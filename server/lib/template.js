/** Replace {{placeholders}} in a template string. Unknown keys render as empty text. */
export function renderTemplate(template, values) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = values?.[key];
    return value === undefined || value === null || value === '' ? '' : String(value);
  });
}
