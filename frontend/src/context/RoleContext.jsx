import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_ROLE, ROLES } from '../roles';
import {
    getActiveRole,
    getUserPlate,
    setActiveRole,
    setUserPlate as persistUserPlate
} from '../utils/storage';

const RoleContext = createContext(null);

function initialRole() {
    const saved = getActiveRole();
    return saved && ROLES[saved] ? saved : DEFAULT_ROLE;
}

export function RoleProvider({ children }) {
    const [roleId, setRoleId] = useState(initialRole);
    const [userPlate, setUserPlateState] = useState(getUserPlate);

    const setRole = useCallback((next) => {
        if (!ROLES[next]) return;
        setRoleId(next);
        setActiveRole(next);
    }, []);

    const setUserPlate = useCallback((plate) => {
        const normalized = (plate ?? '').trim().toUpperCase();
        setUserPlateState(normalized);
        persistUserPlate(normalized);
    }, []);

    const value = useMemo(() => ({
        roleId,
        role: ROLES[roleId],
        setRole,
        userPlate,
        setUserPlate
    }), [roleId, setRole, userPlate, setUserPlate]);

    return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
    const context = useContext(RoleContext);
    if (!context) throw new Error('useRole debe usarse dentro de RoleProvider.');
    return context;
}
