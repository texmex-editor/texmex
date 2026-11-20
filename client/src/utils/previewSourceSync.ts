import type * as monaco from 'monaco-editor';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { mapText, mappedRange, matchTextRange, type TextMap, type TextMatch } from './sourceTextMap';

type PdfPage = { start: number; end: number };
type Viewer = {
  getPageView(index: number): { div: HTMLDivElement };
  scrollPageIntoView(options: { pageNumber: number }): void;
};

/** Text-based navigation also works with PDFs compiled without SyncTeX data.
 * Highlights are overlays, keeping the native selection and keyboard focus intact.
 */
export class PreviewSourceSync {
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private subscriptions: Array<{ dispose(): void }> = [];
  private decorations: monaco.editor.IEditorDecorationsCollection | null = null;
  private pages: PdfPage[] = [];
  private pdf: TextMap = mapText('');
  private sourceCache: { model: monaco.editor.ITextModel; version: number; map: TextMap } | null = null;
  private generation = 0;
  private owner: 'editor' | 'pdf' = 'editor';
  private blockedUntil = 0;
  private applying = false;
  private highlight: TextMatch | null = null;
  private selectionTimer: ReturnType<typeof setTimeout> | undefined;
  private scrollTimer: ReturnType<typeof setTimeout> | undefined;
  private selectionFrame = 0;
  private readonly removers: Array<() => void> = [];

  constructor(private container: HTMLDivElement, private viewer: Viewer) {
    this.listen(document, 'selectionchange', () => {
      clearTimeout(this.selectionTimer);
      this.selectionTimer = setTimeout(() => this.pdfSelection(), 100);
    });
    for (const event of ['wheel', 'pointerdown', 'keydown']) {
      this.listen(container, event, () => { this.owner = 'pdf'; this.blockedUntil = 0; this.pendingReveal = null; });
    }
    this.listen(container, 'scroll', () => this.scheduleScroll('pdf'));
  }

  private listen(target: EventTarget, event: string, callback: EventListener) {
    target.addEventListener(event, callback, { passive: true });
    this.removers.push(() => target.removeEventListener(event, callback));
  }

  setEditor(editor: monaco.editor.IStandaloneCodeEditor | null): void {
    cancelAnimationFrame(this.selectionFrame);
    clearTimeout(this.selectionTimer);
    clearTimeout(this.scrollTimer);
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.subscriptions = [];
    this.decorations?.clear();
    this.editor = editor;
    this.sourceCache = null;
    this.clearHighlight();
    this.decorations = editor?.createDecorationsCollection() ?? null;
    if (!editor) return;
    const dom = editor.getDomNode();
    if (dom) {
      const takeControl = () => { this.owner = 'editor'; this.blockedUntil = 0; this.pendingReveal = null; };
      for (const event of ['wheel', 'pointerdown', 'keydown']) {
        dom.addEventListener(event, takeControl, { passive: true });
        this.subscriptions.push({ dispose: () => dom.removeEventListener(event, takeControl) });
      }
    }
    this.subscriptions.push(
      editor.onDidChangeCursorSelection((event) => {
        if (this.applying || event.source === 'preview-sync' || !editor.hasTextFocus()) return;
        this.owner = 'editor';
        cancelAnimationFrame(this.selectionFrame);
        this.selectionFrame = requestAnimationFrame(() => this.editorSelection());
      }),
      editor.onDidScrollChange((event) => { if (event.scrollTopChanged) this.scheduleScroll('editor'); }),
      editor.onDidChangeModel(() => {
        cancelAnimationFrame(this.selectionFrame);
        clearTimeout(this.scrollTimer);
        this.sourceCache = null;
        this.decorations?.clear();
        this.clearHighlight();
      }),
      editor.onDidChangeModelContent(() => { this.sourceCache = null; this.decorations?.clear(); this.clearHighlight(); }),
      editor.onDidDispose(() => this.setEditor(null)),
    );
  }

