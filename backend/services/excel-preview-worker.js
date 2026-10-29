import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';

// CJS includes legacy codepages for XLS; the version is pinned in package-lock.
const XLSX = createRequire(import.meta.url)('xlsx');
const { limits, filename, sheetIndex } = workerData;
const buffer = Buffer.from(workerData.buffer);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const limit = () => fail('WORKBOOK_LIMIT', 'Превышены лимиты книги: 20 листов, 10000 строк, 256 колонок, 200000 ячеек или 8 МиБ текста.');

// Stream every ZIP entry before SheetJS sees it, including ignored images.
// Feeding only this validated container avoids a second, unbounded ZIP inflater.
function readZip() {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(err);
      const container = XLSX.CFB.utils.cfb_new();
      const names = new Set();
      let declared = 0;
      let inflated = 0;
      const abort = error => { zip.close(); reject(error); };
      zip.on('error', abort);
      zip.on('entry', entry => {
        if (names.has(entry.fileName) || names.size >= limits.entries ||
            (declared += entry.uncompressedSize) > limits.unpackedBytes) {
          return abort(Object.assign(new Error('Архив Excel превышает лимит 50 МиБ/2000 записей или содержит дубликаты.'), { code: 'ARCHIVE_LIMIT' }));
        }
        names.add(entry.fileName);
        if (entry.generalPurposeBitFlag & 1) return abort(Object.assign(new Error('Защищённые паролем книги не поддерживаются.'), { code: 'PROTECTED_WORKBOOK' }));
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return abort(streamError);
          const chunks = [];
          let checksum = 0;
          stream.on('error', abort);
          stream.on('data', chunk => {
            checksum = crc32(chunk, checksum);
            inflated += chunk.length;
            if (inflated > limits.unpackedBytes) {
              stream.destroy(Object.assign(new Error('Распакованный файл превышает 50 МиБ.'), { code: 'ARCHIVE_LIMIT' }));
            } else chunks.push(chunk);
          });
          stream.on('end', () => {
            if (checksum !== entry.crc32) return abort(new Error('Invalid ZIP CRC'));
            XLSX.CFB.utils.cfb_add(container, entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (!names.has('xl/workbook.xml') || !names.has('[Content_Types].xml') ||
            names.has('xl/workbook.bin') || names.has('xl/vbaProject.bin')) {
          return abort(Object.assign(new Error('Содержимое файла не соответствует формату .xlsx.'), { code: 'FORMAT_MISMATCH' }));
        }
        resolve(container);
      });
      zip.readEntry();
    });
  });
}

