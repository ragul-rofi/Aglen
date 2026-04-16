const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload.detail === 'string') return payload.detail;
  if (Array.isArray(payload.detail) && payload.detail.length > 0) {
    const first = payload.detail[0];
    if (typeof first?.msg === 'string') return first.msg;
  }
  return fallback;
}

/**
 * POST /explain — sends a leaf image and receives prediction + Grad-CAM overlay.
 *
 * @param {File} file - The image file to analyse.
 * @returns {Promise<Object>} Parsed ExplainResponse.
 */
export async function explainImage(file) {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${API_BASE}/explain`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(extractErrorMessage(err, `Server error: ${res.status}`));
  }

  return res.json();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.split(',').pop() || '');
    };
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
}

export async function explainScan(file, userId) {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${API_BASE}/explain`, {
    method: 'POST',
    headers: userId ? { 'X-User-Id': userId } : undefined,
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(extractErrorMessage(err, `Server error: ${res.status}`));
  }

  return res.json();
}

export async function explainScanBase64(imageBase64) {
  const res = await fetch(`${API_BASE}/explain/base64`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(extractErrorMessage(err, `Server error: ${res.status}`));
  }

  return res.json();
}

export async function getScans(userId, limit = 20, offset = 0) {
  const params = new URLSearchParams({
    user_id: userId,
    limit: String(limit),
    offset: String(offset),
  });

  const res = await fetch(`${API_BASE}/scans?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(extractErrorMessage(err, `Server error: ${res.status}`));
  }
  return res.json();
}

export async function patchScanFeedback(scanId, userId, feedback, correctedClass) {
  const res = await fetch(`${API_BASE}/scans/${scanId}/feedback`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    },
    body: JSON.stringify({
      feedback,
      corrected_class: correctedClass ?? null,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(extractErrorMessage(err, `Server error: ${res.status}`));
  }
  return res.json();
}

export async function fetchDiseaseAlerts(state) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && anonKey) {
    const params = new URLSearchParams({
      select: 'id,disease_class,severity,affected_state,is_active,last_updated_at',
      affected_state: `eq.${state}`,
      is_active: 'eq.true',
      order: 'last_updated_at.desc',
      limit: '20',
    });

    const res = await fetch(`${supabaseUrl}/rest/v1/disease_alerts?${params.toString()}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });

    if (!res.ok) return [];
    return res.json();
  }

  const params = new URLSearchParams({ state });
  const res = await fetch(`${API_BASE}/alerts?${params.toString()}`);
  if (!res.ok) return [];
  return res.json();
}

/**
 * GET /health — quick liveness check.
 */
export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('API is unreachable');
  return res.json();
}
