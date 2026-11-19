/** Display helpers. Unknown values show as an em dash, never as zero. */

const DASH = '—';

export function int(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : DASH;
}

export function usd(n) {
  if (!Number.isFinite(n)) return DASH;
  if (n === 0) return '$0';
  // Per-turn costs are fractions of a cent: keep four decimals below a dollar.
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pct(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : DASH;
}

/** `anthropic.claude-haiku` → `claude-haiku`; other names unchanged. */
export function shortModel(id) {
  return typeof id === 'string' ? id.replace(/^anthropic\./, '') : DASH;
}

export function time(iso) {
  if (typeof iso !== 'string') return DASH;
  return iso.replace('T', ' ').slice(0, 19);
}

/** `bug_fix` → `bug fix`. */
export function label(value) {
  return typeof value === 'string' ? value.replaceAll('_', ' ') : DASH;
}