async function parse() {
  const format = filename.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'xls';
  const isCfb = buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  const options = { cellFormula: true, cellNF: true, cellText: false, sheetStubs: true, WTF: true };
  let book;
  if (isCfb) {
    const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
    if (XLSX.CFB.find(cfb, 'EncryptedPackage')) fail('PROTECTED_WORKBOOK', 'Защищённые паролем книги не поддерживаются.');
    if (format !== 'xls' || !(XLSX.CFB.find(cfb, 'Workbook') || XLSX.CFB.find(cfb, 'Book'))) {
      fail('FORMAT_MISMATCH', 'Содержимое файла не соответствует расширению .xls/.xlsx.');
    }
    book = XLSX.parse_xlscfb(cfb, options);
  } else {
    if (format !== 'xlsx' || buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
      fail('FORMAT_MISMATCH', 'Содержимое файла не соответствует расширению .xls/.xlsx.');
    }
    book = XLSX.parse_zip(await readZip(), options);
  }
  if (!book.SheetNames?.length) fail('INVALID_WORKBOOK', 'В книге нет листов.');
  if (book.SheetNames.length > limits.sheets) limit();
  let cellCount = 0;
  const sheets = book.SheetNames.map((name, index) => {
    const sheet = book.Sheets[name];
    if (!sheet) fail('INVALID_WORKBOOK', 'Не удалось прочитать один из листов книги.');
    let rowCount = 0;
    let columnCount = 0;
    if (sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref']);
      rowCount = range.e.r + 1;
      columnCount = range.e.c + 1;
    }
    // Check actual cells too: an incorrect declared range must not hide data.
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue;
      const position = XLSX.utils.decode_cell(address);
      rowCount = Math.max(rowCount, position.r + 1);
      columnCount = Math.max(columnCount, position.c + 1);
      if (++cellCount > limits.cells) limit();
    }
    if (rowCount > limits.rows || columnCount > limits.columns || rowCount * columnCount > limits.cells) limit();
    return { index, name, rowCount, columnCount, hidden: !!book.Workbook?.Sheets?.[index]?.Hidden };
  });
  const warnings = [{ code: 'OBJECTS_IGNORED', message: 'Изображения, диаграммы и другие встроенные объекты не импортируются. Ссылки остаются значениями; формулы и макросы не исполняются.' }];
  if (sheetIndex === undefined) return { format, sheets, sheet: null, warnings, limits };
  const selected = sheets[sheetIndex];
  if (!selected) fail('SHEET_NOT_FOUND', 'Выбранный лист отсутствует в книге.');
  const sheet = book.Sheets[selected.name];
  const rows = [];
  const values = [];
  let textBytes = 0;
  let emptyRowCount = 0;
  let skippedCellCount = 0;
  for (let rowIndex = 0; rowIndex < selected.rowCount; rowIndex++) {
    const texts = [];
    const raw = [];
    for (let colIndex = 0; colIndex < selected.columnCount; colIndex++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
      let value = cell?.v ?? null;
      let text = value == null ? '' : String(value);
      let code;
      if (cell?.f && (value === null || cell.t === 'z')) code = 'FORMULA_CACHE_MISSING';
      else if (cell?.t === 'e') code = 'CELL_ERROR';
      // BIFF can store an uncalculated formula as numeric zero, indistinguishable
      // from a genuine cached zero. Make this uncertainty explicit before import.
      else if (format === 'xls' && cell?.f && value === 0) code = 'FORMULA_CACHE_UNVERIFIED';
      if (code) {
        if (warnings.length > limits.warnings) fail('WORKBOOK_LIMIT', 'В книге более 1000 предупреждений по ячейкам. Исправьте книгу перед импортом.');
        warnings.push({ code, sheetIndex, rowIndex, colIndex, message: code === 'FORMULA_CACHE_UNVERIFIED'
          ? 'Формула .xls содержит нулевой кеш: он может быть невычисленным. Проверьте результат, пересчитайте и сохраните книгу.'
          : 'Нет сохранённого результата формулы или ячейка содержит ошибку; ячейка пропущена.' });
        if (code !== 'FORMULA_CACHE_UNVERIFIED') {
          value = null;
          text = '';
          skippedCellCount++;
        }
      } else if (cell?.t === 'n' && XLSX.SSF.is_date(cell.z || '')) {
        const date = XLSX.SSF.parse_date_code(value, { date1904: !!book.Workbook?.WBProps?.date1904 });
        if (!date) fail('INVALID_WORKBOOK', 'Некорректная дата в книге.');
        const pad = n => String(n).padStart(2, '0');
        value = `${String(date.y).padStart(4, '0')}-${pad(date.m)}-${pad(date.d)}T${pad(date.H)}:${pad(date.M)}:${pad(date.S)}`;
        text = value;
      } else if (cell?.t === 'n') {
        // SheetJS SSF drops integer padding for formats such as 0000.00.
        const padded = /^(0{1,21})(?:\.(0{1,20}))?$/.exec(cell.z || '');
        text = padded ? new Intl.NumberFormat('en-US', {
          useGrouping: false, minimumIntegerDigits: padded[1].length,
          minimumFractionDigits: padded[2]?.length || 0, maximumFractionDigits: padded[2]?.length || 0,
        }).format(value) : XLSX.utils.format_cell(cell);
      }
      if (typeof value === 'number' && !Number.isFinite(value)) fail('INVALID_WORKBOOK', 'Некорректное число в книге.');
      textBytes += Buffer.byteLength(text) + (typeof value === 'string' ? Buffer.byteLength(value) : 8);
      if (textBytes > limits.textBytes) limit();
      texts.push(text);
      raw.push(value);
    }
    if (raw.every(v => v === null || v === '')) emptyRowCount++;
    rows.push(texts);
    values.push(raw);
  }
  return { format, sheets, sheet: { ...selected, rows, values, emptyRowCount, skippedCellCount }, warnings, limits };
}

try {
  parentPort.postMessage(await parse());
} catch (error) {
  const protectedFile = /password|encrypt/i.test(error.message);
  parentPort.postMessage({ error: {
    code: error.code || (protectedFile ? 'PROTECTED_WORKBOOK' : 'INVALID_WORKBOOK'),
    message: error.code ? error.message : protectedFile
      ? 'Защищённые паролем книги не поддерживаются.'
      : 'Excel-файл повреждён или содержит неподдерживаемые данные.',
  } });
}
