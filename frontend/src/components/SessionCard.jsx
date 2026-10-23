import { useEffect, useState } from 'react';
import StatusBadge from './StatusBadge';
import { SESSION_STATUS_LABELS } from '../utils/constants';
import { formatDateTime, formatDuration } from '../utils/format';

// Para una sesión activa la duración se calcula en vivo desde entryAt;
// al cerrarse se muestra durationSeconds devuelto por Reservation Service.
function useElapsedSeconds(entryAt, active) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);

    if (!active || !entryAt) return null;
    return Math.max(0, Math.floor((now - new Date(entryAt).getTime()) / 1000));
}

export default function SessionCard({ session, children }) {
    const active = session.status === 'active';
    const elapsed = useElapsedSeconds(session.entryAt, active);
    const duration = active ? elapsed : session.durationSeconds;

    return (
        <div className="card session-card">
            <div className="card-header">
                <h3>Ticket {session.ticketNumber ?? '—'}</h3>
                <StatusBadge status={session.status} labels={SESSION_STATUS_LABELS} />
            </div>
            <dl className="kv">
                <dt>Placa</dt><dd>{session.vehiclePlate ?? '—'}</dd>
                <dt>Entrada</dt><dd>{formatDateTime(session.entryAt)}</dd>
                <dt>Salida</dt><dd>{formatDateTime(session.exitAt)}</dd>
                <dt>Duración</dt>
                <dd className="duration">
                    {formatDuration(duration)}
                    {active && <span className="muted"> (en curso)</span>}
                </dd>
                <dt>Referencia interna</dt>
                <dd><code className="small muted">{session.sessionId ?? session.id}</code></dd>
            </dl>
            {children && <div className="card-actions">{children}</div>}
        </div>
    );
}
