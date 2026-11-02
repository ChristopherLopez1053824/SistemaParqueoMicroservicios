import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '../components/Alert';
import SessionCard from '../components/SessionCard';
import SessionPicker from '../components/SessionPicker';
import { useRole } from '../context/RoleContext';
import { getSession } from '../services/reservation.service';

export default function MySessionsPage() {
    const navigate = useNavigate();
    const { userPlate } = useRole();
    const [session, setSession] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    async function showSession(id) {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            setSession(await getSession(id));
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    }

    const currentId = session?.sessionId ?? session?.id;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Mis sesiones</h1>
                    <p className="page-subtitle">
                        Consulta el estado de tus sesiones de estacionamiento por placa o ticket.
                    </p>
                </div>
            </div>

            <Alert error={error} title="No se pudo consultar la sesión" onClose={() => setError(null)} />

            <div className="two-col">
                <div className="card">
                    <h2>Buscar mis sesiones</h2>
                    <p className="muted small">
                        {userPlate
                            ? `Mostrando primero las sesiones de la placa ${userPlate}. También puedes buscar otra placa o un ticket.`
                            : 'Aún no tienes una placa asociada. Crea una reserva o indícala en Mis reservas para filtrar tu actividad.'}
                    </p>
                    <SessionPicker
                        initialQuery={userPlate}
                        onSelect={(picked) => showSession(picked.sessionId)}
                        emptyHint="No encontramos sesiones con ese criterio. Verifica la placa o el ticket."
                    />
                </div>

                <div>
                    {busy && !session ? (
                        <div className="card"><p className="muted">Consultando sesión…</p></div>
                    ) : session ? (
                        <SessionCard session={session}>
                            {session.status === 'completed' && (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => navigate(`/payments?sessionId=${currentId}`)}
                                >
                                    Consultar pago
                                </button>
                            )}
                        </SessionCard>
                    ) : (
                        <div className="card">
                            <p className="muted">
                                Selecciona una sesión del listado para ver su estado y sus datos.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
