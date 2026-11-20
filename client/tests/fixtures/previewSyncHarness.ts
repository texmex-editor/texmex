import * as monaco from 'monaco-editor';
import { PdfPreviewController } from '../../src/utils/preview';
import '../../src/index.css';
import 'pdfjs-dist/web/pdf_viewer.css';

document.body.innerHTML = `<div id="editor" style="position:absolute;left:0;top:0;width:50%;height:600px"></div>
  <div class="texmex-pdf-container" style="position:absolute;left:50%;top:0;width:50%;height:600px;overflow:auto"><div class="pdfViewer"></div></div>`;

const lines = Array.from({ length: 3 }, (_, p) => Array.from({ length: 26 }, (_, n) =>
  `Page ${p + 1} paragraph ${n + 1} explains the document synchronization.`));
const source = '\\documentclass{article}\n\\begin{document}\n' + lines.map((page) => page.join('\n')).join('\n\\newpage\n') + '\n\\end{document}';

// A small real PDF keeps this browser regression independent of the API,
// database and TeX installation. Offsets are bytes because content is ASCII.
function pdfBytes(): Uint8Array {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  lines.forEach((page, p) => {
    const stream = `BT /F1 12 Tf 40 790 Td 28 TL ${page.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + p * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const editor = monaco.editor.create(document.getElementById('editor')!, {
  value: source, language: 'plaintext', automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
});
const container = document.querySelector<HTMLDivElement>('.texmex-pdf-container')!;
const controller = new PdfPreviewController(container, container.firstElementChild as HTMLDivElement);
controller.setSyncEditor(editor);
await controller.loadPdf(pdfBytes());

(window as any).syncHarness = {
  editor, controller, ready: false,
  selectSource(text: string) {
    const model = editor.getModel()!;
    const start = model.getPositionAt(model.getValue().indexOf(text));
    editor.focus();
    editor.setSelection(new monaco.Range(start.lineNumber, start.column, start.lineNumber, start.column + text.length));
  },
  selectedSource() { return editor.getModel()!.getValueInRange(editor.getSelection()!); },
  selectPdf(text: string) {
    container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    editor.getDomNode()!.querySelector('textarea')?.blur();
    const span = Array.from(container.querySelectorAll('.textLayer span')).find((span) => span.textContent?.startsWith(text))!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 0);
    range.setEnd(span.firstChild!, text.length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
  },
  scrollEditorTo(text: string) {
    editor.getDomNode()!.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    const model = editor.getModel()!;
    editor.revealPositionInCenter(model.getPositionAt(model.getValue().indexOf(text)), monaco.editor.ScrollType.Immediate);
  },
  scrollPdfTo(page: number) {
    container.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    const element = container.querySelector<HTMLElement>(`.page[data-page-number="${page}"]`)!;
    container.scrollTop = element.offsetTop + 100;
  },
  switchModel() { editor.setModel(monaco.editor.createModel('Unrelated file')); },
  async reload() { await controller.loadPdf(pdfBytes()); },
};
// Both PDF.js rendering and the asynchronous text index must be ready.
const ready = setInterval(() => {
  if (container.querySelector('.textLayer span')) {
    clearInterval(ready);
    setTimeout(() => { (window as any).syncHarness.ready = true; }, 300);
  }
}, 50);
