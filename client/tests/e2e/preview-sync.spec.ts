import { test, expect } from '@playwright/test';
import { mapText, mappedRange, matchTextRange } from '../../src/utils/sourceTextMap';

test('text mapping tolerates LaTeX formatting, ligatures, line breaks and comments', () => {
  const source = 'An \\textbf{office} with % hidden office\n hyphenated words.';
  const from = mapText(source, true);
  const pdf = mapText('An ofﬁce with hyphen-\nated words.');
  expect(from.text).toBe(pdf.text);
  const range = mappedRange(from, source.indexOf('office'), source.indexOf('office') + 6)!;
  const match = matchTextRange(from, pdf, range)!;
  expect(pdf.text.slice(match.start, match.end)).toBe('office');
  expect(source.slice(from.offsets[range.start], from.ends[range.end - 1])).toBe('office');
});

test('repeated text uses context and ambiguous or missing text is not guessed', () => {
  const source = mapText('First result is good. Second result is better.');
  const target = mapText('1 First result is good. Second result is better. 2');
  const start = source.text.lastIndexOf('result');
  const match = matchTextRange(source, target, { start, end: start + 6 })!;
  expect(match.start).toBe(target.text.lastIndexOf('result'));
  expect(matchTextRange(mapText('word'), mapText('word word'), { start: 0, end: 4 })).toBeNull();
  expect(matchTextRange(mapText('missing'), target, { start: 0, end: 7 })).toBeNull();
});

test.beforeEach(async ({ page }, info) => {
  if (info.title.startsWith('text mapping') || info.title.startsWith('repeated text')) return;
  await page.route('**/preview-sync-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<html><body style="margin:0"><script type="module" src="/tests/fixtures/previewSyncHarness.ts"></script></body></html>',
  }));
  await page.goto('/preview-sync-test');
  await page.waitForFunction(() => (window as any).syncHarness?.ready);
});

test('editor selection highlights a lazy PDF page, reverse selection retains PDF focus', async ({ page }) => {
  await page.evaluate(() => (window as any).syncHarness.selectSource('Page 3 paragraph 20'));
  await expect(page.locator('.page[data-page-number="3"] .pdf-source-sync-highlight').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const mark = document.querySelector('.page[data-page-number="3"] .pdf-source-sync-highlight')!.getBoundingClientRect();
    const container = document.querySelector('.texmex-pdf-container')!.getBoundingClientRect();
    return Math.abs(mark.top + mark.height / 2 - container.top - container.height / 2);
  })).toBeLessThan(30);
  expect(await page.evaluate(() => (window as any).syncHarness.editor.hasTextFocus())).toBe(true);
  await page.evaluate(() => (window as any).syncHarness.selectPdf('Page 3 paragraph 21'));
  await expect.poll(() => page.evaluate(() => (window as any).syncHarness.selectedSource())).toBe('Page 3 paragraph 21');
  await expect(page.locator('.source-sync-selection').first()).toBeVisible();
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('Page 3 paragraph 21');
  expect(await page.evaluate(() => (window as any).syncHarness.editor.hasTextFocus())).toBe(false);
});

test('scroll follows text in both directions without changing the selection or bouncing', async ({ page }) => {
  await page.evaluate(() => (window as any).syncHarness.scrollEditorTo('Page 3 paragraph 10'));
  await expect.poll(() => page.evaluate(() => document.querySelector('.texmex-pdf-container')!.scrollTop)).toBeGreaterThan(1000);
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => (window as any).syncHarness.editor.getSelection().toString());
  await page.evaluate(() => (window as any).syncHarness.scrollPdfTo(1));
  await expect.poll(() => page.evaluate(() => (window as any).syncHarness.editor.getVisibleRanges()[0].startLineNumber)).toBeLessThan(25);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.querySelector('.texmex-pdf-container')!.scrollTop)).toBeLessThan(1000);
  expect(await page.evaluate(() => (window as any).syncHarness.editor.getSelection().toString())).toBe(before);
});

test('highlights survive zoom and are cleared on model switch and recompile', async ({ page }) => {
  await page.evaluate(() => (window as any).syncHarness.selectSource('Page 1 paragraph 10'));
  await expect(page.locator('.pdf-source-sync-highlight').first()).toBeVisible();
  await page.evaluate(() => (window as any).syncHarness.controller.setScale(1.5));
  await expect.poll(() => page.locator('.pdf-source-sync-highlight').count()).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).syncHarness.switchModel());
  await expect(page.locator('.pdf-source-sync-highlight')).toHaveCount(0);
  await page.evaluate(() => (window as any).syncHarness.reload());
  await expect(page.locator('.pdf-source-sync-highlight')).toHaveCount(0);
});
