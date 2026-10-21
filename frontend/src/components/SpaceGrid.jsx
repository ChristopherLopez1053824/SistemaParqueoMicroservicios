import StatusBadge from './StatusBadge';
import { SPACE_STATUS_LABELS, SPACE_TYPE_LABELS } from '../utils/constants';

// Cuadrícula de plazas agrupadas por nivel.
export default function SpaceGrid({ spaces, onSelect, selectedId }) {
    if (spaces.length === 0) {
        return <p className="muted">No hay plazas para mostrar.</p>;
    }

    const byLevel = spaces.reduce((acc, space) => {
        (acc[space.level] ??= []).push(space);
        return acc;
    }, {});

    return (
        <div className="levels">
            {Object.entries(byLevel).map(([level, levelSpaces]) => (
                <section key={level} className="level">
                    <h3>{level}</h3>
                    <div className="grid">
                        {levelSpaces.map((space) => (
                            <button
                                key={space.id}
                                type="button"
                                className={`space space-${space.status}${selectedId === space.id ? ' space-selected' : ''}`}
                                onClick={() => onSelect?.(space)}
                                title={`${space.code} · ${SPACE_STATUS_LABELS[space.status] ?? space.status}`}
                            >
                                <span className="space-code">{space.code}</span>
                                <span className="space-type">{SPACE_TYPE_LABELS[space.spaceType] ?? space.spaceType}</span>
                                <StatusBadge status={space.status} labels={SPACE_STATUS_LABELS} />
                            </button>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
