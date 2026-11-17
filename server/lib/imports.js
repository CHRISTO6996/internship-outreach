import path from 'node:path';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { fetchDocument } from './http.js';

const NAME_HEADER = /^(company|company[\s_-]?name|organi[sz]ation|org|employer|firm|business|name|brand)$/i;
const WEBSITE_HEADER = /^(website|site|url|domain|web|homepage|company[\s_-]?website)$/i;
const NOTES_HEADER = /^(notes?|remarks?|comments?)$/i;

function normalizeHeader(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function pickHeaderMap(headers) {
  const map = { name: -1, website: -1, notes: -1 };
  headers.forEach((header, index) => {
    const value = normalizeHeader(header);
    if (map.name === -1 && NAME_HEADER.test(value)) map.name = index;
    else if (map.website === -1 && WEBSITE_HEADER.test(value)) map.website = index;
    else if (map.notes === -1 && NOTES_HEADER.test(value)) map.notes = index;
  });
  return map;
}

function rowsToEntries(rows, map) {
  const entries = [];
  for (const row of rows) {
    const name = normalizeHeader(row[map.name >= 0 ? map.name : 0]);
    if (!name) continue;
    if (map.name === -1 && (NAME_HEADER.test(name) || /^company/i.test(name))) continue;
    entries.push({
      name,
      website: map.website >= 0 ? normalizeHeader(row[map.website]) || null : null,
      notes: map.notes >= 0 ? normalizeHeader(row[map.notes]) : '',
    });
  }
  return entries;
}

export function parseCompanyCsv(text) {
  const rows = parseCsv(text, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
  if (!rows.length) return [];
  const headerRow = rows[0].map(normalizeHeader);
  const hasHeader = headerRow.some((cell) => NAME_HEADER.test(cell) || WEBSITE_HEADER.test(cell));
  if (hasHeader) {
    return rowsToEntries(rows.slice(1), pickHeaderMap(headerRow));
  }
  return rowsToEntries(rows, { name: 0, website: -1, notes: -1 });
}

export function parseCompanyText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeHeader(line.replace(/^[-*•\d.)\s]+/, '')))
    .filter((line) => line.length >= 2 && !/^company(\s*name)?$/i.test(line))
    .map((name) => ({ name, website: null, notes: '' }));
}

export async function parseCompanyWorkbook(buffer, filename) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets.find((candidate) => candidate.rowCount > 0);
  if (!sheet) return [];

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const raw = cell.value;
      let value = raw;
      if (raw && typeof raw === 'object') {
        if ('text' in raw) value = raw.text;
        else if ('result' in raw) value = raw.result;
        else if ('richText' in raw) value = raw.richText.map((part) => part.text).join('');
        else if (raw instanceof Date) value = raw.toISOString();
        else value = '';
      }
      values[colNumber - 1] = normalizeHeader(value);
    });
    rows.push(values);
  });

  if (!rows.length) return [];
  const probe = rows.slice(0, 5);
  let headerIndex = probe.findIndex((row) =>
    row.some((cell) => NAME_HEADER.test(String(cell || '')) || WEBSITE_HEADER.test(String(cell || ''))),
  );
  if (headerIndex === -1) headerIndex = 0;
  const headerRow = rows[headerIndex].map((cell) => normalizeHeader(cell));
  const map = pickHeaderMap(headerRow);
  return rowsToEntries(rows.slice(headerIndex + 1), map);
}

export async function parseCompanyFile(buffer, filename) {
  const extension = path.extname(filename || '').toLowerCase();
  if (extension === '.csv' || extension === '.tsv' || extension === '.txt') {
    const text = buffer.toString('utf8');
    return extension === '.txt' ? parseCompanyText(text) : parseCompanyCsv(text);
  }
  if (extension === '.xlsx' || extension === '.xlsm') {
    return parseCompanyWorkbook(buffer, filename);
  }
  throw new Error('Unsupported file type. Upload a .csv, .txt or .xlsx file.');
}

/** Read a Google Sheet that has link sharing enabled, via its CSV export endpoint. */
export async function parseGoogleSheet(url) {
  const match = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('That does not look like a Google Sheets URL');
  const id = match[1];
  const gidMatch = String(url).match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  let page;
  try {
    page = await fetchDocument(exportUrl, { maxBytes: 4_000_000, timeoutMs: 20000 });
  } catch (error) {
    throw new Error(
      `Could not download the sheet (${error.message}). Share it as "Anyone with the link – Viewer", or upload a CSV instead.`,
    );
  }
  if (/<html/i.test(page.text.slice(0, 500)) || /accounts\.google\.com/.test(page.text.slice(0, 2000))) {
    throw new Error(
      'The sheet is not publicly readable. In Google Sheets choose Share → Anyone with the link → Viewer, then try again.',
    );
  }
  return parseCompanyCsv(page.text);
}
