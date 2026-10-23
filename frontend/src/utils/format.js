const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value.trim());
}

// amountMinor está en centavos; solo se divide entre 100 para mostrarlo.
export function formatMoney(amountMinor, currency = 'GTQ') {
    if (!Number.isInteger(amountMinor)) return '—';
    const symbol = currency === 'GTQ' ? 'Q' : `${currency} `;
    return `${symbol}${(amountMinor / 100).toFixed(2)}`;
}

export function formatDuration(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || totalSeconds < 0) return '—';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatDateTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'medium' });
}

export function shortId(id) {
    return typeof id === 'string' ? `${id.slice(0, 8)}…` : '—';
}
