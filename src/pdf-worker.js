import { parentPort, workerData } from 'node:worker_threads';

let task;
try {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  task = getDocument({ data: workerData.bytes, verbosity: 0, isEvalSupported: false,
    disableFontFace: true, useSystemFonts: false, useWorkerFetch: false,
    disableAutoFetch: true, disableRange: true, stopAtErrors: true });
  const pdf = await task.promise;
  const { maxPages, maxCharacters, startPage = 1 } = workerData;
  if (startPage > pdf.numPages) {
    parentPort.postMessage({ errorCode: 'PDF_PAGE_OUT_OF_RANGE', pageCount: pdf.numPages });
  } else {
    const pages = [];
    const emptyPages = [];
    const failedPages = [];
    const partialPages = [];
    let characters = 0;
    let nextPage = null;
    let lastAttempted = startPage - 1;
    let truncated = startPage > 1 || pdf.numPages >= startPage + maxPages;
    for (let number = startPage; number <= Math.min(pdf.numPages, startPage + maxPages - 1); number++) {
      lastAttempted = number;
      let page;
      try {
        page = await pdf.getPage(number);
        const content = await page.getTextContent();
        let text = '';
        let lastY;
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue;
          const y = item.transform?.[5];
          if (lastY !== undefined && Math.abs(y - lastY) > 3) text += '\n';
          text += item.str + (item.hasEOL ? '\n' : ' ');
          lastY = y;
          if (text.length >= Math.min(20000, maxCharacters - characters)) {
            truncated = true;
            partialPages.push(number);
            // Retry this page with a fresh budget if earlier pages consumed space.
            if (characters > 0 && maxCharacters - characters < 20000) nextPage = number;
            break;
          }
        }
        text = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
        const remaining = Math.max(0, Math.min(20000, maxCharacters - characters));
        if (text.length > remaining) truncated = true;
        text = text.slice(0, remaining);
        if (!text) emptyPages.push(number);
        pages.push({ pageNumber: number, text });
        characters += text.length;
        if (characters >= maxCharacters) { if (number < pdf.numPages) truncated = true; break; }
      } catch { failedPages.push(number); }
      finally { page?.cleanup(); }
    }
    nextPage ??= lastAttempted < pdf.numPages ? lastAttempted + 1 : null;
    parentPort.postMessage({ pageCount: pdf.numPages, pages, emptyPages, failedPages, partialPages,
      startPage, nextPage, truncated });
  }
} catch (error) {
  parentPort.postMessage({ errorCode: error?.name === 'PasswordException' ? 'PDF_PASSWORD_REQUIRED' : 'PDF_INVALID_OR_UNREADABLE' });
} finally { await task?.destroy().catch(() => {}); }
