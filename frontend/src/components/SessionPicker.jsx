import { useCallback, useEffect, useState } from 'react';
import Alert from './Alert';
import StatusBadge from './StatusBadge';
import { listSessions } from '../services/reservation.service';
import { listSpaces } from '../services/parking.service';
import { SESSION_STATUS_LABELS } from '../utils/constants';
import { formatDateTime, formatDuration } from '../utils/format';

// Un ticket se ve como "PAR-000123", "par-123" o solo dígitos; cualquier otra cosa se busca como placa.
const TICKET_QUERY_RE = /^(PAR-?)?\d+$/i;

// Permite encontrar una sesión por placa o número de ticket, sin que el usuario
// necesite conocer o escribir su identificador interno (uuid).
export default function SessionPicker({ status, onSelect, emptyHint }) {
    const [query, setQuery] = useState('');
    const [sessions, setSessions] = useState([]);
    const [spacesById, setSpacesById] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const search = useCallback(async (term) => {
        setLoading(true);
        setError(null);
        try {
            const filters = status ? { status } : {};
            const trimmed = term.trim();
            if (trimmed) {
                if (TICKET_QUERY_RE.test(trimmed)) {
                    filters.ticketNumber = trimmed;
                } else {
                    filters.vehiclePlate = trimmed;
                }
            }
            const [sessionsRes, spacesRes] = await Promise.all([listSessions(filters), listSpaces()]);
            setSessions(sessionsRes.sessions);
            setSpacesById(Object.fromEntries(spacesRes.spaces.map((s) => [s.id, s])));
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [status]);

    useEffect(() => { search(''); }, [search]);

    function handleSubmit(e) {
        e.preventDefault();
        search(query);
    }

    return (
        <div className="session-picker">
            <form className="search-row" onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Placa (P123ABC) o ticket (PAR-000123)"
                    aria-label="Buscar sesión por placa o número de ticket"
                />
                <button type="submit" className="btn btn-secondary" disabled={loading}>
                    {loading ? 'Buscando…' : 'Buscar'}
                </button>
            </form>

            <Alert error={error} title="No se pudo buscar la sesión" />

            {loading ? (
                <p className="muted">Buscando sesiones…</p>
            ) : sessions.length === 0 ? (
                <p className="muted">
                    {emptyHint || 'No encontramos sesiones con ese criterio. Verifica la placa o el número de ticket e inténtalo de nuevo.'}
                </p>
            ) : (
                <ul className="session-list">
                    {sessions.map((s) => (
                        <li key={s.sessionId}>
                            <button type="button" className="session-row" onClick={() => onSelect(s)}>
                                <span className="session-row-main">
                                    <strong>{s.ticketNumber ?? '—'}</strong>
                                    <span>{s.vehiclePlate}</span>
                                    <span className="muted">{spacesById[s.spaceId]?.code ?? '—'}</span>
                                </span>
                                <span className="session-row-meta">
                                    <StatusBadge status={s.status} labels={SESSION_STATUS_LABELS} />
                                    <span className="muted small">Entrada: {formatDateTime(s.entryAt)}</span>
                                    <span className="muted small">
                                        {s.status === 'active' ? 'En curso' : formatDuration(s.durationSeconds)}
                                    </span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
