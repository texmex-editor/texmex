import { exec } from "child_process";
import express, { Request, Response } from "express";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 9000;
const COMPILE_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BUFFER_BYTES = 10 * 1024 * 1024;

interface CompileFile {
  filename: string;
  data: string; // base64-encoded binary
}

interface CompileRequest {
  source: string;
  entrypoint?: string; // defaults to "main.tex"
  files?: CompileFile[];
}

function quote(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

// Auto-detect when a document needs the latex -> dvips -> ps2pdf pipeline.
// TODO: support user-selectable compiler (pdflatex / xelatex / lualatex / latex+dvips)
// like Overleaf does — would replace this regex with an explicit Document.Engine field.
function needsDvipsPipeline(source: string): boolean {
  const dvipsPackagePattern =
    /\\usepackage(?:\[[^\]]*])?\{[^}]*\b(?:tree-dvips|lingmacros)\b[^}]*\}/m;
  return dvipsPackagePattern.test(source);
}

function hasPdflatexFriendlyGraphicAssets(
  files: CompileFile[] | undefined,
): boolean {
  if (!files || files.length === 0) return false;

  return files.some((file) => {
    const lower = file.filename.toLowerCase();
    return (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".pdf")
    );
  });
}

function shouldTryDvipsFallback(
  source: string,
  files: CompileFile[] | undefined,
  error: unknown,
): boolean {
  if (hasPdflatexFriendlyGraphicAssets(files)) return false;

  const errorText = String(error ?? "");
  if (needsDvipsPipeline(source)) return true;

  return (
    errorText.includes("tree-dvips") ||
    errorText.includes("lingmacros") ||
    errorText.includes("Unknown graphics extension")
  );
}

function injectPlaceholderMacro(source: string): string {
  if (/\\(?:providecommand|newcommand)\{\\placeholder\}\[1\]/.test(source)) {
    return source;
  }

  const placeholderDefinition = "\\providecommand{\\placeholder}[1]{}\n";
  const documentClassMatch = /\\documentclass(?:\[[^\]]*])?\{[^}]+\}/.exec(
    source,
  );
  if (documentClassMatch) {
    const insertIndex = documentClassMatch.index + documentClassMatch[0].length;
    return `${source.slice(0, insertIndex)}\n${placeholderDefinition}${source.slice(insertIndex)}`;
  }

  const beginDocumentMatch = /\\begin\{document\}/.exec(source);
  if (beginDocumentMatch) {
    return `${source.slice(0, beginDocumentMatch.index)}${placeholderDefinition}${source.slice(beginDocumentMatch.index)}`;
  }

  return `${placeholderDefinition}${source}`;
}

async function runCommand(command: string, cwd: string): Promise<void> {
  await execAsync(command, {
    cwd,
    env: {
      ...process.env,
      // Allow TeX to resolve \input/\include files from any nested folder in the compile workspace.
      TEXINPUTS: `${cwd}//:`,
    },
    timeout: COMPILE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
  });
}

function collectIncludeDirectories(
  workDir: string,
  files: CompileFile[] | undefined,
): string[] {
  const dirs = new Set<string>([workDir]);

  if (!files || files.length === 0) return [...dirs];

  for (const file of files) {
    const filename = file.filename?.trim();
    if (!filename) continue;
    const filePath = resolveFilePath(workDir, filename);
    if (!filePath) continue;
    dirs.add(dirname(filePath));
  }

  return [...dirs];
}

// latexmk wrappers
async function compileWithPdfLatex(
  texFile: string,
  workDir: string,
): Promise<void> {
  const cmd = [
    "latexmk",
    "-pdf",
    "-interaction=nonstopmode",
    "-no-shell-escape",
    "-halt-on-error",
    `-outdir=${quote(workDir)}`,
    quote(texFile),
  ].join(" ");

  await runCommand(cmd, workDir);
}

async function compileWithDvips(
  texFile: string,
  workDir: string,
): Promise<void> {
  const cmd = [
    "latexmk",
    "-pdfdvi",
    "-interaction=nonstopmode",
    "-no-shell-escape",
    "-halt-on-error",
    `-outdir=${quote(workDir)}`,
    quote(texFile),
  ].join(" ");

  await runCommand(cmd, workDir);
}

