import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import {
  IconAudit,
  IconConnect,
  IconKey,
  IconLogout,
  IconMemories,
  IconOrgs,
  LogoMark,
} from './icons';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

const NAV_ITEMS = [
  { to: '/', label: 'Memories', icon: <IconMemories />, end: true },
  { to: '/keys', label: 'API Keys', icon: <IconKey />, end: false },
  { to: '/audit', label: 'Audit Log', icon: <IconAudit />, end: false },
  { to: '/orgs', label: 'Organizations', icon: <IconOrgs />, end: false },
  { to: '/connect', label: 'Connect', icon: <IconConnect />, end: false },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <LogoMark />
          <span className="wordmark">Echo</span>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="avatar">{user ? initials(user.name) : '?'}</span>
            <div className="user-chip-text">
              <div className="name">{user?.name}</div>
              <div className="email">{user?.email}</div>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={() => void onLogout()} title="Log out" aria-label="Log out">
            <IconLogout />
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="main-inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
