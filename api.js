// api.js: talks to the Apps Script backend.

const CFG_KEY = 'homebase.cfg';

export function getCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}
export function setCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }
export function isConfigured() { const c = getCfg(); return !!(c.url && c.token); }

// Actions that only read. Everything else changes data and carries a req_id, so a repeat of the same request
// (after a dropped connection or a timeout) is answered from the backend's memory instead of being done twice.
const READS = new Set(['ping', 'boot', 'today', 'tasks.list', 'tasks.history', 'journal.list', 'records.search', 'meals.list',
  'meals.analyze', 'meals.recommend', 'photos.get', 'taste.deck', 'taste.setup', 'recipe.get', 'grocery.plan', 'grocery.get',
  'chat.history', 'voice.speak', 'voice.status', 'suggestions.list', 'settings.get', 'calendars.list', 'usage',
  'telegram.status', 'users.list']);
export const isWrite = action => !READS.has(action);

// A write that failed on the phone's side keeps its req_id for 10 minutes: trying the same thing again reuses it.
const failed = new Map();   // key → {id, at}
const KEEP_MS = 10 * 60 * 1000;
function newId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* older browser */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function keyOf(action, data) {
  const s = action + '|' + JSON.stringify(data);
  let h = 0x811c9dc5;                                   // FNV-1a: a short key even for photos
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return action + ':' + s.length + ':' + (h >>> 0).toString(36);
}
function reqIdFor(key) {
  const now = Date.now();
  failed.forEach((v, k) => { if (now - v.at > KEEP_MS) failed.delete(k); });
  const hit = failed.get(key);
  return hit ? hit.id : newId();
}

class NetError extends Error {}
async function once(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      // text/plain keeps this a "simple" request, so Apps Script doesn't need CORS preflight
      res = await fetch(url, { method: 'POST', redirect: 'follow', signal: ctrl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
    } catch (e) {
      throw new NetError(e && e.name === 'AbortError' ? 'The backend took too long to answer.'
        : 'Could not reach the backend. Check your connection, or try again in a minute.');
    }
    let out;
    try { out = await res.json(); }
    catch (e) {
      if (e && e.name === 'AbortError') throw new NetError('The backend took too long to answer.');
      if (res.ok === false || res.status >= 400) throw new NetError(`The backend had a problem (${res.status}). It may be busy or over a Google limit; try again in a minute.`);
      throw new Error('Unexpected reply from backend. Is the web app URL right?');
    }
    return out;
  } finally { clearTimeout(timer); }
}

/**
 * Calls the backend. opts.timeoutMs (default 90 s); opts.cfg = {url, token} to try other connection details.
 * A request that never got an answer is tried once more (with the same req_id).
 */
export async function api(action, data = {}, { timeoutMs = 90000, cfg = null } = {}) {
  const { url, token } = cfg || getCfg();
  if (!url || !token) throw new Error('Connect the app to your backend in Settings.');
  const write = isWrite(action);
  const key = write ? keyOf(action, data) : '';
  const req_id = write ? reqIdFor(key) : '';
  const body = JSON.stringify(write ? { token, action, data, req_id } : { token, action, data });
  let out;
  try {
    try { out = await once(url, body, timeoutMs); }
    catch (e) {
      if (!(e instanceof NetError)) throw e;
      // one more try after a dropped connection (Android can cut requests when the app goes to the background)
      if (/took too long/.test(e.message)) throw e;
      await new Promise(r => setTimeout(r, write ? 1500 : 600));
      out = await once(url, body, timeoutMs);
    }
  } catch (e) {
    if (write && e instanceof NetError) failed.set(key, { id: req_id, at: Date.now() });
    throw new Error(e.message);
  }
  if (write) failed.delete(key);
  if (!out || !out.ok) throw new Error((out && out.error) || 'Something went wrong.');
  return out.data;
}
