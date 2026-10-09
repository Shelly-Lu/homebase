// app.js: Homebase PWA (no build step; plain ES modules).
import { api, getCfg, setCfg, isConfigured } from './api.js';

// ---------------- helpers ----------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2600);
}
const fail = e => { console.error(e); toast(e.message || String(e), true); };

function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  return $('#modalBody');
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modalBody').innerHTML = '';
  document.body.style.overflow = '';
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

function todayStr() {
  const d = new Date();
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

// light markdown: escape, **bold**, bullet lines
function md(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^\s*[-*] /gm, '• ');
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
  tasks: cached.tasks || null, meals: cached.meals || null, journal: cached.journal || null,
  chat: cached.chat || null, settings: null, fetchedAt: {},
  me: cached.me || null          // {id, name, role: 'owner'|'member', person_id}
};
const isMember = () => state.me?.role === 'member';

// Invite link from the owner: …#join=<base64 {u: backend url, c: invite code, n: name}>. Signs this phone in.
// Reads an invite link (or just the part after "#join="). Returns {u, c, n} or null.
function parseInvite(text) {
  const m = /#?join=([\w-]+)/.exec(String(text || '').trim());
  if (!m) return null;
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
    return j && j.u && j.c ? j : null;
  } catch { return null; }
}
(function handleJoin() {
  if (!/^#join=/.test(location.hash || '')) return;
  try {
    const j = parseInvite(location.hash);
    if (j) {
      setCfg({ url: j.u, token: j.c });
      forgetLocalData();
      sessionStorage.setItem('homebase.welcome', j.n || 'there');
    }
  } catch { /* bad link: fall through to Settings */ }
  history.replaceState(null, '', location.pathname + '#today');
})();
// Clears everything saved on this phone for the previous person (used when signing in as someone else).
function forgetLocalData() {
  try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem('homebase.today'); localStorage.removeItem('homebase.person'); } catch { /* ignore */ }
  state.today = state.tasks = state.meals = state.chat = state.me = state.journal = null;
  state.fetchedAt = {}; state.chatFresh = false;
}
let saveTimer = null;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ me: state.me, today: state.today, tasks: state.tasks, meals: (state.meals || []).slice(0, 150), journal: state.journal, chat: (state.chat || []).filter(m => !m.typing).slice(-30) })); }
    catch { try { localStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable */ } }
  }, 250);
}
function saveToday() { saveCache(); }
const isStale = key => !state[key] || !state.fetchedAt[key] || Date.now() - state.fetchedAt[key] > FRESH_MS;
// Something changed on the server: keep showing what we have, fetch fresh copies next time a tab opens.
function invalidate() { state.fetchedAt = {}; }
// Applies a task change right away, so lists don't wait for the refresh.
function patchTask(t, removed) {
  if (!t) return;
  if (state.tasks) state.tasks = removed ? state.tasks.filter(x => x.id !== t.id)
    : state.tasks.some(x => x.id === t.id) ? state.tasks.map(x => (x.id === t.id ? t : x)) : [...state.tasks, t];
  if (state.today?.tasks_due) state.today.tasks_due = state.today.tasks_due.filter(x => x.id !== t.id);
  invalidate(); saveCache();
}

let bootP = null;
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
  if (bootP) return bootP;
  bootP = fetchAll().then(b => {
    if (!b || typeof b !== 'object' || !b.today) throw new Error('The backend sent an empty answer. Deploy a New version of the web app and try again.');
    state.today = b.today;
    if (b.me) {
      state.me = b.me;
      const hi = sessionStorage.getItem('homebase.welcome');
      if (hi) { sessionStorage.removeItem('homebase.welcome'); toast(`Welcome, ${b.me.name}! You're signed in.`); }
    }
    if (b.family !== undefined && b.family !== null) state.familyCount = b.family;
    if (b.tasks) state.tasks = b.tasks;
    if (b.meals) state.meals = b.meals;
    const now = Date.now();
    ['today', 'tasks', 'meals'].forEach(k => { state.fetchedAt[k] = now; });
    saveCache();
    repaintIfIdle();
  }).catch(e => { if (!state.today) fail(e); else console.warn('refresh failed', e); })
    .finally(() => { bootP = null; });
  return bootP;
}
function currentTab() { return (location.hash || '#today').slice(1).split('?')[0] || 'today'; }
// Repaints the open tab with fresh data, unless you're in the middle of something (a dialog, typing).
function repaintIfIdle() {
  if (!$('#modal').hidden) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && view.contains(ae)) return;
  const tab = currentTab();
  if (tab === 'today') paintToday();
  else if (tab === 'tasks' && state.taskView !== 'log') paintTasks();
  else if (tab === 'food') paintFood();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && isStale('today')) refreshAll(); });


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
  window.scrollTo(0, 0);
  VIEWS[name]();
}
window.addEventListener('hashchange', route);
$('#settingsBtn').addEventListener('click', () => (location.hash = '#settings'));

// ================= TODAY =================
async function renderToday() {
  paintToday();
  if (isStale('today')) refreshAll();
}

function paintToday() {
  saveCache();
  const t = state.today;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  if (!t) {
    view.innerHTML = `<div class="hello">${greet}<small>${dateLine}</small></div>
      <div class="card"><div class="skeleton" style="height:90px"></div></div>
      <div class="card"><div class="skeleton" style="height:240px"></div></div>`;
    return;
  }
  const wx = t.weather || {};
  view.innerHTML = `
    <div class="hello">${greet}<small>${dateLine}${t.today !== todayStr() ? ' · updating…' : ''}</small></div>
    <div id="quickSlot"></div>
    ${weatherCard(wx, t)}
    ${t.suggestions?.length ? suggestionsCard(t.suggestions) : ''}
    <div class="card">
      <h2>Due soon</h2>
      ${t.tasks_due?.length ? t.tasks_due.map(taskRow).join('') : '<div class="muted small">Nothing due in the next two days. 🎉</div>'}
    </div>
    <div class="card">
      <h2>Next 7 days</h2>
      ${eventsList(t.events || [])}
    </div>`;

  $('#quickSlot').replaceWith(quickBox());   // the same box survives repaints (typed text, attachment, result)
  bindTaskRows(view, () => renderToday());
  bindSuggestions();
}

// What to bring: after 6pm it shows tomorrow's.
const CARRY_ICON = { coat: '🧥', jacket: '🧥', umbrella: '☂️', boots: '🥾', sun: '🕶️', water: '💧', allergy: '🤧' };
function carryHtml(t) {
  const evening = new Date().getHours() >= 18 && t.tomorrow_carry;
  const c = evening ? t.tomorrow_carry : t.carry;
  if (!c) return '';
  return `<div class="carry"><div class="muted small">${evening ? 'Tomorrow, bring' : 'Bring'}</div>
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
    <div class="sug" data-id="${s.id}">
      <div style="font-weight:650">${esc(s.title)}</div>
      <div class="muted small">${s.date ? esc(niceDate(s.date)) + (s.time ? ' · ' + time12(s.time) : '') + ' · ' : ''}${esc(s.details || '')}
        ${s.link ? ` · <a href="${esc(s.link)}" target="_blank" rel="noopener">open email</a>` : ''}</div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn small primary" data-act="accept">${s.type === 'appointment' && s.date ? 'Add to calendar' : s.type === 'info' ? 'Got it' : 'Add as to-do'}</button>
        <button class="btn small ghost" data-act="dismiss">Dismiss</button>
      </div>
    </div>`).join('')}</div>`;
}
function bindSuggestions() {
  $$('#sugCard .sug').forEach(el => {
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      busy(b, async () => {
        await api(b.dataset.act === 'accept' ? 'suggestions.accept' : 'suggestions.dismiss', { id: el.dataset.id });
        el.remove();
        state.today.suggestions = state.today.suggestions.filter(s => s.id !== el.dataset.id);
        if (!state.today.suggestions.length) $('#sugCard')?.remove();
        toast(b.dataset.act === 'accept' ? 'Added.' : 'Dismissed.');
      }).catch(fail);
    });
  });
}

function eventsList(events) {
  if (!events.length) return '<div class="muted small">No calendar events.</div>';
  let html = '', lastDay = '';
  events.forEach(e => {
    const day = e.start.slice(0, 10);
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
  if (!t.interval_days) return t.next_due ? 'one-time · due ' + niceDate(t.next_due) : 'one-time';
  const base = `every ${t.interval_days} day${t.interval_days > 1 ? 's' : ''}`;
  const mode = t.interval_mode === 'ai' ? ' · AI guess' : t.interval_mode === 'learned' ? ' · learned' : '';
  return base + mode + (t.last_done ? ` · last ${rel(t.last_done)}` : '');
}
function taskRow(t) {
  return `<div class="list-row" data-task="${t.id}">
    <button class="check" data-done="${t.id}" aria-label="Mark done">${CHECK}</button>
    <div class="grow tap" data-edit="${t.id}"><div class="title">${t.private ? '<span class="lock" title="Only you can see this">🔒</span> ' : ''}${esc(t.name)}</div><div class="meta">${esc(freqText(t))}</div></div>
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
  $$('[data-edit]', root).forEach(el => el.addEventListener('click', async () => {
    let t = (state.tasks || []).find(x => x.id === el.dataset.edit) || (state.today?.tasks_due || []).find(x => x.id === el.dataset.edit);
    openTaskEditor(t, after);
  }));
}

