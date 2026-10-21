import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import PaymentsPage from './pages/PaymentsPage';
import ReservationsPage from './pages/ReservationsPage';
import SessionsPage from './pages/SessionsPage';
import SpacesAdminPage from './pages/SpacesAdminPage';

const LINKS = [
    { to: '/', label: 'Panel', end: true },
    { to: '/reservations', label: 'Reservas' },
    { to: '/sessions', label: 'Entrada / Salida' },
    { to: '/payments', label: 'Pagos' },
    { to: '/admin/spaces', label: 'Plazas' }
];

export default function App() {
    return (
        <>
            <header className="topbar">
                <div className="brand">Sistema de Parqueos</div>
                <nav>
                    {LINKS.map((link) => (
                        <NavLink key={link.to} to={link.to} end={link.end}>{link.label}</NavLink>
                    ))}
                </nav>
            </header>
            <main>
                <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/reservations" element={<ReservationsPage />} />
                    <Route path="/sessions" element={<SessionsPage />} />
                    <Route path="/payments" element={<PaymentsPage />} />
                    <Route path="/admin/spaces" element={<SpacesAdminPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
        </>
    );
}
