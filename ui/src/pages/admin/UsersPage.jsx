import { useEffect, useMemo, useState } from 'react';
import {
  STATE_OPTIONS,
  addAdminNote,
  fetchUserNotes,
  fetchUserScans,
  fetchUsers,
  updateUser,
} from '../../lib/admin';

const PAGE_SIZE = 25;

function formatDate(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function roleBadgeClass(role) {
  if (role === 'admin') return 'is-admin';
  if (role === 'agronomist') return 'is-agronomist';
  return 'is-farmer';
}

function statusText(active) {
  return active ? 'active' : 'inactive';
}

function toCSV(rows) {
  const headers = [
    'Name',
    'Email',
    'Role',
    'State',
    'Total scans',
    'Last active',
    'Plan',
    'Status',
  ];
  const body = rows.map((row) => [
    row.full_name || '',
    row.email || '',
    row.role || '',
    row.location_state || '',
    row.scan_count || 0,
    row.last_active_at || '',
    row.plan || '',
    row.is_active ? 'active' : 'inactive',
  ]);

  return [headers, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

function triggerDownload(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function UserDetailModal({
  user,
  adminId,
  onClose,
  onUserUpdated,
  onOpenUserScans,
}) {
  const [form, setForm] = useState({
    location_state: user.location_state || '',
    location_district: user.location_district || '',
    crop_types: (user.crop_types || []).join(', '),
    plan: user.plan || 'free',
    role: user.role || 'farmer',
  });
  const [scanHistory, setScanHistory] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyDanger, setBusyDanger] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function loadDetails() {
      try {
        const [scans, fetchedNotes] = await Promise.all([
          fetchUserScans(user.id, 10, 0),
          fetchUserNotes(user.id, 30),
        ]);
        if (!ignore) {
          setScanHistory(scans);
          setNotes(fetchedNotes);
        }
      } catch {
        if (!ignore) {
          setScanHistory([]);
          setNotes([]);
        }
      }
    }
    loadDetails();
    return () => {
      ignore = true;
    };
  }, [user.id]);

  async function saveInlineEdits() {
    setSaving(true);
    try {
      const updated = await updateUser(user.id, {
        location_state: form.location_state || null,
        location_district: form.location_district || null,
        crop_types: form.crop_types
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        plan: form.plan,
        role: form.role,
      });
      onUserUpdated(updated || { ...user, ...form });
    } finally {
      setSaving(false);
    }
  }

  async function submitNote() {
    if (!noteDraft.trim()) return;
    const created = await addAdminNote(user.id, noteDraft.trim(), adminId);
    setNoteDraft('');
    setNotes((prev) => [created, ...prev]);
  }

  async function deactivateWithConfirm() {
    const confirmed = window.confirm(`Deactivate ${user.full_name || user.email}?`);
    if (!confirmed) return;

    setBusyDanger(true);
    try {
      const updated = await updateUser(user.id, { is_active: false });
      onUserUpdated(updated || { ...user, is_active: false });
    } finally {
      setBusyDanger(false);
    }
  }

  return (
    <div className="admin-user-modal" role="dialog" aria-modal="true">
      <div className="admin-user-modal__panel">
        <header className="admin-user-modal__header">
          <h3>{user.full_name || user.email}</h3>
          <button type="button" onClick={onClose}>Close</button>
        </header>

        <section className="admin-user-section">
          <h4>Profile</h4>
          <div className="admin-form-grid">
            <label>
              State
              <input
                value={form.location_state}
                onChange={(event) => setForm((prev) => ({ ...prev, location_state: event.target.value }))}
              />
            </label>
            <label>
              District
              <input
                value={form.location_district}
                onChange={(event) => setForm((prev) => ({ ...prev, location_district: event.target.value }))}
              />
            </label>
            <label>
              Crop types (comma separated)
              <input
                value={form.crop_types}
                onChange={(event) => setForm((prev) => ({ ...prev, crop_types: event.target.value }))}
              />
            </label>
            <label>
              Plan
              <select value={form.plan} onChange={(event) => setForm((prev) => ({ ...prev, plan: event.target.value }))}>
                <option value="free">free</option>
                <option value="pro">pro</option>
              </select>
            </label>
            <label>
              Role
              <select value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}>
                <option value="farmer">farmer</option>
                <option value="agronomist">agronomist</option>
                <option value="admin">admin</option>
              </select>
            </label>
          </div>
          <button type="button" className="admin-btn admin-btn--primary" onClick={saveInlineEdits} disabled={saving}>
            {saving ? 'Saving...' : 'Save profile changes'}
          </button>
        </section>

        <section className="admin-user-section">
          <h4>Activity</h4>
          <p>Created: {formatDate(user.created_at)}</p>
          <p>Last active: {formatDate(user.last_active_at)}</p>
          <p>Total scans: {user.scan_count || 0}</p>
        </section>

        <section className="admin-user-section">
          <h4>Scan history (last 10)</h4>
          <ul className="admin-inline-list">
            {scanHistory.map((scan) => (
              <li key={scan.id}>
                <span>{scan.predicted_class}</span>
                <span>{Math.round((scan.confidence || 0) * 100)}%</span>
              </li>
            ))}
            {scanHistory.length === 0 && <li>No scans yet.</li>}
          </ul>
          <button
            type="button"
            className="admin-btn"
            onClick={() => onOpenUserScans?.(user.id)}
          >
            View full scan history
          </button>
        </section>

        <section className="admin-user-section">
          <h4>Admin notes</h4>
          <div className="admin-note-composer">
            <textarea
              rows={3}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Add an internal note"
            />
            <button type="button" className="admin-btn" onClick={submitNote}>Add note</button>
          </div>
          <ul className="admin-inline-list">
            {notes.map((note) => (
              <li key={note.id}>
                <span>{note.note}</span>
                <span>{formatDate(note.created_at)}</span>
              </li>
            ))}
            {notes.length === 0 && <li>No notes yet.</li>}
          </ul>
        </section>

        <section className="admin-user-section admin-user-section--danger">
          <h4>Danger zone</h4>
          <button type="button" className="admin-btn admin-btn--danger" onClick={deactivateWithConfirm} disabled={busyDanger}>
            {busyDanger ? 'Processing...' : 'Deactivate account'}
          </button>
        </section>
      </div>
    </div>
  );
}

