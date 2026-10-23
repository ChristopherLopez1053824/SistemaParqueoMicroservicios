import { useCallback, useEffect, useState } from 'react';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import { createSpace, listSpaces, updateSpaceStatus } from '../services/parking.service';
import { SPACE_STATUS_LABELS, SPACE_TYPE_LABELS } from '../utils/constants';

const EMPTY_FORM = { code: '', level: '', spaceType: 'standard' };

export default function SpacesAdminPage() {
    const [spaces, setSpaces] = useState([]);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formErrors, setFormErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setSpaces((await listSpaces()).spaces);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleCreate(e) {
        e.preventDefault();
        const errors = {};
        if (!form.code.trim()) errors.code = 'El código es obligatorio.';
        if (!form.level.trim()) errors.level = 'El nivel es obligatorio.';
        setFormErrors(errors);
        if (Object.keys(errors).length > 0 || busy) return;

        setBusy('create');
        setError(null);
        setNotice(null);
        try {
            const space = await createSpace({ code: form.code.trim(), level: form.level.trim(), spaceType: form.spaceType });
            setNotice(`Plaza ${space.code} registrada.`);
            setForm(EMPTY_FORM);
        } catch (err) {
            setError(err);
        } finally {
            setBusy(null);
            load();
        }
    }

    async function handleStatus(space, status) {
        if (busy || status === space.status) return;
        setBusy(space.id);
        setError(null);
        setNotice(null);
        try {
            await updateSpaceStatus(space.id, status);
            setNotice(`Plaza ${space.code}: estado actualizado a ${SPACE_STATUS_LABELS[status]}.`);
        } catch (err) {
            setError(err);
        } finally {
            setBusy(null);
            load();
        }
    }

    return (
        <div className="page">
            <h1>Administración de plazas</h1>

            {notice && <Alert type="success" onClose={() => setNotice(null)}>{notice}</Alert>}
            <Alert error={error} title="La operación no se completó" onClose={() => setError(null)} />

            <div className="two-col">
                <form className="card form" onSubmit={handleCreate} noValidate>
                    <h2>Registrar plaza</h2>
                    <label>
                        Código
                        <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="A-01" />
                        {formErrors.code && <span className="field-error">{formErrors.code}</span>}
                    </label>
                    <label>
                        Nivel
                        <input value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} placeholder="Nivel 1" />
                        {formErrors.level && <span className="field-error">{formErrors.level}</span>}
                    </label>
                    <label>
                        Tipo
                        <select value={form.spaceType} onChange={(e) => setForm({ ...form, spaceType: e.target.value })}>
                            {Object.entries(SPACE_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                    </label>
                    <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                        {busy === 'create' ? 'Registrando…' : 'Registrar plaza'}
                    </button>
                </form>

                <div className="card">
                    <h2>Estado de las plazas</h2>
                    {loading && spaces.length === 0 ? (
                        <p className="muted">Cargando plazas…</p>
                    ) : spaces.length === 0 ? (
                        <p className="muted">Todavía no hay plazas registradas.</p>
                    ) : (
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr><th>Código</th><th>Nivel</th><th>Tipo</th><th>Estado</th><th>Cambiar a</th></tr>
                                </thead>
                                <tbody>
                                    {spaces.map((s) => (
                                        <tr key={s.id}>
                                            <td>{s.code}</td>
                                            <td>{s.level}</td>
                                            <td>{SPACE_TYPE_LABELS[s.spaceType] ?? s.spaceType}</td>
                                            <td><StatusBadge status={s.status} labels={SPACE_STATUS_LABELS} /></td>
                                            <td>
                                                {s.status === 'available' || s.status === 'maintenance' ? (
                                                    <select
                                                        value={s.status}
                                                        disabled={busy !== null}
                                                        onChange={(e) => handleStatus(s, e.target.value)}
                                                    >
                                                        <option value="available">{SPACE_STATUS_LABELS.available}</option>
                                                        <option value="maintenance">{SPACE_STATUS_LABELS.maintenance}</option>
                                                    </select>
                                                ) : (
                                                    <span className="muted small">Se gestiona desde Reservas</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
