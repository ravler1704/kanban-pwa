/** Public board templates (column sets) on the server. */

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sendJson(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error === 'sign in required' ? 'Войдите, чтобы публиковать шаблоны' : `HTTP ${res.status}`);
  return data;
}

export function listTemplates({ q, mine } = {}) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set('q', q.trim());
  if (mine) params.set('mine', '1');
  return getJson(`/api/templates?${params}`);
}

export function getTemplate(id) {
  return getJson(`/api/templates/${encodeURIComponent(id)}`);
}

export function publishTemplate(body) {
  return sendJson('/api/templates', 'POST', body);
}

export function deleteTemplate(id) {
  return sendJson(`/api/templates/${encodeURIComponent(id)}`, 'DELETE');
}

export function noteTemplateUse(id) {
  return sendJson(`/api/templates/${encodeURIComponent(id)}/use`, 'POST', {});
}
