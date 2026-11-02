import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import { useRole } from '../context/RoleContext';
import { listSpaces } from '../services/parking.service';
import { cancelReservation, createReservation, listReservations } from '../services/reservation.service';
import { RESERVATION_STATUS_LABELS, SPACE_TYPE_LABELS } from '../utils/constants';
import { formatDateTime, isUuid, shortId } from '../utils/format';

// Margen para comparar createdAt con la hora local (posible desfase de reloj).
const RECENT_WINDOW_MS = 15 * 60 * 1000;

// Errores tras los cuales la reserva pudo haberse creado aunque no llegó la respuesta.
function isUncertain(err) {
    return err.status === 0 || err.status >= 500;
}

// Busca una reserva confirmada de la misma plaza y placa creada en este intento.
async function findCreatedReservation({ spaceId, vehiclePlate }, startedAt) {
    const { reservations } = await listReservations({ vehiclePlate });
    const plate = vehiclePlate.toUpperCase();
    return reservations.find((r) =>
        r.status === 'confirmed'
        && r.spaceId === spaceId
        && r.vehiclePlate?.trim().toUpperCase() === plate
        && new Date(r.createdAt).getTime() >= startedAt - RECENT_WINDOW_MS
    ) ?? null;
}

function spaceLabel(space) {
    if (!space) return null;
    return [space.code, space.level].filter(Boolean).join(' · ');
}

function ReservationDetails({ reservation, space, title }) {
    return (
        <div className="card reservation-summary">
            <div className="card-header">
                <h2>{title}</h2>
                <StatusBadge status={reservation.status} labels={RESERVATION_STATUS_LABELS} />
            </div>
            <dl className="kv">
                <dt>Código de ticket</dt>
                <dd><strong className="ticket-code">{reservation.ticketNumber ?? '—'}</strong></dd>
                <dt>Placa</dt>
                <dd>{reservation.vehiclePlate ?? '—'}</dd>
                <dt>Parqueo</dt>
                <dd>{space?.level ?? '—'}</dd>
                <dt>Espacio</dt>
                <dd>{space?.code ?? shortId(reservation.spaceId)}</dd>
                <dt>Fecha y hora</dt>
                <dd>{formatDateTime(reservation.startsAt)}</dd>
                <dt>Estado</dt>
                <dd>{RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status}</dd>
            </dl>
        </div>
    );
}

