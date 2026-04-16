import { useEffect, useMemo, useState } from 'react';
import AlertsPage from './pages/app/AlertsPage';
import InstallPrompt from './components/InstallPrompt';
import OfflineIndicator from './components/OfflineIndicator';
import DashboardPage from './pages/app/DashboardPage';
import HistoryPage from './pages/app/HistoryPage';
import ScanPage from './pages/app/ScanPage';
import AdminCommandCenter from './pages/admin/AdminCommandCenter';
import { farmerAuth, getCurrentSession, getSessionProfile, signInWithPassword } from './lib/auth';

const fallbackUser = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Farmer User',
  state: 'Karnataka',
  role: 'farmer',
};

function FarmerLogin({ onLogin }) {
  const [email, setEmail] = useState('farmer@aglen.local');
  const [password, setPassword] = useState('Farmer@12345!');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signInWithPassword(email.trim(), password);
      onLogin();
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="farmer-auth">
      <div className="farmer-auth__card">
        <p>Aglen PWA</p>
        <h1>Farmer Login</h1>
        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Signing in...' : 'Enter Farmer Dashboard'}
          </button>
          {error && <p className="page-error">{error}</p>}
        </form>
      </div>
    </section>
  );
}

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(fallbackUser);
  const [pathname, setPathname] = useState(() => window.location.pathname || '/');

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let ignore = false;

    async function bootstrapSession() {
      const current = await getCurrentSession();
      if (!ignore) setSession(current);
    }

    void bootstrapSession();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const { data } = farmerAuth.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let ignore = false;

    async function hydrateProfile() {
      if (!session?.user?.id) {
        setProfile(fallbackUser);
        return;
      }

      try {
        const userProfile = await getSessionProfile(session.user.id);
        if (!ignore && userProfile) {
          setProfile({
            id: userProfile.id,
            name: userProfile.full_name || session.user.email || 'Farmer User',
            state: userProfile.location_state || 'Karnataka',
            role: userProfile.role || 'farmer',
          });
          return;
        }
      } catch {
      }

      if (!ignore) {
        setProfile({
          id: session.user.id,
          name: session.user.email || 'Farmer User',
          state: 'Karnataka',
          role: 'farmer',
        });
      }
    }

    void hydrateProfile();
    return () => {
      ignore = true;
    };
  }, [session]);

  const tabContent = useMemo(() => {
    if (tab === 'dashboard') return <DashboardPage user={profile} />;
    if (tab === 'alerts') return <AlertsPage profile={{ location_state: profile.state }} />;
    if (tab === 'history') return <HistoryPage userId={profile.id} />;
    return <ScanPage userId={profile.id} />;
  }, [profile, tab]);

  if (!session) {
    return <FarmerLogin onLogin={async () => setSession(await getCurrentSession())} />;
  }

  if (pathname.startsWith('/admin')) {
    if (profile.role !== 'admin') {
      return (
        <section className="farmer-auth">
          <div className="farmer-auth__card">
            <p>Access denied</p>
            <h1>Admin role required</h1>
            <p className="page-error">Your account does not have admin permissions.</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                window.history.pushState({}, '', '/');
                setPathname('/');
              }}
            >
              Go to farmer dashboard
            </button>
          </div>
        </section>
      );
    }

    return (
      <AdminCommandCenter
        adminName={profile.name}
        onBackToFarmer={() => {
          window.history.pushState({}, '', '/');
          setPathname('/');
        }}
        onSignOut={() => {
          void farmerAuth.auth.signOut();
        }}
      />
    );
  }

  return (
    <div className="pwa-shell">
      <OfflineIndicator />
      <header className="app-topbar">
        <div>
          <p>Aglen</p>
          <h1>Farmer assistant</h1>
        </div>
        <button
          type="button"
          className="app-topbar__admin-btn"
          onClick={() => {
            void farmerAuth.auth.signOut();
          }}
        >
          Sign out
        </button>
      </header>

      <main className="app-main">{tabContent}</main>

        <InstallPrompt />

      <nav className="bottom-nav" aria-label="Primary">
        <button type="button" className={tab === 'dashboard' ? 'is-active' : ''} onClick={() => setTab('dashboard')}>
          Home
        </button>
        <button type="button" className={tab === 'alerts' ? 'is-active' : ''} onClick={() => setTab('alerts')}>
          Alerts
        </button>
        <button type="button" className={tab === 'scan' ? 'is-active' : ''} onClick={() => setTab('scan')}>
          Scan
        </button>
        <button type="button" className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}>
          History
        </button>
      </nav>
    </div>
  );
}
