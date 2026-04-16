const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const STATE_OPTIONS = [
  'Andhra Pradesh',
  'Karnataka',
  'Kerala',
  'Maharashtra',
  'Tamil Nadu',
  'Telangana',
  'Uttar Pradesh',
  'West Bengal',
];

function ensureSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required for admin views.');
  }
}

function headers(preferCount = false) {
  const base = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
  if (preferCount) {
    base.Prefer = 'count=exact';
  }
  return base;
}

function parseContentRangeCount(res) {
  const contentRange = res.headers.get('content-range');
  if (!contentRange || !contentRange.includes('/')) return null;
  const total = contentRange.split('/').pop();
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : null;
}

function userSelectQuery() {
  return [
    'id',
    'email',
    'full_name',
    'role',
    'location_state',
    'location_district',
    'crop_types',
    'farm_size_acres',
    'phone',
    'plan',
    'is_active',
    'created_at',
    'last_active_at',
    'scans(count)',
  ].join(',');
}

function normalizeUsers(rows) {
  return (rows || []).map((item) => ({
    ...item,
    scan_count: Array.isArray(item.scans) ? Number(item.scans[0]?.count || 0) : 0,
  }));
}

export async function fetchUsers({
  search = '',
  role = 'all',
  status = 'all',
  plan = 'all',
  state = 'all',
  page = 1,
  limit = 25,
} = {}) {
  ensureSupabaseConfig();

  const offset = (Math.max(page, 1) - 1) * Math.max(limit, 1);
  const rangeEnd = offset + limit - 1;

  const params = new URLSearchParams({
    select: userSelectQuery(),
    order: 'created_at.desc',
    offset: String(offset),
    limit: String(limit),
  });

  if (search.trim()) {
    const term = `*${search.trim()}*`;
    params.set('or', `full_name.ilike.${term},email.ilike.${term}`);
  }
  if (role !== 'all') params.set('role', `eq.${role}`);
  if (plan !== 'all') params.set('plan', `eq.${plan}`);
  if (status !== 'all') params.set('is_active', `eq.${status === 'active'}`);
  if (state !== 'all') params.set('location_state', `eq.${state}`);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?${params.toString()}`, {
    headers: headers(true),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch users (${res.status})`);
  }

  const data = await res.json();
  const count = parseContentRangeCount(res);

  return {
    data: normalizeUsers(data),
    count: count ?? normalizeUsers(data).length,
    page,
    limit,
  };
}

export async function updateUser(userId, fields) {
  ensureSupabaseConfig();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=*`, {
    method: 'PATCH',
    headers: {
      ...headers(),
      Prefer: 'return=representation',
    },
    body: JSON.stringify(fields),
  });

  if (!res.ok) {
    throw new Error(`Failed to update user (${res.status})`);
  }

  const rows = await res.json();
  return rows[0] || null;
}

export async function addAdminNote(targetUserId, note, adminId) {
  ensureSupabaseConfig();

  const payload = {
    target_user_id: targetUserId,
    note,
    created_by: adminId,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_notes?select=*`, {
    method: 'POST',
    headers: {
      ...headers(),
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Failed to create admin note (${res.status})`);
  }

  const rows = await res.json();
  return rows[0] || null;
}

export async function fetchUserScans(userId, limit = 10, offset = 0) {
  ensureSupabaseConfig();

  const params = new URLSearchParams({
    select: 'id,predicted_class,confidence,feedback,created_at',
    user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: String(limit),
    offset: String(offset),
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/scans?${params.toString()}`, {
    headers: headers(),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch user scans (${res.status})`);
  }

  return res.json();
}

export async function fetchUserNotes(userId, limit = 30) {
  ensureSupabaseConfig();

  const params = new URLSearchParams({
    select: 'id,note,created_at,created_by',
    target_user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: String(limit),
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_notes?${params.toString()}`, {
    headers: headers(),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch admin notes (${res.status})`);
  }

  return res.json();
}

export { STATE_OPTIONS };
