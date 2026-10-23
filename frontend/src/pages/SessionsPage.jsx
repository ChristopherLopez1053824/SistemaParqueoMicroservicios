import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '../components/Alert';
import SessionCard from '../components/SessionCard';
import SessionPicker from '../components/SessionPicker';
import { getSession, registerEntry, registerExit } from '../services/reservation.service';
import { isUuid, shortId } from '../utils/format';
import { getRecentSessions, rememberSession } from '../utils/storage';

export default function SessionsPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const [reservationId, setReservationId] = useState(searchParams.get('reservationId') || '');
    const [sessionId, setSessionId] = useState(searchParams.get('sessionId') || '');
    const [session, setSession] = useState(null);
    const [busy, setBusy] = useState(null); // 'entry' | 'exit' | 'lookup'
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [recent, setRecent] = useState(getRecentSessions);
    const [manualLookup, setManualLookup] = useState(false);

    async function showSession(id) {
        const data = await getSession(id);
        setSession(data);
        setSessionId(id);
        return data;
    }

    useEffect(() => {
        const initial = searchParams.get('sessionId');
        if (isUuid(initial)) showSession(initial).catch(setError);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function run(kind, action) {
        if (busy) return;
        setBusy(kind);
        setError(null);
        setNotice(null);
        try {
            await action();
        } catch (err) {
            setError(err);
        } finally {
            setBusy(null);
        }
    }

    function handleEntry(e) {
        e.preventDefault();
        const id = reservationId.trim();
        if (!isUuid(id)) {
            setError({ message: 'El reservationId debe ser un UUID válido.', code: 'INVALID_ID' });
            return;
        }
        run('entry', async () => {
            const result = await registerEntry(id);
            const newSessionId = result.sessionId ?? result.id;
            rememberSession({
                sessionId: newSessionId,
                ticketNumber: result.ticketNumber,
                reservationId: id,
                vehiclePlate: result.vehiclePlate
            });
            setRecent(getRecentSessions());
            setNotice(`Entrada registrada. Ticket ${result.ticketNumber ?? newSessionId}.`);
            if (result.entryAt && result.status) {
                setSession({ ...result, sessionId: newSessionId });
                setSessionId(newSessionId);
            } else {
                await showSession(newSessionId);
            }
        });
    }

    function handleLookup(e) {
        e?.preventDefault();
        const id = sessionId.trim();
        if (!isUuid(id)) {
            setError({ message: 'El identificador debe ser un UUID válido.', code: 'INVALID_ID' });
            return;
        }
        run('lookup', () => showSession(id));
    }

    function handlePickSession(picked) {
        setNotice(null);
        run('lookup', () => showSession(picked.sessionId));
    }

    function handleExit() {
        const id = (session?.sessionId ?? session?.id ?? sessionId).trim();
        if (!isUuid(id)) {
            setError({ message: 'El sessionId debe ser un UUID válido.', code: 'INVALID_ID' });
            return;
        }
        if (!window.confirm('¿Registrar la salida del vehículo?')) return;
        run('exit', async () => {
            try {
                const result = await registerExit(id);
                setSession(result);
                setNotice('Salida registrada. Ya puede calcular el importe.');
            } catch (err) {
                // Una petición fallida no garantiza que la salida no se haya registrado:
                // se consulta el estado real de la sesión antes de mostrar el error.
                try {
                    const current = await showSession(id);
                    if (current.status === 'completed') {
                        setNotice('La sesión ya figura como completada.');
                        return;
                    }
                } catch {
                    // Se mantiene el error original.
                }
                throw err;
            }
        });
    }

    const currentId = session?.sessionId ?? session?.id;

    return (
        <div className="page">
            <h1>Entrada y salida de vehículos</h1>

            {notice && <Alert type="success" onClose={() => setNotice(null)}>{notice}</Alert>}
            <Alert error={error} title="La operación no se completó" onClose={() => setError(null)} />

            <div className="two-col">
                <div className="stack">
                    <form className="card form" onSubmit={handleEntry} noValidate>
                        <h2>Registrar entrada</h2>
                        <label>
                            reservationId
                            <input
                                type="text"
                                value={reservationId}
                                onChange={(e) => setReservationId(e.target.value)}
                                placeholder="UUID de la reserva confirmada"
                            />
                        </label>
                        <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                            {busy === 'entry' ? 'Registrando…' : 'Registrar entrada'}
                        </button>
                        <p className="muted small">
                            Las reservas confirmadas se encuentran en <Link to="/reservations">Reservas</Link>.
                        </p>
                    </form>

                    <div className="card">
                        <h2>Buscar sesión / registrar salida</h2>
                        <p className="muted small">
                            Busca por la placa del vehículo o por el número de ticket para ver el detalle o registrar la salida.
                        </p>
                        {!manualLookup ? (
                            <>
                                <SessionPicker onSelect={handlePickSession} />
                                <button type="button" className="advanced-toggle" onClick={() => setManualLookup(true)}>
                                    ¿Ya tienes el identificador técnico? Ingrésalo manualmente.
                                </button>
                            </>
                        ) : (
                            <>
                                <form className="form" onSubmit={handleLookup} noValidate>
                                    <label>
                                        Identificador técnico de la sesión
                                        <input
                                            type="text"
                                            value={sessionId}
                                            onChange={(e) => setSessionId(e.target.value)}
                                            placeholder="UUID de la sesión"
                                        />
                                    </label>
                                    <button type="submit" className="btn btn-secondary" disabled={busy !== null}>
                                        {busy === 'lookup' ? 'Consultando…' : 'Consultar sesión'}
                                    </button>
                                </form>
                                <button type="button" className="advanced-toggle" onClick={() => setManualLookup(false)}>
                                    Volver a la búsqueda por placa o ticket
                                </button>
                            </>
                        )}
                    </div>

                    {recent.length > 0 && (
                        <div className="card">
                            <h3>Sesiones recientes (este navegador)</h3>
                            <ul className="plain-list">
                                {recent.map((s) => (
                                    <li key={s.sessionId}>
                                        <button
                                            type="button"
                                            className="link-button"
                                            onClick={() => run('lookup', () => showSession(s.sessionId))}
                                        >
                                            {s.vehiclePlate || 'Vehículo'} · {s.ticketNumber || shortId(s.sessionId)}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                <div>
                    {session ? (
                        <SessionCard session={session}>
                            {session.status === 'active' && (
                                <button type="button" className="btn btn-danger" onClick={handleExit} disabled={busy !== null}>
                                    {busy === 'exit' ? 'Registrando salida…' : 'Registrar salida'}
                                </button>
                            )}
                            {session.status === 'completed' && (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => navigate(`/payments?sessionId=${currentId}`)}
                                >
                                    Calcular importe y pagar
                                </button>
                            )}
                        </SessionCard>
                    ) : (
                        <div className="card"><p className="muted">Registre una entrada o busque una sesión por placa o ticket para ver su detalle.</p></div>
                    )}
                </div>
            </div>
        </div>
    );
}
