const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const normalize = (key) => String(key).trim().toLowerCase().replace(/\s+/g, ' ');

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function renderTemplate(text, data = {}, escape = false) {
  const lookup = new Map(Object.entries(data).map(([k, v]) => [normalize(k), v ?? '']));
  return text.replace(PLACEHOLDER_RE, (match, key) => {
    const k = normalize(key);
    if (!lookup.has(k)) return match;
    return escape ? escapeHtml(lookup.get(k)) : String(lookup.get(k));
  });
}

export function unknownPlaceholders(text, headers = []) {
  const known = new Set(headers.map(normalize));
  const unknown = new Set();
  for (const [, key] of text.matchAll(PLACEHOLDER_RE)) {
    if (!known.has(normalize(key))) unknown.add(key.trim());
  }
  return [...unknown];
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export const formatTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
