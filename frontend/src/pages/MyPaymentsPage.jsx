import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Alert from '../components/Alert';
import SessionPicker from '../components/SessionPicker';
import StatusBadge from '../components/StatusBadge';
import { useRole } from '../context/RoleContext';
import { getPaymentBySession } from '../services/payment.service';
import { PAYMENT_STATUS_LABELS } from '../utils/constants';
import { formatDateTime, formatMoney, isUuid } from '../utils/format';

export default function MyPaymentsPage() {
    const [searchParams] = useSearchParams();
    const { userPlate } = useRole();
    const [sessionId, setSessionId] = useState(searchParams.get('sessionId') || '');
    const [selectedSession, setSelectedSession] = useState(null);
    const [payment, setPayment] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [empty, setEmpty] = useState(null);

    async function lookup(id) {
        if (!isUuid(id)) {
            setError({ message: 'El sessionId debe ser un UUID válido.', code: 'INVALID_ID' });
            return;
        }
        setBusy(true);
        setError(null);
        setEmpty(null);
        try {
            setPayment(await getPaymentBySession(id));
        } catch (err) {
            setPayment(null);
            if (err.status === 404) {
                setEmpty('No hay un pago simulado registrado para esa sesión.');
            } else {
                setError(err);
            }
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => {
        const initial = searchParams.get('sessionId');
        if (isUuid(initial)) lookup(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleSubmit(e) {
        e.preventDefault();
        setSelectedSession(null);
        lookup(sessionId.trim());
    }

    function handlePickSession(picked) {
        setSessionId(picked.sessionId);
        setSelectedSession(picked);
        lookup(picked.sessionId);
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Mis pagos</h1>
                    <p className="page-subtitle">
                        Consulta los pagos simulados asociados a tus sesiones de estacionamiento.
                    </p>
                </div>
            </div>

            <Alert error={error} title="No se pudo consultar el pago" onClose={() => setError(null)} />

            <div className="two-col">
                <div className="stack">
                    <div className="card">
                        <h2>Buscar una sesión pagada</h2>
                        <p className="muted small">
                            {userPlate
                                ? `Mostrando primero las sesiones de la placa ${userPlate}.`
                                : 'Busca por placa o ticket entre tus sesiones completadas.'}
                        </p>
                        <SessionPicker
                            status="completed"
                            initialQuery={userPlate}
                            onSelect={handlePickSession}
                            emptyHint="No hay sesiones completadas con ese criterio."
                        />
                    </div>

                    <form className="card form" onSubmit={handleSubmit} noValidate>
                        <h2>Buscar por identificador</h2>
                        <label>
                            Identificador técnico de la sesión
                            <input
                                type="text"
                                value={sessionId}
                                onChange={(e) => setSessionId(e.target.value)}
                                placeholder="UUID de la sesión completada"
                            />
                        </label>
                        <button type="submit" className="btn btn-secondary" disabled={busy}>
                            {busy ? 'Consultando…' : 'Consultar pago'}
                        </button>
                    </form>
                </div>

                <div>
                    {busy ? (
                        <div className="card"><p className="muted">Consultando pago…</p></div>
                    ) : payment ? (
                        <div className="card payment-result">
                            <div className="card-header">
                                <h2>Pago registrado</h2>
                                <StatusBadge status={payment.status} labels={PAYMENT_STATUS_LABELS} />
                            </div>
                            {selectedSession && (
                                <p className="muted small">
                                    Ticket {selectedSession.ticketNumber} · Placa {selectedSession.vehiclePlate}
                                </p>
                            )}
                            <dl className="kv">
                                <dt>Importe</dt><dd>{formatMoney(payment.amountMinor, payment.currency)}</dd>
                                <dt>Método</dt><dd>{payment.method}</dd>
                                <dt>Fecha</dt><dd>{formatDateTime(payment.createdAt)}</dd>
                                <dt>Referencia interna</dt>
                                <dd><code className="small muted">{payment.paymentId ?? payment.id}</code></dd>
                            </dl>
                            {payment.status === 'succeeded' && (
                                <Alert type="success">Pago simulado confirmado. No se transfirió dinero real.</Alert>
                            )}
                        </div>
                    ) : (
                        <div className="card">
                            <p className="muted">
                                {empty || 'Selecciona una sesión completada o ingresa su identificador para consultar el pago.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