export default function UsersPage({
  adminId = '33333333-3333-3333-3333-333333333333',
  onOpenUserScans,
}) {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter, statusFilter, planFilter, stateFilter]);

  useEffect(() => {
    let ignore = false;

    async function loadUsers() {
      setLoading(true);
      setError('');
      try {
        const result = await fetchUsers({
          search: debouncedSearch,
          role: roleFilter,
          status: statusFilter,
          plan: planFilter,
          state: stateFilter,
          page,
          limit: PAGE_SIZE,
        });

        if (!ignore) {
          setRows(result.data);
          setTotalCount(result.count);
        }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load users.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadUsers();
    return () => {
      ignore = true;
    };
  }, [debouncedSearch, roleFilter, statusFilter, planFilter, stateFilter, page]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const stats = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    return {
      totalUsers: totalCount,
      activeToday: rows.filter((item) => new Date(item.last_active_at || 0) >= todayStart).length,
      newThisWeek: rows.filter((item) => new Date(item.created_at || 0).getTime() >= weekAgo).length,
      farmers: rows.filter((item) => item.role === 'farmer').length,
      agronomists: rows.filter((item) => item.role === 'agronomist').length,
    };
  }, [rows, totalCount]);

  async function handleToggleActive(user) {
    const updated = await updateUser(user.id, { is_active: !user.is_active });
    setRows((prev) => prev.map((item) => (item.id === user.id ? { ...item, ...(updated || {}) } : item)));
  }

  async function handleQuickNote(user) {
    const note = window.prompt(`Add note for ${user.full_name || user.email}`);
    if (!note || !note.trim()) return;
    await addAdminNote(user.id, note.trim(), adminId);
  }

  async function handleExportCSV() {
    const exportResult = await fetchUsers({
      search: debouncedSearch,
      role: roleFilter,
      status: statusFilter,
      plan: planFilter,
      state: stateFilter,
      page: 1,
      limit: 5000,
    });
    const csv = toCSV(exportResult.data);
    triggerDownload('aglen-users-export.csv', csv);
  }

  return (
    <section className="admin-users-page">
      <header className="admin-users-top">
        <div className="admin-stats-row">
          <article><p>Total users</p><strong>{stats.totalUsers}</strong></article>
          <article><p>Active today</p><strong>{stats.activeToday}</strong></article>
          <article><p>New this week</p><strong>{stats.newThisWeek}</strong></article>
          <article><p>Farmers</p><strong>{stats.farmers}</strong></article>
          <article><p>Agronomists</p><strong>{stats.agronomists}</strong></article>
        </div>

        <div className="admin-users-controls">
          <input
            type="search"
            value={searchInput}
            placeholder="Search by name or email"
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">Role: all</option>
            <option value="farmer">farmer</option>
            <option value="agronomist">agronomist</option>
            <option value="admin">admin</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Status: all</option>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
          <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
            <option value="all">Plan: all</option>
            <option value="free">free</option>
            <option value="pro">pro</option>
          </select>
          <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
            <option value="all">State: all</option>
            {STATE_OPTIONS.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
          <button type="button" className="admin-btn" onClick={handleExportCSV}>Export CSV</button>
        </div>
      </header>

      {error && <p className="page-error">{error}</p>}

      <div className="admin-users-table-wrap">
        <table className="admin-users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>State</th>
              <th>Total scans</th>
              <th>Last active</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id}>
                <td>{user.full_name || 'N/A'}</td>
                <td>{user.email}</td>
                <td><span className={`admin-role-badge ${roleBadgeClass(user.role)}`}>{user.role}</span></td>
                <td>{user.location_state || 'N/A'}</td>
                <td>{user.scan_count || 0}</td>
                <td>{formatDate(user.last_active_at)}</td>
                <td>{user.plan}</td>
                <td><span className={`admin-status-badge ${user.is_active ? 'is-active' : 'is-inactive'}`}>{statusText(user.is_active)}</span></td>
                <td>
                  <div className="admin-actions-row">
                    <button type="button" onClick={() => setSelectedUser(user)}>View profile</button>
                    <button type="button" onClick={() => handleToggleActive(user)}>
                      {user.is_active ? 'Set inactive' : 'Set active'}
                    </button>
                    <button type="button" onClick={() => handleQuickNote(user)}>Add note</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9}>No users found.</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="admin-users-cards">
          {rows.map((user) => (
            <article key={user.id} className="admin-user-card">
              <header>
                <h3>{user.full_name || 'N/A'}</h3>
                <span className={`admin-role-badge ${roleBadgeClass(user.role)}`}>{user.role}</span>
              </header>
              <p>{user.email}</p>
              <p>State: {user.location_state || 'N/A'}</p>
              <p>Total scans: {user.scan_count || 0}</p>
              <p>Last active: {formatDate(user.last_active_at)}</p>
              <p>Plan: {user.plan}</p>
              <p>Status: {statusText(user.is_active)}</p>
              <div className="admin-actions-row">
                <button type="button" onClick={() => setSelectedUser(user)}>View profile</button>
                <button type="button" onClick={() => handleToggleActive(user)}>
                  {user.is_active ? 'Set inactive' : 'Set active'}
                </button>
                <button type="button" onClick={() => handleQuickNote(user)}>Add note</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <footer className="admin-users-pagination">
        <button type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>
          Prev
        </button>
        <span>Page {page} of {totalPages}</span>
        <button type="button" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages}>
          Next
        </button>
      </footer>

      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          adminId={adminId}
          onOpenUserScans={onOpenUserScans}
          onClose={() => setSelectedUser(null)}
          onUserUpdated={(updatedUser) => {
            setRows((prev) => prev.map((item) => (item.id === updatedUser.id ? { ...item, ...updatedUser } : item)));
            setSelectedUser((prev) => (prev && prev.id === updatedUser.id ? { ...prev, ...updatedUser } : prev));
          }}
        />
      )}
    </section>
  );
}
