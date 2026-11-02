import { useNavigate } from 'react-router-dom';
import { useRole } from '../context/RoleContext';
import { ROLES } from '../roles';

export default function RoleSelector() {
    const { roleId, setRole } = useRole();
    const navigate = useNavigate();

    function select(id) {
        if (id === roleId) return;
        setRole(id);
        navigate(ROLES[id].home);
    }

    return (
        <div className="role-switcher" role="group" aria-label="Seleccionar perfil de usuario">
            <span className="role-switcher-caption">Perfil activo</span>
            {Object.values(ROLES).map((role) => (
                <button
                    key={role.id}
                    type="button"
                    className={`role-option${roleId === role.id ? ' role-option-active' : ''}`}
                    aria-pressed={roleId === role.id}
                    title={role.description}
                    onClick={() => select(role.id)}
                >
                    {role.label}
                </button>
            ))}
        </div>
    );
}
