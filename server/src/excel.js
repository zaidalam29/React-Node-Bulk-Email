import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { config } from './config.js';
import { AppError } from './errors.js';

const EMAIL_RE =
  /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

export const STATUS_HEADERS = {
  status: 'Email Status',
  sentAt: 'Sent At',
  error: 'Email Error',
};

export const MARKS = {
  sent: '✔ Sent',
  failed: '✘ Failed',
  skipped: '⚠ Skipped',
};

const STYLES = {
  sent: { fill: 'FFD1FADF', font: 'FF067647' },
  failed: { fill: 'FFFEE4E2', font: 'FFB42318' },
  skipped: { fill: 'FFFEF0C7', font: 'FF93370D' },
};

export const isValidEmail = (value) => value.length <= 254 && EMAIL_RE.test(value);

export function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('').trim();
    if ('formula' in value || 'sharedFormula' in value) return cellText(value.result);
    if ('text' in value) return cellText(value.text);
    if ('hyperlink' in value) return String(value.hyperlink).replace(/^mailto:/i, '').trim();
    if ('error' in value) return '';
  }
  return String(value).trim();
}

const splitEmails = (text) =>
  text
    .split(/[,;\s]+/)
    .map((part) => part.replace(/^mailto:/i, '').trim())
    .filter(Boolean);

const findHeader = (headers, title) => {
  const index = headers.findIndex((h) => h.toLowerCase() === title.toLowerCase());
  return index === -1 ? null : index + 1;
};

function detectEmailColumn(ws, headers, excluded) {
  const byName = headers.findIndex(
    (h, i) => !excluded.has(i + 1) && /e[\s_-]?mail|mail\s*id|gmail/i.test(h),
  );
  if (byName !== -1) return byName + 1;

  let best = null;
  let bestCount = 0;
  const lastRow = Math.min(ws.rowCount, 51);
  for (let col = 1; col <= headers.length; col++) {
    if (excluded.has(col)) continue;
    let count = 0;
    for (let r = 2; r <= lastRow; r++) {
      if (splitEmails(cellText(ws.getRow(r).getCell(col).value)).some(isValidEmail)) count++;
    }
    if (count > bestCount) {
      best = col;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Reads the first non-empty worksheet. Row 1 must be the header row.
 * Status columns are appended (or reused if they already exist) so the
 * same file can be re-run and only unsent rows are picked up.
 */
export async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch {
    throw new AppError('Could not read the Excel file. Please upload a valid .xlsx file.', 400);
  }

  const ws = workbook.worksheets.find((sheet) => sheet.actualRowCount > 0);
  if (!ws) throw new AppError('The Excel file is empty.', 400);
  if (ws.rowCount < 2) throw new AppError('The Excel file has no data rows below the header.', 400);

  const headerRow = ws.getRow(1);
  const lastCol = Math.max(ws.columnCount, headerRow.cellCount);
  const headers = [];
  for (let c = 1; c <= lastCol; c++) headers.push(cellText(headerRow.getCell(c).value));
  while (headers.length && !headers.at(-1)) headers.pop();

  const statusCols = {};
  let nextCol = Math.max(lastCol, headers.length) + 1;
  for (const [key, title] of Object.entries(STATUS_HEADERS)) {
    let col = findHeader(headers, title);
    if (!col) {
      col = nextCol++;
      const cell = headerRow.getCell(col);
      cell.value = title;
      cell.font = { bold: true };
      ws.getColumn(col).width = key === 'error' ? 40 : 22;
    }
    statusCols[key] = col;
  }

  const excluded = new Set(Object.values(statusCols));
  const dataCols = headers
    .map((h, i) => ({ col: i + 1, name: h || `Column ${i + 1}` }))
    .filter(({ col }) => !excluded.has(col));

  const emailCol = detectEmailColumn(ws, headers, excluded);
  if (!emailCol) {
    throw new AppError('No email column found. Add a header named "Email" in the first row.', 400);
  }

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const data = {};
    let hasData = false;
    for (const { col, name } of dataCols) {
      const text = cellText(row.getCell(col).value);
      data[name] = text;
      if (text) hasData = true;
    }
    if (!hasData) continue;

    const raw = cellText(row.getCell(emailCol).value);
    const parts = splitEmails(raw);
    rows.push({
      rowNumber: r,
      raw,
      emails: [...new Set(parts.filter(isValidEmail).map((e) => e.toLowerCase()))],
      invalid: parts.filter((p) => !isValidEmail(p)),
      data,
      alreadySent: cellText(row.getCell(statusCols.status).value).startsWith('✔'),
    });
  }

  if (!rows.length) throw new AppError('No data rows found in the Excel file.', 400);

  return {
    workbook,
    worksheet: ws,
    headers: dataCols.map((d) => d.name),
    emailHeader: headers[emailCol - 1] || `Column ${emailCol}`,
    statusCols,
    rows,
  };
}

const formatTimestamp = (date = new Date()) =>
  date.toLocaleString('en-IN', {
    timeZone: config.timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

export function markRow(ws, statusCols, rowNumber, kind, error = '') {
  const row = ws.getRow(rowNumber);
  const style = STYLES[kind];

  const status = row.getCell(statusCols.status);
  status.value = MARKS[kind];
  status.font = { bold: true, color: { argb: style.font } };
  status.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
  status.alignment = { horizontal: 'center', vertical: 'middle' };

  row.getCell(statusCols.sentAt).value = kind === 'sent' ? formatTimestamp() : null;
  row.getCell(statusCols.error).value = error || null;
}

export async function saveWorkbook(workbook, filePath) {
  const tmp = `${filePath}.tmp`;
  await workbook.xlsx.writeFile(tmp);
  await fs.rename(tmp, filePath);
}

export function buildSampleWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Recipients');
  ws.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Email', key: 'email', width: 34 },
    { header: 'Company', key: 'company', width: 24 },
  ];
  ws.addRows([
    { name: 'Rahul Sharma', email: 'rahul@example.com', company: 'Acme Pvt Ltd' },
    { name: 'Priya Verma', email: 'priya@example.com', company: 'Globex' },
  ]);
  ws.getRow(1).font = { bold: true };
  return workbook;
}
