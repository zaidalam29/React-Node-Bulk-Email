const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

const normalize = (key) => String(key).trim().toLowerCase().replace(/\s+/g, ' ');

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function findUnknownPlaceholders(text, headers) {
  const known = new Set(headers.map(normalize));
  const unknown = new Set();
  for (const [, key] of text.matchAll(PLACEHOLDER_RE)) {
    if (!known.has(normalize(key))) unknown.add(key.trim());
  }
  return [...unknown];
}

export function renderTemplate(text, data, { escape = false } = {}) {
  const lookup = new Map(Object.entries(data).map(([k, v]) => [normalize(k), v ?? '']));
  return text.replace(PLACEHOLDER_RE, (match, key) => {
    const k = normalize(key);
    if (!lookup.has(k)) return match;
    const value = String(lookup.get(k));
    return escape ? escapeHtml(value) : value;
  });
}

export function htmlToText(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
