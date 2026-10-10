// app.js: Homebase PWA (no build step; plain ES modules).
import { api, getCfg, setCfg, isConfigured } from './api.js';

// ---------------- helpers ----------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// line icons (same style as the Bella 🎙 button at the top)
const ICON_MIC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
const ICON_CLIP = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false; t.textContent = msg;   // shown first, so screen readers read it
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2600);
}
const fail = e => {
  console.error(e);
  const m = e.message || String(e);
  // the app on GitHub is newer than the Apps Script web app
  toast(/^Unknown action/.test(m) ? 'The backend is older than the app. In Apps Script, paste the latest backend files, then Deploy → Manage deployments → edit → New version.' : m, true);
};

// Dialogs. Each openModal() gets a new number: slow work checks it is still showing its own dialog (dialogAlive).
let modalSeq = 0, modalReturn = null;
function openModal(html) {
  const wasOpen = !$('#modal').hidden;
  if (!wasOpen) modalReturn = document.activeElement;
  modalSeq++;
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  if (!wasOpen) pushLayer('hbModal');
  // screen readers: name the dialog after its heading and start reading there
  const h = $('#modalBody h3'), sheet = $('#modal .sheet');
  if (h) { h.id = h.id || 'modalTitle'; h.tabIndex = -1; sheet.setAttribute('aria-labelledby', h.id); try { h.focus({ preventScroll: true }); } catch { /* fine */ } }
  else sheet.removeAttribute('aria-labelledby');
  return $('#modalBody');
}
// A check that the dialog opened just now is still the one on screen.
function dialogAlive() { const n = modalSeq; return () => n === modalSeq && !$('#modal').hidden; }
function closeModal(fromBack = false) {
  const wasOpen = !$('#modal').hidden;
  modalSeq++;
  $('#modal').hidden = true;
  $('#modalBody').innerHTML = '';
  document.body.style.overflow = '';
  if (!wasOpen) return;
  if (!fromBack) popLayer('hbModal');
  const r = modalReturn; modalReturn = null;
  if (r && r.isConnected && !/^(INPUT|TEXTAREA|SELECT)$/.test(r.tagName)) { try { r.focus({ preventScroll: true }); } catch { /* fine */ } }
  if (pendingRepaint) setTimeout(repaintIfIdle, 0);
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('#modalClose')) closeModal(); });

// The Android back button closes the open sheet (talk mode, a recipe, a dialog) instead of changing the tab.
let selfBack = false;
function pushLayer(k) {
  try { const st = window.history.state || {}; if (!st[k]) window.history.pushState({ ...st, [k]: 1 }, ''); } catch { /* fine */ }
}
function layerOpen(k) { return k === 'hbModal' ? !$('#modal').hidden : k === 'hbRecipe' ? !!$('#recipeSheet') : k === 'hbTalk' ? talk.on : false; }
function popLayer(k) {
  // later, so a tab change right after closing isn't undone; only if that entry is still the current one
  setTimeout(() => {
    try { if (window.history.state?.[k] && !layerOpen(k)) { selfBack = true; window.history.back(); setTimeout(() => { selfBack = false; }, 600); } } catch { /* fine */ }
  }, 0);
}
window.addEventListener('popstate', () => {
  if (selfBack) { selfBack = false; return; }
  if (talk.on) { closeTalk(true); return; }
  const rs = $('#recipeSheet');
  if (rs) { rs.remove(); return; }
  if (!$('#modal').hidden) closeModal(true);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (talk.on) return closeTalk();
  const rs = $('#recipeSheet');
  if (rs) { rs.remove(); popLayer('hbRecipe'); return; }
  if (!$('#modal').hidden) closeModal();
});

// Toggle buttons (segments, chips, months) show their state to screen readers too.
const TOGGLE_PARENT = '.seg, .fchips, .months, .where-grid';
function syncPressed(b) { if (b.tagName === 'BUTTON' && b.parentElement?.matches?.(TOGGLE_PARENT)) b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false'); }
try {
  new MutationObserver(list => list.forEach(m => {
    if (m.type === 'attributes') syncPressed(m.target);
    else m.addedNodes.forEach(n => { if (n.nodeType === 1) { syncPressed(n); n.querySelectorAll?.('button').forEach(syncPressed); } });
  })).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
} catch { /* old browser */ }

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayDiff(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }
function rel(dateStr) {
  if (!dateStr) return '';
  const d = dayDiff(todayStr(), dateStr.slice(0, 10));
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d > 1 && d < 7) return new Date(dateStr.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' });
  if (d < 0) return `${-d} days ago`;
  return `in ${d} days`;
}
function niceDate(dateStr) {
  return new Date(dateStr.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function hour12(h) { return h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'; }
function time12(hhmm) {
  if (!hhmm) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
}

// light markdown: escape, **bold**, bullet lines, [links](https://…) (web search sources)
function md(s) {
  return esc(s).replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^\s*[-*] /gm, '• ');
}

// ---------------- state ----------------
// Reads a saved value; anything missing or unreadable counts as "nothing saved".
function loadSaved(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v === 'object') return v;
    localStorage.removeItem(key);
    return null;
  } catch { localStorage.removeItem(key); return null; }
}
// Instant tabs: everything the app shows is kept on the phone and painted straight away;
// one background request ("boot") refreshes all tabs at once when the saved copy is older than FRESH_MS.
const CACHE_KEY = 'homebase.cache.v2';
const FRESH_MS = 60 * 1000;
const cached = loadSaved(CACHE_KEY) || {};
const state = {
  today: cached.today || loadSaved('homebase.today'),
  tasks: cached.tasks || null, meals: cached.meals || null, taste: cached.taste || null, grocery: cached.grocery || null,
  chat: cached.chat || null, settings: null, fetchedAt: {},
  updatedAt: Number(cached.updatedAt) || 0, refreshErr: '',
  me: cached.me || null          // {id, name, role: 'owner'|'member', person_id}
};
const isMember = () => state.me?.role === 'member';

// Invite link from the owner: …#join=<base64 {u: backend url, c: invite code, n: name}>. Signs this phone in.
// Reads an invite link (or just the part after "#join="). Returns {u, c, n} or null.
const BACKEND_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/?#]+\/s|macros\/s)\/[\w-]+\/(?:exec|dev)(?:[?#]|$)/;
function parseInvite(text) {
  const m = /#?join=([\w-]+)/.exec(String(text || '').trim());
  if (!m) return null;
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
    return j && j.u && j.c && BACKEND_URL_RE.test(String(j.u)) ? j : null;   // only a real Apps Script web app
  } catch { return null; }
}
function handleJoin() {
  if (!/^#join=/.test(location.hash || '')) return;
  try {
    const j = parseInvite(location.hash);
    const cur = getCfg();
    if (j && !(cur.url === j.u && cur.token === j.c)
      && (!isConfigured() || confirm(`Sign in as ${j.n || 'this person'}? This replaces the current connection on this phone.`))) {
      setCfg({ url: j.u, token: j.c });
      forgetLocalData();
      sessionStorage.setItem('homebase.welcome', j.n || 'there');
    }
  } catch { /* bad link: fall through to Settings */ }
  try { window.history.replaceState(null, '', location.pathname + '#today'); } catch { location.hash = '#today'; }
}
// Clears everything saved on this phone for the previous person (used when signing in as someone else).
function forgetLocalData() {
  try {
    ['homebase.today', 'homebase.person', 'homebase.guess', 'homebase.lastTiming', 'homebase.phoneTiming', 'homebase.backendVersion', TASTE_KEY].forEach(k => localStorage.removeItem(k));
    Object.keys(localStorage).filter(k => k.startsWith('homebase.lastUse.')).forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
  clearTimeout(saveTimer);
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  state.today = state.tasks = state.meals = state.chat = state.me = state.grocery = state.taste = state.settings = null;
  state.familyCount = 0; state.updatedAt = 0; state.refreshErr = '';
  state.fetchedAt = {}; state.chatFresh = false;
  speaker = null; tasteQueue.length = 0; voiceStatusP = null;
  forgetKept();     // kept phrases say the person's name
  forgetPhotos();
}
let saveTimer = null;
// Saved after a change (not on every paint). If the phone's storage is full, the bulky parts are trimmed instead.
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeCache, 250);
}
function writeCache() {
  const all = { me: state.me, today: state.today, tasks: state.tasks, meals: (state.meals || []).slice(0, 150), taste: state.taste,
    grocery: state.grocery, chat: (state.chat || []).filter(m => !m.typing).slice(-30), updatedAt: state.updatedAt };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); return; } catch { /* full: trim below */ }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...all, meals: all.meals.slice(0, 40),
      chat: all.chat.slice(-10).map(m => ({ role: m.role, content: m.content, kind: m.kind })) }));
  } catch { /* keep the last copy that fit */ }
}
const isStale = (key, ms = FRESH_MS) => !state[key] || !state.fetchedAt[key] || Date.now() - state.fetchedAt[key] > ms;
// Something changed on the server. The screen already shows the change (patched on the phone); the full refresh
// waits a little (several quick changes → one refresh), and any refresh that started before the change is ignored.
let dataVer = 0, refreshTimer = null;
function invalidate(ms = 12000) { dataVer++; refreshSoon(ms); }
function refreshSoon(ms) { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { refreshTimer = null; refreshAll(); }, ms); }
// The task as of today on this phone (the server's days_until is from when it was fetched).
function dueNow(t) {
  if (!t || !t.next_due) return t;
  const d = dayDiff(todayStr(), String(t.next_due).slice(0, 10));
  if (!isFinite(d)) return t;
  return { ...t, days_until: d, state: d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 2 ? 'soon' : 'later' };
}
// Applies a task change right away, so lists don't wait for the refresh.
function patchTask(t, removed) {
  if (!t) return;
  if (state.tasks) state.tasks = removed ? state.tasks.filter(x => x.id !== t.id)
    : state.tasks.some(x => x.id === t.id) ? state.tasks.map(x => (x.id === t.id ? t : x)) : [...state.tasks, t];
  if (state.today?.tasks_due) {
    const now = dueNow(t);
    const due = !removed && t.active !== false && now.days_until !== null && now.days_until !== undefined && now.days_until <= 2;
    const list = state.today.tasks_due.filter(x => x.id !== t.id);
    if (due) {
      const i = state.today.tasks_due.findIndex(x => x.id === t.id);
      if (i >= 0) list.splice(i, 0, t); else { list.push(t); list.sort((a, b) => (dueNow(a).days_until ?? 99) - (dueNow(b).days_until ?? 99)); }
    }
    state.today.tasks_due = list;
  }
  invalidate(); saveCache();
}

let bootP = null, bootAgain = false;
async function fetchAll() {
  try { return await api('boot'); }
  catch (e) {
    if (!/Unknown action/.test(e.message)) throw e;
    // older backend without "boot": ask tab by tab
    const [today, tasks, meals] = await Promise.all([api('today'), api('tasks.list'), api('meals.list', { days: 60 }).catch(() => null)]);
    return { today, tasks, meals };
  }
}
function refreshAll() {
  if (!isConfigured()) return Promise.resolve();
  if (talk.on) { talk.refreshAfter = true; return Promise.resolve(); }   // talk mode: nothing competes with the conversation
  clearTimeout(refreshTimer); refreshTimer = null;
  if (bootP) { if (bootVer !== dataVer) bootAgain = true; return bootP; }
  const v0 = bootVer = dataVer;
  bootP = fetchAll().then(b => {
    if (!b || typeof b !== 'object' || !b.today) throw new Error('The backend sent an empty answer. Deploy a New version of the web app and try again.');
    if (b.me) {
      state.me = b.me;
      const hi = sessionStorage.getItem('homebase.welcome');
      if (hi) { sessionStorage.removeItem('homebase.welcome'); toast(`Welcome, ${b.me.name}! You're signed in.`); }
    }
    if (b.family !== undefined && b.family !== null) state.familyCount = b.family;
    if (b.assistant) lsSet('homebase.assistant', b.assistant);
    if (b.voice_ready !== undefined) lsSet('homebase.voiceReady', b.voice_ready ? '1' : '0');
    noteBackend(b.backend_version || '');
    // something was changed on this phone while this was on its way: this copy is older, ask again
    if (v0 !== dataVer && state.today) { bootAgain = true; return; }
    state.today = b.today;
    if (b.tasks) state.tasks = b.tasks;
    if (b.meals) state.meals = b.meals;
    if (b.taste) state.taste = b.taste;
    if (b.grocery) state.grocery = b.grocery;
    const now = Date.now();
    ['today', 'tasks', 'meals'].forEach(k => { state.fetchedAt[k] = now; });
    state.updatedAt = now; state.refreshErr = '';
    saveCache();
    repaintIfIdle();
    prunePhotos();
  }).catch(e => {
    bootP = null;                     // done: the screen can offer Retry
    state.refreshErr = e.message || String(e);
    if (!state.today || /^Unauthorized/.test(state.refreshErr)) fail(e); else console.warn('refresh failed', e);
    repaintIfIdle();
  }).finally(() => { bootP = null; if (bootAgain) { bootAgain = false; refreshSoon(300); } });
  return bootP;
}
let bootVer = -1;
function currentTab() { return (location.hash || '#today').slice(1).split('?')[0] || 'today'; }
// Repaints the open tab with fresh data, unless you're in the middle of something (a dialog, typing).
// A skipped repaint happens as soon as the dialog closes or the box loses focus.
let pendingRepaint = false;
function repaintIfIdle() {
  const tab = currentTab();
  const ae = document.activeElement;
  const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && view.contains(ae)
    && !(tab === 'today' && quickEl && quickEl.contains(ae));   // Today keeps the Home box as it is while repainting
  if (!$('#modal').hidden || typing) { pendingRepaint = true; return; }
  pendingRepaint = false;
  if (tab === 'today') safely(paintToday, ['today']);
  else if (tab === 'tasks') state.tasks ? safely(paintTasks, ['tasks']) : paintNoData();
  else if (tab === 'food') state.meals ? safely(paintFood, ['meals']) : paintNoData();
}
view.addEventListener('focusout', () => { if (pendingRepaint) setTimeout(() => { if (pendingRepaint) repaintIfIdle(); }, 0); });
// A paint that fails on a saved copy (an older or odd shape) drops that copy instead of leaving a blank screen.
function safely(paint, keys) {
  try { paint(); }
  catch (e) {
    console.error('paint failed', e);
    keys.forEach(k => { state[k] = null; });
    writeCache();
    try { paint(); } catch (e2) { console.error(e2); }
  }
}
// Tasks or Food without any saved copy: a placeholder while loading, or what went wrong with a Retry button.
function paintNoData() {
  const err = !bootP && state.refreshErr;
  view.innerHTML = err
    ? `<div class="card"><div class="muted small">Couldn't load this. ${esc(state.refreshErr)}</div><button type="button" class="btn small" id="noDataRetry" style="margin-top:10px">Retry</button></div>`
    : '<div class="card"><div class="skeleton" style="height:160px"></div></div><div class="card"><div class="skeleton" style="height:220px"></div></div>';
  $('#noDataRetry')?.addEventListener('click', () => { state.refreshErr = ''; refreshAll(); paintNoData(); });
}
// "Updated 5 min ago" under the date on Today.
function agoText(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ago`;
  return 'on ' + niceDate(todayStr(new Date(ms)));
}
function updLineHtml() {
  if (state.refreshErr && !bootP) return ` · Couldn't refresh · <button type="button" class="linkish upd-retry" id="updRetry">Retry</button>`;
  return state.updatedAt ? ` · Updated ${agoText(state.updatedAt)}` : '';
}
function bindUpdLine() {
  $('#updRetry')?.addEventListener('click', () => { state.refreshErr = ''; const el = $('#updLine'); if (el) el.textContent = ' · Updating…'; refreshAll(); });
}
setInterval(() => { const el = $('#updLine'); if (el && !state.refreshErr && state.updatedAt) el.textContent = updLineHtml(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && isStale('today', 2 * FRESH_MS)) refreshAll(); });


// ---------------- router ----------------
const VIEWS = { today: renderToday, chat: renderChat, food: renderFood, tasks: renderTasks, settings: renderSettings };
const TITLES = { today: 'Homebase', chat: 'Chat', food: 'Food', tasks: 'Tasks', settings: 'Settings' };

function route() {
  let name = (location.hash || '#today').slice(1).split('?')[0];
  if (!VIEWS[name]) name = 'today';
  if (!isConfigured() && name !== 'settings') { location.hash = '#settings'; return; }
  $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
  $('#title').textContent = TITLES[name];
  $('.fab')?.remove();
  $('.composer')?.remove();
  if (activeRec) { try { activeRec.abort(); } catch { /* fine */ } }   // dictation belongs to the tab you left
  $('#recipeSheet')?.remove();
  if (!$('#modal').hidden) closeModal();
  window.scrollTo(0, 0);
  VIEWS[name]();
}
window.addEventListener('hashchange', route);
$('#settingsBtn').addEventListener('click', () => (location.hash = '#settings'));

// ================= TODAY =================
async function renderToday() {
  if (isStale('today')) refreshAll();
  safely(paintToday, ['today']);
}

function paintToday() {
  const t = state.today;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const hello = `<div class="hello">${greet}<small>${dateLine}<span id="updLine">${t ? updLineHtml() : ''}</span></small></div>`;
  if (!t) {
    view.innerHTML = `${hello}
      <div class="card"><div class="skeleton" style="height:90px"></div></div>
      <div class="card"><div class="skeleton" style="height:240px"></div></div>`;
    return;
  }
  const wx = t.weather || {};
  const due = (t.tasks_due || []).map(dueNow);
  const rest = `
    ${weatherCard(wx, t)}
    ${t.suggestions?.length ? suggestionsCard(t.suggestions) : ''}
    <div class="card">
      <h2>Due soon</h2>
      ${due.length ? due.map(taskRow).join('') : '<div class="muted small">Nothing due in the next two days. 🎉</div>'}
    </div>
    <div class="card">
      <h2>Next 7 days</h2>
      ${eventsList(t.events || [])}
    </div>`;
  // The Home box stays in place (typed text, focus, attachment, result); only what's around it is redrawn.
  if (quickEl && view.contains(quickEl) && $('#todayRest')) {
    view.querySelector('.hello').outerHTML = hello;
    $('#todayRest').innerHTML = rest;
  } else {
    view.innerHTML = `${hello}<div id="quickSlot"></div><div id="todayRest">${rest}</div>`;
    $('#quickSlot').replaceWith(quickBox());
  }
  bindUpdLine();
  bindTaskRows($('#todayRest'), () => { if (currentTab() === 'today') repaintIfIdle(); });
  bindSuggestions();
  paintSpeaker();
}

// What to bring: after 6pm it shows tomorrow's.
const CARRY_ICON = { coat: '🧥', jacket: '🧥', umbrella: '☂️', boots: '🥾', sun: '🕶️', water: '💧', allergy: '🤧' };
function carryHtml(t) {
  const evening = new Date().getHours() >= 18 && t.tomorrow_carry;
  const c = evening ? t.tomorrow_carry : t.carry;
  if (!c) return '';
  const note = evening ? t.tomorrow_note : t.day_note;
  return `<div class="carry">${note && note !== c.line ? `<div class="carry-note">${esc(note)}</div>` : ''}<div class="muted small">${evening ? 'Tomorrow, bring' : 'Bring'}</div>
    ${c.items?.length ? `<div class="carry-items">${c.items.map(i => `<span class="carry-i"><span aria-hidden="true">${CARRY_ICON[i.key] || '•'}</span><b>${esc(i.text)}</b>${i.why ? `<span class="muted">${esc(i.why)}</span>` : ''}</span>`).join('')}</div>`
      : `<div class="small">${evening ? 'Nothing extra tomorrow.' : 'Nothing extra today.'}</div>`}</div>`;
}
function weatherCard(wx, t = {}) {
  if (wx.error) {
    return `<div class="card"><h2>Weather</h2><div class="muted small">${esc(wx.error)} <a href="#settings">Settings</a></div></div>`;
  }
  const hrs = [wx.morning, wx.noon, wx.evening, wx.night].filter(Boolean);
  return `<div class="card">
    <div class="wx">
      <div class="wx-temp">${wx.high ?? '–'}°<small> / ${wx.low ?? '–'}°</small></div>
      <div class="grow"><div style="font-weight:650;text-transform:capitalize">${esc(wx.condition || '')}</div>
        <div class="muted small">${wx.rain_chance >= 20 ? `${wx.rain_chance}% chance of rain · ` : ''}wind to ${wx.wind_max ?? '–'}</div></div>
    </div>
    ${hrs.length ? `<div class="wx-hours">${hrs.map(h => `<div><span class="muted">${hour12(h.hour)}</span><b>${h.temp}°</b><span class="muted">${h.rain >= 30 ? h.rain + '%☂' : 'feels ' + h.feels + '°'}</span></div>`).join('')}</div>` : ''}
    ${carryHtml(t)}
  </div>`;
}

function suggestionsCard(list) {
  return `<div class="card" id="sugCard"><h2>From your email</h2>${list.map(s => `
    <div class="sug" data-id="${esc(s.id)}">
      <div style="font-weight:650">${esc(s.title)}</div>
      <div class="muted small">${s.date ? esc(niceDate(s.date)) + (s.time ? ' · ' + time12(s.time) : '') + ' · ' : ''}${esc(s.details || '')}
        ${s.link ? ` · <a href="${esc(s.link)}" target="_blank" rel="noopener">open email</a>` : ''}</div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn small primary" data-act="accept">${s.type === 'info' ? 'Got it' : 'Add to Tasks'}</button>
        <button class="btn small ghost" data-act="dismiss">Dismiss</button>
      </div>
    </div>`).join('')}</div>`;
}
function bindSuggestions() {
  $$('#sugCard .sug').forEach(el => {
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      const other = [...el.querySelectorAll('button')].filter(x => x !== b);
      other.forEach(x => { x.disabled = true; });          // one answer at a time for each suggestion
      busy(b, async () => {
        const res = await api(b.dataset.act === 'accept' ? 'suggestions.accept' : 'suggestions.dismiss', { id: el.dataset.id });
        el.remove();
        state.today.suggestions = state.today.suggestions.filter(s => s.id !== el.dataset.id);
        if (!state.today.suggestions.length) $('#sugCard')?.remove();
        toast(b.dataset.act === 'accept' ? (res?.already ? `Already on your list: ${res.name}.` : 'Added to Tasks. Open it there to set a reminder time.') : 'Dismissed.');
        saveCache();
        if (b.dataset.act === 'accept') invalidate();
      }).catch(fail).finally(() => other.forEach(x => { x.disabled = false; }));
    });
  });
}

function eventsList(events) {
  if (!events.length) return '<div class="muted small">No calendar events.</div>';
  let html = '', lastDay = '';
  events.forEach(e => {
    const day = String(e.start || '').slice(0, 10);
    if (!day) return;
    if (day !== lastDay) { html += `<div class="event-day">${esc(rel(day) === 'today' ? 'Today' : rel(day) === 'tomorrow' ? 'Tomorrow' : niceDate(day))}</div>`; lastDay = day; }
    html += `<div class="row small" style="padding:3px 0"><span class="muted" style="width:58px;flex:none">${e.all_day ? 'all day' : time12(e.start.slice(11, 16))}</span>
      <span class="grow">${esc(e.title)}${e.location ? ` <span class="muted">· ${esc(e.location)}</span>` : ''}${e.calendar ? ` <span class="cal-tag">${esc(e.calendar)}</span>` : ''}</span></div>`;
  });
  return html;
}

