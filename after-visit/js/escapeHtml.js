// Shared HTML-escaping helper: entity-escapes &<>"' so text can be dropped into innerHTML templates
// or HTML attributes safely. Used by dashboard.js and exerciseArt.js (keep both using this one).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
