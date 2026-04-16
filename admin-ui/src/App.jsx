import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { activateModel, listModels, uploadModel } from './lib/api';
import { supabase } from './lib/supabase';

const NAV_LINKS = [
  { key: 'overview', label: 'Overview', path: '/', href: '/admin' },
  { key: 'users', label: 'Users', path: '/users', href: '/admin/users' },
  { key: 'scans', label: 'Scans', path: '/scans', href: '/admin/scans' },
  { key: 'alerts', label: 'Alerts', path: '/alerts', href: '/admin/alerts' },
  { key: 'map', label: 'Outbreak map', path: '/map', href: '/admin/map' },
  { key: 'health', label: 'System health', path: '/health', href: '/admin/health' },
];

function normalizeAdminPath(pathname = '/') {
  if (!pathname) return '/';
  if (pathname === '/') return '/';

  const trimmed = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const withoutPrefix = trimmed.startsWith('/admin') ? trimmed.slice('/admin'.length) || '/' : trimmed;
  return NAV_LINKS.some((item) => item.path === withoutPrefix) ? withoutPrefix : '/';
}

function SystemHealthPage() {
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const [healthRes, metricsRes] = await Promise.all([
          fetch(`${apiBase}/health`),
          fetch(`${apiBase}/metrics`),
        ]);

        if (!healthRes.ok || !metricsRes.ok) {
          throw new Error('Unable to fetch backend health.');
        }

        const [healthPayload, metricsPayload] = await Promise.all([
          healthRes.json(),
          metricsRes.json(),
        ]);

        if (!ignore) {
          setHealth(healthPayload);
          setMetrics(metricsPayload);
          setError('');
        }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load health checks.');
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <section className="card">
      <h3>System health</h3>
      {error && <p className="admin-auth__error">{error}</p>}
      <ul className="detail-list">
        <li><span>Status</span><strong>{health?.status || 'unknown'}</strong></li>
        <li><span>Model ready</span><strong>{health?.ready ? 'yes' : 'no'}</strong></li>
        <li><span>Inference device</span><strong>{health?.device || 'unknown'}</strong></li>
        <li><span>Predict count</span><strong>{metrics?.predict?.count ?? 0}</strong></li>
        <li><span>Explain avg latency</span><strong>{metrics?.explain?.avg_ms ?? 0} ms</strong></li>
      </ul>
    </section>
  );
}

function Login({ onAuthenticated }) {
  const [email, setEmail] = useState('admin@aglen.local');
  const [password, setPassword] = useState('Admin@12345!');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;

      const userId = data.session?.user?.id;
      if (!userId) throw new Error('Invalid admin session.');

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('role, full_name')
        .eq('id', userId)
        .single();

      if (profileError) throw profileError;
      if (profile?.role !== 'admin') {
        await supabase.auth.signOut();
        throw new Error('This account is not an admin account.');
      }

      onAuthenticated(data.session, profile);
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-auth">
      <div className="admin-auth__card">
        <p>Aglen Company Console</p>
        <h1>Master Dashboard Login</h1>
        <form onSubmit={submit}>
          <label>
            Admin email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in...' : 'Open Master Dashboard'}
          </button>
          {error && <p className="admin-auth__error">{error}</p>}
        </form>
      </div>
    </section>
  );
}

