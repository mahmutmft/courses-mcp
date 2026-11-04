import { Worker } from 'node:worker_threads';

export const pdfLimits = Object.freeze({ bytes: 10 * 1024 * 1024, pages: 30, characters: 60000, milliseconds: 10000 });

export async function extractPdfText(buffer, { limits = pdfLimits, workerUrl = new URL('./pdf-worker.js', import.meta.url) } = {}) {
  if (buffer.byteLength > limits.bytes) return { errorCode: 'PDF_SIZE_LIMIT' };
  if (!Buffer.from(buffer).subarray(0, 1024).includes(Buffer.from('%PDF-'))) return { errorCode: 'PDF_INVALID_SIGNATURE' };
  const bytes = new Uint8Array(buffer);
  return new Promise(resolve => {
    let worker;
    let timer;
    let settled = false;
    const finish = async result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // End parser work before returning; never expose raw worker diagnostics.
      await worker?.terminate().catch(() => {});
      resolve(result);
    };
    try {
      worker = new Worker(workerUrl, { workerData: { bytes, maxPages: limits.pages, maxCharacters: limits.characters },
        transferList: [bytes.buffer], execArgv: [], stdout: true, stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
      worker.stdout.resume();
      worker.stderr.resume();
      timer = setTimeout(() => { void finish({ errorCode: 'PDF_PARSE_TIMEOUT' }); }, limits.milliseconds);
      worker.once('message', result => { void finish(result); });
      worker.once('error', () => { void finish({ errorCode: 'PDF_PARSER_FAILED' }); });
      worker.once('exit', () => { void finish({ errorCode: 'PDF_PARSER_FAILED' }); });
    } catch { void finish({ errorCode: 'PDF_PARSER_FAILED' }); }
  });
}
