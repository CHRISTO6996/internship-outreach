import { Router } from 'express';
import ExcelJS from 'exceljs';
import { listCompanies } from '../services/companies.js';

export const exportRouter = Router();

const COLUMNS = [
  { header: 'Company Name', key: 'name', width: 32 },
  { header: 'Website', key: 'website', width: 38 },
  { header: 'Company Email', key: 'primaryEmail', width: 34 },
  { header: 'Email Source', key: 'emailSource', width: 48 },
  { header: 'Verification', key: 'verification', width: 14 },
  { header: 'Email Status', key: 'emailStatus', width: 14 },
  { header: 'Date Sent', key: 'dateSent', width: 24 },
  { header: 'Gmail Message ID', key: 'gmailMessageId', width: 26 },
  { header: 'Reply Status', key: 'replyStatus', width: 14 },
  { header: 'Reply Details', key: 'replyDetails', width: 26 },
  { header: 'Follow-up Status', key: 'followUpStatus', width: 18 },
  { header: 'Notes', key: 'notes', width: 40 },
];

function exportRows() {
  const { rows } = listCompanies({ limit: 1000 });
  return rows.map((company) => ({
    name: company.name,
    website: company.website || '',
    primaryEmail: company.primaryEmail || '',
    emailSource: company.emailSource || '',
    verification: company.verification ? capitalize(company.verification) : '',
    emailStatus: company.emailStatus === 'sent' ? 'Sent' : company.emailStatus === 'failed' ? 'Failed' : 'Not Sent',
    dateSent: company.dateSent || '',
    gmailMessageId: company.gmailMessageId || '',
    replyStatus: company.replyStatus === 'replied' ? 'Replied' : company.replyStatus === 'no_reply' ? 'No Reply' : '',
    replyDetails: company.lastReplyClassification ? capitalize(company.lastReplyClassification) : '',
    followUpStatus: company.followUpStatus === 'none' ? '' : capitalize(company.followUpStatus),
    notes: company.notes || '',
  }));
}

function capitalize(value) {
  return String(value || '').replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

exportRouter.get('/companies', async (req, res, next) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const rows = exportRows();
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Internship Outreach';
      const sheet = workbook.addWorksheet('Companies');
      sheet.columns = COLUMNS;
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      for (const row of rows) sheet.addRow(row);
      sheet.autoFilter = { from: 'A1', to: `L${rows.length + 1}` };
      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="companies-${stamp}.xlsx"`);
      res.end(Buffer.from(buffer));
      return;
    }

    const header = COLUMNS.map((column) => csvEscape(column.header)).join(',');
    const body = rows
      .map((row) => COLUMNS.map((column) => csvEscape(row[column.key])).join(','))
      .join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="companies-${stamp}.csv"`);
    res.end(`\uFEFF${header}\r\n${body}`);
  } catch (error) {
    next(error);
  }
});