export default function ReservationsPage() {
    const [searchParams] = useSearchParams();
    const { userPlate, setUserPlate } = useRole();

    const [spaces, setSpaces] = useState([]);
    const [reservations, setReservations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    const [spaceId, setSpaceId] = useState(searchParams.get('spaceId') || '');
    const [vehiclePlate, setVehiclePlate] = useState('');
    const [scheduled, setScheduled] = useState(false);
    const [startsAt, setStartsAt] = useState('');
    const [durationMinutes, setDurationMinutes] = useState('');
    const [formErrors, setFormErrors] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState(null);
    const [createdReservation, setCreatedReservation] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [busyId, setBusyId] = useState(null);

    const [ticketQuery, setTicketQuery] = useState('');
    const [ticketResult, setTicketResult] = useState(null);
    const [ticketSearching, setTicketSearching] = useState(false);
    const [ticketError, setTicketError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        const [spacesRes, reservationsRes] = await Promise.allSettled([listSpaces(), listReservations()]);
        if (spacesRes.status === 'fulfilled') setSpaces(spacesRes.value.spaces);
        if (reservationsRes.status === 'fulfilled') setReservations(reservationsRes.value.reservations);
        const failed = [spacesRes, reservationsRes].find((r) => r.status === 'rejected');
        if (failed) setLoadError(failed.reason);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const available = spaces.filter((s) => s.status === 'available');
    const spaceById = Object.fromEntries(spaces.map((s) => [s.id, s]));

    const visibleReservations = useMemo(() => {
        const plate = userPlate.trim().toUpperCase();
        if (!plate) return [];
        return reservations.filter((r) => (r.vehiclePlate ?? '').trim().toUpperCase() === plate);
    }, [userPlate, reservations]);

    function validate() {
        const errors = {};
        if (!isUuid(spaceId)) errors.spaceId = 'Seleccione una plaza válida.';
        if (!vehiclePlate.trim()) errors.vehiclePlate = 'La placa es obligatoria.';
        if (scheduled && !startsAt) errors.startsAt = 'Indique la hora de llegada.';
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (submitting || !validate()) return;
        setSubmitting(true);
        setResult(null);
        setCreatedReservation(null);
        setActionError(null);
        const input = {
            spaceId,
            vehiclePlate: vehiclePlate.trim(),
            ...(scheduled && startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
            ...(scheduled && durationMinutes ? { durationMinutes: Number(durationMinutes) } : {})
        };
        const startedAt = Date.now();

        function onCreated(reservation, text) {
            setResult({ type: 'success', text: `${text} Conserva el código de ticket para consultar tu reserva.` });
            setCreatedReservation(reservation);
            setTicketResult(null);
            setTicketQuery('');
            setUserPlate(input.vehiclePlate);
            setVehiclePlate('');
            setSpaceId('');
            setScheduled(false);
            setStartsAt('');
            setDurationMinutes('');
        }

        try {
            onCreated(await createReservation(input), 'Reserva creada.');
        } catch (err) {
            // Una petición fallida no garantiza que la reserva no se haya creado (sección 4.2):
            // se verifica en el listado antes de mostrar el error.
            if (isUncertain(err) || err.code === 'RESERVATION_CONFLICT') {
                try {
                    const existing = await findCreatedReservation(input, startedAt);
                    if (existing) {
                        onCreated(existing, 'La reserva sí quedó registrada.');
                        return;
                    }
                } catch {
                    if (isUncertain(err)) {
                        setActionError({
                            ...err,
                            message: 'No se pudo confirmar si la reserva se registró. Revise el listado antes de intentarlo de nuevo.'
                        });
                        return;
                    }
                }
            }
            setActionError(err);
        } finally {
            setSubmitting(false);
            load();
        }
    }

    async function handleCancel(reservation) {
        const id = reservation.id ?? reservation.reservationId;
        if (!window.confirm(`¿Cancelar la reserva de ${reservation.vehiclePlate}?`)) return;
        setBusyId(id);
        setResult(null);
        setActionError(null);
        try {
            const cancelled = await cancelReservation(id);
            setResult({ type: 'success', text: 'Reserva cancelada.' });
            if (createdReservation && (createdReservation.id ?? createdReservation.reservationId) === id) {
                setCreatedReservation(cancelled);
            }
            if (ticketResult && (ticketResult.id ?? ticketResult.reservationId) === id) {
                setTicketResult(cancelled);
            }
        } catch (err) {
            setActionError(err);
        } finally {
            setBusyId(null);
            load();
        }
    }

    async function handleTicketSearch(e) {
        e.preventDefault();
        const term = ticketQuery.trim();
        const plate = userPlate.trim();

        setTicketError(null);
        setTicketResult(null);

        if (!term) {
            setTicketError({ message: 'Ingresa el código de ticket de la reservación.' });
            return;
        }

        if (!plate) {
            setTicketError({
                message: 'Indica tu placa en "Mi placa" para verificar que la reservación te pertenece.'
            });
            return;
        }

        setTicketSearching(true);
        try {
            const { reservations: found } = await listReservations({
                ticketNumber: term,
                vehiclePlate: plate
            });

            if (found.length === 0) {
                setTicketError({
                    message: 'No encontramos una reservación con ese ticket para tu placa. Verifica el código e inténtalo de nuevo.'
                });
                return;
            }

            setTicketResult(found[0]);
        } catch (err) {
            setTicketError(err);
        } finally {
            setTicketSearching(false);
        }
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Mis reservas</h1>
                    <p className="page-subtitle">
                        Crea reservas y consulta únicamente las asociadas a tu placa.
                    </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
                    {loading ? 'Actualizando…' : 'Actualizar'}
                </button>
            </div>

            <Alert error={loadError} title="No se pudieron cargar las plazas o las reservas" />
            {result && <Alert type={result.type} onClose={() => setResult(null)}>{result.text}</Alert>}
            <Alert error={actionError} title="La operación no se completó" onClose={() => setActionError(null)} />

            {createdReservation && (
                <ReservationDetails
                    reservation={createdReservation}
                    space={spaceById[createdReservation.spaceId]}
                    title="Reserva confirmada"
                />
            )}

            <div className="two-col">
                <form className="card form" onSubmit={handleSubmit} noValidate>
                    <h2>Nueva reserva</h2>
                    <label>
                        Plaza
                        <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
                            <option value="">Seleccione una plaza disponible…</option>
                            {available.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.code} · {s.level} · {SPACE_TYPE_LABELS[s.spaceType] ?? s.spaceType}
                                </option>
                            ))}
                        </select>
                        {formErrors.spaceId && <span className="field-error">{formErrors.spaceId}</span>}
                    </label>
                    <label>
                        Placa del vehículo
                        <input
                            type="text"
                            value={vehiclePlate}
                            onChange={(e) => setVehiclePlate(e.target.value)}
                            placeholder="P123ABC"
                            maxLength={20}
                        />
                        {formErrors.vehiclePlate && <span className="field-error">{formErrors.vehiclePlate}</span>}
                    </label>
                    <label className="checkbox-row">
                        <input
                            type="checkbox"
                            checked={scheduled}
                            onChange={(e) => setScheduled(e.target.checked)}
                        />
                        Reservar para más tarde (en lugar de ahora mismo)
                    </label>
                    {scheduled && (
                        <>
                            <label>
                                Hora de llegada
                                <input
                                    type="datetime-local"
                                    value={startsAt}
                                    onChange={(e) => setStartsAt(e.target.value)}
                                />
                                {formErrors.startsAt && <span className="field-error">{formErrors.startsAt}</span>}
                                <span className="muted small">Hasta 2 horas de anticipación.</span>
                            </label>
                            <label>
                                Duración estimada (minutos)
                                <input
                                    type="number"
                                    min="15"
                                    max="480"
                                    step="15"
                                    value={durationMinutes}
                                    onChange={(e) => setDurationMinutes(e.target.value)}
                                    placeholder="240"
                                />
                                <span className="muted small">Se usa solo para evitar reservas que choquen de horario; déjelo vacío para usar el valor por defecto.</span>
                            </label>
                        </>
                    )}
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? 'Reservando…' : scheduled ? 'Programar reserva' : 'Reservar'}
                    </button>
                    {available.length === 0 && spaces.length > 0 && (
                        <p className="muted">No hay plazas disponibles en este momento.</p>
                    )}
                </form>

                <div className="stack">
                    <div className="card">
                        <h2>Mis reservas registradas</h2>
                        <div className="user-plate-filter">
                            <label>
                                Mi placa
                                <input
                                    type="text"
                                    value={userPlate}
                                    onChange={(e) => setUserPlate(e.target.value)}
                                    placeholder="P123ABC"
                                    maxLength={20}
                                />
                            </label>
                            <p className="muted small">
                                {userPlate
                                    ? `Mostrando reservas de la placa ${userPlate}.`
                                    : 'Indica tu placa para ver tus reservas. También se completa al crear una reserva.'}
                            </p>
                        </div>

                        <div className="ticket-search">
                            <h3>Buscar por código de ticket</h3>
                            <form className="search-row" onSubmit={handleTicketSearch}>
                                <input
                                    type="text"
                                    value={ticketQuery}
                                    onChange={(e) => setTicketQuery(e.target.value)}
                                    placeholder="PAR-000123"
                                    aria-label="Buscar reserva por código de ticket"
                                />
                                <button type="submit" className="btn btn-secondary" disabled={ticketSearching}>
                                    {ticketSearching ? 'Buscando…' : 'Buscar'}
                                </button>
                            </form>
                            <Alert
                                error={ticketError}
                                title="No se pudo consultar la reservación"
                                onClose={() => setTicketError(null)}
                            />
                        </div>

                        {loading && visibleReservations.length === 0 ? (
                            <p className="muted">Cargando reservas…</p>
                        ) : visibleReservations.length === 0 ? (
                            <p className="muted">
                                {userPlate
                                    ? 'No tienes reservas registradas con esa placa.'
                                    : 'Indica tu placa para consultar tus reservas.'}
                            </p>
                        ) : (
                            <div className="table-wrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Ticket</th>
                                            <th>Placa</th>
                                            <th>Parqueo / espacio</th>
                                            <th>Fecha y hora</th>
                                            <th>Estado</th>
                                            <th />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleReservations.map((r) => {
                                            const id = r.id ?? r.reservationId;
                                            return (
                                                <tr key={id}>
                                                    <td>
                                                        <strong className="ticket-code">{r.ticketNumber ?? '—'}</strong>
                                                    </td>
                                                    <td>{r.vehiclePlate}</td>
                                                    <td>
                                                        {spaceById[r.spaceId] ? (
                                                            <>
                                                                {spaceById[r.spaceId].code}
                                                                <div className="muted small">{spaceById[r.spaceId].level}</div>
                                                            </>
                                                        ) : (
                                                            <code>{shortId(r.spaceId)}</code>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {formatDateTime(r.startsAt)}
                                                        {r.status === 'confirmed' && !r.spaceClaimedAt && (
                                                            <div className="muted small">Programada · plaza aún no reclamada</div>
                                                        )}
                                                    </td>
                                                    <td><StatusBadge status={r.status} labels={RESERVATION_STATUS_LABELS} /></td>
                                                    <td className="row-actions">
                                                        {r.status === 'confirmed' && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-small btn-danger"
                                                                onClick={() => handleCancel(r)}
                                                                disabled={busyId === id}
                                                            >
                                                                {busyId === id ? 'Cancelando…' : 'Cancelar'}
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {ticketResult && (
                        <ReservationDetails
                            reservation={ticketResult}
                            space={spaceById[ticketResult.spaceId]}
                            title="Reservación encontrada"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
