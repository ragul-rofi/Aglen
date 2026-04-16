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

/**
 * GET /health — quick liveness check.
 */
export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('API is unreachable');
  return res.json();
}
