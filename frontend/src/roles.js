export const DEFAULT_ROLE = 'usuario';

export const ROLES = {
    usuario: {
        id: 'usuario',
        label: 'Usuario',
        description: 'Reserva plazas y consulta tu actividad.',
        home: '/'
    },
    propietario: {
        id: 'propietario',
        label: 'Propietario',
        description: 'Revisa indicadores y resultados del negocio.',
        home: '/'
    }
};

export const NAV_BY_ROLE = {
    usuario: [
        { to: '/', label: 'Plazas', end: true },
        { to: '/reservations', label: 'Mis reservas' },
        { to: '/sessions', label: 'Mis sesiones' },
        { to: '/payments', label: 'Mis pagos' }
    ],
    propietario: [
        { to: '/', label: 'Dashboard', end: true }
    ]
};

export const ALLOWED_PATHS = {
    usuario: ['/', '/reservations', '/sessions', '/payments'],
    propietario: ['/']
};

export function isPathAllowed(roleId, pathname) {
    return (ALLOWED_PATHS[roleId] ?? []).includes(pathname);
}