function ModelControl({ token }) {
  const [models, setModels] = useState([]);
  const [label, setLabel] = useState('');
  const [modelFile, setModelFile] = useState(null);
  const [classNamesFile, setClassNamesFile] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  async function refresh() {
    try {
      const data = await listModels(token);
      setModels(data.models || []);
      setStatus('');
    } catch (err) {
      setModels([]);
      setStatus(err.message || 'Unable to load models from backend.');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onUpload(event) {
    event.preventDefault();
    if (!modelFile) {
      setStatus('Choose a .pth model file first.');
      return;
    }

    setLoading(true);
    setStatus('Uploading model...');
    try {
      await uploadModel(token, modelFile, classNamesFile, label.trim() || undefined);
      setStatus('Model uploaded. You can now activate it.');
      setLabel('');
      setModelFile(null);
      setClassNamesFile(null);
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Failed to upload model.');
    } finally {
      setLoading(false);
    }
  }

  async function onActivate(modelId) {
    setLoading(true);
    setStatus(`Activating model ${modelId}...`);
    try {
      await activateModel(token, modelId);
      setStatus('Model activated successfully.');
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Failed to activate model.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <header>
        <h3>Model Registry Control</h3>
        <p>Upload and activate trained models without touching code.</p>
      </header>

      <form className="model-upload" onSubmit={onUpload}>
        <label>
          Model label
          <input
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Tomato-v5-Apr-2026"
          />
        </label>
        <label>
          Model .pth file
          <input type="file" accept=".pth" onChange={(event) => setModelFile(event.target.files?.[0] || null)} />
        </label>
        <label>
          class_names.json (optional)
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => setClassNamesFile(event.target.files?.[0] || null)}
          />
        </label>
        <button type="submit" disabled={loading}>Upload Model</button>
      </form>

      <div className="model-list">
        {models.map((model) => (
          <article key={model.model_id} className={model.is_active ? 'active' : ''}>
            <div>
              <strong>{model.label || model.model_id}</strong>
              <p>{new Date(model.created_at).toLocaleString()}</p>
            </div>
            <button type="button" onClick={() => onActivate(model.model_id)} disabled={loading || model.is_active}>
              {model.is_active ? 'Active' : 'Activate'}
            </button>
          </article>
        ))}
      </div>

      {status && <p className="status">{status}</p>}
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [adminProfile, setAdminProfile] = useState(null);
  const [users, setUsers] = useState([]);
  const [scans, setScans] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [path, setPath] = useState(() => normalizeAdminPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPath(normalizeAdminPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(nextPath) {
    const normalized = normalizeAdminPath(nextPath);
    setPath(normalized);
    const href = normalized === '/' ? '/admin' : `/admin${normalized}`;
    window.history.pushState({}, '', href);
  }

  useEffect(() => {
    let ignore = false;

    async function bootstrap() {
      const { data } = await supabase.auth.getSession();
      if (!data.session || ignore) return;

      const { data: profile } = await supabase
        .from('users')
        .select('role, full_name')
        .eq('id', data.session.user.id)
        .single();

      if (!ignore && profile?.role === 'admin') {
        setSession(data.session);
        setAdminProfile(profile);
      }
    }

    void bootstrap();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    let ignore = false;
    async function loadData() {
      const [usersRes, scansRes, alertsRes] = await Promise.all([
        supabase.from('users').select('id, full_name, email, role, location_state, is_active, created_at').order('created_at', { ascending: false }).limit(500),
        supabase.from('scans').select('id, confidence, created_at, predicted_class, user_id').order('created_at', { ascending: false }).limit(2000),
        supabase.from('disease_alerts').select('id, severity, disease_class, affected_state, case_count, last_updated_at').eq('is_active', true).limit(200),
      ]);

      if (!ignore) {
        setUsers(usersRes.data || []);
        setScans(scansRes.data || []);
        setAlerts(alertsRes.data || []);
      }
    }

    void loadData();
    return () => {
      ignore = true;
    };
  }, [session]);

  const scansByDay = useMemo(() => {
    const dayMap = new Map();
    scans.forEach((scan) => {
      const key = new Date(scan.created_at).toISOString().slice(0, 10);
      dayMap.set(key, (dayMap.get(key) || 0) + 1);
    });
    return [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, value]) => ({ date, scans: value }));
  }, [scans]);

  const usersByRole = useMemo(() => {
    const roleMap = new Map();
    users.forEach((user) => roleMap.set(user.role, (roleMap.get(user.role) || 0) + 1));
    return [...roleMap.entries()].map(([role, count]) => ({ role, count }));
  }, [users]);

  const scansByState = useMemo(() => {
    const stateMap = new Map();
    const userMap = new Map(users.map((user) => [user.id, user.location_state || 'Unknown']));
    scans.forEach((scan) => {
      const state = userMap.get(scan.user_id) || 'Unknown';
      stateMap.set(state, (stateMap.get(state) || 0) + 1);
    });
    return [...stateMap.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [scans, users]);

  const content = useMemo(() => {
    if (path === '/users') {
      return (
        <section className="card">
          <h3>Users</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>State</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.slice(0, 200).map((user) => (
                  <tr key={user.id}>
                    <td>{user.full_name || 'N/A'}</td>
                    <td>{user.email || 'N/A'}</td>
                    <td>{user.role}</td>
                    <td>{user.location_state || 'N/A'}</td>
                    <td>{user.is_active ? 'active' : 'inactive'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    if (path === '/scans') {
      return (
        <section className="card">
          <h3>Scans</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={scansByDay}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="scans" stroke="#1f7a56" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      );
    }

    if (path === '/alerts') {
      return (
        <section className="card">
          <h3>Alerts</h3>
          <ul className="detail-list">
            {alerts.slice(0, 100).map((alert) => (
              <li key={alert.id}>
                <span>{alert.disease_class} ({alert.affected_state || 'Unknown'})</span>
                <strong>{alert.severity}</strong>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    if (path === '/map') {
      return (
        <section className="card">
          <h3>Outbreak map data (state ranking)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={scansByState}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="state" interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#2b8b6a" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      );
    }

    if (path === '/health') {
      return <SystemHealthPage />;
    }

    return (
      <>
        <section className="stats">
          <article>
            <h3>Total Accounts</h3>
            <p>{users.length}</p>
          </article>
          <article>
            <h3>Total Scans</h3>
            <p>{scans.length}</p>
          </article>
          <article>
            <h3>Active Alerts</h3>
            <p>{alerts.length}</p>
          </article>
        </section>

        <section className="charts">
          <div className="card">
            <h3>Scan Throughput (14 Days)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={scansByDay}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="scans" stroke="#1f7a56" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3>Account Roles</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={usersByRole}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="role" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#d3842f" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <ModelControl token={session.access_token} />
      </>
    );
  }, [alerts, path, scans, scansByDay, scansByState, session?.access_token, users, usersByRole]);

  if (!session) {
    return (
      <Login
        onAuthenticated={(nextSession, profile) => {
          setSession(nextSession);
          setAdminProfile(profile);
        }}
      />
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <p>Aglen</p>
        <h1>Master Dashboard</h1>
        <small>{adminProfile?.full_name || session.user.email}</small>
        <nav className="admin-nav" aria-label="Admin routes">
          {NAV_LINKS.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={path === item.path ? 'is-active' : ''}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.path);
              }}
            >
              <span>{item.label}</span>
              <small>{item.href}</small>
            </a>
          ))}
        </nav>
        <button type="button" onClick={() => supabase.auth.signOut().then(() => setSession(null))}>
          Sign out
        </button>
      </aside>

      <main className="admin-main">{content}</main>
    </div>
  );
}
