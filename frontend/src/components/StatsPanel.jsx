import { SPACE_STATUS_LABELS } from '../utils/constants';

const ORDER = ['available', 'reserved', 'occupied', 'maintenance'];

export default function StatsPanel({ spaces }) {
    const counts = Object.fromEntries(ORDER.map((s) => [s, 0]));
    for (const space of spaces) {
        if (space.status in counts) counts[space.status] += 1;
    }

    return (
        <div className="stats">
            <div className="stat stat-total">
                <span className="stat-value">{spaces.length}</span>
                <span className="stat-label">Total de plazas</span>
            </div>
            {ORDER.map((status) => (
                <div key={status} className={`stat stat-${status}`}>
                    <span className="stat-value">{counts[status]}</span>
                    <span className="stat-label">{SPACE_STATUS_LABELS[status]}</span>
                </div>
            ))}
        </div>
    );
}
