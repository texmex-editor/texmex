export type LatexPackageRule = {
  name: string
  detect: RegExp
}

// Central registry for package requirements. Add new rules here to keep
// detection and auto-insertion behavior consistent across the editor.
export const LATEX_PACKAGE_RULES = [
  {
    name: 'xcolor',
    detect: /\\textcolor\b|\\color\b|\\definecolor\b/,
  },
  {
    name: 'amsmath',
    detect: /\\text\b|\\eqref\b|\\DeclareMathOperator\b|\\begin\{(?:align|gather|multline|cases|split|bmatrix|pmatrix|vmatrix|Vmatrix|smallmatrix)\*?\}/,
  },
  {
    name: 'amssymb',
    detect: /\\mathbb\b|\\mathfrak\b|\\checkmark\b|\\angle\b|\\square\b|\\lozenge\b|\\blacklozenge\b|\\sphericalangle\b|\\complement\b|\\eth\b|\\Finv\b|\\Game\b|\\hbar\b|\\hslash\b|\\Im\b|\\intercal\b|\\mho\b|\\Re\b|\\wp\b/,
  },
  {
    name: 'graphicx',
    detect: /\\includegraphics\b/,
  },
] as const satisfies readonly LatexPackageRule[]

export type LatexPackageName =
  | (typeof LATEX_PACKAGE_RULES)[number]['name']
  | (string & {})

export function detectRequiredPackages(
  source: string,
  _options?: { autoInsertOnly?: boolean },
): LatexPackageName[] {
  if (!source) return []

  const required: LatexPackageName[] = []
  for (const rule of LATEX_PACKAGE_RULES) {
    if (rule.detect.test(source)) {
      required.push(rule.name)
    }
  }
  return required
}