async function renderTasks() {
  if (state.taskView === 'log') return renderLog();
  view.innerHTML = state.tasks ? '' : '<div class="card"><div class="skeleton" style="height:200px"></div></div>';
  if (state.tasks) paintTasks();
  if (isStale('tasks')) refreshAll();
}
// To do | Log switch at the top of the Tasks tab
function taskTabsHtml() {
  return '';   // the Log lives in the spreadsheet's Journal tab; the assistant searches it
  const v = state.taskView === 'log' ? 'log' : 'todo';
  return `<div class="seg task-seg" id="taskSeg"><button type="button" data-v="todo" class="${v === 'todo' ? 'on' : ''}">To do</button><button type="button" data-v="log" class="${v === 'log' ? 'on' : ''}">Log</button></div>`;
}
function bindTaskTabs() {
  $$('#taskSeg button').forEach(b => b.onclick = () => { state.taskView = b.dataset.v; lsSet('homebase.taskView', b.dataset.v); renderTasks(); });
}
function paintTasks() {
  if (state.taskView === 'log') return paintLog();
  saveCache();
  const all = state.tasks || [];
  // Shown: overdue, today and tomorrow. Folded: the rest of this week and next. Further out stays in the spreadsheet.
  // Recurring chores only show up when they're due; otherwise they wait, folded, at the end.
  const recurring = all.filter(t => t.interval_days && (t.days_until === null || t.days_until > 0));
  const oneTime = all.filter(t => !recurring.includes(t));
  const by = (lo, hi) => oneTime.filter(t => t.days_until !== null && t.days_until >= lo && t.days_until <= hi);
  const attention = oneTime.filter(t => t.days_until !== null && t.days_until <= 0);
  const tomorrow = by(1, 1), week = by(2, 7), twoWeeks = by(8, 14);
  const beyond = oneTime.filter(t => t.days_until === null || t.days_until > 14).length;
  state.taskFolds = state.taskFolds || {};
  const section = (name, list) => `<div class="section-title">${name}<span>${list.length}</span></div><div class="card">${list.map(taskRow).join('')}</div>`;
  const fold = (key, name, list) => list.length ? `<details class="later" data-fold="${key}" ${state.taskFolds[key] ? 'open' : ''}>
      <summary><span>${name}</span><span class="muted small">${list.length} task${list.length > 1 ? 's' : ''}</span></summary>
      <div class="card">${list.map(taskRow).join('')}</div></details>` : '';
  view.innerHTML = taskTabsHtml() + (!all.length
    ? `<div class="empty"><div class="big">No tasks yet</div>Add one with +, or just tell Homebase:<br>“remind me to renew the passport in December”.</div>`
    : (attention.length ? section('Needs attention', attention) : '') +
      (tomorrow.length ? section('Tomorrow', tomorrow) : '') +
      (!attention.length && !tomorrow.length ? '<div class="empty small">Nothing due today or tomorrow. 🎉</div>' : '') +
      fold('week', 'Next 7 days', week) + fold('two', 'Next 14 days', twoWeeks) +
      (beyond ? `<div class="muted small" style="margin:12px 4px">+${beyond} more after that, in the spreadsheet's Tasks tab. Ask Homebase anytime, e.g. “what's due next month?”</div>` : '') +
      fold('rec', 'Recurring', recurring));
  $$('details[data-fold]').forEach(d => d.addEventListener('toggle', () => { state.taskFolds[d.dataset.fold] = d.open; }));
  bindTaskTabs();
  bindTaskRows(view, () => renderTasks());
  addFab(() => openTaskEditor(null, () => renderTasks()));
}

