// Small formatting helpers (pure, unit-tested).
export function resetText(iso, now = Date.now()) {
  if (!iso) return '';
  const ms = new Date(iso) - now;
  if (ms <= 0) return 'resets now';
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  if (h < 24) return `resets in ${h ? h + 'h ' : ''}${m}m`;
  return 'resets ' + new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