// ================= TASKS =================
function dueLabel(t) {
  if (t.state === 'none') return '';
  if (t.state === 'overdue') return `<span class="badge overdue">${-t.days_until}d overdue</span>`;
  if (t.state === 'today') return '<span class="badge today">today</span>';
  if (t.state === 'soon') return `<span class="badge soon">${esc(rel(t.next_due))}</span>`;
  return `<span class="badge later">${esc(rel(t.next_due))}</span>`;
}
function freqText(t) {
  if (t.yearly_md) return 'every year · ' + niceDate(t.next_due);
  if (!t.interval_days) return t.next_due ? 'one-time · due ' + niceDate(t.next_due) : 'one-time';
  const base = `every ${t.interval_days} day${t.interval_days > 1 ? 's' : ''}`;
  const mode = t.interval_mode === 'ai' ? ' · AI guess' : t.interval_mode === 'learned' ? ' · learned' : '';
  return base + mode + (t.last_done ? ` · last ${rel(t.last_done)}` : '');
}
// "⏰ 1pm" or "⏰ 8pm, day before"
function remindText(t) {
  if (!t.remind_time) return '';
  const n = Number(t.remind_days_before) || 0;
  const more = String(t.remind_extra || '').split(',').filter(Boolean).length;
  return '⏰ ' + time12(t.remind_time) + (n === 1 ? ', day before' : n === 7 ? ', a week before' : n > 1 ? `, ${n} days before` : '') + (more ? ` + ${more} more` : '');
}
function taskRow(t) {
  return `<div class="list-row" data-task="${esc(t.id)}">
    <button class="check" data-done="${esc(t.id)}" aria-label="Mark done: ${esc(t.name)}">${CHECK}</button>
    <div class="grow tap" data-edit="${esc(t.id)}"><div class="title">${t.private ? '<span class="lock" title="Only you can see this">🔒</span> ' : ''}${esc(t.name)}</div><div class="meta">${esc(freqText(t))}${t.remind_time ? ` · <span class="remind-tag">${esc(remindText(t))}</span>` : ''}</div></div>
    ${GROCERY_TASK_RE.test(t.name) ? `<button type="button" class="btn small groc-task" data-groc="1" aria-label="Plan meals and shopping list">🛒 Plan</button>` : ''}
    ${dueLabel(t)}
  </div>`;
}
function bindTaskRows(root, after) {
  $$('[data-done]', root).forEach(b => b.addEventListener('click', async () => {
    b.classList.add('done'); b.disabled = true;
    try {
      const t = await api('tasks.done', { id: b.dataset.done });
      toast(t.active === false ? `Done: ${t.name}` : `Done. Next: ${rel(t.next_due)}${t.interval_mode === 'learned' ? ' (learned your rhythm)' : ''}`);
      patchTask(t, t.active === false);
      after?.();
    } catch (e) { b.classList.remove('done'); b.disabled = false; fail(e); }
  }));
  $$('[data-groc]', root).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); state.grocery?.total ? openGroceryList() : openGroceryPlanner(); }));
  $$('[data-edit]', root).forEach(el => el.addEventListener('click', async () => {
    let t = (state.tasks || []).find(x => x.id === el.dataset.edit) || (state.today?.tasks_due || []).find(x => x.id === el.dataset.edit);
    openTaskEditor(t, after);
  }));
}

async function renderTasks() {
  if (state.tasks) safely(paintTasks, ['tasks']); else paintNoData();
  if (isStale('tasks')) refreshAll();
}
function paintTasks() {
  if (!state.tasks) return paintNoData();
  const all = state.tasks.map(dueNow);
  // The app shows only what's close: overdue and today, tomorrow, and the next 7 days (recurring ones too, when they
  // come due). Everything further out stays in the backend: Bella knows it all ("what's coming up next month?").
  const by = (lo, hi) => all.filter(t => t.days_until !== null && t.days_until !== undefined && t.days_until >= lo && t.days_until <= hi);
  const attention = all.filter(t => t.days_until !== null && t.days_until !== undefined && t.days_until <= 0);
  const tomorrow = by(1, 1), week = by(2, 7);
  const beyond = all.filter(t => t.days_until === null || t.days_until === undefined || t.days_until > 7).length;
  state.taskFolds = state.taskFolds || {};
  const section = (name, list) => `<div class="section-title">${name}<span>${list.length}</span></div><div class="card">${list.map(taskRow).join('')}</div>`;
  const fold = (key, name, list) => list.length ? `<details class="later" data-fold="${key}" ${state.taskFolds[key] ? 'open' : ''}>
      <summary><span>${name}</span><span class="muted small">${list.length} task${list.length > 1 ? 's' : ''}</span></summary>
      <div class="card">${list.map(taskRow).join('')}</div></details>` : '';
  view.innerHTML = !all.length
    ? `<div class="empty"><div class="big">No tasks yet</div>Add one with +, or just tell Homebase:<br>“remind me to renew the passport in December”.</div>`
    : (attention.length ? section('Needs attention', attention) : '') +
      (tomorrow.length ? section('Tomorrow', tomorrow) : '') +
      (!attention.length && !tomorrow.length ? '<div class="empty small">Nothing due today or tomorrow. 🎉</div>' : '') +
      fold('week', 'Next 7 days', week) +   // folded until you open it (remembered while the app is open)
      (beyond ? `<div class="muted small" style="margin:12px 4px">${beyond} more task${beyond > 1 ? 's' : ''} further out (recurring chores, yearly dates, later to-dos). They're all kept; ask ${esc(assistantName())}, e.g. “what's coming up next month?”</div>` : '') + '<div class="fab-space"></div>';
  $$('details[data-fold]').forEach(d => d.addEventListener('toggle', () => { state.taskFolds[d.dataset.fold] = d.open; }));
  const again = () => { if (currentTab() === 'tasks') repaintIfIdle(); };
  bindTaskRows(view, again);
  addFab(() => openTaskEditor(null, again));
}

function addFab(onClick) {
  $('.fab')?.remove();
  const b = document.createElement('button');
  b.className = 'fab'; b.textContent = '+'; b.setAttribute('aria-label', 'Add');
  b.onclick = onClick;
  document.body.appendChild(b);
}