// ---------------- Log: everything that happened (the Journal) ----------------
state.taskView = 'todo';
state.logQuery = '';
const LOG_CATS = ['health', 'kids', 'school', 'pets', 'home', 'car', 'money', 'food', 'other'];
async function renderLog() {
  paintLog();
  if (!state.journal || isStale('journal')) {
    try {
      state.journal = await api('journal.list', { limit: 300 });
      state.fetchedAt.journal = Date.now(); saveCache();
      if (location.hash === '#tasks' && state.taskView === 'log' && $('#modal').hidden) paintLog(true);
    } catch (e) { if (!state.journal) fail(e); }
  }
}
function paintLog(keepSearch) {
  const list = state.journal;
  const q = state.logQuery.trim().toLowerCase();
  const shown = (list || []).filter(r => !q || (r.text + ' ' + r.category + ' ' + r.people + ' ' + r.date).toLowerCase().includes(q));
  const prevFocus = document.activeElement?.id === 'logQ';
  const html = `${taskTabsHtml()}
    <label class="field log-search"><input type="search" id="logQ" placeholder="Search the log… (fever, oil change, 身高)" value="${esc(state.logQuery)}" autocomplete="off"></label>
    ${!list ? '<div class="card"><div class="skeleton" style="height:160px"></div></div>'
      : !list.length ? `<div class="empty"><div class="big">Nothing logged yet</div>Tell Homebase what happened, on Home or in Chat:<br>“Drey had a fever of 101 last night”, “oil change at 45,000 miles, $89”.<br>Ask later: “when was the last oil change?”</div>`
      : !shown.length ? '<div class="empty small">No records match. Try fewer words, or ask the chat.</div>'
      : groupByMonth(shown).map(([month, rows]) => `<div class="section-title">${esc(month)}<span>${rows.length}</span></div>
          <div class="card">${rows.map(logRow).join('')}</div>`).join('')}`;
  view.innerHTML = html;
  bindTaskTabs();
  const qi = $('#logQ');
  qi.addEventListener('input', () => { state.logQuery = qi.value; paintLog(true); });
  if (keepSearch && prevFocus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  $$('[data-log]').forEach(el => el.onclick = () => openLogEditor((state.journal || []).find(r => r.id === el.dataset.log)));
  addFab(() => openLogEditor(null));
}
function groupByMonth(rows) {
  const out = [];
  rows.forEach(r => {
    const m = new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const last = out[out.length - 1];
    if (last && last[0] === m) last[1].push(r); else out.push([m, [r]]);
  });
  return out;
}
function logRow(r) {
  return `<div class="list-row log-row tap" data-log="${esc(r.id)}">
    <div class="log-date">${esc(niceDate(r.date))}${r.time ? `<br><span class="muted small">${esc(time12(r.time))}</span>` : ''}</div>
    <div class="grow"><div>${r.private ? '<span class="lock">🔒</span> ' : ''}${esc(r.text)}</div>
      ${r.category || r.people ? `<div class="meta">${[r.category, r.people].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</div>
  </div>`;
}
function openLogEditor(r) {
  const isNew = !r;
  r = r || { text: '', date: todayStr(), category: '', people: '', private: false, user: state.me?.id || 'owner' };
  const mine = (r.user || 'owner') === (state.me?.id || 'owner');
  const canDelete = !isNew && (mine || !isMember());
  openModal(`<h3>${isNew ? 'Log something' : 'Record'}</h3>
    <label class="field"><span>What happened</span><textarea id="lgText" rows="3" placeholder="e.g. Drey's height 128 cm at the checkup">${esc(r.text)}</textarea></label>
    <div class="two">
      <label class="field"><span>Date</span><input type="date" id="lgDate" value="${esc(r.date)}"></label>
      <label class="field"><span>Category</span><input type="text" id="lgCat" list="lgCats" value="${esc(r.category || '')}"><datalist id="lgCats">${LOG_CATS.map(c => `<option>${c}</option>`).join('')}</datalist></label>
    </div>
    <label class="field"><span>About (optional)</span><input type="text" id="lgPeople" value="${esc(r.people || '')}" placeholder="e.g. Drey"></label>
    ${mine ? `<label class="field check-field row-field"><input type="checkbox" id="lgPrivate" ${r.private ? 'checked' : ''}><span>Only me <span class="muted small">(hidden from the rest of the family)</span></span></label>` : ''}
    <div class="btn-row"><button class="btn primary" id="lgSave">Save</button>${canDelete ? '<button class="btn danger" id="lgDel">Delete</button>' : ''}</div>`);
  if (isNew) setTimeout(() => $('#lgText')?.focus(), 50);
  $('#lgSave').onclick = e => {
    const text = $('#lgText').value.trim();
    if (!text) return toast('Write what happened.', true);
    const data = { text, date: $('#lgDate').value || todayStr(), category: $('#lgCat').value.trim(), people: $('#lgPeople').value.trim() };
    if (!isNew) data.id = r.id;
    if ($('#lgPrivate')) data.private = $('#lgPrivate').checked;
    busy(e.currentTarget, async () => {
      const saved = await api('journal.save', data);
      state.journal = [saved, ...(state.journal || []).filter(x => x.id !== saved.id)].sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
      saveCache(); closeModal(); toast('Saved.'); paintLog();
    }).catch(fail);
  };
  $('#lgDel')?.addEventListener('click', e => {
    if (!confirm('Delete this record?')) return;
    busy(e.currentTarget, async () => {
      await api('journal.delete', { id: r.id });
      state.journal = (state.journal || []).filter(x => x.id !== r.id);
      saveCache(); closeModal(); paintLog();
    }).catch(fail);
  });
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
  const body = openModal(`
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
    <label class="field"><span>Category</span><input type="text" id="tCat" list="catList" value="${esc(t.category || '')}" placeholder="pets, home, kids…">
      <datalist id="catList"><option>pets</option><option>home</option><option>kids</option><option>health</option><option>car</option><option>garden</option><option>personal</option></datalist></label>
    <label class="field"><span>Notes</span><textarea id="tNotes" rows="2">${esc(t.notes || '')}</textarea></label>
    ${canSetPrivacy ? `<label class="field check-field row-field"><input type="checkbox" id="tPrivate" ${t.private ? 'checked' : ''}><span>Only me <span class="muted small">(hidden from the rest of the family)</span></span></label>` : ''}
    <div class="btn-row"><button class="btn primary" id="tSave">Save</button>${isNew ? '' : '<button class="btn danger" id="tDel">Delete</button>'}</div>
    ${isNew ? '' : '<div class="section-title" style="margin-left:0">History</div><div id="tHist" class="muted small">Loading…</div>'}`);

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
  if (isNew) setTimeout(() => $('#tName')?.focus(), 50);

  if (!isNew) api('tasks.history', { id: t.id, limit: 10 }).then(h => {
    $('#tHist') && ($('#tHist').innerHTML = h.length ? h.map(x => `<div class="hist">✓ ${esc(niceDate(x.date_done))}${x.note && x.note !== 'initial' ? ' · ' + esc(x.note) : ''}</div>`).join('') : 'Not done yet.');
  }).catch(() => {});

  $('#tSave').onclick = e => {
    const name = $('#tName').value.trim();
    if (!name) return toast('Give it a name.', true);
    const data = { name, category: $('#tCat').value.trim(), notes: $('#tNotes').value.trim() };
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
      const saved = await api('tasks.save', data);
      closeModal();
      toast(saved.interval_mode === 'ai' && saved.interval_reason ? `Every ${saved.interval_days} days. ${saved.interval_reason}` : 'Saved.');
      patchTask(saved); after?.();
    }).catch(fail);
  };
  $('#tDel')?.addEventListener('click', e => {
    if (!confirm(`Delete "${t.name}"?`)) return;
    busy(e.currentTarget, async () => { await api('tasks.delete', { id: t.id }); closeModal(); patchTask(t, true); after?.(); }).catch(fail);
  });
}

// ================= shared helpers =================
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* optional */ } };

// --- people in the household ---
function parsePeople(str) {
  try { const l = JSON.parse(str || '[]'); if (Array.isArray(l) && l.length) return l; } catch { /* default */ }
  return [{ id: 'me', name: 'Me', kind: 'adult', notes: '' }];
}
function people() { return state.today?.people || parsePeople(state.settings?.people); }
function personName(id) { const ps = people(); return (ps.find(p => p.id === id) || ps[0]).name; }
function myPersonId() { return state.me?.person_id || 'me'; }
function setPerson(id) { lsSet('homebase.person', id); }

// --- photo cache: memory + IndexedDB (photos are small images fetched from Drive through the backend) ---
const photoMem = new Map();
const photoInflight = new Set();
let photoDb = null;
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
function paintPhotos() {
  $$('[data-photo]').forEach(el => {
    const u = photoMem.get(el.dataset.photo);
    if (u && el.dataset.shown !== '1') { el.style.backgroundImage = `url("${u}")`; el.dataset.shown = '1'; el.classList.add('has'); }
  });
}
// Fills every [data-photo] element on screen. Missing photos are fetched 12 at a time.
async function ensurePhotos(extraIds = []) {
  const ids = [...new Set([...$$('[data-photo]').map(e => e.dataset.photo), ...extraIds].filter(Boolean))];
  const need = [];
  const missing = ids.filter(id => !photoMem.has(id));
  const fromDisk = await Promise.all(missing.map(id => idbGet(id)));   // read the phone's copies in parallel
  missing.forEach((id, i) => { if (fromDisk[i]) photoMem.set(id, fromDisk[i]); else need.push(id); });
  paintPhotos();
  const todo = need.filter(id => !photoInflight.has(id));
  todo.forEach(id => photoInflight.add(id));
  for (let i = 0; i < todo.length; i += 12) {
    const chunk = todo.slice(i, i + 12);
    try {
      const got = await api('photos.get', { ids: chunk });
      Object.entries(got || {}).forEach(([id, u]) => { photoMem.set(id, u); idbPut(id, u); });
    } catch (e) { console.error(e); }
    chunk.forEach(id => photoInflight.delete(id));
    paintPhotos();
  }
}

// --- image helpers (all on the phone) ---
function loadImg(src) {
  return new Promise((ok, no) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => no(new Error("Couldn't read that photo.")); img.src = src; });
}
async function decodeImage(fileOrBlob) {
  try { return await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' }); }
  catch { return loadImg(URL.createObjectURL(fileOrBlob)); }
}
// Meal photos are stored at this size (longest side); receipts larger so the small print stays readable.
const PHOTO_MAX = 800, RECEIPT_MAX = 1600;

// Longest side `max`, as a JPEG on white. Returns {url, data, mime}.
async function shrinkImage(file, max = PHOTO_MAX, quality = 0.84) {
  const bmp = await decodeImage(file);
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
// A stored photo (jpeg/png data URL) as a JPEG on white, for sending to AI.
async function urlToJpegData(url) {
  const img = await loadImg(url);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.8).split(',')[1];
}

// ================= FOOD =================
const MEALS = [['breakfast', 'Breakfast', '🥞'], ['lunch', 'Lunch', '🥗'], ['dinner', 'Dinner', '🍲'], ['snack', 'Snack', '🍎'], ['dessert', 'Dessert', '🍰'], ['drink', 'Drink', '🧋']];
const SOURCES = [['homemade', 'Homemade'], ['restaurant', 'Restaurant'], ['takeout', 'Takeout'], ['packaged', 'Packaged']];
const TAGS = ['sweet', 'savory', 'spicy', 'fried', 'soup', 'noodles', 'rice', 'light', 'heavy', 'high-protein', 'veggie-rich', 'vegetarian', 'seafood', 'comfort', 'healthy', 'treat'];
const NEEDS = [['weight loss', 'Losing weight'], ['craving sweet', 'Craving sweet'], ['craving savory', 'Craving savory'], ['something light', 'Something light'],
  ['comfort food', 'Comfort food'], ['high protein', 'High protein'], ['on my period', 'On my period'], ['low energy', 'Low energy'],
  ['something new', 'Something new'], ['quick and easy', 'Quick & easy'], ['budget', 'Budget'], ['kid-friendly', 'Kid-friendly']];
const WHERE = [['home', '🏠', 'Cook at home'], ['out', '🍽️', 'Eat out'], ['takeout', '🥡', 'Takeout'], ['any', '🎲', 'Surprise me']];
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
  if (state.meals) paintFood();
  else view.innerHTML = '<div class="card"><div class="skeleton" style="height:160px"></div></div><div class="card"><div class="skeleton" style="height:220px"></div></div>';
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
  saveCache();
  const all = state.meals || [];
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
      <div class="muted small">A few quick questions, then three ideas from what you've been eating.</div>
      <button class="btn primary block" id="fGuess" style="margin-top:12px">Guess what I want to eat</button>
    </div>
    ${ps.length > 1 ? `<div class="fchips" id="fFilter"><button data-f="all" class="${f === 'all' ? 'on' : ''}">Everyone</button>${ps.map(p => `<button data-f="${esc(p.id)}" class="${f === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    ${weekSummary(list) ? `<div class="muted small food-week">${esc(weekSummary(list))}</div>` : ''}
    ${days.length ? days.map(d => `<div class="section-title">${esc(dayTitle(d.date))}<span>${d.items.length}</span></div><div class="card meal-list">${d.items.map(mealRow).join('')}</div>`).join('')
      : `<div class="card empty-food"><div class="big">📷</div><div>Snap your meals with <b>+</b>, add the receipt if you have one, and Homebase fills in the rest.</div><div class="muted small" style="margin-top:6px">Or just tell the chat: "had pho at Pho 75 for lunch".</div></div>`}
    ${list.length > shown.length ? `<button class="btn ghost block" id="fMore">Show earlier meals</button>` : ''}
    <div class="spacer"></div>`;
  $('#fGuess').onclick = () => openGuess();
  $$('#fFilter [data-f]').forEach(b => b.onclick = () => { state.ffilter = b.dataset.f; paintFood(); });
  $('#fMore')?.addEventListener('click', () => { state.fshow += 60; paintFood(); });
  $$('[data-meal]', view).forEach(b => b.onclick = () => { const m = (state.meals || []).find(x => x.id === b.dataset.meal); if (m) openMealEditor(m); });
  ensurePhotos();
}

function upsertMeal(m, removed) {
  const l = (state.meals || []).filter(x => x.id !== m.id);
  if (!removed) l.push(m);
  state.meals = l.sort((a, b) => ((b.date + (b.time || '99')) > (a.date + (a.time || '99')) ? 1 : -1));
  invalidate(); saveCache();
  if (location.hash === '#food') paintFood();
}

// --- add / edit a meal ---
// Stage 1 (new meal): food photo, optional receipt, a note, who ate → "Read it" (AI) or fill in by hand.
// Stage 2: the form (pre-filled by the AI), then Save.
function openMealEditor(meal, prefill) {
  const draft = { photo: null, receipt: null, people: meal?.people || prefill?.people || [myPersonId()], taken: null };
  if (meal || prefill) return mealForm(meal, prefill || {}, draft);
  const ps = people();
  openModal(`<h3>Add a meal</h3>
    <div class="snap-row">
      <label class="snap" id="snapFood"><input type="file" accept="image/*" id="mPhoto" hidden><span class="ph snap-ph" id="mPhotoPh"><span class="ph-i">📷</span></span><span class="small">Food photo</span></label>
      <label class="snap" id="snapRcpt"><input type="file" accept="image/*" id="mRcpt" hidden><span class="ph snap-ph" id="mRcptPh"><span class="ph-i">🧾</span></span><span class="small">Receipt <span class="muted">(optional)</span></span></label>
    </div>
    <label class="field"><span>Anything to add? (optional)</span><input type="text" id="mHint" placeholder="e.g. half portion, shared with Drey" maxlength="200"></label>
    ${ps.length > 1 ? `<div class="field"><span>Who ate</span><div class="fchips" id="mWho">${ps.map(p => `<button type="button" data-p="${esc(p.id)}" class="${draft.people.includes(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
    <button class="btn primary block" id="mRead">Read it</button>
    <button class="btn ghost block" id="mByHand" style="margin-top:6px">Fill in by hand</button>`);
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
  $('#mByHand').onclick = () => mealForm(null, { note: $('#mHint').value.trim() }, draft);
  $('#mRead').onclick = e => {
    const hint = $('#mHint').value.trim();
    if (!draft.photo && !draft.receipt && !hint) return toast('Add a photo, a receipt or a few words first.', true);
    const t = draft.taken || new Date();
    busy(e.currentTarget, async () => {
      e.currentTarget.textContent = 'Reading…';
      const r = await api('meals.analyze', {
        photo: draft.photo ? { data: draft.photo.data, mime: draft.photo.mime } : undefined,
        receipt: draft.receipt ? { data: draft.receipt.data, mime: draft.receipt.mime } : undefined,
        hint, date: dayOf(t), time: nowHHMM(t), people: draft.people
      }, { timeoutMs: 90000 });
      mealForm(null, { ...r, note: hint, ai: true }, draft);
    }).catch(fail);
  };
}

function mealForm(meal, pre, draft) {
  const m = meal || {};
  const v = k => (pre[k] !== undefined ? pre[k] : m[k]);
  const ps = people();
  const t = draft.taken || new Date();
  const val = {
    meal: v('meal') || mealByTime(v('time') || nowHHMM(t)), source: v('source') || 'homemade',
    tags: [...(v('tags') || [])], rating: v('rating') === undefined || v('rating') === null ? '' : v('rating'),
    people: [...(meal ? m.people || [] : draft.people)]
  };
  const photoSrc = draft.photo?.url;
  openModal(`<h3>${meal ? 'Meal' : 'Check and save'}</h3>
    ${photoSrc || m.photo_id || m.receipt_id ? `<div class="meal-photos">${photoSrc ? `<span class="ph meal-big has" style="background-image:url('${photoSrc}')"></span>` : m.photo_id ? `<span class="ph meal-big" data-photo="${esc(m.photo_id)}"><span class="ph-i">${mealIcon(m.meal)}</span></span>` : ''}
      ${draft.receipt?.url ? `<span class="ph meal-rc has" style="background-image:url('${draft.receipt.url}')"></span>` : m.receipt_id ? `<span class="ph meal-rc" data-photo="${esc(m.receipt_id)}"><span class="ph-i">🧾</span></span>` : ''}</div>` : ''}
    ${meal ? `<label class="snap-inline small"><input type="file" accept="image/*" id="fNewPhoto" hidden>${m.photo_id ? 'Change photo' : '📷 Add a photo'}</label>` : ''}
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
  $('#fSave').onclick = e => busy(e.currentTarget, async () => {
    const name = $('#fName').value.trim();
    if (!name) throw new Error('Give it a name.');
    const photo = newPhoto || draft.photo;
    const saved = await api('meals.save', {
      id: meal?.id, name, meal: val.meal, source: val.source, place: $('#fPlace').value.trim(), cuisine: $('#fCuisine').value.trim(),
      date: $('#fDate').value || todayStr(), time: $('#fTime').value, people: val.people.length ? val.people : [myPersonId()],
      calories: $('#fKcal').value, protein_g: $('#fProt').value, price: $('#fPrice').value, ingredients: $('#fIng').value,
      tags: val.tags, rating: val.rating, note: $('#fNote').value.trim(), ai: !!pre.ai,
      photo: photo ? { data: photo.data, mime: photo.mime } : undefined,
      receipt: !meal && draft.receipt ? { data: draft.receipt.data, mime: draft.receipt.mime } : undefined
    }, { timeoutMs: 60000 });
    if (photo && saved.photo_id) { photoMem.set(saved.photo_id, photo.url); idbPut(saved.photo_id, photo.url); }
    if (!meal && draft.receipt && saved.receipt_id) { photoMem.set(saved.receipt_id, draft.receipt.url); idbPut(saved.receipt_id, draft.receipt.url); }
    closeModal();
    upsertMeal(saved);
    toast(meal ? 'Saved.' : `Logged ${mealLabel(saved.meal).toLowerCase()}.`);
  }).catch(fail);
  $('#fDel')?.addEventListener('click', e => {
    if (!confirm(`Delete "${m.name}"?`)) return;
    busy(e.currentTarget, async () => { await api('meals.delete', { id: m.id }); closeModal(); upsertMeal(m, true); }).catch(fail);
  });
}

// --- "Guess what I want to eat": a few questions, then three ideas ---
function openGuess(prev) {
  const ps = people();
  let saved = {};
  try { saved = JSON.parse(lsGet('homebase.guess', '{}')) || {}; } catch { saved = {}; }
  const a = prev || { people: [myPersonId()], where: saved.where || '', meal: mealByTime(), effort: saved.effort || 'normal', needs: [], note: '' };
  openModal(`<h3>What are you in the mood for?</h3>
    ${ps.length > 1 ? `<div class="field"><span>Who's eating?</span><div class="fchips" id="gWho">${ps.map(p => `<button type="button" data-p="${esc(p.id)}" class="${a.people.includes(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
    <div class="field"><span>Where?</span><div class="where-grid" id="gWhere">${WHERE.map(([k, i, l]) => `<button type="button" data-v="${k}" class="${a.where === k ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('')}</div></div>
    <div class="field"><span>Which meal?</span><div class="fchips wrap" id="gMeal">${MEALS.filter(x => x[0] !== 'drink').map(([k, l, i]) => `<button type="button" data-v="${k}" class="${a.meal === k ? 'on' : ''}">${i} ${l}</button>`).join('')}</div></div>
    <div class="field" id="gEffortF"><span>How much effort?</span><div class="seg" id="gEffort">${EFFORT.map(([k, l]) => `<button type="button" data-v="${k}" class="${a.effort === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field"><span>Anything going on? <span class="muted">(pick any)</span></span><div class="fchips wrap" id="gNeeds">${NEEDS.map(([k, l]) => `<button type="button" data-v="${esc(k)}" class="${a.needs.includes(k) ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <label class="field"><span>Anything else? <span class="muted">(optional)</span></span><input type="text" id="gNote" value="${esc(a.note)}" maxlength="200" placeholder="e.g. have chicken and rice; nothing too spicy"></label>
    <button class="btn primary block" id="gGo">Guess!</button>`);
  const effortShow = () => { $('#gEffortF').hidden = !(a.where === 'home' || a.where === 'any' || !a.where); };
  const one = (id, key) => $$(`#${id} [data-v]`).forEach(b => b.onclick = () => {
    $$(`#${id} [data-v]`).forEach(x => x.classList.remove('on')); b.classList.add('on'); a[key] = b.dataset.v; effortShow();
  });
  one('gWhere', 'where'); one('gMeal', 'meal'); one('gEffort', 'effort');
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
  let r;
  try {
    r = await api('meals.recommend', { people: a.people, where: a.where, meal: a.meal, effort: a.where === 'home' || a.where === 'any' ? a.effort : '', needs: a.needs, note: a.note, exclude: seen }, { timeoutMs: 90000 });
  } catch (e) { closeModal(); return fail(e); }
  if ($('#modal').hidden) return;   // closed while waiting
  const ideas = r.ideas || [];
  const whereIcon = w => (WHERE.find(x => x[0] === w) || WHERE[0])[1];
  const whereText = x => x.where === 'home' ? 'Cook at home' : (x.place ? x.place : x.where === 'takeout' ? 'Takeout' : 'Eat out') + (x.cuisine ? ' · ' + x.cuisine : '');
  openModal(`<h3>How about…</h3>
    ${r.intro ? `<div class="muted small" style="margin:-4px 0 10px">${esc(r.intro)}</div>` : ''}
    ${ideas.map((x, i) => `<div class="idea">
      <div class="idea-head"><span class="idea-i">${whereIcon(x.where)}</span><div class="grow"><b>${esc(x.title)}</b><div class="muted small">${esc(whereText(x))}${x.est_calories ? ` · ~${x.est_calories} kcal` : ''}</div></div></div>
      <div class="idea-why">${esc(x.why)}</div>
      ${x.how ? `<div class="small idea-how">${esc(x.how)}</div>` : ''}
      ${x.ingredients?.length ? `<div class="small muted">Need: ${esc(x.ingredients.join(', '))}</div>` : ''}
      <button type="button" class="btn small" data-pick="${i}">I'll have this</button>
    </div>`).join('') || '<div class="muted">No ideas came back. Try again.</div>'}
    <div class="btn-row" style="margin-top:6px"><button class="btn" id="gMore">Other ideas</button><button class="btn ghost" id="gBack">Change answers</button></div>`);
  $$('[data-pick]').forEach(b => b.onclick = () => {
    const x = ideas[+b.dataset.pick];
    openMealEditor(null, { name: x.title, meal: r.meal || a.meal, source: x.where === 'home' ? 'homemade' : x.where === 'takeout' ? 'takeout' : 'restaurant',
      place: x.place, cuisine: x.cuisine, ingredients: x.ingredients, tags: x.tags, calories: x.est_calories, people: r.people || a.people, date: todayStr(), time: nowHHMM() });
    toast('Tap Save when you eat it.');
  });
  $('#gMore').onclick = () => runGuess(a, [...seen, ...ideas.map(x => x.title)].slice(-12));
  $('#gBack').onclick = () => openGuess(a);
}

// ================= HOME: quick box =================
// Type or say what happened. If the assistant saved something and has no question, a short confirmation
// (with Undo) shows right here; questions and conversations continue in the Chat tab.
let quickEl = null, quickShare = null, quickMic = false, quickTimer = null;
function quickBox() {
  if (quickEl) return quickEl;
  quickEl = document.createElement('div');
  quickEl.className = 'card quick';
  quickEl.innerHTML = `<form id="qForm" class="qform">
      <textarea id="qIn" rows="1" placeholder="Tell me what happened or ask anything…" autocomplete="off"></textarea>
      <div class="qbar">
        <button type="button" class="attach" id="qAttach" aria-label="Add a photo or screenshot">📎</button><input type="file" id="qFile" accept="image/*" hidden>
        ${SR ? '<button type="button" class="attach mic" id="qMic" aria-label="Speak">🎤</button>' : ''}
        <span class="grow muted small" id="qHint"></span>
        <button class="btn primary" id="qSend">Send</button>
      </div></form>
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
  $('#qMic', quickEl)?.addEventListener('click', e => dictate(ta, e.currentTarget, () => { quickMic = true; grow(); }));
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
  const sh = quickShare, viaMic = quickMic;
  quickShare = null; quickMic = false; paintQuickChip();
  ta.value = ''; ta.style.height = 'auto';
  clearTimeout(quickTimer);
  res.innerHTML = '<div class="logged working"><span class="spinner sm"></span> On it…</div>';
  btn.disabled = true;
  const shown = sh ? text + '\n📎 ' + (sh.image ? 'photo' : (sh.text || '').slice(0, 80)) : text;
  try {
    const shared = sh ? { title: sh.title || '', text: (sh.text || '').slice(0, 6000), url: sh.url || '', image: sh.image ? { data: sh.image.data, mime: sh.image.mime } : null } : undefined;
    const r = await api('chat.send', { message: text, shared, mode: 'quick' }, { timeoutMs: 120000 });
    state.chat = state.chat || [];
    state.chat.push({ role: 'user', content: shown }, { role: 'assistant', content: r.reply, charts: r.charts?.length ? r.charts : undefined });
    saveCache();
    invalidate();
    if (viaMic) speak(r.reply);
    if ((r.actions || []).length && !r.asked && !r.charts?.length) showLogged(r);
    else { res.innerHTML = ''; location.hash = '#chat'; }
    refreshAll();
  } catch (e) {
    ta.value = text; res.innerHTML = '';
    fail(e);
  } finally { btn.disabled = false; }
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
      invalidate(); refreshAll();
    }).catch(fail);
  });
}

// Settings card: how this phone listens and reads replies aloud (saved on this phone only).
function voiceCardHtml() {
  const cur = lsGet('homebase.voiceLang', '');
  const rate = Number(lsGet('homebase.voiceRate', '1')) || 1;
  return `<div class="card" id="voiceCard">
      <h2>Voice (this phone)</h2>
      <label class="field"><span>I speak</span><select id="sVoiceLang">${VOICE_LANGS.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Reading voice</span><select id="sVoiceName"></select></label>
      <label class="field"><span>Speed <b id="sRateVal">${rate.toFixed(1)}×</b></span><input type="range" id="sVoiceRate" min="0.7" max="1.5" step="0.1" value="${rate}"></label>
      <div class="row"><button type="button" class="btn small" id="sVoiceTest">▶ Test</button>
        <span class="muted small grow">“Online” voices sound most natural. For more, install voices in Android Settings → Text-to-speech.</span></div>
    </div>`;
}
const langFamily = l => String(l || '').replace('_', '-').slice(0, 2).toLowerCase();
function allVoices() {
  try { return ('speechSynthesis' in window ? speechSynthesis.getVoices() : []) || []; } catch { return []; }
}
function voiceLabel(v) {
  return `${v.name.replace(/\s*\((?:[^)]*)\)\s*$/, '')} · ${String(v.lang).replace('_', '-')} · ${v.localService === false ? 'online' : 'on phone'}`;
}
// The voice to read with: your pick for that language, else an online voice for it, else any match.
function pickVoice(lang) {
  const fam = langFamily(lang), vs = allVoices();
  if (!vs.length) return null;
  const saved = lsGet('homebase.voiceName.' + fam, '');
  const norm = l => String(l || '').replace('_', '-').toLowerCase();
  const exact = vs.filter(v => norm(v.lang) === norm(lang)), fams = vs.filter(v => langFamily(v.lang) === fam);
  return (saved && vs.find(v => v.name === saved && langFamily(v.lang) === fam))
    || exact.find(v => v.localService === false) || exact.find(v => v.default) || exact[0]
    || fams.find(v => v.localService === false) || fams[0] || null;
}
function sampleLine(lang) {
  return langFamily(lang) === 'zh' ? (lang === 'zh-HK' ? '你好，我係 Homebase。今日記得帶遮。' : '你好，我是 Homebase。今天记得带伞。')
    : "Hi, I'm Homebase. Don't forget your umbrella today.";
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
  try { speechSynthesis.addEventListener('voiceschanged', fill); } catch { /* old browser */ }
  setTimeout(fill, 700);
  $('#sVoiceLang').addEventListener('change', e => { lsSet('homebase.voiceLang', e.target.value); fill(); toast('Saved on this phone.'); });
  sel.addEventListener('change', () => { lsSet('homebase.voiceName.' + langFamily(voiceLang()), sel.value); speak(sampleLine(voiceLang())); });
  $('#sVoiceRate').addEventListener('input', e => { lsSet('homebase.voiceRate', e.target.value); $('#sRateVal').textContent = Number(e.target.value).toFixed(1) + '×'; });
  $('#sVoiceRate').addEventListener('change', () => speak(sampleLine(voiceLang())));
  $('#sVoiceTest').onclick = () => {
    if (!('speechSynthesis' in window)) return toast("This browser can't read aloud.", true);
    speak(sampleLine(voiceLang()));
  };
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
// Replies are read aloud by the phone's own voice, only when you used the mic.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const VOICE_LANGS = [['', 'Same as this phone'], ['en-US', 'English'], ['zh-CN', '中文（普通话）'], ['zh-TW', '中文（台灣）'], ['zh-HK', '粵語']];
function voiceLang() {
  const v = lsGet('homebase.voiceLang', '');
  return v || (navigator.language || 'en-US');
}
let activeRec = null;
function dictate(textarea, btn, onDone) {
  if (!SR) return toast("Voice input isn't available here. Open Homebase in Chrome, or use the mic on your keyboard.", true);
  if (activeRec) { activeRec.stop(); return; }
  try { speechSynthesis?.cancel(); } catch { /* nothing playing */ }
  const rec = new SR();
  rec.lang = voiceLang(); rec.interimResults = true; rec.continuous = false;
  const base = textarea.value.trim() ? textarea.value.trim() + ' ' : '';
  let heard = false;
  rec.onresult = e => {
    let txt = '';
    for (const r of e.results) txt += r[0].transcript;
    heard = !!txt.trim();
    textarea.value = base + txt;
    textarea.dispatchEvent(new Event('input'));
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow the microphone for Homebase (Chrome → site settings → Microphone).', true);
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Voice input stopped: ' + e.error, true);
  };
  rec.onend = () => { activeRec = null; btn.classList.remove('rec'); if (heard) onDone?.(); };
  activeRec = rec;
  btn.classList.add('rec');
  try { rec.start(); } catch (e) { activeRec = null; btn.classList.remove('rec'); fail(e); }
}
function plainForSpeech(t) {
  return String(t || '').replace(/\*\*|__|`|#+ /g, '').replace(/^\s*[-*•] /gm, '').replace(/https?:\/\/\S+/g, 'link').slice(0, 1200);
}
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(plainForSpeech(text));
    u.lang = /[\u4e00-\u9fff]/.test(text) ? (voiceLang().startsWith('zh') ? voiceLang() : 'zh-CN') : (voiceLang().startsWith('zh') ? 'en-US' : voiceLang());
    const v = pickVoice(u.lang);
    if (v) { u.voice = v; u.lang = String(v.lang).replace('_', '-'); }
    u.rate = Number(lsGet('homebase.voiceRate', '1')) || 1;
    speechSynthesis.speak(u);
  } catch { /* no voice on this phone */ }
}

// ================= CHAT =================
// --- sharing into Homebase (Android Share menu → service worker → here) ---
const SHARE_PROMPT = 'Find the dates, events and to-dos in this and suggest what to add.';
async function shareImage(fileOrBlob) {
  const f = fileOrBlob instanceof File ? fileOrBlob : new File([fileOrBlob], 'shared', { type: fileOrBlob.type || 'image/jpeg' });
  const s = await shrinkImage(f, 1600);   // big enough to read a flyer, small enough to send quickly
  if (s.mime !== 'image/jpeg') {          // flatten transparent images for reading
    const data = await urlToJpegData(s.url);
    return { data, mime: 'image/jpeg', url: 'data:image/jpeg;base64,' + data };
  }
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
  composer.innerHTML = `<div id="shareChip" class="share-chip" hidden></div>
    <button type="button" class="attach" id="chatAttach" aria-label="Add a photo or screenshot">📎</button><input type="file" id="chatFile" accept="image/*" hidden>
    ${SR ? '<button type="button" class="attach mic" id="chatMic" aria-label="Speak">🎤</button>' : ''}
    <textarea id="chatInput" rows="1" placeholder="Ask or tell me anything…" autocomplete="off"></textarea>
    <button class="btn primary" aria-label="Send">Send</button>`;
  document.body.appendChild(composer);
  const ta = $('#chatInput');
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
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
    const v = ta.value.trim() || (state.pendingShare ? SHARE_PROMPT : '');
    if (v) { ta.value = ''; grow(); const m = chatMic; chatMic = false; sendChat(v, m); }
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
  $('#chatMic')?.addEventListener('click', e => dictate(ta, e.currentTarget, () => { chatMic = true; grow(); }));
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
    const fresh = h.map(m => ({ role: m.role, content: m.content, charts: Array.isArray(m.chart) && m.chart.length ? m.chart : undefined }));
    if (state.chat?.some(m => m.typing)) return;                // a reply is on its way; don't disturb
    state.chat = fresh; saveCache(); if (location.hash === '#chat') paintChat();
  });
  if (!state.chat) {
    paintChat(true);
    try { await loadHistory(); } catch (e) { state.chat = []; fail(e); }
  } else if (!state.chatFresh) loadHistory().catch(e => console.warn(e));
  paintChat();
  const pending = sessionStorage.getItem('homebase.pending');
  if (pending) { sessionStorage.removeItem('homebase.pending'); sendChat(pending); }
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
    msgs.map((m, i) => `<div class="msg ${m.role}${m.typing ? ' typing' : ''}${m.charts?.length ? ' has-chart' : ''}" data-i="${i}">${m.typing ? '<span class="spinner"></span> thinking…' : md(m.content)}${(m.charts || []).map((_, j) => `<div class="chart-slot" data-chart="${i}:${j}"></div>`).join('')}${m.role === 'assistant' && !m.typing && m.content && 'speechSynthesis' in window ? `<button type="button" class="say" data-say="${i}" aria-label="Read aloud">🔊</button>` : ''}</div>`).join('') +
    `<div class="chips chat-chips">${CHAT_CHIPS.map(c => `<button class="chip" type="button">${esc(c)}</button>`).join('')}</div>`;
  $$('.chat-chips .chip', list).forEach(c => c.onclick = () => sendChat(c.textContent));
  $$('[data-say]', list).forEach(b => b.onclick = () => speak((state.chat || [])[+b.dataset.say]?.content));
  if (isMember()) $$('.chat-chips .chip', list).forEach(c => { if (/email/i.test(c.textContent)) c.remove(); });
  mountCharts(list);
  requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}

let chatBusy = false;
let chatMic = false;
async function sendChat(text, viaMic = false) {
  if (chatBusy) return toast('One moment…');
  chatBusy = true;
  state.chat = state.chat || [];
  const sh = state.pendingShare; state.pendingShare = null;
  if ($('#shareChip')) { $('#shareChip').hidden = true; }
  const shown = sh ? text + '\n📎 ' + (sh.image ? 'photo' + (sh.text || sh.url ? ' + ' : '') : '') + ((sh.title || sh.text || sh.url || '').slice(0, 80)) : text;
  state.chat.push({ role: 'user', content: shown }, { role: 'assistant', content: '', typing: true });
  paintChat();
  try {
    const shared = sh ? { title: sh.title || '', text: (sh.text || '').slice(0, 6000), url: sh.url || '', image: sh.image ? { data: sh.image.data, mime: sh.image.mime } : null } : undefined;
    const r = await api('chat.send', { message: text, shared }, { timeoutMs: 120000 });
    state.chat.pop();
    state.chat.push({ role: 'assistant', content: r.reply, charts: r.charts?.length ? r.charts : undefined }); saveCache();
    if (viaMic) speak(r.reply);
    invalidate(); // the assistant may have changed tasks, meals or the calendar
  } catch (e) {
    state.chat.pop();
    state.chat.push({ role: 'assistant', content: '⚠️ ' + e.message });
  } finally { chatBusy = false; }
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
    setCfg({ url, token });
    if (old.token && old.token !== token) forgetLocalData();   // someone else's data shouldn't linger
    const p = await api('ping');
    state.settings = p.settings;
    if (p.me) { state.me = p.me; saveCache(); }
    $('#sStatus').innerHTML = `✓ Connected${p.me ? ' as <b>' + esc(p.me.name) + '</b>' : ''}.${p.has_ai_key ? '' : ' <b>No AI key yet</b> — add CLAUDE_API_KEY (or GEMINI_API_KEY) in Script Properties.'}`;
    if (p.me?.role !== 'member' && !p.settings.app_url) await api('settings.save', { app_url: location.origin + location.pathname });
    paintServerSettings();
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
  const s = state.settings || {};
  $('#serverSettings').innerHTML = `
    <div class="card">
      <h2>You</h2>
      <div>Signed in as <b>${esc(state.me?.name || '')}</b>.</div>
      <div class="muted small" style="margin-top:6px">Tasks, the food log and the family calendar are shared with the household. Your chat and your “Only me” tasks are private.</div>
      <button class="btn small ghost" id="sSignOut" style="margin-top:10px">Sign out of this phone</button>
    </div>
    ${voiceCardHtml()}
    <div class="card">
      <h2>Notifications</h2>
      <label class="field"><span>Send my notifications with</span>
        <div class="seg" id="sChan"><button type="button" data-v="telegram">Telegram</button><button type="button" data-v="ntfy">ntfy</button></div></label>
      <div id="sTg" class="chan-box">
        <ol class="small steps"><li>In Telegram, open <b id="sBot">the family's Homebase bot</b> and tap <b>Start</b>.</li><li>Tap <b>Link Telegram</b> below.</li></ol>
        <div class="row"><button class="btn small primary" id="sTgLink" type="button">Link Telegram</button><span id="sTgStatus" class="muted small grow"></span></div>
      </div>
      <div id="sNtfy" class="chan-box">
        <div class="muted small" style="margin-bottom:8px">Install the free <b>ntfy</b> app, tap +, and subscribe to this topic (server ntfy.sh). It's yours; keep it private.</div>
        <div class="row"><input type="text" readonly value="${esc(s.ntfy_topic)}" id="sTopic"><button class="btn small" id="sCopy" type="button">Copy</button></div>
      </div>
      <button class="btn small" id="sTestN" style="margin-top:12px">Send test notification</button>
    </div>
    <button class="btn primary block" id="sSave">Save</button>
    <div class="spacer"></div>`;
  bindVoiceCard();
  foldCards($('#serverSettings'), ['You']);
  let channel = s.notify_channel === 'telegram' ? 'telegram' : 'ntfy';
  const paintChan = () => {
    $$('#sChan button').forEach(b => b.classList.toggle('on', b.dataset.v === channel));
    $('#sTg').classList.toggle('hidden', channel !== 'telegram');
    $('#sNtfy').classList.toggle('hidden', channel !== 'ntfy');
  };
  $$('#sChan button').forEach(b => b.onclick = () => { channel = b.dataset.v; paintChan(); });
  paintChan();
  api('telegram.status').then(st => {
    if (st.bot && $('#sBot')) $('#sBot').textContent = st.bot;
    if ($('#sTgStatus')) $('#sTgStatus').textContent = st.linked ? '✓ Linked' : st.has_token ? '' : 'Telegram isn\'t set up for this household yet; use ntfy.';
  }).catch(() => {});
  $('#sTgLink').onclick = e => busy(e.currentTarget, async () => {
    await api('telegram.link');
    $('#sTgStatus').textContent = '✓ Linked'; channel = 'telegram'; paintChan();
    toast('Linked. A test message was sent to Telegram.');
  }).catch(fail);
  $('#sCopy').onclick = () => navigator.clipboard?.writeText($('#sTopic').value).then(() => toast('Copied.'));
  $('#sTestN').onclick = e => busy(e.currentTarget, async () => {
    const r = await api('notify.test');
    toast(r.note ? r.note : `Sent via ${r.channel === 'telegram' ? 'Telegram' : 'ntfy'}. Check your phone.`);
  }).catch(fail);
  $('#sSave').onclick = e => busy(e.currentTarget, async () => { state.settings = await api('settings.save', { notify_channel: channel }); toast('Saved.'); }).catch(fail);
  $('#sSignOut').onclick = () => {
    if (!confirm('Sign out of Homebase on this phone?')) return;
    setCfg({}); forgetLocalData();
    location.hash = '#settings'; route();
  };
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
    <div class="card">
      <h2>Notifications</h2>
      <label class="field"><span>Send notifications with</span>
        <div class="seg" id="sChan"><button type="button" data-v="telegram">Telegram</button><button type="button" data-v="ntfy">ntfy</button></div></label>
      <div id="sTg" class="chan-box">
        <div class="muted small">Recommended: free and reliable. One-time setup (on a computer for step 2):</div>
        <ol class="small steps">
          <li>In Telegram, message <b>@BotFather</b>, send <code>/newbot</code>, pick any name, and copy the <b>token</b> it gives you.</li>
          <li>In Apps Script → Project Settings → Script Properties, add <code>TELEGRAM_BOT_TOKEN</code> with that token.</li>
          <li>Open your new bot in Telegram and tap <b>Start</b>.</li>
          <li>Tap <b>Link Telegram</b> below.</li>
        </ol>
        <div class="row"><button class="btn small primary" id="sTgLink" type="button">Link Telegram</button><span id="sTgStatus" class="muted small grow"></span></div>
      </div>
      <div id="sNtfy" class="chan-box">
        <div class="muted small" style="margin-bottom:8px">Install the free <b>ntfy</b> app, tap +, and subscribe to this topic (server ntfy.sh). Keep it private. Note: ntfy's free server can hit a shared limit with Google; Telegram doesn't.</div>
        <div class="row"><input type="text" readonly value="${esc(s.ntfy_topic)}" id="sTopic"><button class="btn small" id="sCopy" type="button">Copy</button></div>
      </div>
      <div class="two" style="margin-top:12px">
        <label class="field"><span>Morning brief</span><select id="sBrief">${hourOpts(s.brief_hour, true)}</select></label>
        <label class="field"><span>Evening check-in</span><select id="sEve">${hourOpts(s.evening_hour, true)}</select></label>
      </div>
      <button class="btn small" id="sTestN">Send test notification</button>
    </div>
    ${voiceCardHtml()}
    <div class="card">
      <h2>Assistant</h2>
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
      <label class="field check-field row-field"><input type="checkbox" id="sFullMail" ${s.email_full_search !== 'off' ? 'checked' : ''}><span>Let my chat search all my email <span class="muted small">(read-only; not spam, trash or promotions; never for family members)</span></span></label>
      <details class="why" style="margin-bottom:12px"><summary>AI models, usage & cost</summary>
        <label class="field" style="margin-top:8px"><span>AI provider</span><select id="sProvider">
          <option value="auto" ${!s.ai_provider || s.ai_provider === 'auto' ? 'selected' : ''}>Auto: Claude if CLAUDE_API_KEY is set, otherwise Gemini</option>
          <option value="claude" ${s.ai_provider === 'claude' ? 'selected' : ''}>Claude (paid per use, private)</option>
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
        <div id="sUsage" class="muted small">Loading usage…</div>
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

  api('usage').then(u => {
    const el = $('#sUsage'); if (!el) return;
    const rows = Object.entries(u.calls || {});
    el.innerHTML = `In use: <b>${u.provider === 'claude' ? 'Claude' : 'Gemini'}</b> · <b>${esc(u.models?.main || '?')}</b> (everyday), <b>${esc(u.models?.smart || '?')}</b> (food ideas).<br>` +
      (rows.length ? 'Requests today: ' + rows.map(([m, n]) => `${esc(m)} ${n}`).join(' · ') : 'No AI requests yet today.') +
      (u.cost_month ? `<br>Claude this month: about <b>$${u.cost_month.usd.toFixed(2)}</b> (${Math.round(u.cost_month.tokens / 1000)}k tokens, estimate). Your real bill is at console.anthropic.com.` : '<br>Your exact free limits are listed in Google AI Studio.');
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
  $('#sCopy').onclick = () => navigator.clipboard?.writeText($('#sTopic').value).then(() => toast('Copied.'));
  $('#sTestN').onclick = e => busy(e.currentTarget, async () => {
    const r = await api('notify.test');
    toast(r.note ? r.note : `Sent via ${r.channel === 'telegram' ? 'Telegram' : 'ntfy'}. Check your phone.`);
  }).catch(fail);

  let channel = s.notify_channel === 'telegram' ? 'telegram' : 'ntfy';
  const paintChan = () => {
    $$('#sChan button').forEach(b => b.classList.toggle('on', b.dataset.v === channel));
    $('#sTg').classList.toggle('hidden', channel !== 'telegram');
    $('#sNtfy').classList.toggle('hidden', channel !== 'ntfy');
  };
  $$('#sChan button').forEach(b => b.onclick = () => { channel = b.dataset.v; paintChan(); });
  paintChan();
  $('#sChan').dataset.value = channel;
  $$('#sChan button').forEach(b => b.addEventListener('click', () => { $('#sChan').dataset.value = channel; }));
  const tgStatus = st => {
    const el = $('#sTgStatus'); if (!el) return;
    el.textContent = st.linked ? `✓ Linked${st.bot ? ' to ' + st.bot : ''}` : st.has_token ? `Token found${st.bot ? ' (' + st.bot + ')' : ''}. Tap Start in the bot, then Link.` : 'No bot token yet (step 2).';
  };
  api('telegram.status').then(tgStatus).catch(() => {});
  $('#sTgLink').onclick = e => busy(e.currentTarget, async () => {
    const r = await api('telegram.link');
    tgStatus({ linked: true, bot: r.bot });
    channel = 'telegram'; paintChan(); $('#sChan').dataset.value = channel;
    toast('Linked. A test message was sent to Telegram.');
  }).catch(fail);
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
      brief_hour: $('#sBrief').value, evening_hour: $('#sEve').value, notify_channel: $('#sChan').dataset.value || 'ntfy',
      about_me: $('#sAbout').value.trim(), email_watch_query: buildWatch(watchList, $('#sWatchExtra').value),
      model_main: $('#sModelMain').value.trim() || 'auto', model_smart: $('#sModelSmart').value.trim() || 'auto',
      people: plist.map(p => ({ ...p, name: String(p.name || '').trim() || 'Person' })),
      app_url: location.origin + location.pathname
    });
    invalidate(); refreshAll();
    toast('Saved.');
  }).catch(fail);
}

// ---------------- boot ----------------
window.__hbBooted = true;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
