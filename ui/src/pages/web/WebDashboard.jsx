import PropTypes from 'prop-types';

const navItems = [
  { key: 'dashboard', label: 'Overview' },
  { key: 'scan', label: 'Scan Leaf' },
  { key: 'history', label: 'History' },
  { key: 'alerts', label: 'Alerts' },
];

export default function WebDashboard({ tab, onTabChange, content, onOpenAdmin }) {
  return (
    <div className="web-shell">
      <aside className="web-sidebar">
        <div className="web-sidebar__brand">
          <p>Aglen Web</p>
          <h1>Farmer Dashboard</h1>
        </div>

        <nav className="web-nav" aria-label="Web dashboard navigation">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? 'is-active' : ''}
              onClick={() => onTabChange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button type="button" className="web-admin-btn" onClick={onOpenAdmin}>
          Open Admin Dashboard
        </button>
      </aside>

      <main className="web-main">
        <header className="web-main__header">
          <div>
            <p>Web Experience</p>
            <h2>{navItems.find((item) => item.key === tab)?.label ?? 'Overview'}</h2>
          </div>
        </header>

        <section className="web-main__content">{content}</section>
      </main>
    </div>
  );
}

WebDashboard.propTypes = {
  tab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  content: PropTypes.node.isRequired,
  onOpenAdmin: PropTypes.func.isRequired,
};