// Resolves a filename to a safe path inside workDir, or null if the name looks suspicious.
function resolveFilePath(workDir: string, filename: string): string | null {
  if (/[\x00-\x1f\x7f-\xff\\%]/.test(filename)) return null;
  if (
    filename.startsWith("/") ||
    filename.includes("..") ||
    filename.includes("//")
  )
    return null;
  if (filename.endsWith("/")) return null;

  const resolved = resolve(workDir, filename);
  if (!resolved.startsWith(workDir + "/")) return null;

  return resolved;
}

app.post("/compile", async (req: Request, res: Response) => {
  const { source, entrypoint, files } = req.body as CompileRequest;

  if (!source || typeof source !== "string") {
    res.status(400).json({ error: "Missing or invalid source field" });
    return;
  }

  const entrypointName =
    entrypoint && typeof entrypoint === "string" ? entrypoint : "main.tex";
  // baseName is used to locate the OUTPUT pdf + log files, which latexmk
  // writes to --outdir using the entrypoint's BARE BASENAME (no directory
  // segment). When the entrypoint is nested (e.g. "lol/main.tex"), the
  // input goes into workDir/lol/main.tex but pdflatex still writes the
  // outputs as workDir/main.pdf and workDir/main.log. Without stripping
  // the directory here, existsSync(pdfFile) always returns false for
  // nested entrypoints and the response falls through to the "PDF not
  // generated — check LaTeX source" branch even though pdflatex actually
  // succeeded. Symptom: every doc with an entrypoint inside a folder
  // failed to compile with that generic 422 message.
  const baseName = entrypointName
    .replace(/^.*\//, "")
    .replace(/\.tex$/, "");

  const workDir = mkdtempSync(join(tmpdir(), "latex-"));

  try {
    const texFile = join(workDir, entrypointName);
    const pdfFile = join(workDir, `${baseName}.pdf`);
    const compileSource = injectPlaceholderMacro(source);

    // Write auxiliary files before the main source so they're available during compilation
    if (files && Array.isArray(files)) {
      for (const file of files) {
        // Accept empty file data (""), only reject non-strings
        if (typeof file.filename !== "string" || typeof file.data !== "string")
          continue;

        const filePath = resolveFilePath(workDir, file.filename);
        if (!filePath) {
          console.warn(`[compiler] Rejected unsafe filename: ${file.filename}`);
          continue;
        }

        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, Buffer.from(file.data, "base64"));
      }
    }

    mkdirSync(dirname(texFile), { recursive: true });
    writeFileSync(texFile, compileSource, "utf-8");
    const includeDirs = collectIncludeDirectories(workDir, files);

    const prefersDvips = needsDvipsPipeline(source);
    const hasPdflatexGraphics = hasPdflatexFriendlyGraphicAssets(files);

    if (prefersDvips && !hasPdflatexGraphics) {
      await compileWithDvips(texFile, workDir);
    } else {
      try {
        await compileWithPdfLatex(texFile, workDir);
      } catch (pdfLatexError: unknown) {
        if (shouldTryDvipsFallback(source, files, pdfLatexError)) {
          await compileWithDvips(texFile, workDir);
        } else {
          throw pdfLatexError;
        }
      }
    }

    if (!existsSync(pdfFile)) {
      const logFile = join(workDir, `${baseName}.log`);
      const log = existsSync(logFile)
        ? readFileSync(logFile, "utf-8")
        : "PDF not generated — check LaTeX source";
      res.status(422).json({ error: log });
      return;
    }

    const pdf = readFileSync(pdfFile);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length.toString());
    res.send(pdf);
  } catch (err: unknown) {
    const logFile = join(workDir, `${baseName}.log`);
    const log = existsSync(logFile)
      ? readFileSync(logFile, "utf-8")
      : String(err);
    res.status(422).json({ error: log });
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`latex-compiler listening on port ${PORT}`);
});