  async setDocument(doc: PDFDocumentProxy | null): Promise<void> {
    const generation = ++this.generation;
    this.pages = [];
    this.pdf = mapText('');
    this.decorations?.clear();
    this.clearHighlight();
    if (!doc) return;
    const pages: PdfPage[] = [];
    const pdf: TextMap = mapText('');
    try {
      // Sequential reads keep large projects from flooding the PDF worker.
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        if (generation !== this.generation) return;
        const map = mapText(content.items.map((item) => 'str' in item ? item.str : '').join(''));
        pages.push({ start: pdf.text.length, end: pdf.text.length + map.text.length });
        pdf.text += map.text;
      }
      if (generation !== this.generation) return;
      this.pages = pages;
      this.pdf = pdf;
      if (this.editor?.hasTextFocus()) this.editorSelection();
    } catch {
      // A replaced/destroyed document cancels indexing. Compilation and native
      // PDF selection remain usable if a PDF has no extractable text.
    }
  }

  private source(): TextMap | null {
    const model = this.editor?.getModel();
    if (!model) return null;
    if (this.sourceCache?.model !== model || this.sourceCache.version !== model.getVersionId()) {
      this.sourceCache = { model, version: model.getVersionId(), map: mapText(model.getValue(), true) };
    }
    return this.sourceCache.map;
  }

  private editorSelection(): void {
    const editor = this.editor;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    const source = this.source();
    this.decorations?.clear();
    this.clearHighlight();
    if (!editor || !model || !selection || !source || selection.isEmpty()) return;
    const range = mappedRange(source, model.getOffsetAt(selection.getStartPosition()), model.getOffsetAt(selection.getEndPosition()));
    const match = range && matchTextRange(source, this.pdf, range);
    if (!match) return;
    this.highlight = match;
    this.revealPdf(match);
    this.renderHighlight();
  }

  private pageElement(node: Node | null): HTMLElement | null {
    const element = node instanceof Element ? node : node?.parentElement;
    const page = element?.closest<HTMLElement>('.page[data-page-number]');
    return page && this.container.contains(page) ? page : null;
  }

  private selectionOffset(page: HTMLElement, node: Node, offset: number): number | null {
    const layer = page.querySelector('.textLayer');
    if (!layer?.contains(node)) return null;
    const range = document.createRange();
    range.selectNodeContents(layer);
    range.setEnd(node, offset);
    return mapText(range.toString()).text.length;
  }

  private pdfSelection(): void {
    if (!this.editor || this.applying) return;
    const selection = document.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) {
      if (this.owner === 'pdf') { this.decorations?.clear(); this.clearHighlight(); }
      return;
    }
    const range = selection.getRangeAt(0);
    const first = this.pageElement(range.startContainer);
    const last = this.pageElement(range.endContainer);
    if (!first || !last) return;
    const firstPage = this.pages[Number(first.dataset.pageNumber) - 1];
    const lastPage = this.pages[Number(last.dataset.pageNumber) - 1];
    const start = this.selectionOffset(first, range.startContainer, range.startOffset);
    const end = this.selectionOffset(last, range.endContainer, range.endOffset);
    const source = this.source();
    const model = this.editor.getModel();
    this.decorations?.clear();
    this.clearHighlight();
    if (!firstPage || !lastPage || start === null || end === null || !source || !model) return;
    const match = matchTextRange(this.pdf, source, { start: firstPage.start + start, end: lastPage.start + end });
    if (!match) return;
    const from = model.getPositionAt(source.offsets[match.start]);
    const to = model.getPositionAt(source.ends[match.end - 1]);
    const editorRange = { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column };
    this.owner = 'pdf';
    this.applying = true;
    this.blockedUntil = performance.now() + 250;
    try {
      this.editor.setSelection(editorRange, 'preview-sync');
      this.decorations?.set([{ range: editorRange, options: { className: 'source-sync-selection' } }]);
      this.editor.revealRangeInCenterIfOutsideViewport(editorRange, 1);
    } finally { this.applying = false; }
  }

  private scheduleScroll(owner: 'editor' | 'pdf'): void {
    if (this.owner !== owner || performance.now() < this.blockedUntil) return;
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      if (this.owner !== owner || performance.now() < this.blockedUntil) return;
      if (owner === 'editor') this.editorScroll();
      else this.pdfScroll();
    }, 80);
  }

  private editorScroll(): void {
    const editor = this.editor;
    const model = editor?.getModel();
    const source = this.source();
    if (!editor || !model || !source) return;
    const line = editor.getTargetAtClientPoint(
      (editor.getDomNode()?.getBoundingClientRect().left ?? 0) + editor.getLayoutInfo().contentLeft + 10,
      (editor.getDomNode()?.getBoundingClientRect().top ?? 0) + editor.getLayoutInfo().height / 2,
    )?.position?.lineNumber ?? editor.getVisibleRanges()[0]?.startLineNumber;
    if (!line) return;
    // Nearby lines handle blank lines and commands without visible text.
    for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
      const candidate = line + delta;
      if (candidate < 1 || candidate > model.getLineCount()) continue;
      const start = model.getOffsetAt({ lineNumber: candidate, column: 1 });
      const range = mappedRange(source, start, start + model.getLineLength(candidate));
      if (!range || range.end - range.start < 4) continue;
      const match = matchTextRange(source, this.pdf, range);
      if (match) { this.revealPdf(match); return; }
    }
  }

  private pdfScroll(): void {
    const source = this.source();
    const editor = this.editor;
    const model = editor?.getModel();
    if (!source || !editor || !model) return;
    const bounds = this.container.getBoundingClientRect();
    const center = bounds.top + bounds.height / 2;
    const spans = this.container.querySelectorAll<HTMLElement>('.textLayer span');
    let best: HTMLElement | null = null;
    let distance = Infinity;
    for (const span of spans) {
      if (span.childElementCount || !span.textContent?.trim()) continue;
      const rect = span.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
      const next = Math.abs(rect.top + rect.height / 2 - center);
      if (next < distance) { best = span; distance = next; }
    }
    const page = best && this.pageElement(best);
    if (!best || !page) return;
    const indexedPage = this.pages[Number(page.dataset.pageNumber) - 1];
    const offset = this.selectionOffset(page, best, 0);
    if (!indexedPage || offset === null) return;
    const start = indexedPage.start + offset;
    const match = matchTextRange(this.pdf, source, { start, end: start + mapText(best.textContent ?? '').text.length });
    if (!match) return;
    this.blockedUntil = performance.now() + 250;
    editor.revealPositionInCenter(model.getPositionAt(source.offsets[match.start]), 1);
  }

  private revealPdf(match: TextMatch): void {
    this.pendingReveal = null;
    const index = this.pages.findIndex((page) => match.start >= page.start && match.start < page.end);
    if (index < 0) return;
    this.blockedUntil = performance.now() + 250;
    const page = this.viewer.getPageView(index)?.div;
    if (!page) return;
    const range = this.domRange(page, match.start - this.pages[index].start, Math.min(match.end, this.pages[index].end) - this.pages[index].start);
    if (range) {
      const rect = range.getBoundingClientRect();
      const bounds = this.container.getBoundingClientRect();
      this.container.scrollTop += rect.top - bounds.top - bounds.height / 2 + rect.height / 2;
      if (rect.left < bounds.left || rect.right > bounds.right) {
        this.container.scrollLeft += rect.left - bounds.left - 20;
      }
    } else {
      // PDF.js lazily builds text layers. Navigate to the page first; the
      // textlayerrendered callback will finish positioning at the exact text.
      this.pendingReveal = match;
      this.viewer.scrollPageIntoView({ pageNumber: index + 1 });
    }
  }

  private pendingReveal: TextMatch | null = null;

  textLayerRendered(): void {
    if (this.pendingReveal) {
      const match = this.pendingReveal;
      this.pendingReveal = null;
      this.revealPdf(match);
    }
    this.renderHighlight();
  }

  private domRange(page: HTMLElement, start: number, end: number): Range | null {
    const layer = page.querySelector('.textLayer');
    if (!layer) return null;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Node; start: number; end: number }> = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, start: text.length, end: text.length + (node.textContent?.length ?? 0) });
      text += node.textContent ?? '';
    }
    const map = mapText(text);
    const firstOffset = map.offsets[start];
    const lastOffset = map.ends[end - 1];
    if (firstOffset === undefined || lastOffset === undefined) return null;
    const first = nodes.find((node) => node.end > firstOffset);
    const last = nodes.find((node) => node.end >= lastOffset);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, firstOffset - first.start);
    range.setEnd(last.node, lastOffset - last.start);
    return range;
  }

  private textRects(range: Range): DOMRect[] {
    if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) return Array.from(range.getClientRects());
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    const rects: DOMRect[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.setStart(node, node === range.startContainer ? range.startOffset : 0);
      part.setEnd(node, node === range.endContainer ? range.endOffset : node.textContent?.length ?? 0);
      rects.push(...Array.from(part.getClientRects()));
    }
    return rects;
  }

  renderHighlight(): void {
    this.container.querySelectorAll('.pdf-source-sync-highlight').forEach((element) => element.remove());
    if (!this.highlight) return;
    this.pages.forEach((indexed, index) => {
      const start = Math.max(this.highlight!.start, indexed.start);
      const end = Math.min(this.highlight!.end, indexed.end);
      if (end <= start) return;
      const page = this.viewer.getPageView(index)?.div;
      if (!page) return;
      const range = this.domRange(page, start - indexed.start, end - indexed.start);
      if (!range) return;
      const bounds = page.getBoundingClientRect();
      // Range.getClientRects also includes containing spans for multi-span
      // selections. Read text nodes separately to avoid painting them twice.
      for (const rect of this.textRects(range)) {
        if (!rect.width || !rect.height) continue;
        const mark = document.createElement('div');
        mark.className = 'pdf-source-sync-highlight';
        mark.style.left = `${100 * (rect.left - bounds.left) / bounds.width}%`;
        mark.style.top = `${100 * (rect.top - bounds.top) / bounds.height}%`;
        mark.style.width = `${100 * rect.width / bounds.width}%`;
        mark.style.height = `${100 * rect.height / bounds.height}%`;
        mark.setAttribute('aria-hidden', 'true');
        page.appendChild(mark);
      }
    });
  }

  private clearHighlight(): void {
    this.highlight = null;
    this.pendingReveal = null;
    this.renderHighlight();
  }

  destroy(): void {
    ++this.generation;
    clearTimeout(this.selectionTimer);
    clearTimeout(this.scrollTimer);
    cancelAnimationFrame(this.selectionFrame);
    this.setEditor(null);
    this.removers.forEach((remove) => remove());
    this.pages = [];
  }
}