function openTaskEditor(t, after) {
  const isNew = !t;
  t = t || { name: '', category: '', interval_days: null, interval_mode: 'ai', last_done: '', next_due: '', notes: '' };
  let repeat = isNew ? 'ai' : !t.interval_days ? 'once' : t.interval_mode === 'fixed' ? 'every' : 'ai';
  // Privacy only matters with family members; only the person who added a task can change it.
  const family = isMember() || (state.familyCount || 0) > 0;
  const canSetPrivacy = family && (isNew || (t.owner || 'owner') === (state.me?.id || 'owner'));
  openModal(`
    <h3>${isNew ? 'New task' : 'Edit task'}</h3>
    <label class="field"><span>What</span><input type="text" id="tName" value="${esc(t.name)}" placeholder="Clip cat's claws"></label>
    <label class="field"><span>Repeats</span>
      <div class="seg" id="tRepeat">
        <button type="button" data-v="ai">Let AI decide</button><button type="button" data-v="every">Every…</button><button type="button" data-v="once">One-time</button>
      </div></label>
    <div id="tAiInfo" class="muted small" style="margin:-4px 0 12px"></div>
    <div class="two">
      <label class="field" id="tEveryF"><span>Every (days)</span><input type="number" min="1" id="tEvery" value="${t.interval_days || ''}"></label>
      <label class="field" id="tLastF"><span>Last done</span><input type="date" id="tLast" value="${esc(t.last_done || '')}"></label>
      <label class="field" id="tDueF"><span>Due date</span><input type="date" id="tDue" value="${esc(t.next_due || '')}"></label>
    </div>
    <div class="field"><span>Reminder</span>
      <div class="remind-row">
        <input type="time" id="tRemind" value="${esc(t.remind_time || '')}" aria-label="Reminder time">
        <select id="tRemindDay" aria-label="Which day">${[[0, 'same day'], [1, 'day before'], [2, '2 days before'], [7, 'week before']]
          .concat([0, 1, 2, 7].includes(Number(t.remind_days_before) || 0) ? [] : [[Number(t.remind_days_before), t.remind_days_before + ' days before']])
          .map(([v, l]) => `<option value="${v}" ${(Number(t.remind_days_before) || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="btn small ghost" id="tRemindClear">None</button>
      </div>
      <span class="muted small" id="tRemindInfo" style="display:block;margin-top:5px"></span></div>
    <label class="field"><span>Category</span><input type="text" id="tCat" list="catList" value="${esc(t.category || '')}" placeholder="pets, home, kids…">
      <datalist id="catList"><option>pets</option><option>home</option><option>kids</option><option>health</option><option>car</option><option>garden</option><option>personal</option></datalist></label>
    <label class="field"><span>Notes</span><textarea id="tNotes" rows="2">${esc(t.notes || '')}</textarea></label>
    ${canSetPrivacy ? `<label class="field check-field row-field"><input type="checkbox" id="tPrivate" ${t.private ? 'checked' : ''}><span>Only me <span class="muted small">(hidden from the rest of the family)</span></span></label>` : ''}
    <div class="btn-row"><button class="btn primary" id="tSave">Save</button>${isNew ? '' : '<button class="btn danger" id="tDel">Delete</button>'}</div>
    ${isNew ? '' : '<div class="section-title" style="margin-left:0">History</div><div id="tHist" class="muted small">Loading…</div>'}`);
  const alive = dialogAlive();

  const paint = () => {
    $$('#tRepeat button').forEach(b => b.classList.toggle('on', b.dataset.v === repeat));
    $('#tEveryF').classList.toggle('hidden', repeat !== 'every');
    $('#tLastF').classList.toggle('hidden', repeat === 'once');
    $('#tDueF').classList.toggle('hidden', repeat !== 'once');
    $('#tAiInfo').textContent = repeat === 'ai'
      ? (!isNew && t.interval_days && t.interval_mode !== 'fixed'
        ? `Currently every ${t.interval_days} days${t.interval_reason ? ': ' + t.interval_reason : ''}. It adapts to when you actually do it.`
        : 'AI picks a sensible interval, then adapts to when you actually do it.')
      : '';
  };
  $$('#tRepeat button').forEach(b => b.onclick = () => { repeat = b.dataset.v; paint(); });
  paint();
  const paintRemind = () => {
    const on = !!$('#tRemind').value;
    $('#tRemindDay').disabled = !on;
    $('#tRemindInfo').textContent = on
      ? `A Telegram notification at ${time12($('#tRemind').value)}${Number($('#tRemindDay').value) ? ', ' + $('#tRemindDay').selectedOptions[0].text : ' on the due day'}${repeat !== 'once' ? ', each time it comes due' : ''}.`
      : 'No timed reminder. It still shows in the morning brief and evening check-in.';
  };
  $('#tRemind').addEventListener('input', paintRemind); $('#tRemind').addEventListener('change', paintRemind);
  $('#tRemindDay').addEventListener('change', paintRemind);
  $('#tRemindClear').onclick = () => { $('#tRemind').value = ''; paintRemind(); };
  $$('#tRepeat button').forEach(b => b.addEventListener('click', paintRemind));
  paintRemind();
  if (isNew) setTimeout(() => $('#tName')?.focus(), 50);

  if (!isNew) api('tasks.history', { id: t.id, limit: 10 }).then(h => {
    if (alive() && $('#tHist')) ($('#tHist').innerHTML = h.length ? h.map(x => `<div class="hist">✓ ${esc(niceDate(x.date_done))}${x.note && x.note !== 'initial' ? ' · ' + esc(x.note) : ''}</div>`).join('') : 'Not done yet.');
  }).catch(() => {});

  $('#tSave').onclick = e => {
    const name = $('#tName').value.trim();
    if (!name) return toast('Give it a name.', true);
    const data = { name, category: $('#tCat').value.trim(), notes: $('#tNotes').value.trim(),
      remind_time: $('#tRemind').value || '', remind_days_before: $('#tRemind').value ? Number($('#tRemindDay').value) || 0 : 0 };
    if (!isNew) data.id = t.id;
    if ($('#tPrivate')) data.private = $('#tPrivate').checked;
    if (repeat === 'ai') {
      if (isNew || !t.interval_days || t.interval_mode === 'fixed') data.ai_interval = true;
      if (!isNew && t.interval_mode === 'fixed') { data.interval_days = ''; }
    } else if (repeat === 'every') {
      const n = parseInt($('#tEvery').value, 10);
      if (!n) return toast('How many days?', true);
      data.interval_days = n; data.interval_mode = 'fixed';
    } else {
      data.interval_days = ''; data.due_date = $('#tDue').value || todayStr();
    }
    if (repeat !== 'once' && $('#tLast').value && $('#tLast').value !== t.last_done) data.last_done = $('#tLast').value;
    busy(e.currentTarget, async () => {
      let saved;
      try { saved = await api('tasks.save', data); }
      catch (err) {
        if (!/^DUPLICATE:/.test(err.message)) throw err;
        if (!confirm(err.message.replace(/^DUPLICATE:\s*/, '') + ' Add another one anyway?')) return;
        saved = await api('tasks.save', { ...data, allow_duplicate: true });
      }
      if (alive()) closeModal();
      toast(saved.interval_mode === 'ai' && saved.interval_reason ? `Every ${saved.interval_days} days. ${saved.interval_reason}`
        : saved.remind_at ? `Saved. Reminder ${rel(saved.remind_at.slice(0, 10))} at ${time12(saved.remind_at.slice(11))}.` : 'Saved.');
      patchTask(saved); after?.();
    }).catch(fail);
  };
  $('#tDel')?.addEventListener('click', e => {
    if (!confirm(`Delete "${t.name}"?`)) return;
    busy(e.currentTarget, async () => { await api('tasks.delete', { id: t.id }); if (alive()) closeModal(); patchTask(t, true); after?.(); }).catch(fail);
  });
}

// ================= shared helpers =================
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* optional */ } };

// --- people in the household ---
function parsePeople(str) {
  try { const l = JSON.parse(str || '[]'); if (Array.isArray(l) && l.length) return l; } catch { /* default */ }
  return [{ id: 'me', name: 'Me', kind: 'adult', notes: '' }];
}
// How long the last reply took, shown in Settings → AI models (to see where the time goes).
function noteTiming(t) {
  if (!t || !(t.total_ms || t.server_ms)) return;
  lsSet('homebase.lastTiming', JSON.stringify({ ...t, at: Date.now() }));
}
// The phone's side: you stop speaking (or tap Send) → request sent → reply arrived → voice started.
function notePhoneTiming(mode, tm) {
  if (!tm || !tm.sent || !tm.reply) return;
  const o = { mode, stop_ms: Math.max(0, tm.sent - (tm.stop || tm.sent)), wait_ms: tm.reply - tm.sent, at: Date.now() };
  if (tm.voice) o.voice_ms = Math.max(0, tm.voice - tm.reply);
  o.total_ms = (tm.voice || tm.reply) - (tm.stop || tm.sent);
  lsSet('homebase.phoneTiming', JSON.stringify(o));
}
function readJson(k) { try { return JSON.parse(lsGet(k, '') || 'null'); } catch { return null; } }
function timingText() {
  const t = readJson('homebase.lastTiming'), p = readJson('homebase.phoneTiming');
  const s = ms => (Number(ms || 0) / 1000).toFixed(1) + ' s';
  if (!t && !p) return `No timing yet. Send a message or talk to ${esc(assistantName())}, then look here again.`;
  let out = '';
  if (t) {
    const steps = Number(t.ai_steps) || 0;
    out += `Last reply took <b>${s(t.server_ms || t.total_ms)}</b> on the server: AI ${s(t.ai_ms)} (${steps} step${steps === 1 ? '' : 's'}${t.cached_tokens ? ', instructions cached' : ''}), reading the Sheet ${s(t.prompt_ms)}, actions ${s(t.tools_ms)}, saving ${s(t.save_ms)}${t.voice_ms ? ', voice ' + s(t.voice_ms) : ''}.`;
  }
  if (p) {
    out += `${out ? '<br>' : ''}On the phone (${p.mode === 'talk' ? 'talking' : 'typing'}): ${p.mode === 'talk' ? `you stopped speaking → sent ${s(p.stop_ms)}, ` : ''}waiting for the reply ${s(p.wait_ms)}${p.voice_ms !== undefined ? `, voice started ${s(p.voice_ms)} later` : ''}; <b>${s(p.total_ms)}</b> in all.`;
  } else out += ' Plus a second or two to reach Google.';
  return out;
}
// Which backend version answered last (shown in Settings → AI models).
function noteBackend(v) { if (v !== undefined) lsSet('homebase.backendVersion', v ? String(v) : ''); }
let appVerP = null;
// The app's version is the service worker's VERSION ('homebase-v49' → 'v49').
function appVersion() {
  if (appVerP) return appVerP;
  appVerP = new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; res(String(v || '').replace(/^homebase-/, '') || '?'); };
    const viaFile = () => fetch('sw.js', { cache: 'no-cache' }).then(r => r.text())
      .then(t => finish((/VERSION\s*=\s*'([^']+)'/.exec(t) || [])[1])).catch(() => finish(''));
    try {
      const c = navigator.serviceWorker?.controller;
      if (c && typeof MessageChannel === 'function') {
        const ch = new MessageChannel();
        ch.port1.onmessage = e => finish(e.data);
        c.postMessage('version', [ch.port2]);
        setTimeout(viaFile, 1500);
        return;
      }
    } catch { /* ask the file instead */ }
    viaFile();
  });
  return appVerP;
}
function versionHtml(app) {
  const b = lsGet('homebase.backendVersion', '');
  return `App ${esc(app)} · ${b ? 'Backend ' + esc(b) : 'Backend: old version — paste the new Apps Script files and Deploy → New version'}`;
}

function people() { return state.today?.people || parsePeople(state.settings?.people); }

// Who is talking on this phone right now. Normally the person signed in; on a shared phone someone can say
// "This is Sam." / "It's Alex here" / "我是…" and the assistant talks with them (for 30 minutes after their last message).
// Only at the start of a message, and only when the name ends the sentence ("It's Sam turn to…" is not a switch).
let speaker = null;   // {id, name, until}
let speakerTimer = null;
function speakerFor(text) {
  const m = /^\s*(?:(?:hi|hey|hello|ok|okay)[,!.\s]+)?(?:[\p{L}]+[,!.\s]+)?(?:this is|it'?s|it is|i'?m|i am|我是|我係|我系)\s*([\p{L}][\p{L}'-]*)(?=\s*(?:$|[,.!?;:，。！？…])|\s+(?:here|again|speaking|now|talking)\b)/iu.exec(String(text || ''));
  if (m) {
    const n = m[1].toLowerCase();
    const p = people().find(x => { const nm = String(x.name || '').toLowerCase(); return nm === n || nm.split(/\s+/)[0] === n; });
    if (p) speaker = p.id === myPersonId() ? null : { id: p.id, name: p.name };
  }
  const s = activeSpeaker();
  if (s) s.until = Date.now() + 30 * 60 * 1000;
  paintSpeaker();
  return s ? s.id : undefined;
}
function activeSpeaker() { if (speaker && speaker.until && speaker.until < Date.now()) speaker = null; return speaker; }
// "Talking with Sam ✕" in Chat, the Home box and talk mode while someone else is speaking; ✕ goes back to you.
function paintSpeaker() {
  const s = activeSpeaker();
  clearTimeout(speakerTimer);
  if (s && s.until) speakerTimer = setTimeout(paintSpeaker, Math.max(1000, s.until - Date.now() + 500));
  $$('.spk-row').forEach(el => {
    el.hidden = !s;
    el.innerHTML = s ? `<span class="spk-chip">Talking with ${esc(s.name)}<button type="button" class="spk-x" aria-label="Stop talking with ${esc(s.name)}">✕</button></span>` : '';
    $('.spk-x', el)?.addEventListener('click', () => { speaker = null; paintSpeaker(); });
  });
  $('#chatInput')?.dispatchEvent(new Event('input'));   // the chat list makes room for the message box
}
function personName(id) { const ps = people(); return (ps.find(p => p.id === id) || ps[0]).name; }
function myPersonId() { return state.me?.person_id || 'me'; }
// The signed-in person's name, as in the People list.
function myName() { const p = people().find(x => x.id === myPersonId()); return String((p && p.name) || state.me?.name || '').trim(); }
// When this person last talked with the assistant on this phone (talk, chat or the Home box).
const lastUseKey = () => 'homebase.lastUse.' + (state.me?.id || 'owner');
function markUse() { lsSet(lastUseKey(), String(Date.now())); }

// --- photo cache: memory (the 60 most recent) + IndexedDB (photos are small images fetched from Drive through the backend) ---
const PHOTO_MEM_MAX = 60;
const photoMem = new Map();
const photoInflight = new Set();
const photoMissing = new Set();   // the backend has no photo for these (asked once per app start)
let photoDb = null;
function memGet(id) { const u = photoMem.get(id); if (u) { photoMem.delete(id); photoMem.set(id, u); } return u; }
function memSet(id, u) {
  photoMem.delete(id); photoMem.set(id, u);
  while (photoMem.size > PHOTO_MEM_MAX) photoMem.delete(photoMem.keys().next().value);
}
function openPhotoDb() {
  if (!photoDb) photoDb = new Promise(res => {
    try {
      const r = indexedDB.open('homebase-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('p');
      r.onsuccess = () => res(r.result);
      r.onerror = r.onblocked = () => res(null);
    } catch { res(null); }
  });
  return photoDb;
}
async function idbGet(id) {
  const db = await openPhotoDb();
  if (!db) return null;
  return new Promise(res => {
    try { const q = db.transaction('p').objectStore('p').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); }
  });
}
async function idbPut(id, val) {
  const db = await openPhotoDb();
  if (!db) return;
  try { db.transaction('p', 'readwrite').objectStore('p').put(val, id); } catch { /* cache only */ }
}
// Photos of meals no longer in the saved list are removed from the phone (once per app start).
let photosPruned = false;
async function prunePhotos() {
  if (photosPruned || !state.meals) return;
  photosPruned = true;
  const keep = new Set();
  state.meals.forEach(m => { if (m.photo_id) keep.add(m.photo_id); if (m.receipt_id) keep.add(m.receipt_id); });
  const db = await openPhotoDb();
  if (!db) return;
  try {
    const st = db.transaction('p', 'readwrite').objectStore('p');
    const q = st.getAllKeys();
    q.onsuccess = () => (q.result || []).forEach(k => { if (!keep.has(k)) st.delete(k); });
  } catch { /* cache only */ }
}
// Signing in as someone else: their photos go too.
function forgetPhotos() {
  photoMem.clear(); photoMissing.clear();
  const p = photoDb; photoDb = null;
  Promise.resolve(p).then(db => { try { db?.close(); } catch { /* fine */ } try { indexedDB.deleteDatabase('homebase-photos'); } catch { /* fine */ } });
}
function paintPhotos() {
  $$('[data-photo]').forEach(el => {
    const u = memGet(el.dataset.photo);
    if (u && el.dataset.shown !== '1') { el.style.backgroundImage = `url("${u}")`; el.dataset.shown = '1'; el.classList.add('has'); }
  });
}
// Fills every [data-photo] element on screen. Missing photos are fetched 12 at a time.
async function ensurePhotos(extraIds = []) {
  const ids = [...new Set([...$$('[data-photo]').map(e => e.dataset.photo), ...extraIds].filter(Boolean))];
  const need = [];
  const missing = ids.filter(id => !photoMem.has(id) && !photoMissing.has(id));
  const fromDisk = await Promise.all(missing.map(id => idbGet(id)));   // read the phone's copies in parallel
  missing.forEach((id, i) => { if (fromDisk[i]) memSet(id, fromDisk[i]); else need.push(id); });
  paintPhotos();
  const todo = need.filter(id => !photoInflight.has(id));
  todo.forEach(id => photoInflight.add(id));
  for (let i = 0; i < todo.length; i += 12) {
    const chunk = todo.slice(i, i + 12);
    try {
      const got = await api('photos.get', { ids: chunk }) || {};
      chunk.forEach(id => { if (got[id]) { memSet(id, got[id]); idbPut(id, got[id]); } else photoMissing.add(id); });
    } catch (e) { console.error(e); }
    chunk.forEach(id => photoInflight.delete(id));
    paintPhotos();
  }
}

// --- image helpers (all on the phone) ---
function loadImg(src) {
  return new Promise((ok, no) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => no(new Error("Couldn't read that photo.")); img.src = src; });
}
// Opens a picture file as an <img> (the browser reads only the header until it is drawn).
async function fileImg(fileOrBlob) {
  const u = URL.createObjectURL(fileOrBlob);
  try { return await loadImg(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 0); }
}
// Decodes a photo already scaled down near `max` (a 50 MP camera photo is never decoded at full size).
async function decodeImage(fileOrBlob, max) {
  let opts = { imageOrientation: 'from-image' };
  try {
    const img = await fileImg(fileOrBlob);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = w && h ? Math.min(1, max / Math.max(w, h)) : 1;
    // width only: the height follows the photo's own shape, whichever way the camera held it
    if (k < 1) opts = { ...opts, resizeWidth: Math.max(1, Math.round(w * k * 1.05)), resizeQuality: 'high' };
  } catch { /* size unknown: decode as is */ }
  try { return await createImageBitmap(fileOrBlob, opts); }
  catch { return fileImg(fileOrBlob); }
}
// Meal photos are stored at this size (longest side); receipts larger so the small print stays readable.
const PHOTO_MAX = 800, RECEIPT_MAX = 1600;

// Longest side `max`, as a JPEG on white. Returns {url, data, mime}.
async function shrinkImage(file, max = PHOTO_MAX, quality = 0.84) {
  const bmp = await decodeImage(file, max);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const url = c.toDataURL('image/jpeg', quality);
  return { url, data: url.split(',')[1], mime: 'image/jpeg' };
}
// ================= FOOD =================
const MEALS = [['breakfast', 'Breakfast', '🥞'], ['lunch', 'Lunch', '🥗'], ['dinner', 'Dinner', '🍲'], ['snack', 'Snack', '🍎'], ['dessert', 'Dessert', '🍰'], ['drink', 'Drink', '🧋']];
const SOURCES = [['homemade', 'Homemade'], ['restaurant', 'Restaurant'], ['takeout', 'Takeout'], ['packaged', 'Packaged']];
const TAGS = ['sweet', 'savory', 'spicy', 'fried', 'soup', 'noodles', 'rice', 'light', 'heavy', 'high-protein', 'veggie-rich', 'vegetarian', 'seafood', 'comfort', 'healthy', 'treat'];
const NEEDS = [['weight loss', 'Losing weight'], ['craving sweet', 'Craving sweet'], ['craving savory', 'Craving savory'], ['something light', 'Something light'],
  ['comfort food', 'Comfort food'], ['high protein', 'High protein'], ['on my period', 'On my period'], ['low energy', 'Low energy'],
  ['something new', 'Something new'], ['quick and easy', 'Quick & easy'], ['budget', 'Budget'], ['kid-friendly', 'Kid-friendly']];
const WHERE = [['home', '🏠', 'Cook at home'], ['out', '🍽️', 'Eat out'], ['takeout', '🥡', 'Takeout'], ['any', '🎲', 'Surprise me']];
const MOODS = [['usual', 'My usual'], ['mix', 'Mix it up'], ['new', 'Something different']];
const KIND_LABEL = { favorite: 'A favorite', twist: 'A twist', new: 'Something new' };
const EFFORT = [['15 minutes', '⚡ 15 min'], ['normal', 'Normal'], ['no limit', 'No rush']];
const mealIcon = m => (MEALS.find(x => x[0] === m) || MEALS[2])[2];
const mealLabel = m => (MEALS.find(x => x[0] === m) || [m, m])[1];
const nowHHMM = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mealByTime(hhmm) {
  const h = parseInt(String(hhmm || nowHHMM()).slice(0, 2), 10);
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : h < 22 ? 'dinner' : 'snack';
}
state.ffilter = 'all';
state.fshow = 30;   // days shown in the list

async function renderFood() {
  if (state.meals) safely(paintFood, ['meals']); else paintNoData();
  addFab(() => openMealEditor(null));
  if (isStale('meals')) refreshAll();
}

function weekSummary(list) {
  const since = dayOf(new Date(Date.now() - 6 * 864e5));
  const wk = list.filter(m => m.date >= since);
  if (!wk.length) return '';
  const by = k => wk.filter(m => m.source === k).length;
  const sweets = wk.filter(m => (m.tags || []).includes('sweet') || m.meal === 'dessert').length;
  const parts = [`${wk.length} meal${wk.length > 1 ? 's' : ''}`];
  if (by('homemade')) parts.push(`${by('homemade')} homemade`);
  if (by('restaurant')) parts.push(`${by('restaurant')} out`);
  if (by('takeout')) parts.push(`${by('takeout')} takeout`);
  if (sweets) parts.push(`${sweets} sweet`);
  return 'Last 7 days: ' + parts.join(' · ');
}

function mealRow(m) {
  const who = (m.people || []).length > 1 || (m.people || [])[0] !== myPersonId()
    ? `<span class="who">${(m.people || []).map(id => esc(personName(id).charAt(0).toUpperCase())).join('')}</span>` : '';
  const sub = [mealLabel(m.meal) + (m.time ? ' ' + time12(m.time) : ''), m.source === 'homemade' ? 'Homemade' : m.place || (SOURCES.find(s => s[0] === m.source) || ['', ''])[1], m.calories ? `~${m.calories} kcal` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="meal-row" data-meal="${esc(m.id)}">
    <span class="ph meal-ph" ${m.photo_id ? `data-photo="${esc(m.photo_id)}"` : ''}><span class="ph-i">${mealIcon(m.meal)}</span></span>
    <span class="grow"><b>${esc(m.name)}${m.rating === 1 ? ' <span class="loved" title="Loved it">♥</span>' : ''}</b><span class="muted small">${esc(sub)}</span></span>${who}</button>`;
}

function paintFood() {
  if (!state.meals) return paintNoData();
  const everything = state.meals || [];
  const planned = everything.filter(m => m.status === 'planned');
  const all = everything.filter(m => m.status !== 'planned');
  const ps = people();
  const f = state.ffilter;
  const list = f === 'all' ? all : all.filter(m => (m.people || []).includes(f));
  const since = dayOf(new Date(Date.now() - (state.fshow - 1) * 864e5));
  const shown = list.filter(m => m.date >= since);
  const days = [];
  shown.forEach(m => { const d = days.find(x => x.date === m.date); if (d) d.items.push(m); else days.push({ date: m.date, items: [m] }); });
  const dayTitle = d => { const r = rel(d); return r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : niceDate(d); };
  view.innerHTML = `
    <div class="card food-hero">
      <div class="fh-q">Not sure what to eat?</div>
      <div class="muted small">A few quick questions, then three ideas from your taste and what you've been eating.</div>
      <button class="btn primary block" id="fGuess" style="margin-top:12px">Guess what I want to eat</button>
      ${(state.taste?.[myPersonId()] || 0) < 20
        ? `<button type="button" class="taste-cta" id="fTaste"><span class="grow"><b>New here? Take the taste quiz</b><span class="muted small">Pick your cuisines, then rate 30 dish photos (about a minute) so ideas fit from day one.</span></span><span aria-hidden="true">›</span></button>`
        : `<button type="button" class="btn small ghost" id="fTaste" style="margin-top:8px">Taste quiz · ${state.taste[myPersonId()]} rated</button>`}
    </div>
    ${groceryCardHtml()}
    ${planned.length ? `<div class="section-title">Up next<span>${planned.length}</span></div><div class="card meal-list up-next">${planned.map(m => `
      <div class="next-row" data-next="${esc(m.id)}">
        <span class="idea-i">${m.source === 'homemade' ? '🏠' : m.source === 'takeout' ? '🥡' : '🍽️'}</span>
        <span class="grow"><b>${esc(m.name)}</b><span class="muted small">${esc([mealLabel(m.meal), m.place, rel(m.date) === 'today' ? '' : 'picked ' + rel(m.date)].filter(Boolean).join(' · '))}</span></span>
        <button type="button" class="btn small primary" data-ate="${esc(m.id)}" aria-label="I ate it">✓ Ate it</button>
        <button type="button" class="icon-mini" data-snap="${esc(m.id)}" aria-label="Add a photo">📷</button>
        <button type="button" class="icon-mini" data-drop="${esc(m.id)}" aria-label="Remove">✕</button>
      </div>`).join('')}</div>` : ''}
    ${ps.length > 1 ? `<div class="fchips" id="fFilter"><button data-f="all" class="${f === 'all' ? 'on' : ''}">Everyone</button>${ps.map(p => `<button data-f="${esc(p.id)}" class="${f === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    ${weekSummary(list) ? `<div class="muted small food-week">${esc(weekSummary(list))}</div>` : ''}
    ${days.length ? days.map(d => `<div class="section-title">${esc(dayTitle(d.date))}<span>${d.items.length}</span></div><div class="card meal-list">${d.items.map(mealRow).join('')}</div>`).join('')
      : `<div class="card empty-food"><div class="big">📷</div><div>Snap your meals with <b>+</b>, add the receipt if you have one, and Homebase fills in the rest.</div><div class="muted small" style="margin-top:6px">Or just tell the chat: "had pho at Pho 75 for lunch".</div></div>`}
    ${list.length > shown.length ? `<button class="btn ghost block" id="fMore">Show earlier meals</button>` : ''}
    <div class="spacer"></div>`;
  $('#fGuess').onclick = () => openGuess();
  bindGroceryCard();
  $('#fTaste').onclick = () => openTasteQuiz(myPersonId());
  $$('#fFilter [data-f]').forEach(b => b.onclick = () => { state.ffilter = b.dataset.f; paintFood(); });
  $('#fMore')?.addEventListener('click', () => { state.fshow += 60; paintFood(); });
  $$('[data-meal]', view).forEach(b => b.onclick = () => { const m = (state.meals || []).find(x => x.id === b.dataset.meal); if (m) openMealEditor(m); });
  const byId = id => (state.meals || []).find(x => x.id === id);
  $$('[data-ate]', view).forEach(b => b.onclick = () => busy(b, async () => {
    const saved = await api('meals.save', { id: b.dataset.ate, status: '', date: todayStr(), time: nowHHMM() });
    upsertMeal(saved);
    toast(`Logged ${mealLabel(saved.meal).toLowerCase()}. Tap it to add a photo or fix details.`);
  }).catch(fail));
  $$('[data-snap]', view).forEach(b => b.onclick = () => { const m = byId(b.dataset.snap); if (m) openMealEditor(m, null, { capture: true }); });
  $$('[data-drop]', view).forEach(b => b.onclick = () => {
    const m = byId(b.dataset.drop);
    if (!confirm(`Remove "${m ? m.name : 'this meal'}" from Up next?`)) return;
    busy(b, async () => { await api('meals.delete', { id: b.dataset.drop }); if (m) upsertMeal(m, true); }).catch(fail);
  });
  $$('[data-next] .grow', view).forEach(el => el.onclick = () => { const m = byId(el.closest('[data-next]').dataset.next); if (m) openMealEditor(m); });
  ensurePhotos();
}

function upsertMeal(m, removed) {
  const l = (state.meals || []).filter(x => x.id !== m.id);
  if (!removed) l.push(m);
  state.meals = l.sort((a, b) => ((b.date + (b.time || '99')) > (a.date + (a.time || '99')) ? 1 : -1));
  invalidate(); saveCache();
  if (currentTab() === 'food') repaintIfIdle();
}

// ================= GROCERIES =================
// Plan meals for a shopping trip → one shared shopping list from their recipes → scratch what you already have.
const GROC_NEEDS = ['Quick & easy', 'Healthy', 'Kid-friendly', 'Budget', 'Vegetarian', 'Something new'];
const GROCERY_TASK_RE = /grocer|supermarket|costco|trader joe|whole foods|h ?mart|aldi|wegmans|safeway|kroger|food shopping|shopping list|买菜|買菜|超市/i;
const SECTION_ICON = { produce: '🥬', 'meat & seafood': '🍗', 'dairy & eggs': '🥚', bakery: '🍞', pantry: '🥫', frozen: '🧊', drinks: '🧃', household: '🧻', other: '🛒' };

function groceryCardHtml() {
  const g = state.grocery;
  const has = g && g.total;
  return `<div class="card groc-card">
    <div class="groc-top"><span class="groc-i" aria-hidden="true">🛒</span>
      <span class="grow"><b>Groceries</b><span class="muted small">${has ? `${g.left} to buy${g.total - g.left ? ` · ${g.total - g.left} scratched` : ''}${g.meals ? ` · ${g.meals} meals` : ''}` : 'Plan meals for your next shop and get one list.'}</span></span></div>
    <div class="btn-row" style="margin-top:10px">${has ? '<button class="btn small primary" id="gOpen">Open list</button><button class="btn small" id="gPlan">Plan new meals</button>' : '<button class="btn small primary" id="gPlan">Plan meals & list</button>'}</div>
  </div>`;
}
function bindGroceryCard() {
  $('#gPlan')?.addEventListener('click', () => openGroceryPlanner());
  $('#gOpen')?.addEventListener('click', () => openGroceryList());
}
function setGrocery(g) {
  state.grocery = { left: g.items.filter(i => !i.status).length, total: g.items.length, meals: g.meals.length, created: g.created };
  saveCache();
  if (currentTab() === 'food') pendingRepaint = true;   // the Groceries card catches up when the list closes
}

function openGroceryPlanner() {
  let count = 5;
  const needs = new Set();
  openModal(`<h3>🛒 Plan meals</h3>
    <div class="field"><span>How many meals are we shopping for?</span>
      <div class="fchips" id="gCount">${[3, 4, 5, 7, 10].map(n => `<button type="button" data-n="${n}" class="${n === count ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="field"><span>Anything special? <span class="muted">(optional)</span></span>
      <div class="fchips" id="gNeeds">${GROC_NEEDS.map(x => `<button type="button" data-x="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
    <label class="field"><span>Note <span class="muted">(optional)</span></span><input type="text" id="gNote" maxlength="200" placeholder="e.g. we have chicken and rice; one fish night"></label>
    <button class="btn primary block" id="gGo">Suggest meals</button>`);
  $$('#gCount [data-n]').forEach(b => b.onclick = () => { count = +b.dataset.n; $$('#gCount [data-n]').forEach(x => x.classList.toggle('on', x === b)); });
  $$('#gNeeds [data-x]').forEach(b => b.onclick = () => { const x = b.dataset.x; needs.has(x) ? needs.delete(x) : needs.add(x); b.classList.toggle('on', needs.has(x)); });
  $('#gGo').onclick = () => runGroceryPlan({ count, needs: [...needs], note: $('#gNote').value.trim() });
}

async function runGroceryPlan(q) {
  const body = openModal(`<h3>🛒 Plan meals</h3><div class="guess-wait"><span class="spinner"></span><div class="muted small">Picking ${q.count} meals you'll like…</div></div>`);
  const alive = dialogAlive();
  let plan;
  try { plan = await api('grocery.plan', q, { timeoutMs: 150000 }); }
  catch (e) { if (alive()) closeModal(); return fail(e); }
  if (!alive()) return;
  let meals = plan.meals || [];
  const paint = () => {
    body.innerHTML = `<h3>🛒 ${meals.length} meal${meals.length === 1 ? '' : 's'}</h3>
      ${plan.intro ? `<div class="muted small" style="margin-bottom:10px">${esc(plan.intro)}</div>` : ''}
      <div class="plan-list">${meals.map((m, i) => `<div class="plan-row">
        ${m.photo_url ? `<img class="plan-ph" src="${esc(m.photo_url)}" alt="">` : '<span class="plan-ph plan-ph-i" aria-hidden="true">🍲</span>'}
        <div class="grow"><b>${esc(m.title)}</b><div class="muted small">${esc([m.time, m.cuisine].filter(Boolean).join(' · '))}</div>
          ${m.why ? `<div class="small">${esc(m.why)}</div>` : ''}
          <div class="btn-row plan-acts"><button type="button" class="btn small ghost" data-rcp="${i}">📖 Recipe</button><button type="button" class="btn small ghost" data-swap="${i}">↻ Swap</button><button type="button" class="btn small ghost" data-rm="${i}" aria-label="Remove ${esc(m.title)}">✕</button></div></div>
      </div>`).join('')}</div>
      <button class="btn primary block" id="gBuild" ${meals.length ? '' : 'disabled'}>Make shopping list</button>
      <div class="muted small" style="margin-top:6px;text-align:center">The meals also go to “Up next”, so you can tick them off as you cook.</div>`;
    $$('[data-rcp]', body).forEach(b => b.onclick = () => { const m = meals[+b.dataset.rcp]; openRecipe({ title: m.title, cuisine: m.cuisine, ingredients: (m.ingredients || []).map(g => g.item + (g.amount ? ' (' + g.amount + ')' : '')) }); });
    $$('[data-rm]', body).forEach(b => b.onclick = () => { meals.splice(+b.dataset.rm, 1); paint(); });
    $$('[data-swap]', body).forEach(b => b.onclick = () => {
      const old = meals[+b.dataset.swap];   // the list can change while this is on its way: swap that meal, wherever it is now
      busy(b, async () => {
        const r = await api('grocery.plan', { count: 1, needs: q.needs, note: q.note, exclude: meals.map(m => m.title) }, { timeoutMs: 120000 });
        const j = meals.indexOf(old);
        if (r.meals?.[0] && j >= 0 && alive()) { meals[j] = r.meals[0]; paint(); }
      }).catch(fail);
    });
    $('#gBuild').onclick = e => busy(e.currentTarget, async () => {
      const g = await api('grocery.build', { meals }, { timeoutMs: 120000 });
      setGrocery(g); invalidate(1500);
      if (alive()) openGroceryList(g);
      toast(`Shopping list ready: ${g.items.length} items. Tap anything you already have.`);
    }).catch(fail);
  };
  paint();
}

async function openGroceryList(g) {
  const body = openModal(`<h3>🛒 Shopping list</h3><div class="guess-wait"><span class="spinner"></span></div>`);
  const alive = dialogAlive();
  if (!g) {
    try { g = await api('grocery.get'); } catch (e) { if (alive()) closeModal(); return fail(e); }
    if (!alive()) return;
  }
  setGrocery(g);
  // What you tick is what you see: taps are sent one item at a time, a moment later (two quick taps = no change),
  // and replies never undo a tap made after them.
  const want = new Map();     // item id → status you picked, not yet confirmed
  const sent = new Map();     // item id → status on its way
  let flushTimer = null, flushing = false;
  const take = fresh => {
    fresh.items.forEach(i => { if (want.has(i.id)) i.status = want.get(i.id); else if (sent.has(i.id)) i.status = sent.get(i.id); });
    g = fresh; setGrocery(g);
  };
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (want.size) {
        const [id, status] = want.entries().next().value;
        want.delete(id); sent.set(id, status);
        try {
          const fresh = await api('grocery.set', { id, status });
          sent.delete(id);
          take(fresh);
        } catch (e) {
          sent.delete(id);
          if (!want.has(id)) { const it = g.items.find(x => x.id === id); if (it) it.status = status ? '' : 'have'; setGrocery(g); }
          fail(e);
        }
        if (alive()) paint();
      }
    } finally { flushing = false; }
  };
  const paint = () => {
    const left = g.items.filter(i => !i.status).length;
    const sections = [];
    g.items.forEach(i => { const s = sections.find(x => x.name === i.section); if (s) s.items.push(i); else sections.push({ name: i.section, items: [i] }); });
    body.innerHTML = `<h3>🛒 Shopping list</h3>
      <div class="muted small" style="margin:-4px 0 10px">${g.items.length ? `${left} to buy · tap what you already have to scratch it` : 'Empty. Add things below, or plan meals.'}</div>
      <form class="groc-add" id="gAddF"><input type="text" id="gAdd" placeholder="Add an item (e.g. milk, eggs)" autocomplete="off" maxlength="60"><button class="btn small primary">Add</button></form>
      ${g.meals.length ? `<div class="groc-meals">${g.meals.map((m, i) => `<button type="button" class="chip" data-mr="${i}">📖 ${esc(m.name)}</button>`).join('')}</div>` : ''}
      ${sections.map(s => `<div class="section-title" style="margin-left:0">${SECTION_ICON[s.name] || '🛒'} ${esc(s.name)}<span>${s.items.filter(i => !i.status).length}</span></div>
        <div class="groc-list">${s.items.slice().sort((a, b) => (!!a.status - !!b.status)).map(i => `<button type="button" class="groc-item${i.status ? ' have' : ''}" data-gi="${esc(i.id)}" aria-pressed="${i.status ? 'true' : 'false'}">
          <span class="groc-box" aria-hidden="true">${i.status ? '✓' : ''}</span>
          <span class="grow"><span class="groc-name">${esc(i.name)}</span>${i.amount ? ` <span class="muted small">${esc(i.amount)}</span>` : ''}
            ${i.meals ? `<span class="groc-for muted small">for ${esc(i.meals)}</span>` : ''}</span>
          ${i.status ? '<span class="muted small">have it</span>' : ''}</button>`).join('')}</div>`).join('')}
      <div class="btn-row" style="margin-top:14px">${g.items.length ? '<button class="btn small" id="gCopy">Copy list</button>' : ''}<button class="btn small" id="gNew">Plan new meals</button>${g.items.length ? '<button class="btn small ghost" id="gClear">Clear list</button>' : ''}</div>`;
    $$('[data-gi]', body).forEach(b => b.onclick = () => {
      const it = g.items.find(x => x.id === b.dataset.gi); if (!it) return;
      it.status = it.status ? '' : 'have'; want.set(it.id, it.status);
      paint(); setGrocery(g);
      clearTimeout(flushTimer); flushTimer = setTimeout(flush, 700);
    });
    $$('[data-mr]', body).forEach(b => b.onclick = () => { const m = g.meals[+b.dataset.mr]; const r = m.recipe || {};
      openRecipe({ title: m.name, cuisine: r.cuisine, ingredients: (r.ingredients || []).map(x => x.item + (x.amount ? ' (' + x.amount + ')' : '')) }); });
    $('#gAddF').onsubmit = e => {
      e.preventDefault();
      const v = $('#gAdd').value.trim(); if (!v) return;
      busy(e.submitter || $('#gAddF button'), async () => { const fresh = await api('grocery.set', { add: v.split(/\s*,\s*/) }); take(fresh); if (alive()) { paint(); $('#gAdd')?.focus(); } }).catch(fail);
    };
    $('#gCopy')?.addEventListener('click', () => {
      let sec = '';
      const text = g.items.filter(i => !i.status).map(i => { const h = i.section !== sec ? (sec = i.section, `\n${sec.toUpperCase()}\n`) : ''; return h + '• ' + i.name + (i.amount ? ' (' + i.amount + ')' : ''); }).join('\n').trim();
      navigator.clipboard?.writeText(text).then(() => toast('Copied. Paste it anywhere.')).catch(() => toast('Copy not allowed here.', true));
    });
    $('#gNew').onclick = () => openGroceryPlanner();
    $('#gClear')?.addEventListener('click', e => { if (!confirm('Clear the whole shopping list?')) return; busy(e.currentTarget, async () => { want.clear(); g = await api('grocery.set', { clear: true }); setGrocery(g); if (alive()) paint(); }).catch(fail); });
  };
  paint();
}

// --- add / edit a meal ---
// Stage 1 (new meal): food photo, optional receipt, a note, who ate → "Read it" (AI) or fill in by hand.
// Stage 2: the form (pre-filled by the AI), then Save.
function openMealEditor(meal, prefill, opts = {}) {
  const draft = { photo: null, receipt: null, people: meal?.people || prefill?.people || [myPersonId()], taken: null };
  if ((meal || prefill) && !opts.capture) return mealForm(meal, prefill || {}, draft);
  const target = opts.capture ? meal : null;
  const ps = people();
  openModal(`<h3>${target ? esc(target.name) : 'Add a meal'}</h3>
    <div class="snap-row">
      <label class="snap" id="snapFood"><input type="file" accept="image/*" id="mPhoto" hidden><span class="ph snap-ph" id="mPhotoPh"><span class="ph-i">📷</span></span><span class="small">Food photo</span></label>
      <label class="snap" id="snapRcpt"><input type="file" accept="image/*" id="mRcpt" hidden><span class="ph snap-ph" id="mRcptPh"><span class="ph-i">🧾</span></span><span class="small">Receipt <span class="muted">(optional)</span></span></label>
    </div>
    <label class="field"><span>Anything to add? (optional)</span><input type="text" id="mHint" placeholder="e.g. half portion, shared with Sam" maxlength="200"></label>
    ${ps.length > 1 ? `<div class="field"><span>Who ate</span><div class="fchips" id="mWho">${ps.map(p => `<button type="button" data-p="${esc(p.id)}" class="${draft.people.includes(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
    <button class="btn primary block" id="mRead">Read it</button>
    <button class="btn ghost block" id="mByHand" style="margin-top:6px">Fill in by hand</button>`);
  const alive = dialogAlive();
  const pick = async (input, ph, key, max) => {
    const file = input.files?.[0]; if (!file) return;
    try {
      const img = await shrinkImage(file, max, key === 'receipt' ? 0.8 : 0.84);
      draft[key] = img;
      if (key === 'photo' && file.lastModified && Date.now() - file.lastModified < 7 * 864e5) draft.taken = new Date(file.lastModified);
      ph.style.backgroundImage = `url("${img.url}")`; ph.classList.add('has');
    } catch (e) { fail(e); }
  };
  $('#mPhoto').onchange = e => pick(e.target, $('#mPhotoPh'), 'photo', PHOTO_MAX);
  $('#mRcpt').onchange = e => pick(e.target, $('#mRcptPh'), 'receipt', RECEIPT_MAX);
  $$('#mWho [data-p]').forEach(b => b.onclick = () => {
    b.classList.toggle('on');
    draft.people = $$('#mWho [data-p].on').map(x => x.dataset.p);
  });
  $('#mByHand').onclick = () => mealForm(target, { note: $('#mHint').value.trim() || undefined }, draft);
  $('#mRead').onclick = e => {
    const hint = $('#mHint').value.trim();
    if (!draft.photo && !draft.receipt && !hint) return toast('Add a photo, a receipt or a few words first.', true);
    const t = draft.taken || new Date();
    busy(e.currentTarget, async () => {
      e.currentTarget.textContent = 'Reading…';
      const r = await api('meals.analyze', {
        photo: draft.photo ? { data: draft.photo.data, mime: draft.photo.mime } : undefined,
        receipt: draft.receipt ? { data: draft.receipt.data, mime: draft.receipt.mime } : undefined,
        hint: [target ? 'Planned: ' + target.name + (target.place ? ' at ' + target.place : '') : '', hint].filter(Boolean).join('. '), date: dayOf(t), time: nowHHMM(t), people: draft.people
      }, { timeoutMs: 90000 });
      if (alive()) mealForm(target, { ...r, note: hint || undefined, ai: true }, draft);
    }).catch(fail);
  };
}

function mealForm(meal, pre, draft) {
  const m = meal || {};
  const v = k => (pre[k] !== undefined ? pre[k] : m[k]);
  const ps = people();
  const t = draft.taken || new Date();
  const wasPlanned = m.status === 'planned';
  if (wasPlanned && pre.date === undefined) { pre = { ...pre, date: dayOf(t), time: pre.time || nowHHMM(t) }; }
  const val = {
    meal: v('meal') || mealByTime(v('time') || nowHHMM(t)), source: v('source') || 'homemade',
    tags: [...(v('tags') || [])], rating: v('rating') === undefined || v('rating') === null ? '' : v('rating'),
    people: [...(meal ? m.people || [] : draft.people)]
  };
  const photoSrc = draft.photo?.url;
  openModal(`<h3>${wasPlanned ? 'Ate it? Check and save' : meal ? 'Meal' : 'Check and save'}</h3>
    ${photoSrc || m.photo_id || m.receipt_id ? `<div class="meal-photos">${photoSrc ? `<span class="ph meal-big has" style="background-image:url('${photoSrc}')"></span>` : m.photo_id ? `<span class="ph meal-big" data-photo="${esc(m.photo_id)}"><span class="ph-i">${mealIcon(m.meal)}</span></span>` : ''}
      ${draft.receipt?.url ? `<span class="ph meal-rc has" style="background-image:url('${draft.receipt.url}')"></span>` : m.receipt_id ? `<span class="ph meal-rc" data-photo="${esc(m.receipt_id)}"><span class="ph-i">🧾</span></span>` : ''}</div>` : ''}
    <div class="snap-links">
      ${meal || !draft.photo ? `<label class="snap-inline small"><input type="file" accept="image/*" id="fNewPhoto" hidden>📷 ${m.photo_id || draft.photo ? 'Change photo' : 'Add a photo'}</label>` : ''}
      ${!draft.receipt ? `<label class="snap-inline small"><input type="file" accept="image/*" id="fNewRcpt" hidden>🧾 ${m.receipt_id ? 'Change receipt' : 'Add a receipt'}</label>` : ''}
    </div>
    <label class="field"><span>What was it</span><input type="text" id="fName" value="${esc(v('name') || '')}" maxlength="80" placeholder="e.g. Beef pho with spring rolls"></label>
    <div class="field"><span>Meal</span><div class="fchips wrap" id="fMeal">${MEALS.map(([k, l, i]) => `<button type="button" data-v="${k}" class="${val.meal === k ? 'on' : ''}">${i} ${l}</button>`).join('')}</div></div>
    <div class="field"><span>From</span><div class="seg" id="fSource">${SOURCES.map(([k, l]) => `<button type="button" data-v="${k}" class="${val.source === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="two" id="fPlaceRow">
      <label class="field"><span>Place</span><input type="text" id="fPlace" value="${esc(v('place') || '')}" maxlength="60" placeholder="Restaurant or store"></label>
      <label class="field"><span>Cuisine</span><input type="text" id="fCuisine" value="${esc(v('cuisine') || '')}" maxlength="30" placeholder="e.g. vietnamese"></label>
    </div>
    <div class="two">
      <label class="field"><span>Date</span><input type="date" id="fDate" value="${esc(v('date') || dayOf(t))}" max="${todayStr()}"></label>
      <label class="field"><span>Time</span><input type="time" id="fTime" value="${esc(v('time') || (meal ? '' : nowHHMM(t)))}"></label>
    </div>
    ${ps.length > 1 ? `<div class="field"><span>Who ate</span><div class="fchips" id="fWho">${ps.map(p => `<button type="button" data-p="${esc(p.id)}" class="${val.people.includes(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
    <div class="two">
      <label class="field"><span>Calories (about)</span><input type="number" id="fKcal" inputmode="numeric" value="${esc(v('calories') ?? '')}" min="0" max="5000"></label>
      <label class="field"><span>Protein (g)</span><input type="number" id="fProt" inputmode="numeric" value="${esc(v('protein_g') ?? '')}" min="0" max="400"></label>
    </div>
    <label class="field"><span>Ingredients</span><input type="text" id="fIng" value="${esc((v('ingredients') || []).join(', '))}" placeholder="comma separated"></label>
    <div class="field"><span>Tags</span><div class="fchips wrap" id="fTags">${[...new Set([...TAGS, ...val.tags])].map(tg => `<button type="button" data-v="${esc(tg)}" class="${val.tags.includes(tg) ? 'on' : ''}">${esc(tg)}</button>`).join('')}</div></div>
    <div class="field"><span>How was it?</span><div class="seg" id="fRate"><button type="button" data-v="1" class="${val.rating === 1 ? 'on' : ''}">😋 Loved it</button><button type="button" data-v="0" class="${val.rating === 0 ? 'on' : ''}">🙂 Fine</button><button type="button" data-v="-1" class="${val.rating === -1 ? 'on' : ''}">😕 Not again</button></div></div>
    <div class="two">
      <label class="field"><span>Price</span><input type="number" id="fPrice" inputmode="decimal" step="0.01" value="${esc(v('price') ?? '')}" min="0"></label>
      <label class="field"><span>Note</span><input type="text" id="fNote" value="${esc(v('note') || '')}" maxlength="300"></label>
    </div>
    ${pre.ai ? '<div class="muted small" style="margin:-4px 0 10px">Filled in by AI from the photo; calories are a rough guess. Fix anything that\'s off.</div>' : ''}
    <div class="btn-row"><button class="btn primary" id="fSave">Save</button>${meal ? '<button class="btn ghost" id="fDel">Delete</button>' : ''}</div>`);
  const alive = dialogAlive();
  if (meal) ensurePhotos();
  const single = (id, key, num) => $$(`#${id} [data-v]`).forEach(b => b.onclick = () => {
    const on = !b.classList.contains('on') || id !== 'fRate';
    $$(`#${id} [data-v]`).forEach(x => x.classList.remove('on'));
    if (on) b.classList.add('on');
    val[key] = on ? (num ? Number(b.dataset.v) : b.dataset.v) : '';
    if (id === 'fSource') placeRow();
  });
  const placeRow = () => { $('#fPlace').closest('label').style.opacity = val.source === 'homemade' ? '.55' : '1'; };
  single('fMeal', 'meal'); single('fSource', 'source'); single('fRate', 'rating', true);
  placeRow();
  $$('#fTags [data-v]').forEach(b => b.onclick = () => { b.classList.toggle('on'); val.tags = $$('#fTags [data-v].on').map(x => x.dataset.v); });
  $$('#fWho [data-p]').forEach(b => b.onclick = () => { b.classList.toggle('on'); val.people = $$('#fWho [data-p].on').map(x => x.dataset.p); });
  let newPhoto = null;
  $('#fNewPhoto')?.addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try { newPhoto = await shrinkImage(file, PHOTO_MAX); toast('Photo will be saved with the meal.'); } catch (err) { fail(err); }
  });
  // a receipt added here is read right away: place, price, date and time fill in (what you typed stays)
  $('#fNewRcpt')?.addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    const lab = e.target.closest('label');
    try {
      draft.receipt = await shrinkImage(file, RECEIPT_MAX, 0.8);
      lab.lastChild.textContent = ' Reading the receipt…';
      const r = await api('meals.analyze', { receipt: { data: draft.receipt.data, mime: draft.receipt.mime }, hint: 'Meal: ' + ($('#fName').value.trim() || m.name || ''), people: val.people }, { timeoutMs: 90000 });
      if (!alive()) return;
      if (r.place && !$('#fPlace').value.trim()) $('#fPlace').value = r.place;
      if (r.price) $('#fPrice').value = r.price;
      if (r.place && val.source === 'homemade') { $$('#fSource [data-v]').forEach(x => x.classList.toggle('on', x.dataset.v === 'restaurant')); val.source = 'restaurant'; placeRow(); }
      if (r.date && r.date !== todayStr()) $('#fDate').value = r.date;
      if (r.time && !$('#fTime').value) $('#fTime').value = r.time;
      lab.lastChild.textContent = ' Receipt added ✓';
    } catch (err) { if (alive()) lab.lastChild.textContent = ' Receipt added (couldn\'t read it)'; console.warn(err); }
  });
  $('#fSave').onclick = e => busy(e.currentTarget, async () => {
    const name = $('#fName').value.trim();
    if (!name) throw new Error('Give it a name.');
    const photo = newPhoto || draft.photo;
    const saved = await api('meals.save', {
      id: meal?.id, name, meal: val.meal, source: val.source, place: $('#fPlace').value.trim(), cuisine: $('#fCuisine').value.trim(),
      date: $('#fDate').value || todayStr(), time: $('#fTime').value, people: val.people.length ? val.people : [myPersonId()],
      calories: $('#fKcal').value, protein_g: $('#fProt').value, price: $('#fPrice').value, ingredients: $('#fIng').value,
      tags: val.tags, rating: val.rating, note: $('#fNote').value.trim(), ai: !!pre.ai, status: '',
      photo: photo ? { data: photo.data, mime: photo.mime } : undefined,
      receipt: draft.receipt ? { data: draft.receipt.data, mime: draft.receipt.mime } : undefined
    }, { timeoutMs: 60000 });
    if (photo && saved.photo_id) { memSet(saved.photo_id, photo.url); idbPut(saved.photo_id, photo.url); }
    if (draft.receipt && saved.receipt_id) { memSet(saved.receipt_id, draft.receipt.url); idbPut(saved.receipt_id, draft.receipt.url); }
    if (alive()) closeModal();
    upsertMeal(saved);
    toast(meal && !wasPlanned ? 'Saved.' : `Logged ${mealLabel(saved.meal).toLowerCase()}.`);
  }).catch(fail);
  $('#fDel')?.addEventListener('click', e => {
    if (!confirm(`Delete "${m.name}"?`)) return;
    busy(e.currentTarget, async () => { await api('meals.delete', { id: m.id }); if (alive()) closeModal(); upsertMeal(m, true); }).catch(fail);
  });
}

// --- Recipes: from TheMealDB (quiz dishes and matching ideas) or written by the AI for "cook at home" ideas ---
async function openRecipe(q) {
  const had = document.getElementById('recipeSheet');
  had?.remove();
  const el = document.createElement('div');
  el.id = 'recipeSheet'; el.className = 'recipe-sheet';
  el.innerHTML = `<div class="recipe-card" role="dialog" aria-modal="true" aria-label="Recipe"><button type="button" class="recipe-x" aria-label="Close">✕</button>
    <div class="guess-wait"><span class="spinner"></span><div class="muted small">${q.dish_id ? 'Getting the recipe…' : 'Writing a recipe…'}</div></div></div>`;
  document.body.appendChild(el);
  if (!had) pushLayer('hbRecipe');
  const close = () => { if (!el.isConnected) return; el.remove(); popLayer('hbRecipe'); };
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.recipe-x')) close(); });
  try { $('.recipe-x', el).focus({ preventScroll: true }); } catch { /* fine */ }
  try {
    const r = await api('recipe.get', q, { timeoutMs: 90000 });
    if (!el.isConnected) return;
    const ing = Array.isArray(r?.ingredients) ? r.ingredients : [], steps = Array.isArray(r?.steps) ? r.steps : [];
    const meta = [r.area, r.category, r.time, r.servings ? `serves ${r.servings}` : ''].filter(Boolean).join(' · ');
    el.querySelector('.recipe-card').innerHTML = `<button type="button" class="recipe-x" aria-label="Close">✕</button>
      ${r.thumb ? `<img class="recipe-img" alt="" src="${esc(r.thumb + '/medium')}">` : ''}
      <h3>${esc(r.name || q.title || 'Recipe')}</h3>${meta ? `<div class="muted small">${esc(meta)}</div>` : ''}
      <div class="section-title" style="margin-left:0">Ingredients<span>${ing.length}</span></div>
      <ul class="recipe-ing">${ing.map(x => `<li><b>${esc(x?.amount || '')}</b> ${esc(x?.item ?? x)}</li>`).join('')}</ul>
      <div class="section-title" style="margin-left:0">Steps</div>
      <ol class="recipe-steps">${steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      ${r.tips ? `<p class="tips">${esc(r.tips)}</p>` : ''}
      <div class="recipe-links">${r.youtube ? `<a href="${esc(r.youtube)}" target="_blank" rel="noopener">▶ Video</a>` : ''}${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">Original recipe</a>` : ''}</div>
      <div class="muted tiny" style="text-align:left">${r.source === 'ai' ? 'Written by AI for your household. Double-check allergies and cooking times.' : 'Recipe and photo: <a href="https://www.themealdb.com" target="_blank" rel="noopener">TheMealDB</a>'}</div>`;
    const img = $('.recipe-img', el);
    if (img) fallbackImg(img, r.thumb);
  } catch (e) { close(); fail(e); }
}
// If the smaller picture is missing, show the full-size one (set here, not in an inline handler).
function fallbackImg(img, full) {
  img.onerror = () => { img.onerror = null; if (full) img.src = full; };
}

// --- Taste quiz: rate dish photos (from TheMealDB) so ideas fit from day one ---
// Answers wait on the phone (also across restarts) until the backend has them.
const TASTE_KEY = 'homebase.tasteQueue';
const tasteQueue = (() => { try { const l = JSON.parse(localStorage.getItem(TASTE_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
const tasteSending = [];
let tasteTimer = null;
function tasteKeep() {
  try {
    const all = tasteSending.concat(tasteQueue);
    if (all.length) localStorage.setItem(TASTE_KEY, JSON.stringify(all.slice(-300))); else localStorage.removeItem(TASTE_KEY);
  } catch { /* storage full: they stay in memory */ }
}
// Sends what is waiting. Resolves true when everything was saved (failed ones go back in the queue and retry later).
function tasteFlush() {
  clearTimeout(tasteTimer); tasteTimer = null;
  if (!tasteQueue.length || !isConfigured()) return Promise.resolve(!tasteQueue.length);
  const batch = tasteQueue.splice(0);
  tasteSending.push(...batch); tasteKeep();
  const byPerson = {};
  batch.forEach(x => { (byPerson[x.person] = byPerson[x.person] || []).push(x); });
  return Promise.all(Object.entries(byPerson).map(([person, items]) => api('taste.save', { person, answers: items.map(x => x.a) })
    .then(r => { if (r?.counts) { state.taste = r.counts; saveCache(); } return true; })
    .catch(e => { console.warn(e); tasteQueue.unshift(...items); return false; })))
    .then(oks => {
      batch.forEach(x => { const i = tasteSending.indexOf(x); if (i >= 0) tasteSending.splice(i, 1); });
      tasteKeep();
      const ok = oks.every(Boolean);
      if (!ok) tasteTimer = setTimeout(tasteFlush, 60000);
      return ok;
    });
}
const thumbUrl = (u, size) => (u ? u + '/' + size : '');
// First a quick setup (whose taste, which cuisines, spice), then 30 dishes; "20 more" at the end.
const AREA_FLAG = { American: '🇺🇸', British: '🇬🇧', Canadian: '🇨🇦', Chinese: '🇨🇳', Croatian: '🇭🇷', Dutch: '🇳🇱', Egyptian: '🇪🇬', Filipino: '🇵🇭', French: '🇫🇷', Greek: '🇬🇷', Indian: '🇮🇳', Irish: '🇮🇪', Italian: '🇮🇹', Jamaican: '🇯🇲', Japanese: '🇯🇵', Kenyan: '🇰🇪', Malaysian: '🇲🇾', Mexican: '🇲🇽', Moroccan: '🇲🇦', Polish: '🇵🇱', Portuguese: '🇵🇹', Russian: '🇷🇺', Spanish: '🇪🇸', Thai: '🇹🇭', Tunisian: '🇹🇳', Turkish: '🇹🇷', Ukrainian: '🇺🇦', Uruguayan: '🇺🇾', Vietnamese: '🇻🇳', Korean: '🇰🇷', Australian: '🇦🇺', Argentinian: '🇦🇷', Norwegian: '🇳🇴', Saudi: '🇸🇦', Slovakian: '🇸🇰', Syrian: '🇸🇾', Venezulan: '🇻🇪', Algerian: '🇩🇿' };
const SPICE = [['mild', '🙂 Not spicy'], ['mix', '🌶️ A little is fine'], ['spicy', '🔥 Love spicy']];
async function openTasteQuiz(person) {
  const ps = people();
  openModal(`<h3>Taste quiz</h3><div class="guess-wait"><span class="spinner"></span><div class="muted small">Getting the dish list… (the very first time takes about 10 seconds)</div></div>`);
  const waiting = dialogAlive();
  let st;
  try { st = await api('taste.setup', { person }, { timeoutMs: 60000 }); }
  catch (e) { if (waiting()) closeModal(); return fail(e); }
  if (!waiting()) return;
  const chosen = new Set(st.chosen || []);
  let spice = st.spice || 'mix';
  const who = personName(person);
  openModal(`<h3>Taste quiz</h3>
    ${ps.length > 1 ? `<div class="field"><span>Whose taste?</span><div class="fchips" id="qsWho">${ps.map(p => `<button type="button" data-p="${esc(p.id)}" class="${p.id === person ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
    <div class="field"><span>Which cuisines ${person === myPersonId() ? 'do you' : 'does ' + esc(who)} eat? <span class="muted">(none picked = all)</span></span>
      <div class="fchips wrap" id="qsAreas">${(st.areas || []).map(a => `<button type="button" data-a="${esc(a.area)}" class="${chosen.has(a.area) ? 'on' : ''}">${AREA_FLAG[a.area] || ''} ${esc(a.area)}</button>`).join('')}</div></div>
    <div class="field"><span>Spice</span><div class="seg" id="qsSpice">${SPICE.map(([k, l]) => `<button type="button" data-v="${k}" class="${spice === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    ${st.kid ? `<div class="muted small" style="margin:-4px 0 12px">For a child, kid-friendly dishes come first.</div>` : ''}
    <button class="btn primary block" id="qsGo">Start (30 dishes)</button>`);
  $$('#qsWho [data-p]').forEach(b => b.onclick = () => { if (b.dataset.p !== person) openTasteQuiz(b.dataset.p); });
  $$('#qsAreas [data-a]').forEach(b => b.onclick = () => { b.classList.toggle('on'); if (b.classList.contains('on')) chosen.add(b.dataset.a); else chosen.delete(b.dataset.a); });
  $$('#qsSpice [data-v]').forEach(b => b.onclick = () => { $$('#qsSpice [data-v]').forEach(x => x.classList.remove('on')); b.classList.add('on'); spice = b.dataset.v; });
  $('#qsGo').onclick = () => runTasteQuiz(person, [...chosen], spice, 30);
}

async function runTasteQuiz(person, areas, spice, size) {
  const ps = people();
  openModal(`<h3>Taste quiz</h3><div class="guess-wait"><span class="spinner"></span><div class="muted small">Picking dishes…</div></div>`);
  const waiting = dialogAlive();
  let r;
  try { r = await api('taste.deck', { person, areas, spice, size }, { timeoutMs: 60000 }); }
  catch (e) { if (waiting()) closeModal(); return fail(e); }
  if (!waiting()) return;
  const deck = r.deck || [];
  let i = 0, rated = 0;
  const pre = new Set();
  const preload = () => deck.slice(i + 1, i + 4).forEach(m => { if (!pre.has(m.id)) { pre.add(m.id); const im = new Image(); im.src = thumbUrl(m.thumb, 'medium'); } });
  const paint = () => {
    const m = deck[i];
    if (!m) {
      tasteFlush().then(() => { if (location.hash === '#food' && $('#modal').hidden) paintFood(); });
      openModal(`<h3>All done${rated ? '!' : ''}</h3><div class="muted" style="margin-bottom:14px">${rated ? `Thanks! ${rated} dish${rated > 1 ? 'es' : ''} rated. Food ideas now use this taste.` : 'Nothing new to rate with these cuisines. Pick more cuisines to see other dishes.'}</div>
        ${deck.length ? '<button class="btn block" id="qzMore" style="margin-bottom:8px">Rate 20 more</button>' : ''}
        <button class="btn primary block" id="qzOk">Back to Food</button>`);
      $('#qzMore')?.addEventListener('click', () => tasteFlush().then(() => runTasteQuiz(person, areas, spice, 20)));
      $('#qzOk').onclick = () => { closeModal(); if (location.hash === '#food') paintFood(); };
      return;
    }
    openModal(`<div class="quiz-top">${ps.length > 1 ? `<div class="fchips" id="qzWho">${ps.map(p => `<button type="button" data-p="${esc(p.id)}" class="${p.id === person ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>` : '<h3 style="margin:0">Taste quiz</h3>'}
        <span class="muted small">${i + 1} / ${deck.length}</span></div>
      <div class="progress quiz-prog"><i style="width:${Math.round(100 * i / deck.length)}%"></i></div>
      <div class="quiz-card" id="qzCard">
        <img class="quiz-img" alt="" src="${esc(thumbUrl(m.thumb, 'medium'))}">
        <div class="quiz-name">${esc(m.name)}</div>
        <div class="muted small">${esc([m.area, m.category].filter(Boolean).join(' · '))}</div>
      </div>
      <div style="text-align:center"><button type="button" class="linkish" id="qzRecipe">📖 Recipe</button></div>
      <div class="quiz-btns">
        <button type="button" class="btn" data-a="-1"><span>🙅</span>Not for me</button>
        <button type="button" class="btn" data-a="0"><span>🙂</span>It's OK</button>
        <button type="button" class="btn primary" data-a="1"><span>😍</span>Love it</button>
      </div>
      <div class="quiz-foot"><button type="button" class="linkish" id="qzSkip">Skip</button><button type="button" class="linkish" id="qzDone">Done for now</button></div>
      <div class="muted tiny">Dishes and photos: <a href="https://www.themealdb.com" target="_blank" rel="noopener">TheMealDB</a></div>`);
    const img = $('.quiz-img');
    img.onerror = () => { if (!img.dataset.full) { img.dataset.full = '1'; img.src = m.thumb; } };
    preload();
    const answer = v => {
      tasteQueue.push({ person, a: { dish_id: m.id, name: m.name, area: m.area, category: m.category, answer: v } });
      tasteKeep();
      rated++;
      clearTimeout(tasteTimer); tasteTimer = setTimeout(tasteFlush, tasteQueue.length >= 10 ? 0 : 1500);
      i++; paint();
    };
    $$('.quiz-btns [data-a]').forEach(b => b.onclick = () => answer(Number(b.dataset.a)));
    $('#qzSkip').onclick = () => { i++; paint(); };
    $('#qzRecipe').onclick = () => openRecipe({ dish_id: m.id });
    $('#qzDone').onclick = () => {
      closeModal();
      if (!rated && !tasteQueue.length) return toast('See you next time.');
      tasteFlush().then(ok => {
        toast(ok ? `Saved ${rated} answer${rated === 1 ? '' : 's'}.` : "Couldn't save your answers yet. They're kept on this phone and sent again later.", !ok);
        if (location.hash === '#food' && $('#modal').hidden) paintFood();
      });
    };
    $$('#qzWho [data-p]').forEach(b => b.onclick = () => { if (b.dataset.p !== person) { tasteFlush(); openTasteQuiz(b.dataset.p); } });
    // swipe the card: right = love it, left = not for me
    const card = $('#qzCard');
    let x0 = null;
    card.addEventListener('pointerdown', e => { x0 = e.clientX; card.setPointerCapture?.(e.pointerId); });
    card.addEventListener('pointermove', e => { if (x0 !== null) card.style.transform = `translateX(${e.clientX - x0}px) rotate(${(e.clientX - x0) / 30}deg)`; });
    const end = e => {
      if (x0 === null) return;
      const dx = e.clientX - x0; x0 = null; card.style.transform = '';
      if (dx > 90) answer(1); else if (dx < -90) answer(-1);
    };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', () => { x0 = null; card.style.transform = ''; });
  };
  paint();
}

// --- "Guess what I want to eat": a few questions, then three ideas ---
function openGuess(prev) {
  const ps = people();
  let saved = {};
  try { saved = JSON.parse(lsGet('homebase.guess', '{}')) || {}; } catch { saved = {}; }
  const a = prev || { people: [myPersonId()], where: saved.where || '', meal: mealByTime(), effort: saved.effort || 'normal', mood: 'mix', needs: [], note: '' };
  openModal(`<h3>What are you in the mood for?</h3>
    ${ps.length > 1 ? `<div class="field"><span>Who's eating?</span><div class="fchips" id="gWho">${ps.map(p => `<button type="button" data-p="${esc(p.id)}" class="${a.people.includes(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
    <div class="field"><span>Where?</span><div class="where-grid" id="gWhere">${WHERE.map(([k, i, l]) => `<button type="button" data-v="${k}" class="${a.where === k ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('')}</div></div>
    <div class="field"><span>Which meal?</span><div class="fchips wrap" id="gMeal">${MEALS.filter(x => x[0] !== 'drink').map(([k, l, i]) => `<button type="button" data-v="${k}" class="${a.meal === k ? 'on' : ''}">${i} ${l}</button>`).join('')}</div></div>
    <div class="field"><span>In the mood for</span><div class="seg" id="gMood">${MOODS.map(([k, l]) => `<button type="button" data-v="${k}" class="${a.mood === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field" id="gEffortF"><span>How much effort?</span><div class="seg" id="gEffort">${EFFORT.map(([k, l]) => `<button type="button" data-v="${k}" class="${a.effort === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field"><span>Anything going on? <span class="muted">(pick any)</span></span><div class="fchips wrap" id="gNeeds">${NEEDS.map(([k, l]) => `<button type="button" data-v="${esc(k)}" class="${a.needs.includes(k) ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <label class="field"><span>Anything else? <span class="muted">(optional)</span></span><input type="text" id="gNote" value="${esc(a.note)}" maxlength="200" placeholder="e.g. have chicken and rice; nothing too spicy"></label>
    <button class="btn primary block" id="gGo">Guess!</button>`);
  const effortShow = () => { $('#gEffortF').hidden = !(a.where === 'home' || a.where === 'any' || !a.where); };
  const one = (id, key) => $$(`#${id} [data-v]`).forEach(b => b.onclick = () => {
    $$(`#${id} [data-v]`).forEach(x => x.classList.remove('on')); b.classList.add('on'); a[key] = b.dataset.v; effortShow();
  });
  one('gWhere', 'where'); one('gMeal', 'meal'); one('gEffort', 'effort'); one('gMood', 'mood');
  effortShow();
  $$('#gNeeds [data-v]').forEach(b => b.onclick = () => { b.classList.toggle('on'); a.needs = $$('#gNeeds [data-v].on').map(x => x.dataset.v); });
  $$('#gWho [data-p]').forEach(b => b.onclick = () => { b.classList.toggle('on'); a.people = $$('#gWho [data-p].on').map(x => x.dataset.p); });
  $('#gGo').onclick = () => {
    a.note = $('#gNote').value.trim();
    if (!a.where) return toast('Home, out, takeout, or surprise you?', true);
    if (!a.people.length) a.people = [myPersonId()];
    lsSet('homebase.guess', JSON.stringify({ where: a.where, effort: a.effort }));
    runGuess(a, []);
  };
}

async function runGuess(a, seen) {
  openModal(`<h3>Thinking…</h3><div class="guess-wait"><span class="spinner"></span><div class="muted small">Looking at what you've been eating${a.needs.length ? ' and ' + esc(a.needs.join(', ')) : ''}.</div></div>`);
  const waiting = dialogAlive();
  let r;
  try {
    r = await api('meals.recommend', { people: a.people, where: a.where, meal: a.meal, effort: a.where === 'home' || a.where === 'any' ? a.effort : '', mood: a.mood || 'mix', needs: a.needs, note: a.note, exclude: seen }, { timeoutMs: 90000 });
  } catch (e) { if (waiting()) closeModal(); return fail(e); }
  if (!waiting()) return;   // closed or replaced while waiting
  const ideas = r.ideas || [];
  const whereIcon = w => (WHERE.find(x => x[0] === w) || WHERE[0])[1];
  const whereText = x => x.where === 'home' ? 'Cook at home' : (x.place ? x.place : x.where === 'takeout' ? 'Takeout' : 'Eat out') + (x.cuisine ? ' · ' + x.cuisine : '');
  openModal(`<h3>How about…</h3>
    ${r.intro ? `<div class="muted small" style="margin:-4px 0 10px">${esc(r.intro)}</div>` : ''}
    ${ideas.map((x, i) => `<div class="idea">
      ${x.kind ? `<span class="idea-kind k-${esc(x.kind)}">${KIND_LABEL[x.kind] || ''}</span>` : ''}
      <div class="idea-head">${x.last?.photo_id ? `<span class="ph idea-ph" data-photo="${esc(x.last.photo_id)}"><span class="ph-i">${whereIcon(x.where)}</span></span>`
        : x.photo_url ? `<img class="idea-ph" alt="" loading="lazy" src="${esc(x.photo_url + '/small')}" data-full="${esc(x.photo_url)}">`
        : `<span class="idea-i">${whereIcon(x.where)}</span>`}<div class="grow"><b>${esc(x.title)}</b><div class="muted small">${esc(whereText(x))}${x.est_calories ? ` · ~${x.est_calories} kcal` : ''}</div></div></div>
      <div class="idea-why">${esc(x.why)}</div>
      ${x.how ? `<div class="small idea-how">${esc(x.how)}</div>` : ''}
      ${x.ingredients?.length ? `<div class="small muted">Need: ${esc(x.ingredients.join(', '))}</div>` : ''}
      ${x.last ? `<div class="idea-last small">Last time: ${esc(x.last.name)}${x.last.place ? ' at ' + esc(x.last.place) : ''} · ${esc(rel(x.last.date))}${x.last.price ? ' · $' + esc(Number(x.last.price).toFixed(2)) : ''}${x.last.rating === 1 ? ' · ♥' : ''}
        ${x.last.receipt_id ? `<button type="button" class="linkish rc-btn" data-rc="${esc(x.last.receipt_id)}">🧾 Receipt</button>` : ''}</div>` : ''}
      ${x.photo_url && x.photo_of ? `<div class="tiny" style="text-align:left">Photo: ${esc(x.photo_of)} · TheMealDB</div>` : ''}
      <div class="btn-row idea-btns"><button type="button" class="btn small" data-pick="${i}">I'll have this</button>
        ${x.dish_id || x.where === 'home' ? `<button type="button" class="btn small ghost" data-recipe="${i}">📖 Recipe</button>` : ''}</div>
    </div>`).join('') || '<div class="muted">No ideas came back. Try again.</div>'}
    <div class="btn-row" style="margin-top:6px"><button class="btn" id="gMore">Other ideas</button><button class="btn ghost" id="gBack">Change answers</button></div>`);
  const shown = dialogAlive();
  ensurePhotos();
  $$('img.idea-ph[data-full]').forEach(img => fallbackImg(img, img.dataset.full));
  $$('[data-rc]').forEach(b => b.onclick = () => {
    const box = b.closest('.idea');
    const open = box.querySelector('.rc-view');
    if (open) { open.remove(); return; }
    box.insertAdjacentHTML('beforeend', `<span class="ph rc-view" data-photo="${esc(b.dataset.rc)}"><span class="ph-i">🧾</span></span>`);
    ensurePhotos();
  });
  $$('[data-recipe]').forEach(b => b.onclick = () => {
    const x = ideas[+b.dataset.recipe];
    openRecipe(x.dish_id ? { dish_id: x.dish_id } : { title: x.title, cuisine: x.cuisine, ingredients: x.ingredients, people: r.people || a.people });
  });
  $$('[data-pick]').forEach(b => b.onclick = () => busy(b, async () => {
    const x = ideas[+b.dataset.pick];
    const saved = await api('meals.save', { name: x.title, meal: r.meal || a.meal, source: x.where === 'home' ? 'homemade' : x.where === 'takeout' ? 'takeout' : 'restaurant',
      place: x.place, cuisine: x.cuisine, ingredients: x.ingredients, tags: x.tags, calories: x.est_calories, people: r.people || a.people,
      date: todayStr(), time: '', status: 'planned', ai: true });
    upsertMeal(saved);
    toast('Saved under "Up next". Tap ✓ Ate it when you\'ve had it.');
    if (!shown()) return;
    closeModal();
    if (location.hash !== '#food') location.hash = '#food';
  }).catch(fail));
  $('#gMore').onclick = () => runGuess(a, [...seen, ...ideas.map(x => x.title)].slice(-12));
  $('#gBack').onclick = () => openGuess(a);
}

// ================= HOME: quick box =================
// Type or say what happened. If the assistant saved something and has no question, a short confirmation
// (with Undo) shows right here; questions and conversations continue in the Chat tab.
let quickEl = null, quickShare = null, quickTimer = null;
function quickBox() {
  if (quickEl) return quickEl;
  quickEl = document.createElement('div');
  quickEl.className = 'card quick';
  quickEl.innerHTML = `<form id="qForm" class="qform">
      <textarea id="qIn" rows="2" placeholder="Tell me what happened or ask anything…" autocomplete="off"></textarea>
      <div class="qbar">
        <button type="button" class="attach" id="qAttach" aria-label="Add a photo or screenshot">${ICON_CLIP}</button><input type="file" id="qFile" accept="image/*" hidden>
        ${SR ? `<button type="button" class="attach mic" id="qMic" aria-label="Speak (turns speech into text)">${ICON_MIC}</button>` : ''}
        <span class="grow muted small" id="qHint"></span>
        <button class="btn primary" id="qSend">Send</button>
      </div></form>
    <div class="spk-row" hidden></div>
    <div id="qChip" class="share-chip" hidden></div>
    <div id="qResult"></div>`;
  const ta = $('#qIn', quickEl);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); quickSend(); } });
  $('#qForm', quickEl).addEventListener('submit', e => { e.preventDefault(); quickSend(); });
  $('#qAttach', quickEl).onclick = () => $('#qFile', quickEl).click();
  $('#qFile', quickEl).onchange = async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try { quickShare = { image: await shareImage(f) }; paintQuickChip(); } catch (err) { fail(err); }
    e.target.value = '';
  };
  $('#qMic', quickEl)?.addEventListener('click', e => dictate(ta, e.currentTarget, () => { grow(); quickSend(); }));
  return quickEl;
}
function paintQuickChip() {
  const chip = $('#qChip', quickEl);
  chip.hidden = !quickShare;
  if (!quickShare) return;
  chip.innerHTML = `${quickShare.image ? `<img src="${quickShare.image.url}" alt="">` : ''}<span class="grow">${esc((quickShare.text || 'Photo').slice(0, 120))}</span><button type="button" class="x" aria-label="Remove">✕</button>`;
  $('.x', chip).onclick = () => { quickShare = null; paintQuickChip(); };
}
async function quickSend() {
  const ta = $('#qIn', quickEl), res = $('#qResult', quickEl), btn = $('#qSend', quickEl);
  const text = ta.value.trim() || (quickShare ? SHARE_PROMPT : '');
  if (!text || btn.disabled) return;
  const tm = { stop: Date.now() };
  const sh = quickShare;
  quickShare = null; paintQuickChip();
  ta.value = ''; ta.style.height = 'auto';
  clearTimeout(quickTimer);
  res.innerHTML = '<div class="logged working"><span class="spinner sm"></span> On it…</div>';
  btn.disabled = true;
  const shown = sh ? text + '\n📎 ' + (sh.image ? 'photo' : (sh.text || '').slice(0, 80)) : text;
  chatInflight++;
  markUse();
  try {
    const shared = sh ? { title: sh.title || '', text: (sh.text || '').slice(0, 6000), url: sh.url || '', image: sh.image ? { data: sh.image.data, mime: sh.image.mime } : null } : undefined;
    tm.sent = Date.now();
    const r = await api('chat.send', { message: text, shared, mode: 'quick', speaker: speakerFor(text) }, { timeoutMs: 120000 });
    tm.reply = Date.now();
    noteTiming(r.timing); notePhoneTiming('chat', tm);
    state.chat = state.chat || [];
    state.chat.push({ role: 'user', content: shown }, { role: 'assistant', content: r.reply, charts: r.charts?.length ? r.charts : undefined });
    saveCache();
    invalidate((r.actions || []).length ? 1500 : 12000);   // what changed shows on Today a moment later
    if ((r.actions || []).length && !r.asked && !r.charts?.length) showLogged(r);
    else { res.innerHTML = ''; location.hash = '#chat'; }
  } catch (e) {
    ta.value = text === SHARE_PROMPT && sh ? '' : text; res.innerHTML = '';
    if (sh) { quickShare = sh; paintQuickChip(); }          // the photo stays attached for another try
    fail(e);
  } finally { btn.disabled = false; chatInflight--; }
}
function showLogged(r) {
  const res = $('#qResult', quickEl);
  const undos = r.actions.map(a => a.undo).filter(Boolean);
  res.innerHTML = `<div class="logged">
      ${r.actions.map(a => `<div class="lg-line">✓ ${esc(a.label)}</div>`).join('')}
      <div class="btn-row" style="margin-top:6px">${undos.length ? '<button type="button" class="btn small" id="qUndo">Undo</button>' : ''}<button type="button" class="btn small ghost" id="qOpen">Open in chat</button></div>
    </div>`;
  const fade = () => { const el = $('.logged', res); if (!el) return; el.classList.add('fade'); setTimeout(() => { if (el.isConnected) el.remove(); }, 450); };
  quickTimer = setTimeout(fade, 8000);
  $('#qOpen', res).onclick = () => { clearTimeout(quickTimer); res.innerHTML = ''; location.hash = '#chat'; };
  $('#qUndo', res)?.addEventListener('click', e => {
    clearTimeout(quickTimer);
    busy(e.currentTarget, async () => {
      for (const k of undos) await api('undo', { key: k });
      state.chat?.push({ role: 'assistant', content: '↩︎ Undone.' }); saveCache();
      res.innerHTML = '<div class="logged">↩︎ Undone.</div>';
      quickTimer = setTimeout(fade, 3000);
      invalidate(1500);
    }).catch(fail);
  });
}

// Settings card: how this phone listens and reads replies aloud (saved on this phone only).
const CHIRP_FEMALE = ['Aoede', 'Kore', 'Leda', 'Zephyr', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome', 'Laomedeia', 'Sulafat', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix'];
const CHIRP_MALE = ['Puck', 'Charon', 'Fenrir', 'Orus', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Enceladus', 'Iapetus', 'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Umbriel', 'Zubenelgenubi'];
const assistantName = () => lsGet('homebase.assistant', 'Bella') || 'Bella';
// The natural (Chirp) voice picked on this phone, or null for the phone's own voice.
function chirpVoice() {
  const v = lsGet('homebase.chirpVoice', 'Aoede');
  if (v === 'phone' || chirpOff || lsGet('homebase.voiceReady', '') === '0') return null;
  return CHIRP_FEMALE.includes(v) || CHIRP_MALE.includes(v) ? v : 'Aoede';
}
function voiceCardHtml() {
  const cur = lsGet('homebase.voiceLang', '');
  const rate = Number(lsGet('homebase.voiceRate', '1')) || 1;
  const pick = lsGet('homebase.chirpVoice', 'Aoede');
  const opt = v => `<option value="${v}" ${pick === v ? 'selected' : ''}>${v}</option>`;
  const nm = esc(assistantName());
  return `<div class="card" id="voiceCard">
      <h2>Voice (this phone)</h2>
      <label class="field"><span>I speak</span><select id="sVoiceLang">${VOICE_LANGS.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>${nm}'s voice</span><select id="sChirp">
        <optgroup label="Natural voice · female">${CHIRP_FEMALE.map(opt).join('')}</optgroup>
        <optgroup label="Natural voice · male">${CHIRP_MALE.map(opt).join('')}</optgroup>
        <option value="phone" ${pick === 'phone' ? 'selected' : ''}>Phone voice (offline)</option></select></label>
      <div class="muted small" id="sChirpNote" style="margin:-4px 0 12px"></div>
      <label class="field"><span>Phone voice (used when the natural voice isn't available)</span><select id="sVoiceName"></select></label>
      <label class="field"><span>Speed <b id="sRateVal">${rate.toFixed(1)}×</b></span><input type="range" id="sVoiceRate" min="0.7" max="1.5" step="0.1" value="${rate}"></label>
      <label class="field check-field row-field"><input type="checkbox" id="sTalkOpen" ${lsGet('homebase.talkOnOpen', '1') === '1' ? 'checked' : ''}><span>Start talking to ${nm} when I open Homebase <span class="muted small">(for “Hey Google, open Homebase”; not when a notification opens it)</span></span></label>
      <div class="row"><button type="button" class="btn small" id="sVoiceTest">▶ Test</button><button type="button" class="btn small" id="sTalkNow">🎙 Talk to ${nm}</button></div>
    </div>`;
}
const langFamily = l => String(l || '').replace('_', '-').slice(0, 2).toLowerCase();
function allVoices() {
  try { return ('speechSynthesis' in window ? speechSynthesis.getVoices() : []) || []; } catch { return []; }
}
function voiceLabel(v) {
  return `${v.name.replace(/\s*\((?:[^)]*)\)\s*$/, '')} · ${String(v.lang).replace('_', '-')} · ${v.localService === false ? 'online' : 'on phone'}`;
}
// The phone voice to read with: your pick for that language, else one on the phone itself (starts at once, works
// offline), else any match.
function pickVoice(lang) {
  const fam = langFamily(lang), vs = allVoices();
  if (!vs.length) return null;
  const saved = lsGet('homebase.voiceName.' + fam, '');
  const norm = l => String(l || '').replace('_', '-').toLowerCase();
  const exact = vs.filter(v => norm(v.lang) === norm(lang)), fams = vs.filter(v => langFamily(v.lang) === fam);
  const local = v => v.localService !== false;
  return (saved && vs.find(v => v.name === saved && langFamily(v.lang) === fam))
    || exact.find(v => local(v) && v.default) || exact.find(local) || exact.find(v => v.default) || exact[0]
    || fams.find(local) || fams[0] || null;
}
function sampleLine(lang) {
  const n = assistantName();
  return langFamily(lang) === 'zh' ? (lang === 'zh-HK' ? `你好，我係${n}。今日記得帶遮。` : `你好，我是${n}。今天记得带伞。`)
    : `Hi, I'm ${n}. Don't forget your umbrella today.`;
}
function bindVoiceCard() {
  const sel = $('#sVoiceName'); if (!sel) return;
  const fill = () => {
    const lang = voiceLang(), fam = langFamily(lang);
    const vs = allVoices().filter(v => langFamily(v.lang) === fam)
      .sort((a, b) => (a.localService === false ? 0 : 1) - (b.localService === false ? 0 : 1) || a.name.localeCompare(b.name));
    const saved = lsGet('homebase.voiceName.' + fam, '');
    sel.innerHTML = `<option value="">Automatic (best available)</option>` +
      vs.map(v => `<option value="${esc(v.name)}" ${v.name === saved ? 'selected' : ''}>${esc(voiceLabel(v))}</option>`).join('');
    sel.disabled = !vs.length;
    if (!vs.length) sel.innerHTML = `<option value="">${'speechSynthesis' in window ? 'Loading voices…' : 'No voices on this browser'}</option>`;
  };
  fill();
  try { if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (sel.isConnected) fill(); }; } catch { /* old browser */ }
  setTimeout(() => { if (sel.isConnected) fill(); }, 700);
  const note = $('#sChirpNote');
  const paintNote = st => {
    if (!note) return;
    if (!st) { note.textContent = ''; return; }
    if (!st.ready) { note.innerHTML = 'Natural voices need a one-time Google Cloud key (<code>TTS_API_KEY</code>, see the README, “Natural voice”). Until then the phone voice reads.'; return; }
    const pct = st.cap ? Math.min(100, Math.round(st.used / st.cap * 100)) : 100;
    note.textContent = `Natural voice: ${st.used.toLocaleString()} of ${st.cap.toLocaleString()} free characters used this month (${pct}%). After that, the phone voice reads until next month.`;
  };
  voiceStatus().then(paintNote).catch(() => paintNote(null));
  $('#sChirp').addEventListener('change', e => { lsSet('homebase.chirpVoice', e.target.value); speak(sampleLine(voiceLang())); });
  $('#sVoiceLang').addEventListener('change', e => { lsSet('homebase.voiceLang', e.target.value); fill(); toast('Saved on this phone.'); });
  sel.addEventListener('change', () => { lsSet('homebase.voiceName.' + langFamily(voiceLang()), sel.value); speak(sampleLine(voiceLang()), { phone: true }); });
  $('#sVoiceRate').addEventListener('input', e => { lsSet('homebase.voiceRate', e.target.value); $('#sRateVal').textContent = Number(e.target.value).toFixed(1) + '×'; });
  $('#sVoiceRate').addEventListener('change', () => speak(sampleLine(voiceLang())));
  $('#sTalkOpen').addEventListener('change', e => { lsSet('homebase.talkOnOpen', e.target.checked ? '1' : '0'); toast(e.target.checked ? `${assistantName()} will greet you when you open Homebase.` : 'Saved on this phone.'); });
  $('#sTalkNow').onclick = () => openTalk();
  $('#sVoiceTest').onclick = () => speak(sampleLine(voiceLang()));
}

// The natural-voice status, asked once per app start (Settings opens often).
let voiceStatusP = null;
function voiceStatus() {
  if (!voiceStatusP) {
    voiceStatusP = api('voice.status').then(st => {
      lsSet('homebase.voiceReady', st.ready ? '1' : '0');
      if (st.assistant) lsSet('homebase.assistant', st.assistant);
      return st;
    });
    voiceStatusP.catch(() => { voiceStatusP = null; });
  }
  return voiceStatusP;
}

// Settings sections fold up: tap a heading to open it. Open ones are remembered on this phone.
function foldCards(root, openByDefault = []) {
  let open; try { open = JSON.parse(lsGet('homebase.openCards', '[]')) || []; } catch { open = []; }
  root.querySelectorAll(':scope > .card, :scope > div > .card').forEach(card => {
    const h = card.querySelector(':scope > h2');
    if (!h || card.dataset.fold) return;
    const key = h.textContent.trim();
    card.dataset.fold = key;
    card.classList.add('fold-card');
    h.setAttribute('role', 'button'); h.tabIndex = 0;
    const set = on => { card.classList.toggle('collapsed', !on); h.setAttribute('aria-expanded', String(on)); };
    set(open.includes(key) || openByDefault.includes(key));
    const toggle = () => {
      const on = card.classList.contains('collapsed');
      set(on);
      try { open = JSON.parse(lsGet('homebase.openCards', '[]')) || []; } catch { open = []; }
      open = open.filter(k => k !== key); if (on) open.push(key);
      lsSet('homebase.openCards', JSON.stringify(open));
    };
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

// ================= VOICE =================
// Speech → text uses Chrome's speech recognition (audio goes to Google, like keyboard voice typing).
// Replies are read aloud with the natural voice (Google Cloud Chirp, via the backend) or the phone's own voice.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const VOICE_LANGS = [['', 'Same as this phone'], ['en-US', 'English'], ['zh-CN', '中文（普通话）'], ['zh-TW', '中文（台灣）'], ['zh-HK', '粵語']];
function voiceLang() {
  const v = lsGet('homebase.voiceLang', '');
  return v || (navigator.language || 'en-US');
}
let activeRec = null;
const DICTATE_SEND_MS = 2500;   // 🎤 in the chat box / Home box: after you stop talking this long, it sends by itself
/**
 * Speech to text for the chat box and the Home box: the words appear as you speak; 2.5 seconds after you stop, onSend
 * runs (the message goes, no Send button). Tap the mic again to send at once. Typing takes over (no auto-send).
 */
function dictate(textarea, btn, onSend) {
  if (!SR) return toast("Voice input isn't available here. Open Homebase in Chrome, or use the mic on your keyboard.", true);
  if (activeRec) {
    if (activeRec.textarea === textarea) { activeRec.finish(); return; }
    activeRec.abort();                          // the other box stops listening; this one starts
  }
  stopSpeaking();
  const base = textarea.value.trim() ? textarea.value.trim() + ' ' : '';
  let committed = '', live = '', lastHeard = 0, finished = false, rec = null, errors = 0;
  const started = Date.now();
  const text = () => (committed + ' ' + live).replace(/\s+/g, ' ').trim();
  const show = () => { textarea.value = base + text(); textarea.dispatchEvent(new Event('input')); };
  const me = { textarea, finish: () => stopAll(true), abort: () => stopAll(false) };
  const stopAll = send => {
    if (finished) return;
    finished = true; clearInterval(tick);
    textarea.removeEventListener('keydown', onType);
    const r = rec; rec = null;
    if (activeRec === me) activeRec = null;
    try { r?.abort(); } catch { /* fine */ }
    btn.classList.remove('rec');
    if (send && text() && textarea.isConnected) onSend?.();
  };
  const onType = () => stopAll(false);          // you started typing: it's yours to send
  textarea.addEventListener('keydown', onType);
  const begin = () => {
    if (finished) return;
    const r = new SR();
    rec = r;
    r.lang = voiceLang(); r.interimResults = true; r.continuous = false;
    r.onresult = e => {
      if (r !== rec) return;
      let t = '';
      for (const x of e.results) t += x[0].transcript;
      live = t.trim();
      if (live) { lastHeard = Date.now(); show(); }
    };
    r.onerror = e => {
      if (r !== rec) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Allow the microphone for Homebase (Chrome → site settings → Microphone).', true); stopAll(false); }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') errors++;
    };
    r.onend = () => {
      if (r !== rec) return;
      committed = text(); live = '';
      if (finished) return;
      if (errors > 4) { toast('Voice input stopped. Check the connection.', true); return stopAll(false); }
      setTimeout(begin, 80);                    // Chrome stops after each short pause: keep listening
    };
    try { r.start(); } catch { errors++; setTimeout(begin, 400); }
  };
  const tick = setInterval(() => {
    const now = Date.now();
    if (!textarea.isConnected) stopAll(false);                       // the box is gone (another tab)
    else if (lastHeard && text() && now - lastHeard >= DICTATE_SEND_MS) stopAll(true);
    else if (!lastHeard && now - started >= 9000) stopAll(false);   // nothing said
  }, 150);
  activeRec = me;
  btn.classList.add('rec');
  begin();
}
// What is read aloud: no markdown, links by their name, no emoji; cut at a sentence end like the backend's voice.
const SPEECH_MAX = 700;
function plainForSpeech(t) {
  let s = String(t || '').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/\*\*|__|`|#+ /g, '').replace(/^\s*[-*•] /gm, '').replace(/https?:\/\/\S+/g, 'link')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
  if (s.length > SPEECH_MAX) {
    const cut = s.slice(0, SPEECH_MAX);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('。'));
    s = end > 200 ? cut.slice(0, end + 1) : cut;
  }
  return s;
}
// Which Chirp language to ask for: Chinese text → Mandarin (Cantonese if you speak 粵語), else your English variant.
function ttsLang(text) {
  const l = voiceLang();
  if (/[一-鿿]/.test(text)) return l === 'zh-HK' ? 'yue-HK' : 'cmn-CN';
  return /^en-(US|GB|AU|IN)$/.test(l) ? l : 'en-US';
}
const voiceRate = () => Number(lsGet('homebase.voiceRate', '1')) || 1;

// Audio from the backend (base64) plays from a Blob URL (no big data: string); released after playing.
function b64Blob(b64, mime) {
  const bin = atob(b64), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime || 'audio/mpeg' });
}
function audioSrc(b64, mime) {
  try { if (typeof Blob === 'function' && typeof URL.createObjectURL === 'function') return URL.createObjectURL(b64Blob(b64, mime)); } catch { /* below */ }
  return 'data:' + (mime || 'audio/mpeg') + ';base64,' + b64;
}
function dropSrc(u) {
  if (!u || !/^blob:/.test(u)) return;
  for (const k of kept.values()) if (k === u) return;   // kept phrases stay
  try { URL.revokeObjectURL(u); } catch { /* fine */ }
}

// One thing plays at a time. stopSpeaking() ends it (and resolves the say() that started it, even mid-download).
let player = null;            // one <audio> for everything Homebase says (made on first use)
let playing = null;           // {stop()} for what's playing now
let speakSeq = 0;
let stopWaiters = [];
function stopSpeaking() {
  speakSeq++;
  try { speechSynthesis.cancel(); } catch { /* no speech */ }
  const p = playing; playing = null;
  p?.stop();
  const ws = stopWaiters; stopWaiters = [];
  ws.forEach(f => f(null));
}
// Resolves (with null) the next time something stops the speech.
function stopped() { return new Promise(r => stopWaiters.push(r)); }
function playAudio(src) {
  return new Promise(resolve => {
    if (!player && typeof Audio === 'function') { player = new Audio(); player.preload = 'auto'; }
    if (!player) return resolve('error');
    const p = player, tag = {};
    let done = false, began = false, safety = null;
    const end = r => {
      if (done) return;
      done = true; clearTimeout(safety);
      p.onended = p.onerror = p.onpause = p.onplaying = p.onloadedmetadata = null;
      if (playing?.tag === tag) playing = null;
      resolve(r);
    };
    // never stuck "speaking": a safety timer from the clip's length (or 90 s until that is known)
    const arm = ms => { clearTimeout(safety); safety = setTimeout(() => { try { p.pause(); } catch { /* fine */ } end('ok'); }, ms); };
    playing = { tag, stop: () => { end('ok'); try { p.pause(); } catch { /* fine */ } } };
    p.onended = () => end('ok');
    p.onerror = () => end('error');
    p.onplaying = () => { began = true; };
    p.onpause = () => { if (began && !p.ended) end('ok'); };     // Android took the sound (a call, another app)
    p.onloadedmetadata = () => { const d = Number(p.duration); if (isFinite(d) && d > 0) arm(d * 1000 / (p.playbackRate || 1) + 3000); };
    arm(90000);
    p.src = src;
    let pr;
    try { pr = p.play(); } catch { return end('error'); }
    Promise.resolve(pr).then(() => { began = true; }, e => end(e && e.name === 'NotAllowedError' ? 'blocked' : 'error'));
  });
}
function phoneSpeak(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || !text) return resolve('error');
    let done = false, timer = null;
    const tag = {};
    const end = r => { if (done) return; done = true; clearTimeout(timer); if (playing?.tag === tag) playing = null; resolve(r); };
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const zh = /[一-鿿]/.test(text);
      u.lang = zh ? (voiceLang().startsWith('zh') ? voiceLang() : 'zh-CN') : (voiceLang().startsWith('zh') ? 'en-US' : voiceLang());
      const v = pickVoice(u.lang);
      if (v) { u.voice = v; u.lang = String(v.lang).replace('_', '-'); }
      u.rate = voiceRate();
      u.onend = () => end('ok');
      u.onerror = e => end(e.error === 'not-allowed' ? 'blocked' : e.error === 'interrupted' || e.error === 'canceled' ? 'ok' : 'error');
      playing = { tag, stop: () => { try { speechSynthesis.cancel(); } catch { /* fine */ } end('ok'); } };
      speechSynthesis.speak(u);
      // Android sometimes never reports the end. The guess allows for slow Chinese voices and the speed; when it runs
      // out, it checks whether the phone is still talking (so the mic never opens while it speaks).
      const est = 4000 + text.length * (zh ? 260 : 90) / u.rate, t0 = Date.now();
      const check = ms => {
        timer = setTimeout(() => {
          let busy = false;
          try { busy = !!(speechSynthesis.speaking || speechSynthesis.pending); } catch { /* unknown */ }
          if (busy && Date.now() - t0 < est * 3) return check(1000);
          if (busy) { try { speechSynthesis.cancel(); } catch { /* fine */ } }
          end('ok');
        }, ms);
      };
      check(est);
    } catch { end('error'); }
  });
}

// Short phrases said every time (greeting, "Okay.") are kept on the phone (Cache API, not localStorage), so they play
// instantly. Only the current voice and speed are kept.
const TTS_CACHE = 'homebase-tts';
const kept = new Map();       // key → audio URL, this app start
function keptKey(text, voice) { return [voice, ttsLang(text), voiceRate(), text].join('|'); }
const keptUrl = k => new URL('__tts/' + encodeURIComponent(k), location.href.split('#')[0]).href;
const hasCaches = () => { try { return typeof caches !== 'undefined' && !!caches.open; } catch { return false; } };
async function keptGet(k) {
  if (kept.has(k)) return kept.get(k);
  if (!hasCaches()) return null;
  try {
    const c = await caches.open(TTS_CACHE);
    const r = await c.match(keptUrl(k));
    if (!r) return null;
    const u = URL.createObjectURL(await r.blob());
    kept.set(k, u);
    return u;
  } catch { return null; }
}
async function keptPut(k, b64, mime) {
  const u = audioSrc(b64, mime);
  kept.set(k, u);
  if (hasCaches()) {
    try { const c = await caches.open(TTS_CACHE); await c.put(keptUrl(k), new Response(b64Blob(b64, mime), { headers: { 'Content-Type': mime || 'audio/mpeg' } })); }
    catch { /* memory only */ }
  }
  return u;
}
// Phrases for another voice or speed are dropped.
async function pruneKept(voice) {
  if (!hasCaches()) return;
  try {
    const c = await caches.open(TTS_CACHE);
    const keys = await c.keys();
    const rate = String(voiceRate());
    const old = keys.filter(q => { const p = decodeURIComponent(q.url.split('/__tts/')[1] || '').split('|'); return p[0] !== voice || p[2] !== rate; });
    await Promise.all(old.concat(keys.length - old.length > 40 ? keys.filter(x => !old.includes(x)).slice(0, keys.length - old.length - 40) : []).map(q => c.delete(q)));
  } catch { /* fine */ }
}
function forgetKept() {
  kept.clear();
  try { if (hasCaches()) caches.delete(TTS_CACHE); } catch { /* fine */ }
}
let voiceWarned = false;
let chirpOff = false;         // the month's natural-voice characters ran out: the phone voice reads until the app restarts
// Says why the natural voice isn't reading (once), and remembers what it means.
function voiceProblem(reason) {
  if (!reason || reason === 'empty') return;
  if (reason === 'no_key') { lsSet('homebase.voiceReady', '0'); return; }
  if (reason === 'monthly_limit') chirpOff = true;
  if (voiceWarned) return;
  voiceWarned = true;
  toast(reason === 'monthly_limit' ? 'This month\'s free natural-voice characters are used up; using the phone voice until next month.'
    : reason === 'error' ? 'The natural voice had a problem; the phone voice reads for now.' : String(reason), reason !== 'monthly_limit');
}
async function naturalAudio(text, voice, keep) {
  const k = keep ? keptKey(text, voice) : '';
  if (k) { const hit = await keptGet(k); if (hit) return hit; }
  const r = await api('voice.speak', { text, voice, lang: ttsLang(text), rate: voiceRate() }, { timeoutMs: 20000 });
  if (r.audio) {
    lsSet('homebase.voiceReady', '1');
    if (k && r.audio.length < 160000) return keptPut(k, r.audio, r.mime || 'audio/mpeg');
    return audioSrc(r.audio, r.mime);
  }
  voiceProblem(r.reason);
  return null;
}
/**
 * Reads text aloud. Resolves when it has finished (or was stopped) with 'ok', 'blocked' (the browser wants a tap
 * first) or 'error'. opts.keep keeps the audio on the phone; opts.phone uses the phone voice; opts.instant (with keep)
 * never waits for the network; opts.onStart runs when the sound starts.
 */
async function say(text, opts = {}) {
  const plain = plainForSpeech(text);
  if (!plain) return 'ok';
  stopSpeaking();
  const my = speakSeq;
  const start = () => { try { opts.onStart?.(); } catch { /* fine */ } };
  const voice = opts.phone ? null : chirpVoice();
  if (voice && isConfigured()) {
    if (opts.keep && opts.instant) {
      const hit = await keptGet(keptKey(plain, voice));
      if (my !== speakSeq) return 'ok';
      if (!hit) {                                   // the phone voice says it now; the natural one is fetched for next time
        naturalAudio(plain, voice, true).catch(() => {});
        start();
        return phoneSpeak(plain);
      }
    }
    try {
      const src = await Promise.race([naturalAudio(plain, voice, opts.keep), stopped()]);
      if (my !== speakSeq) return 'ok';             // stopped (a tap) or something else started meanwhile
      if (src) {
        start();
        const r = await playAudio(src);
        dropSrc(src);
        if (r !== 'error' || my !== speakSeq) return r;
      }
    } catch (e) { console.warn('natural voice:', e.message); }
    if (my !== speakSeq) return 'ok';
  }
  start();
  return phoneSpeak(plain);
}
function speak(text, opts) { say(text, opts); }

// ================= TALK MODE =================
// Hands-free conversation: the assistant greets you, listens, sends as soon as you finish speaking, reads the answer
// and listens again. "Thanks" or "bye" ends it; so do two silences in a row. "Never mind" drops what you said.
const TALK_PAUSE_MS = 2500;          // safety only: talk mode sends as soon as Chrome hears you stop
const TALK_WAIT_MS = 9000;           // how long it waits for you to start talking
const talk = { on: false, gen: 0, state: 'idle', rec: null, silences: 0, wake: null, wakeP: null, finishNow: null, el: null,
  blocked: false, greeting: '', pending: null, refreshAfter: false, stopAt: 0, back: null };
// lower case, no punctuation, without the assistant's name ("thanks Bella" = "thanks")
function normSpeech(t) {
  const nm = assistantName().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (' ' + String(t || '').toLowerCase().replace(/[.,!?;:"’。，！？、~]/g, ' ').replace(/\s+/g, ' ') + ' ')
    .replace(new RegExp(' (?:hey )?' + nm + '(?= )', 'g'), ' ').replace(/\s+/g, ' ').trim();
}
const END_RE = /^(?:(?:ok|okay|alright|great|perfect|cool)\s+)?(?:thanks|thank you|thank you so much|thanks a lot|thanks so much|bye|bye bye|goodbye|good bye|thanks bye|thank you bye|thanks goodbye|thank you goodbye|谢谢|謝謝|多谢|多謝|拜拜|再见|再見|谢谢 ?再见|謝謝 ?再見|多谢 ?再见|多謝 ?再見)$/;
const CANCEL_RE = /^(?:never ?mind|cancel|cancel that|forget it|算了|取消|唔使)$/;
// "look it up", "search …", "google …", "ask Gemini", 查一下 / 搜一下: a web search, which takes a few seconds
const LOOKUP_RE = /\blook\b[^.?!]{0,24}?\bup\b|\bsearch\b|\bgoogle\b|\bask gemini\b|查一下|搜一下|查查|搜搜/i;
const isZh = () => langFamily(voiceLang()) === 'zh';
const lookupPhrase = () => (isZh() ? '我查一下。' : 'Let me look that up.');
const TALK_PHRASES = ['Bye!', 'Okay.', `I'll be here if you need me.`];

// "Hi, Sam, how can I help?" when this person hasn't used the assistant on this phone for 6 hours, else "I am here."
const GREET_GAP_MS = 6 * 60 * 60 * 1000;
function greetFresh(name) {
  if (isZh()) return name ? `嗨，${name}，有什么可以帮你？` : '嗨，有什么可以帮你？';
  return name ? `Hi, ${name}, how can I help?` : 'Hi, how can I help?';
}
const greetBack = () => (isZh() ? '我在。' : 'I am here.');
function talkGreeting() {
  const last = Number(lsGet(lastUseKey(), '0')) || 0;
  return last && Date.now() - last <= GREET_GAP_MS ? greetBack() : greetFresh(myName());
}

function talkHtml() {
  const nm = esc(assistantName());
  return `<div class="talk-top"><div><div class="talk-name">${nm}</div><div class="talk-sub">Say “thanks” or “bye” to finish</div><div class="spk-row" hidden></div></div>
      <button type="button" class="talk-end" id="talkEnd">End</button></div>
    <div class="talk-mid">
      <button type="button" class="talk-orb" id="talkOrb" aria-label="Talk"><span class="talk-ring"></span><span class="talk-dot"></span></button>
      <div class="talk-state" id="talkState" aria-live="polite"></div>
    </div>
    <div class="talk-log">
      <div class="talk-heard" id="talkHeard"></div>
      <div class="talk-reply" id="talkReply"></div>
      <div class="talk-done" id="talkDone"></div>
    </div>`;
}
// States: opening (mic starting), listening (mic open), thinking, fetching (getting the voice), speaking, idle.
let fetchLabelTimer = null;
function setTalk(st, label) {
  talk.state = st;
  clearTimeout(fetchLabelTimer);
  if (!talk.el) return;
  talk.el.dataset.state = st;
  $('#talkState', talk.el).textContent = label ?? ({ listening: 'Listening…', thinking: 'Thinking…', idle: 'Tap to talk' }[st] || '');
  // fetching: "Thinking…" only if the voice takes a moment (kept phrases start at once)
  if (st === 'fetching' && label === undefined) fetchLabelTimer = setTimeout(() => { if (talk.state === 'fetching' && talk.el) $('#talkState', talk.el).textContent = 'Thinking…'; }, 300);
}
const talkLine = (id, html) => { const el = talk.el && $('#' + id, talk.el); if (el) el.innerHTML = html; };

// Keeps the screen on while talking. One request at a time; one that comes back after talk mode closed is let go.
function keepAwake() {
  if (!('wakeLock' in navigator) || talk.wake || talk.wakeP || document.visibilityState !== 'visible') return;
  talk.wakeP = Promise.resolve().then(() => navigator.wakeLock.request('screen')).then(s => {
    talk.wakeP = null;
    if (!talk.on || talk.wake) { try { s.release(); } catch { /* fine */ } return; }
    talk.wake = s;
    s.addEventListener?.('release', () => { if (talk.wake === s) talk.wake = null; });
  }).catch(() => { talk.wakeP = null; });   // battery saver can refuse; fine
}

function openTalk() {
  if (talk.on) return;
  if (!isConfigured()) { location.hash = '#settings'; return; }
  if (!SR) return toast("Talk mode needs Chrome's speech recognition. Open Homebase in Chrome.", true);
  closeModal();
  if (activeRec) { try { activeRec.abort(); } catch { /* fine */ } }
  talk.on = true; talk.silences = 0; talk.gen++; talk.blocked = false; talk.pending = null;
  // wake the backend up while the greeting plays, so the first answer is quicker
  api('ping').then(p => { if (p) noteBackend(p.backend_version || ''); }).catch(() => {});
  talk.back = document.activeElement;
  const el = document.createElement('div');
  el.className = 'talk'; el.id = 'talk';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Talk to ' + assistantName());
  el.innerHTML = talkHtml();
  document.body.appendChild(el); document.body.classList.add('talking');
  talk.el = el;
  $('#talkEnd', el).onclick = () => closeTalk();
  $('#talkOrb', el).onclick = talkTap;
  pushLayer('hbTalk');
  try { $('#talkEnd', el).focus({ preventScroll: true }); } catch { /* fine */ }
  paintSpeaker();
  keepAwake();
  talk.greeting = talkGreeting();
  markUse();
  talkGreet(talk.greeting);
}
function closeTalk(fromBack = false) {
  if (!talk.on) return;
  talk.on = false; talk.gen++;
  try { talk.rec?.abort(); } catch { /* fine */ }
  talk.rec = null; talk.finishNow = null; talk.pending = null;
  stopSpeaking();
  try { talk.wake?.release(); } catch { /* fine */ }
  talk.wake = null;
  talk.el?.remove(); talk.el = null;
  document.body.classList.remove('talking');
  if (!fromBack) popLayer('hbTalk');
  const b = talk.back; talk.back = null;
  if (b && b.isConnected && !/^(INPUT|TEXTAREA|SELECT)$/.test(b.tagName)) { try { b.focus({ preventScroll: true }); } catch { /* fine */ } }
  if (currentTab() === 'chat') paintChat();
  // what waited for the conversation to end: the refresh, then the short phrases for next time
  if (talk.refreshAfter) { talk.refreshAfter = false; refreshSoon(400); }
  setTimeout(prefetchPhrases, 2500);
}

async function talkSay(text, opts = {}) {
  const g = talk.gen;
  setTalk('fetching');
  const r = await say(text, { ...opts, onStart: () => { if (talk.on && g === talk.gen) setTalk('speaking', ''); opts.onStart?.(); } });
  if (!talk.on || g !== talk.gen) return 'stopped';
  return r;
}
async function talkGreet(text) {
  talkLine('talkReply', esc(text));
  const r = await talkSay(text, { keep: true });
  if (r === 'stopped') return;
  if (r === 'blocked') {                    // the phone wants one tap before Homebase may speak or listen
    talk.blocked = true;
    setTalk('idle', 'Tap to start');
    return;
  }
  talkListen();
}
// After talk mode closes: fetch the short phrases (and both greetings) once, so they play instantly next time.
let prefetching = false;
async function prefetchPhrases() {
  const v = chirpVoice();
  if (!v || !isConfigured() || talk.on || prefetching) return;
  prefetching = true;
  try {
    await pruneKept(v);
    for (const p of [...TALK_PHRASES, lookupPhrase(), greetBack(), greetFresh(myName())]) {
      if (talk.on) return;
      if (await keptGet(keptKey(p, v))) continue;
      try { await naturalAudio(p, v, true); } catch { return; }
    }
  } finally { prefetching = false; }
}
function talkTap() {
  if (!talk.on) return;
  if (talk.state === 'speaking' || talk.state === 'fetching') { stopSpeaking(); return; }   // interrupt: straight to listening
  if (talk.state === 'listening' || talk.state === 'opening') { talk.finishNow?.(); return; }  // done talking: send now
  if (talk.state === 'idle') {
    keepAwake();
    talk.gen++;
    if (talk.blocked) { talk.blocked = false; talkGreet(talk.greeting); }
    else if (talk.pending) { const p = talk.pending; talk.pending = null; talkAnswer(p, talk.gen); }
    else { talk.silences = 0; talkListen(); }
  }
}

// Listens until you finish speaking (Chrome's final result), or TALK_WAIT_MS without starting.
// "Listening…" shows only once the microphone is really open.
function listenFor(g) {
  return new Promise((resolve, reject) => {
    let committed = '', live = '', lastHeard = 0, errors = 0, finished = false, rec = null, openTimer = null;
    const started = Date.now();
    const text = () => (committed + ' ' + live).replace(/\s+/g, ' ').trim();
    const stopAll = () => {
      finished = true; clearInterval(tick); clearTimeout(openTimer);
      if (talk.finishNow === finish) talk.finishNow = null;
      const r = rec; rec = null;
      if (talk.rec === r) talk.rec = null;
      try { r?.abort(); } catch { /* fine */ }
    };
    const finish = () => { if (finished) return; const t = text(); talk.stopAt = Date.now(); stopAll(); resolve(t); };
    const opened = r => {
      if (r !== rec || finished) return;
      clearTimeout(openTimer);
      if (talk.on && g === talk.gen && talk.state === 'opening') setTalk('listening');
    };
    const begin = () => {
      if (finished) return;
      if (!talk.on || g !== talk.gen) return finish();
      const r = new SR();
      rec = r; talk.rec = r;
      r.lang = voiceLang(); r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      if (talk.state === 'listening') setTalk('opening', '');
      r.onstart = r.onaudiostart = () => opened(r);
      clearTimeout(openTimer);
      openTimer = setTimeout(() => opened(r), 1500);      // a browser that never says the mic is open
      r.onresult = e => {
        if (r !== rec) return;
        let t = '';
        for (const x of e.results) t += x[0].transcript;
        live = t.trim();
        if (live) { lastHeard = Date.now(); talkLine('talkHeard', esc(text())); }
        const last = e.results[e.results.length - 1];
        if (last && last.isFinal && text()) finish();    // Chrome has your final words: send now, no wait for the end
      };
      r.onerror = e => {
        if (r !== rec) return;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          stopAll();
          reject(Object.assign(new Error('Allow the microphone for Homebase (Chrome → site settings → Microphone), then tap.'), { blocked: true }));
        } else if (e.error !== 'no-speech' && e.error !== 'aborted') errors++;
      };
      r.onend = () => {
        if (r !== rec) return;
        committed = text(); live = '';
        if (finished) return;
        if (committed) return finish();                  // you finished speaking: send now (talk mode doesn't wait)
        if (errors > 4) { stopAll(); return reject(new Error("I can't hear right now. Check the connection, then tap.")); }
        setTimeout(begin, 80);
      };
      try { r.start(); } catch { errors++; setTimeout(begin, 400); }
    };
    const tick = setInterval(() => {
      if (!talk.on || g !== talk.gen) return finish();
      const now = Date.now();
      if (lastHeard && text() && now - lastHeard >= TALK_PAUSE_MS) finish();
      else if (!lastHeard && now - started >= TALK_WAIT_MS) finish();
    }, 150);
    talk.finishNow = finish;
    begin();
  });
}

async function talkListen() {
  if (!talk.on) return;
  const g = talk.gen;
  setTalk('opening', '');
  talkLine('talkHeard', '');
  let heard;
  try { heard = await listenFor(g); }
  catch (e) {
    if (!talk.on || g !== talk.gen) return;
    talk.blocked = false;
    setTalk('idle', e.message);
    return;
  }
  if (!talk.on || g !== talk.gen) return;
  if (!heard) {
    if (++talk.silences >= 2) {
      const r = await talkSay(`I'll be here if you need me.`, { keep: true, instant: true });
      if (r !== 'stopped') closeTalk();
      return;
    }
    return talkListen();
  }
  talk.silences = 0;
  talkLine('talkHeard', esc(heard));
  const n = normSpeech(heard);
  if (END_RE.test(n)) {
    talkLine('talkReply', 'Bye!');
    const r = await talkSay('Bye!', { keep: true, instant: true });
    if (r !== 'stopped') closeTalk();
    return;
  }
  if (CANCEL_RE.test(n)) {
    talkLine('talkReply', 'Okay.');
    const r = await talkSay('Okay.', { keep: true, instant: true });
    if (r !== 'stopped' && talk.on && g === talk.gen) talkListen();
    return;
  }
  await talkAsk(heard, g);
}

// Web search sources go into the chat copy as links (the spoken reply stays clean).
function sourcesMd(src) {
  const l = (Array.isArray(src) ? src : []).filter(x => x && /^https?:\/\//.test(String(x.url || ''))).slice(0, 3);
  return l.length ? '\n' + l.map(x => `- [${String(x.title || x.url).replace(/[[\]\n]/g, ' ').slice(0, 120)}](${String(x.url).replace(/[\s)]/g, '')})`).join('\n') : '';
}

async function talkAsk(text, g) {
  const tm = { stop: talk.stopAt || Date.now() };
  setTalk('thinking');
  talkLine('talkReply', ''); talkLine('talkDone', '');
  talk.pending = null;
  state.chat = state.chat || [];
  const mine = { role: 'user', content: text };
  state.chat.push(mine);
  markUse();
  chatInflight++;
  // a web search takes a few seconds: say so right away (kept phrase, no network)
  const look = LOOKUP_RE.test(text) ? say(lookupPhrase(), { keep: true, instant: true }) : null;
  let res;
  try {
    const v = chirpVoice();
    tm.sent = Date.now();
    const r = await api('chat.send', { message: text, mode: 'talk', speaker: speakerFor(text),
      voice: v ? { voice: v, lang: ttsLang(text), rate: voiceRate() } : undefined }, { timeoutMs: 120000 });
    tm.reply = Date.now();
    noteTiming(r.timing);
    res = { reply: r.reply || 'Done.', actions: r.actions || [], audio: r.audio || '', mime: r.mime || 'audio/mpeg',
      rest: String(r.rest_text || '').trim(), voiceReason: r.voice_reason || '', voice: v, tm };
    (state.chat || (state.chat = [])).push({ role: 'assistant', content: res.reply + sourcesMd(r.sources), charts: r.charts?.length ? r.charts : undefined });
    saveCache();
    invalidate();                         // the refresh itself waits until talk mode closes
  } catch (e) {
    const i = (state.chat || []).indexOf(mine);
    if (i >= 0) state.chat.splice(i, 1);
    res = { reply: /took too long/.test(e.message) ? 'Sorry, that took too long. Please try again.' : `Sorry, I couldn't do that. ${e.message}`, actions: [], failed: true, tm };
  } finally { chatInflight--; }
  if (look) await look;                   // "Let me look that up." finishes first (never two voices at once)
  if (!talk.on) return;
  if (g !== talk.gen) {
    // the screen was off or the app switched meanwhile: keep the answer for when you're back
    talk.pending = res;
    if (!document.hidden && (talk.state === 'opening' || talk.state === 'listening') && !$('#talkHeard', talk.el)?.textContent) {
      talk.gen++;
      try { talk.rec?.abort(); } catch { /* fine */ }
      const p = talk.pending; talk.pending = null;
      talkAnswer(p, talk.gen);
    }
    return;
  }
  await talkAnswer(res, g);
}
async function talkAnswer(res, g) {
  talkLine('talkReply', md(res.reply));
  talkLine('talkDone', (res.actions || []).map(a => `<div>✓ ${esc(a.label)}</div>`).join(''));
  const r = await talkSpeak(res, g);
  if (r === 'stopped' || !talk.on || g !== talk.gen) return;
  talkListen();
}
// Speaks a reply: the first part came with it (plays at once) while the rest is fetched; a tap stops both.
async function talkSpeak(res, g) {
  const tm = res.tm;
  const onStart = () => { if (tm && tm.reply && !tm.voice) { tm.voice = Date.now(); notePhoneTiming('talk', tm); } };
  if (res.failed) return talkSay(res.reply, { phone: true });
  if (res.audio) {
    stopSpeaking();
    const my = speakSeq;
    const rest = res.rest && res.voice ? res.rest : '';
    const restP = rest ? naturalAudio(rest, res.voice, false).catch(() => null) : null;   // fetched while the first part plays
    setTalk('speaking', '');
    onStart();
    const first = audioSrc(res.audio, res.mime);
    let r = await playAudio(first);
    dropSrc(first);
    if (!talk.on || g !== talk.gen) return 'stopped';
    if (my !== speakSeq) return 'ok';                        // tapped: the rest isn't played either
    if (r === 'error' || r === 'blocked') return talkSay(res.reply, { phone: true });
    if (!rest) return r;
    setTalk('fetching');
    const src = await Promise.race([restP, stopped()]);
    if (!talk.on || g !== talk.gen) { dropSrc(src); return 'stopped'; }
    if (my !== speakSeq) { dropSrc(src); return 'ok'; }
    if (src) {
      setTalk('speaking', '');
      r = await playAudio(src);
      dropSrc(src);
      if (!talk.on || g !== talk.gen) return 'stopped';
      if (r !== 'error' || my !== speakSeq) return r;
    }
    return talkSay(rest, { phone: true });
  }
  if (res.voiceReason) {                                   // the voice was asked for but didn't come: phone voice, no second try
    voiceProblem(res.voiceReason);
    return talkSay(res.reply, { phone: true, onStart });
  }
  return talkSay(res.reply, { onStart });
}

// Screen off or another app: stop listening; pick up again when you're back (with an answer that came meanwhile).
document.addEventListener('visibilitychange', () => {
  if (!talk.on) return;
  if (document.hidden) {
    talk.gen++;
    try { talk.rec?.abort(); } catch { /* fine */ }
    stopSpeaking();
    setTalk('idle', 'Tap to continue');
  } else {
    keepAwake();
    if (talk.state !== 'idle' || talk.blocked) return;
    talk.gen++;
    if (talk.pending) { const p = talk.pending; talk.pending = null; talkAnswer(p, talk.gen); }
    else { talk.silences = 0; talkListen(); }
  }
});

// "Hey Google, open Homebase" (or the icon) starts the app at #today with no "?from=notify": start talking if you turned
// that on. The "Talk to Bella" shortcut (long-press the icon) always does. Coming back after 10+ minutes counts too.
function wasOpenedByYou() {
  const q = new URLSearchParams(location.search);
  const hash = location.hash || '';
  return !q.has('from') && (hash === '' || hash === '#today' || q.has('talk'));
}
function maybeTalkOnOpen() {
  const q = new URLSearchParams(location.search);
  const forced = q.has('talk');
  const byYou = wasOpenedByYou();
  if (q.has('talk') || q.has('from') || q.has('launch')) {
    try { history.replaceState(null, '', location.pathname + (location.hash || '#today')); } catch { /* fine */ }
  }
  if (!isConfigured()) return;
  if (forced || (byYou && lsGet('homebase.talkOnOpen', '1') === '1')) setTimeout(() => openTalk(), 350);
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (talk.on || !hiddenAt || Date.now() - hiddenAt < 10 * 60 * 1000 || lsGet('homebase.talkOnOpen', '1') !== '1' || !isConfigured()) return;
  // a notification tap reloads the page with ?from=notify instead; give that a moment to happen
  setTimeout(() => { if (!document.hidden && !talk.on && $('#modal').hidden) openTalk(); }, 700);
});

// A 🎙 button next to Settings starts talk mode from any tab.
(function addTalkButton() {
  const gear = $('#settingsBtn');
  if (!gear || $('#talkBtn')) return;
  const wrap = document.createElement('div');
  wrap.className = 'top-acts';
  gear.replaceWith(wrap);
  wrap.innerHTML = `<button class="icon-btn" id="talkBtn" aria-label="Talk to ${esc(assistantName())}">${ICON_MIC.replace(/width="20" height="20"/, 'width="22" height="22"')}</button>`;
  wrap.appendChild(gear);
  $('#talkBtn').onclick = () => openTalk();
})();

// ================= CHAT =================
// --- sharing into Homebase (Android Share menu → service worker → here) ---
const SHARE_PROMPT = 'Find the dates, events and to-dos in this and suggest what to add.';
async function shareImage(fileOrBlob) {
  const f = fileOrBlob instanceof File ? fileOrBlob : new File([fileOrBlob], 'shared', { type: fileOrBlob.type || 'image/jpeg' });
  const s = await shrinkImage(f, 1600);   // big enough to read a flyer, small enough to send quickly (JPEG on white)
  return { data: s.data, mime: s.mime, url: s.url };
}
async function takeShared() {
  if (!('caches' in window)) return null;
  const c = await caches.open('homebase-share');
  const m = await c.match('./__shared/meta');
  if (!m) return null;
  const meta = await m.json();
  const im = await c.match('./__shared/image');
  await c.delete('./__shared/meta'); await c.delete('./__shared/image');
  if (Date.now() - (meta.at || 0) > 10 * 60 * 1000) return null;   // stale leftovers
  const out = { title: meta.title || '', text: meta.text || '', url: meta.url || '' };
  if (im) out.image = await shareImage(await im.blob());
  if (!out.text && !out.url && !out.image && !out.title) return null;
  return out;
}

const CHAT_CHIPS = ['What should I eat?', "What's due this week?", 'What should I bring tomorrow?', 'Anything in my watched emails to act on?'];

async function renderChat() {
  view.innerHTML = '<div class="chat" id="chatList"></div>';
  const composer = document.createElement('form');
  composer.className = 'composer';
  composer.innerHTML = `<div class="spk-row" hidden></div><div id="shareChip" class="share-chip" hidden></div>
    <div class="cbox">
      <textarea id="chatInput" rows="2" placeholder="Ask or tell me anything…" autocomplete="off"></textarea>
      <div class="cbar">
        <button type="button" class="attach" id="chatAttach" aria-label="Add a photo or screenshot">${ICON_CLIP}</button><input type="file" id="chatFile" accept="image/*" hidden>
        ${SR ? `<button type="button" class="attach mic" id="chatMic" aria-label="Speak (turns speech into text)">${ICON_MIC}</button>` : ''}
        <span class="grow"></span>
        <button class="btn primary" aria-label="Send">Send</button>
      </div>
    </div>`;
  document.body.appendChild(composer);
  const ta = $('#chatInput');
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = Math.max(52, Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4))) + 'px';
    const l = $('#chatList'); if (l) l.style.paddingBottom = (composer.offsetHeight + 16) + 'px';
  };
  ta.addEventListener('input', grow);
  // Enter sends; Shift+Enter adds a new line. Phone keyboards can report Enter only via beforeinput.
  let shiftDown = false;
  ta.addEventListener('keydown', e => {
    shiftDown = e.shiftKey;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); }
  });
  ta.addEventListener('keyup', e => { shiftDown = e.shiftKey; });
  ta.addEventListener('beforeinput', e => {
    if (e.inputType === 'insertLineBreak' && !shiftDown) { e.preventDefault(); composer.requestSubmit(); }
  });
  composer.addEventListener('submit', e => {
    e.preventDefault();
    if (chatBusy) { toast('One moment…'); return; }   // what you wrote stays in the box
    const v = ta.value.trim() || (state.pendingShare ? SHARE_PROMPT : '');
    if (v) { ta.value = ''; grow(); sendChat(v); }
  });
  // something shared from another app (Android Share menu), or a photo picked with 📎
  const showShare = () => {
    const chip = $('#shareChip'), sh = state.pendingShare;
    chip.hidden = !sh;
    if (sh) {
      const words = (sh.title ? sh.title + ' · ' : '') + (sh.text || '') + (sh.url && !(sh.text || '').includes(sh.url) ? ' ' + sh.url : '');
      chip.innerHTML = `${sh.image ? `<img src="${sh.image.url}" alt="">` : ''}<span class="grow">${esc(words.trim().slice(0, 160) || 'Photo')}</span><button type="button" class="x" id="shareX" aria-label="Remove">✕</button>`;
      $('#shareX').onclick = () => { state.pendingShare = null; showShare(); };
      if (!ta.value.trim()) ta.value = SHARE_PROMPT;
    }
    grow();
  };
  $('#chatAttach').onclick = () => $('#chatFile').click();
  $('#chatMic')?.addEventListener('click', e => dictate(ta, e.currentTarget, () => { grow(); composer.requestSubmit(); }));
  $('#chatFile').onchange = async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try { state.pendingShare = { ...(state.pendingShare || {}), image: await shareImage(f) }; showShare(); } catch (err) { fail(err); }
    e.target.value = '';
  };
  try { const sh = await takeShared(); if (sh) state.pendingShare = sh; } catch (err) { console.warn(err); }
  showShare();

  // Saved conversation shows at once; the server copy is checked once per app start.
  const loadHistory = () => api('chat.history', { limit: 30 }).then(h => {
    state.chatFresh = true;
    const fresh = h.map(m => ({ role: m.role, content: m.content, kind: m.kind || undefined, charts: Array.isArray(m.chart) && m.chart.length ? m.chart : undefined }));
    if (chatInflight > 0) return;                              // a reply is on its way; don't disturb
    state.chat = fresh; saveCache(); if (location.hash === '#chat') paintChat();
  });
  if (!state.chat) {
    paintChat(true);
    try { await loadHistory(); } catch (e) { state.chat = []; fail(e); }
  } else if (!state.chatFresh) loadHistory().catch(e => console.warn(e));
  paintChat();
  paintSpeaker();
}

// Charts in the chat are drawn by charts.js, loaded the first time one is shown.
let chartsMod = null;
function mountCharts(root) {
  const slots = $$('.chart-slot', root);
  if (!slots.length) return;
  (chartsMod ||= import('./charts.js')).then(mod => slots.forEach(slot => {
    const [i, j] = slot.dataset.chart.split(':').map(Number);
    const spec = state.chat?.[i]?.charts?.[j];
    if (spec) mod.renderChart(slot, spec);
  })).catch(e => { console.warn(e); slots.forEach(s => { s.textContent = "Charts couldn't load. Check your connection."; }); });
}

function paintChat(loading = false) {
  const list = $('#chatList');
  if (!list) return;
  if (loading) { list.innerHTML = '<div class="msg assistant typing"><span class="spinner"></span></div>'; return; }
  const msgs = state.chat || [];
  list.innerHTML = (msgs.length ? '' : `<div class="empty"><div class="big">Hi! What's on your mind?</div>
      I know your tasks, calendar and the weather. You can also just tell me things you did.</div>`) +
    msgs.map((m, i) => `<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}${m.kind === 'brief' ? ' brief' : ''}${m.typing ? ' typing' : ''}${m.charts?.length ? ' has-chart' : ''}" data-i="${i}">${m.typing ? '<span class="spinner"></span> thinking…' : md(m.content)}${(m.charts || []).map((_, j) => `<div class="chart-slot" data-chart="${i}:${j}"></div>`).join('')}${m.role === 'assistant' && !m.typing && m.content ? `<button type="button" class="say" data-say="${i}" aria-label="Read aloud">🔊</button>` : ''}</div>`).join('') +
    `<div class="chips chat-chips">${CHAT_CHIPS.map(c => `<button class="chip" type="button">${esc(c)}</button>`).join('')}</div>`;
  $$('.chat-chips .chip', list).forEach(c => c.onclick = () => sendChat(c.textContent));
  $$('[data-say]', list).forEach(b => b.onclick = () => speak((state.chat || [])[+b.dataset.say]?.content));
  if (isMember()) $$('.chat-chips .chip', list).forEach(c => { if (/email/i.test(c.textContent)) c.remove(); });
  mountCharts(list);
  requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}

let chatBusy = false;
let chatInflight = 0;         // chat sends on their way (chat box, Home box, talk mode)
async function sendChat(text) {
  if (chatBusy) return toast('One moment…');
  chatBusy = true; chatInflight++;
  const tm = { stop: Date.now() };
  state.chat = state.chat || [];
  const sh = state.pendingShare; state.pendingShare = null;
  if ($('#shareChip')) { $('#shareChip').hidden = true; }
  const shown = sh ? text + '\n📎 ' + (sh.image ? 'photo' + (sh.text || sh.url ? ' + ' : '') : '') + ((sh.title || sh.text || sh.url || '').slice(0, 80)) : text;
  const wait = { role: 'assistant', content: '', typing: true };
  state.chat.push({ role: 'user', content: shown }, wait);
  markUse();
  paintChat();
  let ans;
  try {
    const shared = sh ? { title: sh.title || '', text: (sh.text || '').slice(0, 6000), url: sh.url || '', image: sh.image ? { data: sh.image.data, mime: sh.image.mime } : null } : undefined;
    tm.sent = Date.now();
    const r = await api('chat.send', { message: text, shared, speaker: speakerFor(text) }, { timeoutMs: 120000 });
    tm.reply = Date.now();
    noteTiming(r.timing); notePhoneTiming('chat', tm);
    ans = { role: 'assistant', content: r.reply, charts: r.charts?.length ? r.charts : undefined };
    invalidate((r.actions || []).length ? 1500 : 12000);   // the assistant may have changed tasks, meals or the calendar
  } catch (e) {
    ans = { role: 'assistant', content: '⚠️ ' + e.message };
  } finally { chatBusy = false; chatInflight--; }
  // the answer takes the place of its own "thinking…" (other messages may have come in meanwhile)
  const list = state.chat || (state.chat = []);
  const i = list.indexOf(wait);
  if (i >= 0) list.splice(i, 1, ans); else list.push(ans);
  if (!/^⚠️ /.test(ans.content)) saveCache();
  if (location.hash === '#chat') paintChat();
}

// ================= SETTINGS =================
async function renderSettings() {
  const cfg = getCfg();
  const configured = isConfigured();
  view.innerHTML = `
    ${configured ? '' : `<div class="card"><div class="big" style="font-family:var(--serif);font-size:21px;margin-bottom:6px">Welcome to Homebase</div>
      <div class="muted small">Paste your Apps Script web app URL and the app token from <b>setup()</b>. See the README for the setup.<br>Joining your family's Homebase? Open the invite link you were sent instead.</div></div>`}
    <div class="card">
      <h2>Connection</h2>
      ${configured ? '' : `<label class="field"><span>Got an invite link? Paste it here</span><input type="text" id="sInviteIn" placeholder="https://…#join=…" autocomplete="off"></label>
      <div class="muted small" style="margin:-4px 0 12px">Or fill in the two boxes below.</div>`}
      <label class="field"><span>Backend URL (Apps Script web app)</span><input type="url" id="sUrl" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="field"><span>App token or invite code</span><input type="password" id="sToken" value="${esc(cfg.token || '')}"></label>
      <div class="btn-row"><button class="btn primary" id="sConnect">${configured ? 'Save & test' : 'Connect'}</button></div>
      <div id="sStatus" class="muted small" style="margin-top:10px"></div>
    </div>
    <div id="serverSettings">${configured ? '<div class="card"><div class="skeleton" style="height:200px"></div></div>' : ''}</div>`;

  // Pasting a whole invite link into any box fills in both.
  foldCards(view, configured ? [] : ['Connection']);
  const fromInvite = el => { const j = parseInvite(el.value); if (j) { $('#sUrl').value = j.u; $('#sToken').value = j.c; if ($('#sInviteIn')) $('#sInviteIn').value = ''; toast(`Invite for ${j.n || 'you'} found. Tap Connect.`); } };
  ['#sInviteIn', '#sUrl', '#sToken'].forEach(id => $(id)?.addEventListener('input', e => fromInvite(e.target)));
  $('#sConnect').onclick = e => busy(e.currentTarget, async () => {
    const url = $('#sUrl').value.trim(), token = $('#sToken').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw new Error('That does not look like an Apps Script web app URL.');
    const old = getCfg();
    // test the new details first: a typo leaves the working connection (and this phone's data) as it was
    const p = await api('ping', {}, { cfg: { url, token } });
    setCfg({ url, token });
    if (old.token && old.token !== token) forgetLocalData();   // someone else's data shouldn't linger
    noteBackend(p.backend_version || '');
    state.settings = p.settings || await api('settings.get');
    if (p.me) { state.me = p.me; saveCache(); }
    const member = (p.me?.role || state.settings?.role) === 'member';
    $('#sStatus').innerHTML = `✓ Connected${p.me ? ' as <b>' + esc(p.me.name) + '</b>' : ''}.${p.has_ai_key === false ? ' <b>No AI key yet</b> — add CLAUDE_API_KEY (or GEMINI_API_KEY) in Script Properties.' : ''}`;
    if (!member && state.settings && !state.settings.app_url) await api('settings.save', { app_url: location.origin + location.pathname });
    paintServerSettings();
    refreshAll();
  }).catch(fail);

  if (configured) {
    try { state.settings = await api('settings.get'); paintServerSettings(); }
    catch (e) { $('#serverSettings').innerHTML = ''; fail(e); }
  }
}

// ---------------- family (owner) ----------------
function inviteLink(code, name) {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ u: getCfg().url, c: code, n: name }))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return location.origin + location.pathname + '#join=' + b64;
}
function showInviteLink(name, code) {
  const link = inviteLink(code, name);
  openModal(`<h3>Invite link for ${esc(name)}</h3>
    <div class="muted small">Send it privately (a text or email). Opening it on their phone signs them in as ${esc(name)}. Anyone with the link can sign in as them, so if it ends up somewhere else, make a new link: the old one stops working.</div>
    <input type="text" readonly id="invLink" value="${esc(link)}" style="margin:10px 0">
    <div class="btn-row"><button class="btn primary" id="invShare">Share</button><button class="btn" id="invCopy">Copy</button><button class="btn ghost" id="invDone">Done</button></div>
    <div class="muted small" style="margin-top:8px">On their phone, open it in <b>Chrome</b> (not inside WeChat or another chat app: those use their own browser). Easiest: long-press the link → Copy, then paste it into Chrome's address bar, or into the "invite link" box on Homebase's first screen. Then ⋮ → <b>Add to Home screen</b>.</div>
    <details class="why" style="margin-top:8px"><summary>Enter it by hand instead</summary>
      <div class="small" style="margin-top:6px">Backend URL:<br><code style="word-break:break-all">${esc(getCfg().url)}</code><br>Invite code:<br><code style="word-break:break-all">${esc(code)}</code></div></details>`);
  $('#invCopy').onclick = () => navigator.clipboard?.writeText(link).then(() => toast('Copied.')).catch(() => { $('#invLink').select(); });
  $('#invShare').onclick = () => (navigator.share ? navigator.share({ title: 'Homebase', text: `Join our Homebase, ${name}:`, url: link }).catch(() => {}) : $('#invCopy').click());
  $('#invDone').onclick = closeModal;
}
async function paintFamily() {
  const el = $('#sFamily');
  if (!el) return;
  try {
    const list = await api('users.list');
    state.familyCount = list.filter(u => u.active).length;
    const pname = id => (people().find(p => p.id === id) || {}).name || '—';
    el.classList.toggle('muted', !list.length);
    el.innerHTML = list.length ? list.map(u => `<div class="fam-row${u.active ? '' : ' off'}">
        <div class="grow"><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="muted small">(paused)</span>'}<br>
          <span class="muted small">Profile: ${esc(pname(u.person_id))} · ${u.last_seen ? 'last seen ' + esc(rel(u.last_seen.slice(0, 10))) : 'not signed in yet'} · alerts by ${esc(u.notifications)}</span></div>
        <div class="fam-acts"><button class="btn small ghost" data-uact="newcode" data-uid="${esc(u.id)}" data-name="${esc(u.name)}">New link</button>
          <button class="btn small ghost" data-uact="${u.active ? 'pause' : 'resume'}" data-uid="${esc(u.id)}">${u.active ? 'Pause' : 'Resume'}</button>
          <button class="btn small ghost" data-uact="remove" data-uid="${esc(u.id)}" data-name="${esc(u.name)}">Remove</button></div></div>`).join('')
      : 'Nobody yet. Tap “Invite someone”.';
    $$('#sFamily [data-uact]').forEach(b => b.onclick = () => {
      const id = b.dataset.uid, act = b.dataset.uact;
      if (act === 'remove' && !confirm(`Remove ${b.dataset.name}? Their sign-in, chat and "Only me" tasks are deleted. Shared tasks and meals stay.`)) return;
      busy(b, async () => {
        if (act === 'newcode') { const r = await api('users.newcode', { id }); showInviteLink(b.dataset.name, r.code); }
        else if (act === 'remove') await api('users.delete', { id });
        else await api('users.update', { id, active: act === 'resume' });
        paintFamily();
      }).catch(fail);
    });
  } catch (e) { el.textContent = e.message; }
}
function openInvite() {
  const ps = people().filter(p => p.id !== 'me');
  openModal(`<h3>Invite someone</h3>
    <label class="field"><span>Name</span><input type="text" id="invName" maxlength="30" placeholder="e.g. Alex"></label>
    <label class="field"><span>Who are they in the People list?</span><select id="invWho">
      <option value="new">Add them (adult)</option><option value="new-child">Add them (child)</option>
      ${ps.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
    <div class="muted small" style="margin-bottom:12px">They'll get their own sign-in link. You can pause or remove them anytime.</div>
    <button class="btn primary block" id="invGo">Create invite link</button>`);
  $('#invGo').onclick = e => {
    const name = $('#invName').value.trim();
    if (!name) return toast('Give them a name.', true);
    const who = $('#invWho').value;
    busy(e.currentTarget, async () => {
      const r = await api('users.invite', { name, person_id: who.startsWith('new') ? 'new' : who, kind: who === 'new-child' ? 'child' : 'adult' });
      if (state.settings) state.settings.people = JSON.stringify(r.people);
      if (state.today) state.today.people = r.people;
      invalidate(); refreshAll();
      showInviteLink(name, r.code);
      paintFamily();
    }).catch(fail);
  };
}

// ---------------- settings for a family member ----------------
function paintMemberSettings() {
  $('#serverSettings').innerHTML = `
    <div class="card">
      <h2>You</h2>
      <div>Signed in as <b>${esc(state.me?.name || '')}</b>.</div>
      <div class="muted small" style="margin-top:6px">Tasks, the food log and the family calendar are shared with the household. Your chat and your “Only me” tasks are private.</div>
      <button class="btn small ghost" id="sSignOut" style="margin-top:10px">Sign out of this phone</button>
    </div>
    ${voiceCardHtml()}
    ${notifyCardHtml(false)}
    <div class="spacer"></div>`;
  bindVoiceCard();
  foldCards($('#serverSettings'), ['You']);
  bindNotifyCard();
  $('#sSignOut').onclick = () => {
    if (!confirm('Sign out of Homebase on this phone?')) return;
    setCfg({}); forgetLocalData();
    location.hash = '#settings'; route();
  };
}

// Notifications always go by Telegram. The owner sets up the bot once; everyone links their own Telegram:
// "Open Telegram" opens the bot with a one-time code (tap Start there), then "Link Telegram".
function notifyCardHtml(owner, extra = '') {
  return `<div class="card">
      <h2>Notifications</h2>
      <div id="sTg" class="chan-box">
        ${owner ? `<div class="muted small">Notifications come by Telegram: free and reliable. One-time setup (on a computer for step 2):</div>
        <ol class="small steps">
          <li>In Telegram, message <b>@BotFather</b>, send <code>/newbot</code>, pick any name, and copy the <b>token</b> it gives you.</li>
          <li>In Apps Script → Project Settings → Script Properties, add <code>TELEGRAM_BOT_TOKEN</code> with that token.</li>
          <li>Tap <b>Open Telegram</b> below, then <b>Start</b> in your bot.</li>
          <li>Come back and tap <b>Link Telegram</b>.</li>
        </ol>` : `<ol class="small steps"><li>Tap <b>Open Telegram</b> below (it opens <b id="sBot">the family's Homebase bot</b>), then <b>Start</b>.</li><li>Come back and tap <b>Link Telegram</b>.</li></ol>`}
        <div class="row"><a class="btn small" id="sTgOpen" target="_blank" rel="noopener" hidden>Open Telegram</a><button class="btn small primary" id="sTgLink" type="button">Link Telegram</button><span id="sTgStatus" class="muted small grow"></span></div>
      </div>
      ${extra}
      <button class="btn small" id="sTestN" style="margin-top:12px">Send test notification</button>
    </div>`;
}
function bindNotifyCard() {
  let last = {};
  const paint = st => {
    last = st || {};
    const el = $('#sTgStatus'); if (!el) return;
    if (st.bot && $('#sBot')) $('#sBot').textContent = st.bot;
    const open = $('#sTgOpen');
    if (open) { open.hidden = !st.start_url || st.linked; if (st.start_url) open.href = st.start_url; }
    el.textContent = st.linked ? `✓ Linked${st.bot ? ' to ' + st.bot : ''}`
      : st.has_token ? (st.start_url ? 'Open Telegram, tap Start, then Link.' : `Token found${st.bot ? ' (' + st.bot + ')' : ''}. Tap Start in the bot, then Link.`)
      : isMember() ? "Telegram isn't set up for this household yet." : 'No bot token yet (step 2).';
  };
  const load = () => api('telegram.status').then(paint).catch(() => {});
  load();
  $('#sTgLink').onclick = e => busy(e.currentTarget, async () => {
    const r = await api('telegram.link');
    paint({ ...last, linked: true, bot: r.bot || last.bot });
    toast('Linked. A test message was sent to Telegram.');
  }).catch(err => { fail(err); load(); });
  $('#sTestN').onclick = e => busy(e.currentTarget, async () => {
    const r = await api('notify.test');
    toast(r.note ? r.note : 'Sent via Telegram. Check your phone.');
  }).catch(fail);
}

// Watch-list helpers: rows <-> "from:(a OR b) extra" string
function parseWatch(q) {
  q = String(q || '');
  const list = [];
  let extra = q.replace(/\bfrom:\(([^)]*)\)/gi, (_, inner) => {
    inner.split(/\s*(?:,|\bOR\b|\s)\s*/i).map(x => x.trim()).filter(Boolean).forEach(x => list.push(x));
    return ' ';
  });
  extra = extra.replace(/\s+/g, ' ').trim();
  return { list: [...new Set(list)], extra };
}
function buildWatch(list, extra) {
  const parts = [];
  if (list.length) parts.push(`from:(${list.join(' OR ')})`);
  if ((extra || '').trim()) parts.push(extra.trim());
  return parts.join(' ');
}

function paintServerSettings() {
  const s = state.settings || {};
  if (s.role === 'member' || isMember()) return paintMemberSettings();
  const watch = parseWatch(s.email_watch_query);
  const watchList = watch.list;
  const hours = [...Array(24).keys()];
  const hourOpts = (val, allowOff) => (allowOff ? `<option value="" ${val === '' ? 'selected' : ''}>Off</option>` : '') +
    hours.map(h => `<option value="${h}" ${String(val) === String(h) ? 'selected' : ''}>${hour12(h).replace('a', ' am').replace('p', ' pm')}</option>`).join('');
  $('#serverSettings').innerHTML = `
    <div class="card">
      <h2>Weather</h2>
      <div class="two">
        <label class="field"><span>Latitude</span><input type="text" id="sLat" value="${esc(s.latitude)}" inputmode="decimal"></label>
        <label class="field"><span>Longitude</span><input type="text" id="sLon" value="${esc(s.longitude)}" inputmode="decimal"></label>
      </div>
      <button class="btn small" id="sLoc" style="margin:-4px 0 12px">📍 Use my location</button>
      <div class="two">
        <label class="field"><span>Units</span><select id="sUnits"><option value="F" ${s.units !== 'C' ? 'selected' : ''}>°F</option><option value="C" ${s.units === 'C' ? 'selected' : ''}>°C</option></select></label>
        <span></span>
      </div>
      <div class="field"><span>Remind me to bring allergy medicine in</span>
        <div class="months" id="sAllergy">${['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((l, i) => `<button type="button" data-m="${i + 1}" class="${String(s.allergy_months || '').split(',').map(Number).includes(i + 1) ? 'on' : ''}" aria-label="${new Date(2026, i, 1).toLocaleDateString(undefined, { month: 'long' })}">${l}</button>`).join('')}</div>
        <span class="muted small" style="display:block;margin-top:5px">Home and the morning brief say what to bring: a jacket, umbrella, sunglasses, and allergy medicine in these months (skipped on rainy days).</span></div>
    </div>
    <div class="card">
      <h2>People</h2>
      <div class="muted small" style="margin-bottom:8px">Everyone in the household. Food notes (allergies, dislikes, goals) shape the meal ideas. For a child, the birth date and sex are used for growth charts.</div>
      <div id="sPeople"></div>
      <button type="button" class="btn small" id="sPeopleAdd">+ Add person</button>
    </div>
    <div class="card">
      <h2>Family</h2>
      <div class="muted small" style="margin-bottom:8px">Invite family members to use this Homebase on their own phone. Tasks, the food log and the calendars you mark "Family" are shared; their chat and "Only me" tasks stay private. Your email stays yours. Everyone gets their own notifications.</div>
      <div id="sFamily" class="muted small">Loading…</div>
      <button type="button" class="btn small" id="sInvite" style="margin-top:8px">+ Invite someone</button>
    </div>
    <div class="card">
      <h2>Calendars</h2>
      <div class="muted small" style="margin-bottom:8px">Which calendars Homebase reads for Today, reminders and the morning brief. Shared calendars (like Family) appear here once they're in your Google Calendar.${(state.familyCount || 0) > 0 ? ' <b>Family</b> = family members can see it too.' : ''}</div>
      <div id="sCals" class="muted small">Loading calendars…</div>
      <label class="field hidden" id="sFamTargetF" style="margin-top:10px"><span>Events family members add go to</span><select id="sFamTarget"></select></label>
    </div>
    ${notifyCardHtml(true, `<div class="two" style="margin-top:12px">
        <label class="field"><span>Morning brief</span><select id="sBrief">${hourOpts(s.brief_hour, true)}</select></label>
        <label class="field"><span>Evening check-in</span><select id="sEve">${hourOpts(s.evening_hour, true)}</select></label>
      </div>`)}
    ${voiceCardHtml()}
    <div class="card">
      <h2>Assistant</h2>
      <label class="field"><span>Assistant's name</span><input type="text" id="sAsstName" maxlength="20" value="${esc(s.assistant_name || 'Bella')}"></label>
      <label class="field"><span>About your household (the AI uses this)</span>
        <textarea id="sAbout" rows="3" placeholder="e.g. One indoor cat. One kid in elementary school. I work from home Mon/Fri, office Tue–Thu. We eat dinner around 6:30 and cook most weeknights.">${esc(s.about_me)}</textarea></label>
      <div class="field"><span>Watch these emails (blank = email reading off)</span>
        <details class="why watch" id="sWatch">
          <summary id="sWatchSum"></summary>
          <div id="sWatchRows" class="watch-rows"></div>
          <div class="watch-add"><input type="text" id="sWatchNew" placeholder="name@school.org or school.org" autocapitalize="off" autocomplete="off"><button type="button" class="btn small" id="sWatchAdd">Add</button></div>
          <details class="why" style="margin-top:8px"><summary>Advanced: extra Gmail search words</summary>
            <input type="text" id="sWatchExtra" value="${esc(watch.extra)}" placeholder="e.g. newer_than:30d" style="margin-top:6px"></details>
        </details>
        <span class="muted small" style="display:block;margin-top:5px">The hourly check reads only these senders and turns dates and to-dos into suggestions on Today (family members see the suggestions, not the emails).</span></div>
      <label class="field check-field row-field"><input type="checkbox" id="sFullMail" ${s.email_full_search === 'on' ? 'checked' : ''}><span>Let my chat search all my email <span class="muted small">(read-only; not spam, trash or promotions; never for family members)</span></span></label>
      <details class="why" style="margin-bottom:12px"><summary>AI models, usage & cost</summary>
        <label class="field" style="margin-top:8px"><span>AI provider</span><select id="sProvider">
          <option value="auto" ${!s.ai_provider || s.ai_provider === 'auto' ? 'selected' : ''}>Auto: Claude if CLAUDE_API_KEY is set (Gemini as backup if its key is set), otherwise Gemini</option>
          <option value="claude" ${s.ai_provider === 'claude' ? 'selected' : ''}>Claude only (no Gemini backup)</option>
          <option value="gemini" ${s.ai_provider === 'gemini' ? 'selected' : ''}>Gemini (free tier)</option></select></label>
        <div class="two">
          <label class="field"><span>Claude everyday model</span><input type="text" id="sClaudeMain" value="${esc(s.claude_model_main || 'claude-haiku-5-5')}"></label>
          <label class="field"><span>Claude food ideas model</span><input type="text" id="sClaudeSmart" value="${esc(s.claude_model_smart || 'claude-haiku-5-5')}"></label>
        </div>
        <div class="muted small" style="margin:0 0 8px">With a Gemini key too, Gemini takes over automatically if Claude fails (for example, out of credit). Gemini "auto" picks the newest free models: Flash-Lite for everyday work, Flash for food ideas.</div>
        <div class="two">
          <label class="field"><span>Gemini everyday model</span><input type="text" id="sModelMain" value="${esc(s.model_main || 'auto')}"></label>
          <label class="field"><span>Gemini food ideas model</span><input type="text" id="sModelSmart" value="${esc(s.model_smart || 'auto')}"></label>
        </div>
        <div id="sVer" class="muted small" style="margin-bottom:6px">${versionHtml('…')}</div>
        <div id="sUsage" class="muted small">Loading usage…</div>
        <div id="sTiming" class="muted small" style="margin-top:6px">${timingText()}</div>
      </details>
      <div class="btn-row"><button class="btn" id="sScan">Check email now</button><button class="btn ghost" id="sClear">Clear chat history</button></div>
    </div>
    <button class="btn primary block" id="sSave">Save settings</button>
    <div class="spacer"></div>`;

  const paintWatch = () => {
    $('#sWatchSum').textContent = watchList.length ? `${watchList.length} sender${watchList.length > 1 ? 's' : ''} watched (tap to edit)` : 'None yet (tap to add)';
    $('#sWatchRows').innerHTML = watchList.map((x, i) => `<div class="watch-row"><span>${esc(x)}</span><button type="button" class="x" data-rm="${i}" aria-label="Remove ${esc(x)}">✕</button></div>`).join('');
  };
  const addWatch = () => {
    const inp = $('#sWatchNew');
    inp.value.split(/[\s,]+/).map(x => x.trim()).filter(Boolean).forEach(x => { if (!watchList.includes(x)) watchList.push(x); });
    inp.value = ''; paintWatch();
  };
  $('#sWatchAdd').addEventListener('click', addWatch);
  $('#sWatchNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addWatch(); } });
  $('#sWatchRows').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { watchList.splice(+b.dataset.rm, 1); paintWatch(); } });
  paintWatch();

  const plist = parsePeople(s.people).map(p => ({ ...p }));
  const paintPeople = () => {
    $('#sPeople').innerHTML = plist.map((p, i) => `<div class="person-row" data-i="${i}">
      <label class="field"><span>${i === 0 ? 'You' : 'Name'}</span><input type="text" data-f="name" value="${esc(p.name)}" maxlength="30"></label>
      ${i === 0 ? '' : `<div class="row"><div class="seg grow"><button type="button" data-f="kind" data-v="adult" class="${p.kind !== 'child' ? 'on' : ''}">Adult</button><button type="button" data-f="kind" data-v="child" class="${p.kind === 'child' ? 'on' : ''}">Child</button></div>
        <button type="button" class="x" data-rmp="${i}" aria-label="Remove ${esc(p.name)}">✕</button></div>`}
      ${p.kind === 'child' ? `<div class="two">
        <label class="field"><span>Birth date</span><input type="date" data-f="birthdate" value="${esc(p.birthdate || '')}" max="${todayStr()}"></label>
        <label class="field"><span>Sex (for growth charts)</span><select data-f="sex"><option value="">—</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Girl</option><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Boy</option></select></label>
      </div>` : ''}
      <label class="field"><span>Food notes (optional)</span><input type="text" data-f="notes" value="${esc(p.notes || '')}" placeholder="${p.kind === 'child' ? 'e.g. peanut allergy, picky about vegetables' : 'e.g. losing weight, no mushrooms, lactose-free'}" maxlength="400"></label>
    </div>`).join('');
    $('#sPeopleAdd').hidden = plist.length >= 6;
  };
  const onPeopleField = e => {
    const row = e.target.closest('[data-i]'); const f = e.target.dataset.f;
    if (row && f && f !== 'kind') plist[+row.dataset.i][f] = e.target.value;
  };
  $('#sPeople').addEventListener('input', onPeopleField);
  $('#sPeople').addEventListener('change', onPeopleField);
  $('#sPeople').addEventListener('click', e => {
    const k = e.target.closest('button[data-f="kind"]');
    if (k) { plist[+k.closest('[data-i]').dataset.i].kind = k.dataset.v; paintPeople(); return; }
    const r = e.target.closest('[data-rmp]');
    if (r && confirm(`Remove ${plist[+r.dataset.rmp].name}? Their meals stay in the log.`)) { plist.splice(+r.dataset.rmp, 1); paintPeople(); }
  });
  $('#sPeopleAdd').onclick = () => {
    if (plist.length < 6) plist.push({ id: 'p' + Math.random().toString(36).slice(2, 8), name: '', kind: 'child', notes: '' });
    paintPeople();
  };
  paintPeople();

  paintFamily();
  $('#sInvite').onclick = openInvite;
  bindVoiceCard();
  foldCards($('#serverSettings'));

  // App and backend versions, and how long the last reply took (always shown, even without usage numbers)
  const paintVer = () => appVersion().then(v => { const el = $('#sVer'); if (el) el.innerHTML = versionHtml(v); });
  paintVer();
  api('usage').then(u => {
    noteBackend(u.backend_version || '');
    paintVer();
    const el = $('#sUsage'); if (!el) return;
    const rows = Object.entries(u.calls || {});
    const sr = u.search;
    el.innerHTML = `In use: <b>${u.provider === 'claude' ? 'Claude' : 'Gemini'}</b> · <b>${esc(u.models?.main || '?')}</b> (everyday), <b>${esc(u.models?.smart || '?')}</b> (food ideas).<br>` +
      (rows.length ? 'Requests today: ' + rows.map(([m, n]) => `${esc(m)} ${Number(n) || 0}`).join(' · ') : 'No AI requests yet today.') +
      (sr ? `<br>Web searches today: ${Number(sr.today) || 0} of ${Number(sr.cap_day) || 0}${sr.month ? ` (${Number(sr.month) || 0} this month)` : ''}` : '') +
      (u.cost_month ? `<br>Claude this month: about <b>$${(Number(u.cost_month.usd) || 0).toFixed(2)}</b> (${Math.round((Number(u.cost_month.tokens) || 0) / 1000)}k tokens, estimate). Your real bill is at console.anthropic.com.` : '<br>Your exact free limits are listed in Google AI Studio.');
  }).catch(() => { $('#sUsage') && ($('#sUsage').textContent = ''); });

  api('calendars.list').then(cals => {
    const el = $('#sCals'); if (!el) return;
    el.classList.remove('muted', 'small');
    const fam = (state.familyCount || 0) > 0;
    el.innerHTML = cals.map(c => `<div class="row cal-row"><label class="row grow"><input type="checkbox" data-sel value="${esc(c.id)}" ${c.selected ? 'checked' : ''}>
      <span class="grow">${esc(c.name)}${c.primary ? ' <span class="muted small">(yours)</span>' : ''}${!c.owned && !c.primary ? ' <span class="muted small">shared</span>' : ''}</span></label>
      ${fam ? `<label class="fam-tog"><input type="checkbox" data-fam value="${esc(c.id)}" ${c.family ? 'checked' : ''}> Family</label>` : ''}</div>`).join('');
    if (fam) {
      $('#sFamTargetF').classList.remove('hidden');
      $('#sFamTarget').innerHTML = cals.filter(c => !c.primary).map(c => `<option value="${esc(c.id)}" ${c.family_target ? 'selected' : ''}>${esc(c.name)}</option>`).join('') || '<option value="">(no shared calendar yet)</option>';
    }
  }).catch(e => { $('#sCals') && ($('#sCals').textContent = 'Could not load calendars: ' + e.message); });

  $$('#sAllergy [data-m]').forEach(b => b.onclick = () => b.classList.toggle('on'));
  $('#sLoc').onclick = e => {
    const btn = e.currentTarget;
    if (!navigator.geolocation) return toast('Location not available.', true);
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(p => {
      $('#sLat').value = p.coords.latitude.toFixed(3); $('#sLon').value = p.coords.longitude.toFixed(3);
      btn.disabled = false; toast('Location filled in. Tap Save.');
    }, err => { btn.disabled = false; toast(err.message, true); }, { timeout: 15000 });
  };
  bindNotifyCard();
  $('#sScan').onclick = e => busy(e.currentTarget, async () => {
    const list = await api('email.scan', {}, { timeoutMs: 180000 });
    toast(list.length ? `${list.length} item(s) waiting on Today.` : 'Nothing new found.');
    invalidate();
  }).catch(fail);
  $('#sClear').onclick = e => { if (confirm('Clear chat history?')) busy(e.currentTarget, async () => { await api('chat.clear'); state.chat = []; saveCache(); toast('Cleared.'); }).catch(fail); };
  $('#sSave').onclick = e => busy(e.currentTarget, async () => {
    const calBoxes = $$('#sCals input[data-sel]');
    const famBoxes = $$('#sCals input[data-fam]');
    const calendar_ids = calBoxes.filter(b => b.checked).map(b => b.value);
    if (calBoxes.length && !calendar_ids.length) throw new Error('Pick at least one calendar.');
    state.settings = await api('settings.save', {
      ...(calBoxes.length ? { calendar_ids } : {}),
      ...(famBoxes.length ? { member_calendar_ids: famBoxes.filter(b => b.checked).map(b => b.value), member_calendar_id: $('#sFamTarget').value } : {}),
      email_full_search: $('#sFullMail').checked ? 'on' : 'off',
      ai_provider: $('#sProvider').value,
      claude_model_main: $('#sClaudeMain').value.trim() || 'claude-haiku-5-5', claude_model_smart: $('#sClaudeSmart').value.trim() || 'claude-haiku-5-5',
      latitude: $('#sLat').value.trim(), longitude: $('#sLon').value.trim(), units: $('#sUnits').value,
      allergy_months: $$('#sAllergy [data-m].on').map(b => Number(b.dataset.m)),
      brief_hour: $('#sBrief').value, evening_hour: $('#sEve').value,
      about_me: $('#sAbout').value.trim(), assistant_name: $('#sAsstName').value.trim() || 'Bella', email_watch_query: buildWatch(watchList, $('#sWatchExtra').value),
      model_main: $('#sModelMain').value.trim() || 'auto', model_smart: $('#sModelSmart').value.trim() || 'auto',
      people: plist.map(p => ({ ...p, name: String(p.name || '').trim() || 'Person' })),
      app_url: location.origin + location.pathname
    });
    if (state.settings?.assistant_name) lsSet('homebase.assistant', state.settings.assistant_name);
    invalidate(); refreshAll();
    toast('Saved.');
  }).catch(fail);
}

// ---------------- app updates ----------------
// A new version is checked for whenever the app comes back to the screen (at most every 10 minutes); when it has
// taken over, a small "New version — tap to reload" appears.
function watchUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let lastCheck = Date.now();
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - lastCheck < 10 * 60 * 1000) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || $('#updPrompt')) return;      // first install: nothing to reload
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'updPrompt'; b.className = 'toast upd-toast';
    b.textContent = 'New version — tap to reload';
    b.onclick = () => location.reload();
    document.body.appendChild(b);
  });
}

// ---------------- boot ----------------
handleJoin();
try { Object.keys(localStorage).filter(k => k.startsWith('homebase.tts.')).forEach(k => localStorage.removeItem(k)); } catch { /* fine */ }   // kept phrases used to live here
route();
window.__hbBooted = true;          // the first screen is up: the "couldn't start" box is not needed
if ($('#bootError')) $('#bootError').hidden = true;
maybeTalkOnOpen();
if (tasteQueue.length) setTimeout(tasteFlush, 4000);   // quiz answers that didn't reach the backend last time
watchUpdates();
