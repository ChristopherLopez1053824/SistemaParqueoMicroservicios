// Muestra confirmaciones o errores. Con un ApiError incluye los detalles y el requestId como referencia.
export default function Alert({ type = 'info', title, error, children, onClose }) {
    const message = error ? error.message : children;
    if (!message && !title) return null;

    const details = Array.isArray(error?.details) ? error.details : null;

    return (
        <div className={`alert alert-${error ? 'error' : type}`} role={error ? 'alert' : 'status'}>
            <div className="alert-body">
                {title && <strong>{title}</strong>}
                <div>{message}</div>
                {details && details.length > 0 && (
                    <ul className="alert-details">
                        {details.map((d, i) => (
                            <li key={i}>{d.field ? <code>{d.field}</code> : null} {d.message}</li>
                        ))}
                    </ul>
                )}
                {error?.requestId && (
                    <div className="alert-meta">
                        <span>Referencia: <code>{error.requestId}</code></span>
                    </div>
                )}
            </div>
            {onClose && (
                <button type="button" className="alert-close" onClick={onClose} aria-label="Cerrar">×</button>
            )}
        </div>
    );
}
