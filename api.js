// api.js: talks to the Apps Script backend.

const CFG_KEY = 'homebase.cfg';

export function getCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}
export function setCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }
export function isConfigured() { const c = getCfg(); return !!(c.url && c.token); }

export async function api(action, data = {}, { timeoutMs = 90000 } = {}) {
  const { url, token } = getCfg();
  if (!url || !token) throw new Error('Connect the app to your backend in Settings.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    // text/plain keeps this a "simple" request, so Apps Script doesn't need CORS preflight
    res = await fetch(url, {
      method: 'POST', redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, action, data })
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The backend took too long to answer.' : 'Could not reach the backend. Check your connection.');
  } finally { clearTimeout(timer); }
  let body;
  try { body = await res.json(); } catch { throw new Error('Unexpected reply from backend. Is the web app URL right?'); }
  if (!body.ok) throw new Error(body.error || 'Something went wrong.');
  return body.data;
}
