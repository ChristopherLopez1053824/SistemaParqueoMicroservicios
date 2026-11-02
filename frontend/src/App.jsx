import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import RoleSelector from './components/RoleSelector';
import { RoleProvider, useRole } from './context/RoleContext';
import DashboardPage from './pages/DashboardPage';
import MyPaymentsPage from './pages/MyPaymentsPage';
import MySessionsPage from './pages/MySessionsPage';
import OwnerDashboardPage from './pages/OwnerDashboardPage';
import ReservationsPage from './pages/ReservationsPage';
import { NAV_BY_ROLE } from './roles';

function RoleRoute({ roles, children }) {
    const { roleId } = useRole();
    if (!roles.includes(roleId)) return <Navigate to="/" replace />;
    return children;
}

function HomePage() {
    const { roleId } = useRole();
    return roleId === 'propietario' ? <OwnerDashboardPage /> : <DashboardPage />;
}

function AppShell() {
    const { roleId, role } = useRole();
    const links = NAV_BY_ROLE[roleId] ?? [];

    return (
        <>
            <header className="topbar">
                <div className="brand">
                    Sistema de Parqueos
                    <span className="brand-role">{role.label}</span>
                </div>
                <nav>
                    {links.map((link) => (
                        <NavLink key={link.to} to={link.to} end={link.end}>{link.label}</NavLink>
                    ))}
                </nav>
                <RoleSelector />
            </header>
            <main>
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/reservations" element={
                        <RoleRoute roles={['usuario']}>
                            <ReservationsPage />
                        </RoleRoute>
                    } />
                    <Route path="/sessions" element={
                        <RoleRoute roles={['usuario']}>
                            <MySessionsPage />
                        </RoleRoute>
                    } />
                    <Route path="/payments" element={
                        <RoleRoute roles={['usuario']}>
                            <MyPaymentsPage />
                        </RoleRoute>
                    } />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
        </>
    );
}

export default function App() {
    return (
        <RoleProvider>
            <AppShell />
        </RoleProvider>
    );
}
