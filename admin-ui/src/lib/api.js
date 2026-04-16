const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function parseOrThrow(res) {
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.detail || `Request failed with ${res.status}`);
  }
  return res.json();
}

export async function listModels(token) {
  const res = await fetch(`${API_BASE}/admin/models`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return parseOrThrow(res);
}

export async function activateModel(token, modelId) {
  const res = await fetch(`${API_BASE}/admin/models/activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ model_id: modelId }),
  });
  return parseOrThrow(res);
}

export async function uploadModel(token, modelFile, classNamesFile, label) {
  const form = new FormData();
  form.append('model_file', modelFile);
  if (classNamesFile) form.append('class_names_file', classNamesFile);
  if (label) form.append('label', label);

  const res = await fetch(`${API_BASE}/admin/models/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
  return parseOrThrow(res);
}
