import { Worker } from 'node:worker_threads';
import { z } from 'zod';

export const EXCEL_LIMITS = Object.freeze({
  fileBytes: 10 * 1024 * 1024, unpackedBytes: 50 * 1024 * 1024,
  entries: 2000, sheets: 20, rows: 10000, columns: 256, cells: 200000,
  textBytes: 8 * 1024 * 1024, warnings: 1000, timeoutMs: 15000,
});
const inputSchema = z.object({
  filename: z.string().max(255).regex(/\.(xlsx|xls)$/i),
  sheetIndex: z.number().int().min(0).optional(),
});
let active = 0;

// Each preview has its own bounded heap and deadline; no DB or persistent files.
export async function previewExcel(buffer, filename, sheetIndex) {
  const input = inputSchema.safeParse({ filename, sheetIndex });
  if (!input.success || !Buffer.isBuffer(buffer)) {
    throw Object.assign(new Error('Выберите файл .xlsx или .xls и корректный лист.'), { code: 'INVALID_INPUT' });
  }
  if (!buffer.length || buffer.length > EXCEL_LIMITS.fileBytes) {
    throw Object.assign(new Error('Размер Excel-файла должен быть от 1 байта до 10 МиБ.'), { code: 'FILE_LIMIT' });
  }
  if (active >= 2) throw Object.assign(new Error('Импорт занят. Повторите позже.'), { code: 'PREVIEW_BUSY' });
  active++;
  let worker;
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      worker = new Worker(new URL('./excel-preview-worker.js', import.meta.url), {
        workerData: { buffer, ...input.data, limits: EXCEL_LIMITS },
        resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 16 },
        env: {}, execArgv: [], stdout: true, stderr: true,
      });
      // Parser diagnostics can contain cell content; never put them in server logs.
      worker.stdout.resume();
      worker.stderr.resume();
      timer = setTimeout(() => reject(Object.assign(new Error('Превышено время разбора Excel-файла.'), { code: 'PREVIEW_TIMEOUT' })), EXCEL_LIMITS.timeoutMs);
      worker.once('message', result => result.error
        ? reject(Object.assign(new Error(result.error.message), { code: result.error.code }))
        : resolve(result));
      worker.once('error', () => reject(Object.assign(new Error('Не удалось разобрать Excel-файл в пределах лимитов.'), { code: 'WORKBOOK_LIMIT' })));
      worker.once('exit', () => reject(Object.assign(new Error('Разбор Excel-файла прерван.'), { code: 'INVALID_WORKBOOK' })));
    });
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate();
    active--;
  }
}
