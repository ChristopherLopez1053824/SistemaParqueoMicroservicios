import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '../components/Alert';
import StatsPanel from '../components/StatsPanel';
import { getPaymentBySession } from '../services/payment.service';
import { listSpaces } from '../services/parking.service';
import { listReservations, listSessions } from '../services/reservation.service';
import {
    RESERVATION_STATUS_LABELS,
    SESSION_STATUS_LABELS,
    SPACE_STATUS_LABELS
} from '../utils/constants';
import { formatDateTime, formatMoney } from '../utils/format';

const SPACE_ORDER = ['available', 'reserved', 'occupied', 'maintenance'];

function countBy(items, key) {
    return items.reduce((acc, item) => {
        const value = item[key];
        acc[value] = (acc[value] ?? 0) + 1;
        return acc;
    }, {});
}

function percentage(part, total) {
    if (!total) return null;
    return Math.round((part / total) * 100);
}

export default function OwnerDashboardPage() {
    const [spaces, setSpaces] = useState([]);
    const [reservations, setReservations] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);

        const [spacesRes, reservationsRes, sessionsRes] = await Promise.allSettled([
            listSpaces(),
            listReservations(),
            listSessions()
        ]);

        if (spacesRes.status === 'fulfilled') setSpaces(spacesRes.value.spaces);
        if (reservationsRes.status === 'fulfilled') setReservations(reservationsRes.value.reservations);

        let fetchedSessions = [];
        if (sessionsRes.status === 'fulfilled') {
            fetchedSessions = sessionsRes.value.sessions;
            setSessions(fetchedSessions);
        }

        const completedSessions = fetchedSessions.filter((s) => s.status === 'completed');
        const paymentResults = await Promise.allSettled(
            completedSessions.map((s) => getPaymentBySession(s.sessionId ?? s.id))
        );
        const fetchedPayments = paymentResults
            .filter((result) => result.status === 'fulfilled' && result.value)
            .map((result) => result.value);
        setPayments(fetchedPayments);

        const failed = [spacesRes, reservationsRes, sessionsRes].find((result) => result.status === 'rejected');
        if (failed) setError(failed.reason);

        setLastUpdated(new Date());
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const stats = useMemo(() => {
        const spaceCounts = Object.fromEntries(SPACE_ORDER.map((status) => [status, 0]));
        for (const space of spaces) {
            if (space.status in spaceCounts) spaceCounts[space.status] += 1;
        }

        const totalSpaces = spaces.length;
        const occupancyPct = percentage(spaceCounts.occupied + spaceCounts.reserved, totalSpaces);
        const availabilityPct = percentage(spaceCounts.available, totalSpaces);

        const reservationCounts = countBy(reservations, 'status');
        const sessionCounts = countBy(sessions, 'status');
        const paymentCounts = countBy(payments, 'status');

        const succeededPayments = payments.filter((p) => p.status === 'succeeded');
        const revenueMinor = succeededPayments.reduce((sum, p) => sum + (p.amountMinor ?? 0), 0);
        const averageMinor = succeededPayments.length
            ? Math.round(revenueMinor / succeededPayments.length)
            : null;

        return {
            spaceCounts,
            totalSpaces,
            occupancyPct,
            availabilityPct,
            reservationCounts,
            sessionCounts,
            paymentCounts,
            revenueMinor,
            averageMinor,
            succeededCount: succeededPayments.length
        };
    }, [spaces, reservations, sessions, payments]);

    const hasSpaces = spaces.length > 0;
    const hasReservations = reservations.length > 0;
    const hasSessions = sessions.length > 0;
    const hasPayments = payments.length > 0;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Dashboard del negocio</h1>
                    <p className="page-subtitle">
                        Indicadores generales del parqueo calculados con la información disponible en el sistema.
                    </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
                    {loading ? 'Actualizando…' : 'Actualizar'}
                </button>
            </div>

            <Alert error={error} title="Algunos datos no se pudieron cargar" />

            {loading && !lastUpdated ? (
                <div className="card"><p className="muted">Cargando indicadores…</p></div>
            ) : (
                <>
                    <StatsPanel spaces={spaces} />

                    <div className="owner-grid">
                        <section className="card">
                            <h2>Ocupación</h2>
                            {hasSpaces ? (
                                <>
                                    <div className="occupancy-row">
                                        <span>Ocupadas y reservadas</span>
                                        <strong>{stats.occupancyPct ?? 0}%</strong>
                                    </div>
                                    <div className="progress" aria-hidden="true">
                                        <div className="progress-bar" style={{ width: `${stats.occupancyPct ?? 0}%` }} />
                                    </div>
                                    <div className="occupancy-row">
                                        <span>Disponibles</span>
                                        <strong>{stats.availabilityPct ?? 0}%</strong>
                                    </div>
                                    <div className="progress progress-available" aria-hidden="true">
                                        <div className="progress-bar" style={{ width: `${stats.availabilityPct ?? 0}%` }} />
                                    </div>
                                    <div className="owner-space-list">
                                        {SPACE_ORDER.map((status) => (
                                            <div className="owner-space-row" key={status}>
                                                <span>{SPACE_STATUS_LABELS[status]}</span>
                                                <strong>{stats.spaceCounts[status]}</strong>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className="muted">Todavía no hay plazas registradas.</p>
                            )}
                        </section>

                        <section className="card">
                            <h2>Ingresos simulados</h2>
                            {hasPayments ? (
                                <>
                                    <div className="owner-highlight">
                                        <span>Ingreso registrado</span>
                                        <strong>{formatMoney(stats.revenueMinor)}</strong>
                                    </div>
                                    <dl className="kv">
                                        <dt>Pagos confirmados</dt><dd>{stats.succeededCount}</dd>
                                        <dt>Ticket promedio</dt>
                                        <dd>{stats.averageMinor === null ? '—' : formatMoney(stats.averageMinor)}</dd>
                                        <dt>Pagos fallidos</dt><dd>{stats.paymentCounts.failed ?? 0}</dd>
                                        <dt>Pagos pendientes</dt><dd>{stats.paymentCounts.pending ?? 0}</dd>
                                    </dl>
                                </>
                            ) : (
                                <p className="muted">
                                    No hay pagos simulados registrados para las sesiones completadas.
                                </p>
                            )}
                        </section>

                        <section className="card">
                            <h2>Reservas</h2>
                            {hasReservations ? (
                                <dl className="kv">
                                    <dt>Total</dt><dd>{reservations.length}</dd>
                                    <dt>{RESERVATION_STATUS_LABELS.confirmed}</dt>
                                    <dd>{stats.reservationCounts.confirmed ?? 0}</dd>
                                    <dt>{RESERVATION_STATUS_LABELS.cancelled}</dt>
                                    <dd>{stats.reservationCounts.cancelled ?? 0}</dd>
                                    <dt>{RESERVATION_STATUS_LABELS.completed}</dt>
                                    <dd>{stats.reservationCounts.completed ?? 0}</dd>
                                </dl>
                            ) : (
                                <p className="muted">Todavía no hay reservas registradas.</p>
                            )}
                        </section>

                        <section className="card">
                            <h2>Sesiones</h2>
                            {hasSessions ? (
                                <dl className="kv">
                                    <dt>Total</dt><dd>{sessions.length}</dd>
                                    <dt>{SESSION_STATUS_LABELS.active}</dt>
                                    <dd>{stats.sessionCounts.active ?? 0}</dd>
                                    <dt>{SESSION_STATUS_LABELS.completed}</dt>
                                    <dd>{stats.sessionCounts.completed ?? 0}</dd>
                                    <dt>{SESSION_STATUS_LABELS.cancelled}</dt>
                                    <dd>{stats.sessionCounts.cancelled ?? 0}</dd>
                                </dl>
                            ) : (
                                <p className="muted">Todavía no hay sesiones de estacionamiento.</p>
                            )}
                        </section>
                    </div>

                    <section className="card owner-indicators">
                        <h2>Indicadores generales</h2>
                        <div className="indicator-grid">
                            <div className="indicator">
                                <span className="indicator-value">{stats.totalSpaces}</span>
                                <span className="indicator-label">Plazas totales</span>
                            </div>
                            <div className="indicator">
                                <span className="indicator-value">{stats.spaceCounts.available}</span>
                                <span className="indicator-label">Plazas disponibles</span>
                            </div>
                            <div className="indicator">
                                <span className="indicator-value">{stats.reservationCounts.confirmed ?? 0}</span>
                                <span className="indicator-label">Reservas activas</span>
                            </div>
                            <div className="indicator">
                                <span className="indicator-value">{stats.sessionCounts.active ?? 0}</span>
                                <span className="indicator-label">Sesiones en curso</span>
                            </div>
                            <div className="indicator">
                                <span className="indicator-value">{payments.length}</span>
                                <span className="indicator-label">Pagos consultados</span>
                            </div>
                            <div className="indicator">
                                <span className="indicator-value">
                                    {stats.occupancyPct === null ? '—' : `${stats.occupancyPct}%`}
                                </span>
                                <span className="indicator-label">Ocupación actual</span>
                            </div>
                        </div>
                    </section>

                    <p className="muted small owner-note">
                        Los ingresos y estadísticas de pagos se calculan a partir de los pagos consultados para las
                        sesiones completadas. Última actualización: {lastUpdated ? formatDateTime(lastUpdated.toISOString()) : '—'}.
                    </p>
                </>
            )}
        </div>
    );
}
