import { useMemo } from 'react';

const NAV_LINKS = [
  { key: 'overview', label: 'Overview', path: '/', href: '/admin' },
  { key: 'users', label: 'Users', path: '/users', href: '/admin/users' },
  { key: 'scans', label: 'Scans', path: '/scans', href: '/admin/scans' },
  { key: 'alerts', label: 'Alerts', path: '/alerts', href: '/admin/alerts' },
  { key: 'map', label: 'Outbreak map', path: '/map', href: '/admin/map' },
  { key: 'health', label: 'System health', path: '/health', href: '/admin/health' },
];

export default function AdminLayout({
  activePath = '/users',
  adminName = 'Admin User',
  onNavigate,
  onSignOut,
  children,
}) {
  const activeKey = useMemo(
    () => NAV_LINKS.find((item) => item.path === activePath)?.key,
    [activePath],
  );

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar" aria-label="Admin sidebar">
        <div className="admin-sidebar__header">
          <p>Aglen Admin</p>
          <h1>Command center</h1>
        </div>

        <nav className="admin-sidebar__nav">
          {NAV_LINKS.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={`admin-nav-link ${activeKey === item.key ? 'is-active' : ''}`}
              onClick={(event) => {
                event.preventDefault();
                onNavigate?.(item.path);
              }}
            >
              <span>{item.label}</span>
              <small>{item.href}</small>
            </a>
          ))}
        </nav>

        <div className="admin-sidebar__footer">
          <strong>{adminName}</strong>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="admin-content">{children}</main>

      <nav className="admin-mobile-tabs" aria-label="Admin tabs">
        {NAV_LINKS.map((item) => (
          <a
            key={item.key}
            href={item.href}
            className={activeKey === item.key ? 'is-active' : ''}
            onClick={(event) => {
              event.preventDefault();
              onNavigate?.(item.path);
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
