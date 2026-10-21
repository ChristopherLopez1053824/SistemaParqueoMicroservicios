import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '../components/Alert';
import SpaceGrid from '../components/SpaceGrid';
import StatsPanel from '../components/StatsPanel';
import StatusBadge from '../components/StatusBadge';
import { listSpaces } from '../services/parking.service';
import { SPACE_STATUS_LABELS, SPACE_TYPE_LABELS } from '../utils/constants';

export default function DashboardPage() {
    const navigate = useNavigate();
    const [spaces, setSpaces] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [statusFilter, setStatusFilter] = useState('');
    const [selected, setSelected] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { spaces: data } = await listSpaces();
            setSpaces(data);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const visible = useMemo(
        () => (statusFilter ? spaces.filter((s) => s.status === statusFilter) : spaces),
        [spaces, statusFilter]
    );

    return (
        <div className="page">
            <div className="page-header">
                <h1>Panel de plazas</h1>
                <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
                    {loading ? 'Actualizando…' : 'Actualizar'}
                </button>
            </div>

            <Alert error={error} title="No se pudieron cargar las plazas" />

            <StatsPanel spaces={spaces} />

            <div className="toolbar">
                <label>
                    Filtrar por estado{' '}
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="">Todos</option>
                        {Object.entries(SPACE_STATUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                </label>
                <div className="legend">
                    {Object.keys(SPACE_STATUS_LABELS).map((s) => (
                        <StatusBadge key={s} status={s} labels={SPACE_STATUS_LABELS} />
                    ))}
                </div>
            </div>

            <div className="dashboard-layout">
                <div>
                    {loading && spaces.length === 0
                        ? <p className="muted">Cargando plazas…</p>
                        : <SpaceGrid spaces={visible} onSelect={setSelected} selectedId={selected?.id} />}
                </div>

                <aside className="card detail">
                    {selected ? (
                        <>
                            <div className="card-header">
                                <h3>Plaza {selected.code}</h3>
                                <StatusBadge status={selected.status} labels={SPACE_STATUS_LABELS} />
                            </div>
                            <dl className="kv">
                                <dt>Código</dt><dd>{selected.code}</dd>
                                <dt>Nivel</dt><dd>{selected.level}</dd>
                                <dt>Tipo</dt><dd>{SPACE_TYPE_LABELS[selected.spaceType] ?? selected.spaceType}</dd>
                                <dt>Estado</dt><dd>{SPACE_STATUS_LABELS[selected.status] ?? selected.status}</dd>
                                <dt>id</dt><dd><code>{selected.id}</code></dd>
                            </dl>
                            {selected.status === 'available' ? (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => navigate(`/reservations?spaceId=${selected.id}`)}
                                >
                                    Reservar esta plaza
                                </button>
                            ) : (
                                <p className="muted">Solo las plazas disponibles pueden reservarse.</p>
                            )}
                        </>
                    ) : (
                        <p className="muted">Seleccione una plaza para ver su detalle.</p>
                    )}
                </aside>
            </div>
        </div>
    );
}
