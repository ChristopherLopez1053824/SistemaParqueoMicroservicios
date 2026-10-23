import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Alert from '../components/Alert';
import SessionPicker from '../components/SessionPicker';
import StatusBadge from '../components/StatusBadge';
import { createPayment, createQuote, getPaymentBySession } from '../services/payment.service';
import { PAYMENT_STATUS_LABELS } from '../utils/constants';
import { formatDateTime, formatDuration, formatMoney, isUuid } from '../utils/format';
import { getPendingIdempotencyKey, setPendingIdempotencyKey } from '../utils/storage';
import { uuidv4 } from '../utils/uuid';

// Errores tras los cuales el pago pudo haberse registrado o puede reintentarse con la misma clave.
const RETRYABLE = new Set(['NETWORK_ERROR', 'TIMEOUT', 'SERVICE_UNAVAILABLE']);

export default function PaymentsPage() {
    const [searchParams] = useSearchParams();
    const [sessionId, setSessionId] = useState(searchParams.get('sessionId') || '');
    const [selectedSession, setSelectedSession] = useState(null);
    const [manualLookup, setManualLookup] = useState(false);
    const [quote, setQuote] = useState(null);
    const [payment, setPayment] = useState(null);
    const [idempotencyKey, setIdempotencyKey] = useState(null);
    const [busy, setBusy] = useState(null); // 'quote' | 'pay' | 'lookup'
    const [error, setError] = useState(null);
    const [now, setNow] = useState(() => Date.now());

    const expired = quote?.expiresAt ? new Date(quote.expiresAt).getTime() <= now : false;

    useEffect(() => {
        if (!quote?.expiresAt) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [quote]);

    async function run(kind, action) {
        if (busy) return;
        setBusy(kind);
        setError(null);
        try {
            await action();
        } catch (err) {
            setError(err);
        } finally {
            setBusy(null);
        }
    }

    function validSessionId() {
        const id = sessionId.trim();
        if (!isUuid(id)) {
            setError({ message: 'El sessionId debe ser un UUID válido.', code: 'INVALID_ID' });
            return null;
        }
        return id;
    }

    function requestQuote(id) {
        run('quote', async () => {
            setPayment(null);
            const data = await createQuote(id);
            setQuote(data);
            setNow(Date.now());
            // Un intento de pago por cotización: se reutiliza la clave pendiente si existe.
            setIdempotencyKey(getPendingIdempotencyKey(data.quoteId) || uuidv4());
        });
    }

    function handleQuote(e) {
        e.preventDefault();
        const id = validSessionId();
        if (!id) return;
        requestQuote(id);
    }

    function handlePickSession(picked) {
        setSessionId(picked.sessionId);
        setSelectedSession(picked);
        requestQuote(picked.sessionId);
    }

    useEffect(() => {
        const initial = searchParams.get('sessionId');
        if (isUuid(initial)) requestQuote(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handlePay() {
        if (!quote || !idempotencyKey) return;
        setPendingIdempotencyKey(quote.quoteId, idempotencyKey);
        run('pay', async () => {
            try {
                const result = await createPayment(
                    { quoteId: quote.quoteId, sessionId: quote.sessionId },
                    idempotencyKey
                );
                setPayment(result);
                setPendingIdempotencyKey(quote.quoteId, null);
            } catch (err) {
                // La sesión ya tiene un pago: se muestra en lugar de un error.
                if (err.code === 'PAYMENT_ALREADY_PROCESSED') {
                    setPendingIdempotencyKey(quote.quoteId, null);
                    setPayment(await getPaymentBySession(quote.sessionId));
                    return;
                }
                // Si el error no es reintentable, el siguiente intento usará una clave nueva.
                if (!RETRYABLE.has(err.code) && err.status !== 502 && err.status !== 504) {
                    setPendingIdempotencyKey(quote.quoteId, null);
                    setIdempotencyKey(uuidv4());
                }
                throw err;
            }
        });
    }

    function handleLookup() {
        const id = validSessionId();
        if (!id) return;
        run('lookup', async () => {
            setPayment(await getPaymentBySession(id));
        });
    }

    const canRetry = error && quote && !payment && (RETRYABLE.has(error.code) || error.status === 502 || error.status === 504);

    return (
        <div className="page">
            <h1>Cálculo de importe y pago simulado</h1>

            <Alert error={error} title="La operación no se completó" onClose={() => setError(null)} />
            {canRetry && (
                <Alert type="warning">
                    El pago pudo haberse procesado. Puede reintentarlo con seguridad: se reutilizará la misma
                    Idempotency-Key y no se generará un segundo cobro.
                </Alert>
            )}

            <div className="two-col">
                <div className="card">
                    <h2>1. Buscar la sesión a cobrar</h2>
                    <p className="muted small">
                        Busca por la placa del vehículo o por el número de ticket. Solo se pueden cotizar sesiones finalizadas.
                    </p>
                    {!manualLookup ? (
                        <>
                            <SessionPicker
                                status="completed"
                                onSelect={handlePickSession}
                                emptyHint="Todavía no hay sesiones finalizadas listas para cobrar. Registra la salida del vehículo en Entrada / Salida y vuelve a buscarla aquí."
                            />
                            <button type="button" className="advanced-toggle" onClick={() => setManualLookup(true)}>
                                ¿Ya tienes el identificador técnico? Ingrésalo manualmente.
                            </button>
                        </>
                    ) : (
                        <>
                            <form className="form" onSubmit={handleQuote} noValidate>
                                <label>
                                    Identificador técnico de la sesión
                                    <input
                                        type="text"
                                        value={sessionId}
                                        onChange={(e) => setSessionId(e.target.value)}
                                        placeholder="UUID de la sesión completada"
                                    />
                                </label>
                                <div className="btn-row">
                                    <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                                        {busy === 'quote' ? 'Calculando…' : 'Calcular importe'}
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={handleLookup} disabled={busy !== null}>
                                        {busy === 'lookup' ? 'Consultando…' : 'Consultar pago de la sesión'}
                                    </button>
                                </div>
                            </form>
                            <button type="button" className="advanced-toggle" onClick={() => setManualLookup(false)}>
                                Volver a la búsqueda por placa o ticket
                            </button>
                        </>
                    )}
                </div>

                <div className="stack">
                    {quote && (
                        <div className="card">
                            <h2>2. Detalle del cálculo</h2>
                            {selectedSession && (
                                <p className="muted small">
                                    Ticket {selectedSession.ticketNumber} · Placa {selectedSession.vehiclePlate}
                                </p>
                            )}
                            <dl className="kv">
                                <dt>Duración</dt><dd>{formatDuration(quote.durationSeconds)}</dd>
                                <dt>Horas cobrables</dt><dd>{quote.billableHours}</dd>
                                <dt>Tarifa por hora</dt><dd>{formatMoney(quote.hourlyRateMinor, quote.currency)}</dd>
                                <dt>Vence</dt>
                                <dd>{formatDateTime(quote.expiresAt)} {expired && <span className="badge badge-failed">Vencida</span>}</dd>
                            </dl>
                            <div className="amount">
                                <span>Total a pagar</span>
                                <strong>{formatMoney(quote.amountMinor, quote.currency)}</strong>
                            </div>
                            <p className="muted small">Se cobra cada hora iniciada (mínimo una hora).</p>
                            {!payment && (
                                expired ? (
                                    <p className="field-error">La cotización venció. Calcule el importe de nuevo.</p>
                                ) : (
                                    <button type="button" className="btn btn-primary btn-block" onClick={handlePay} disabled={busy !== null}>
                                        {busy === 'pay' ? 'Registrando pago…' : canRetry ? 'Reintentar pago simulado' : 'Confirmar pago simulado'}
                                    </button>
                                )
                            )}
                        </div>
                    )}

                    {payment && (
                        <div className="card payment-result">
                            <div className="card-header">
                                <h2>3. Resultado del pago</h2>
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
                    )}
                </div>
            </div>
        </div>
    );
}
