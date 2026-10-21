export default function StatusBadge({ status, labels }) {
    return <span className={`badge badge-${status}`}>{labels?.[status] ?? status ?? '—'}</span>;
}
