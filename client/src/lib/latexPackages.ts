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
