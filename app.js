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
const state = {
  today: JSON.parse(localStorage.getItem('homebase.today') || 'null'),
  tasks: null, chat: null, settings: null
};

// ---------------- router ----------------
const VIEWS = { today: renderToday, chat: renderChat, tasks: renderTasks, settings: renderSettings };
const TITLES = { today: 'Homebase', chat: 'Chat', tasks: 'Tasks', settings: 'Settings' };

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
  try {
    state.today = await api('today');
    localStorage.setItem('homebase.today', JSON.stringify(state.today));
    if (location.hash === '' || location.hash === '#today') paintToday();
  } catch (e) { fail(e); }
}

function paintToday() {
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
    <form class="quicklog" id="quicklog">
      <input type="text" name="q" placeholder="Tell me what you did or need…" autocomplete="off">
      <button class="btn primary" aria-label="Send">Send</button>
    </form>
    ${weatherCard(wx)}
    <div class="card" id="outfitCard">${outfitCardInner(t.outfit)}</div>
    ${t.suggestions?.length ? suggestionsCard(t.suggestions) : ''}
    <div class="card">
      <h2>Due soon</h2>
      ${t.tasks_due?.length ? t.tasks_due.map(taskRow).join('') : '<div class="muted small">Nothing due in the next two days. 🎉</div>'}
    </div>
    <div class="card">
      <h2>Next 7 days</h2>
      ${eventsList(t.events || [])}
    </div>`;

  $('#quicklog').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('input', e.target).value.trim();
    if (!q) return;
    sessionStorage.setItem('homebase.pending', q);
    location.hash = '#chat';
  });
  bindTaskRows(view, () => renderToday());
  bindOutfitCard();
  bindSuggestions();
}

function weatherCard(wx) {
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
  </div>`;
}

function outfitCardInner(o) {
  if (!o) {
    return `<h2>What to wear today</h2>
      <div class="muted small" style="margin-bottom:10px">Based on the hourly weather, your calendar, and time indoors vs outdoors.</div>
      <label class="field"><input type="text" id="outfitNote" placeholder="Anything special? e.g. soccer game, dinner out"></label>
      <div class="btn-row"><button class="btn primary" id="pickOutfit">Suggest an outfit</button>
      <button class="btn" id="planTomorrow">Tomorrow</button></div>`;
  }
  return `<h2>${o.date === todayStr() ? 'What to wear today' : 'What to wear ' + esc(rel(o.date))}</h2>
    ${outfitBody(o)}
    <div class="spacer"></div>
    <div class="btn-row">
      <button class="btn" id="another">Different idea</button>
      <button class="btn ghost" id="planTomorrow">Tomorrow</button>
    </div>`;
}

function outfitBody(o) {
  const layers = o.layers || [];
  return `<div class="outfit-summary">${esc(o.summary || '')}</div>
    ${layers.length ? `<ul class="layers">${layers.map(l => `<li><span class="li-item">${esc(l.item)}</span>${l.why ? `<span class="li-why">${esc(l.why)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${o.bring?.length ? `<div class="bring"><span class="muted small">Bring</span>${o.bring.map(b => `<span class="pill">${esc(b)}</span>`).join('')}</div>` : ''}
    ${o.tips ? `<p class="tips">${esc(o.tips)}</p>` : ''}`;
}

function bindOutfitCard() {
  const card = $('#outfitCard');
  if (!card) return;
  const t = state.today;
  const gen = async (btn, date, note) => busy(btn, async () => {
    const o = await api('outfit.generate', { date, note });
    if (date === 'today') state.today.outfit = o; else state.today.tomorrow_outfit = o;
    localStorage.setItem('homebase.today', JSON.stringify(state.today));
    if (date === 'today') { card.innerHTML = outfitCardInner(o); bindOutfitCard(); }
    else showOutfitModal(o);
  }).catch(fail);

  $('#pickOutfit', card)?.addEventListener('click', e => gen(e.currentTarget, 'today', $('#outfitNote', card).value));
  $('#another', card)?.addEventListener('click', e => gen(e.currentTarget, 'today', 'Give a different idea than: ' + (t.outfit?.summary || '')));
  $('#planTomorrow', card)?.addEventListener('click', e => {
    if (state.today.tomorrow_outfit) showOutfitModal(state.today.tomorrow_outfit);
    else gen(e.currentTarget, 'tomorrow', '');
  });
}

function showOutfitModal(o) {
  openModal(`<h3>What to wear ${esc(rel(o.date))}</h3>${outfitBody(o)}
    <div class="spacer"></div>
    <div class="btn-row"><button class="btn" id="mAnother">Different idea</button><button class="btn primary" id="mClose">Got it</button></div>`);
  $('#mClose').onclick = closeModal;
  $('#mAnother').onclick = e => busy(e.currentTarget, async () => {
    const n = await api('outfit.generate', { date: o.date, note: 'Give a different idea than: ' + o.summary });
    if (state.today && o.date !== todayStr()) state.today.tomorrow_outfit = n;
    showOutfitModal(n);
  }).catch(fail);
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
      <span class="grow">${esc(e.title)}${e.location ? ` <span class="muted">· ${esc(e.location)}</span>` : ''}</span></div>`;
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
    <div class="grow tap" data-edit="${t.id}"><div class="title">${esc(t.name)}</div><div class="meta">${esc(freqText(t))}</div></div>
    ${dueLabel(t)}
  </div>`;
}
function bindTaskRows(root, after) {
  $$('[data-done]', root).forEach(b => b.addEventListener('click', async () => {
    b.classList.add('done'); b.disabled = true;
    try {
      const t = await api('tasks.done', { id: b.dataset.done });
      toast(t.active === false ? `Done: ${t.name}` : `Done. Next: ${rel(t.next_due)}${t.interval_mode === 'learned' ? ' (learned your rhythm)' : ''}`);
      state.tasks = null;
      after?.();
    } catch (e) { b.classList.remove('done'); b.disabled = false; fail(e); }
  }));
  $$('[data-edit]', root).forEach(el => el.addEventListener('click', async () => {
    let t = (state.tasks || []).find(x => x.id === el.dataset.edit) || (state.today?.tasks_due || []).find(x => x.id === el.dataset.edit);
    openTaskEditor(t, after);
  }));
}

async function renderTasks() {
  view.innerHTML = state.tasks ? '' : '<div class="card"><div class="skeleton" style="height:200px"></div></div>';
  if (state.tasks) paintTasks();
  try { state.tasks = await api('tasks.list'); if (location.hash === '#tasks') paintTasks(); } catch (e) { fail(e); }
}
function paintTasks() {
  const all = state.tasks || [];
  const groups = [
    ['Needs attention', all.filter(t => ['overdue', 'today'].includes(t.state))],
    ['Coming up', all.filter(t => t.state === 'soon')],
    ['Recurring', all.filter(t => t.state === 'later' && t.interval_days)],
    ['To-dos', all.filter(t => !t.interval_days && t.state !== 'overdue' && t.state !== 'today' && t.state !== 'soon')]
  ];
  view.innerHTML = all.length ? groups.filter(g => g[1].length).map(([name, list]) =>
    `<div class="section-title">${name}<span>${list.length}</span></div><div class="card">${list.map(taskRow).join('')}</div>`).join('')
    : `<div class="empty"><div class="big">No tasks yet</div>Add one with +, or just tell the chat:<br>“I clipped the cat's claws today.”</div>`;
  bindTaskRows(view, () => renderTasks());
  addFab(() => openTaskEditor(null, () => renderTasks()));
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
      state.tasks = null; after?.();
    }).catch(fail);
  };
  $('#tDel')?.addEventListener('click', e => {
    if (!confirm(`Delete "${t.name}"?`)) return;
    busy(e.currentTarget, async () => { await api('tasks.delete', { id: t.id }); closeModal(); state.tasks = null; after?.(); }).catch(fail);
  });
}

// ================= CHAT =================
const CHAT_CHIPS = ['What should I wear today?', "What's due this week?", 'What should I wear tomorrow?', 'Anything in my watched emails to act on?'];

async function renderChat() {
  view.innerHTML = '<div class="chat" id="chatList"></div>';
  const composer = document.createElement('form');
  composer.className = 'composer';
  composer.innerHTML = `<input type="text" id="chatInput" placeholder="Ask or tell me anything…" autocomplete="off" enterkeyhint="send">
    <button class="btn primary" aria-label="Send">Send</button>`;
  document.body.appendChild(composer);
  composer.addEventListener('submit', e => { e.preventDefault(); const v = $('#chatInput').value.trim(); if (v) { $('#chatInput').value = ''; sendChat(v); } });

  if (!state.chat) {
    paintChat(true);
    try { state.chat = (await api('chat.history', { limit: 30 })).map(m => ({ role: m.role, content: m.content })); }
    catch (e) { state.chat = []; fail(e); }
  }
  paintChat();
  const pending = sessionStorage.getItem('homebase.pending');
  if (pending) { sessionStorage.removeItem('homebase.pending'); sendChat(pending); }
}

function paintChat(loading = false) {
  const list = $('#chatList');
  if (!list) return;
  if (loading) { list.innerHTML = '<div class="msg assistant typing"><span class="spinner"></span></div>'; return; }
  const msgs = state.chat || [];
  list.innerHTML = (msgs.length ? '' : `<div class="empty"><div class="big">Hi! What's on your mind?</div>
      I know your tasks, calendar and the weather. You can also just tell me things you did.</div>`) +
    msgs.map((m, i) => `<div class="msg ${m.role}${m.typing ? ' typing' : ''}" data-i="${i}">${m.typing ? '<span class="spinner"></span> thinking…' : md(m.content)}${m.outfit ? `<div class="chat-outfit">${outfitBody(m.outfit)}</div>` : ''}</div>`).join('') +
    `<div class="chips chat-chips">${CHAT_CHIPS.map(c => `<button class="chip" type="button">${esc(c)}</button>`).join('')}</div>`;
  $$('.chat-chips .chip', list).forEach(c => c.onclick = () => sendChat(c.textContent));
  requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}

let chatBusy = false;
async function sendChat(text) {
  if (chatBusy) return toast('One moment…');
  chatBusy = true;
  state.chat = state.chat || [];
  state.chat.push({ role: 'user', content: text }, { role: 'assistant', content: '', typing: true });
  paintChat();
  try {
    const r = await api('chat.send', { message: text }, { timeoutMs: 120000 });
    state.chat.pop();
    state.chat.push({ role: 'assistant', content: r.reply, outfit: r.outfit });
    if (r.outfit && r.outfit.date === todayStr() && state.today) state.today.outfit = r.outfit;
    state.tasks = null; // the assistant may have changed tasks
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
      <div class="muted small">Paste your Apps Script web app URL and the app token from <b>setup()</b>. See the README for the 10-minute setup.</div></div>`}
    <div class="card">
      <h2>Connection</h2>
      <label class="field"><span>Backend URL (Apps Script web app)</span><input type="url" id="sUrl" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="field"><span>App token</span><input type="password" id="sToken" value="${esc(cfg.token || '')}"></label>
      <div class="btn-row"><button class="btn primary" id="sConnect">${configured ? 'Save & test' : 'Connect'}</button></div>
      <div id="sStatus" class="muted small" style="margin-top:10px"></div>
    </div>
    <div id="serverSettings">${configured ? '<div class="card"><div class="skeleton" style="height:200px"></div></div>' : ''}</div>`;

  $('#sConnect').onclick = e => busy(e.currentTarget, async () => {
    const url = $('#sUrl').value.trim(), token = $('#sToken').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw new Error('That does not look like an Apps Script web app URL.');
    setCfg({ url, token });
    const p = await api('ping');
    state.settings = p.settings;
    $('#sStatus').innerHTML = `✓ Connected.${p.has_ai_key ? '' : ' <b>No Gemini API key yet</b> — add GEMINI_API_KEY in Script Properties.'}`;
    if (!p.settings.app_url) await api('settings.save', { app_url: location.origin + location.pathname });
    paintServerSettings();
  }).catch(fail);

  if (configured) {
    try { state.settings = await api('settings.get'); paintServerSettings(); }
    catch (e) { $('#serverSettings').innerHTML = ''; fail(e); }
  }
}

function paintServerSettings() {
  const s = state.settings || {};
  const hours = [...Array(24).keys()];
  const hourOpts = (val, allowOff) => (allowOff ? `<option value="" ${val === '' ? 'selected' : ''}>Off</option>` : '') +
    hours.map(h => `<option value="${h}" ${String(val) === String(h) ? 'selected' : ''}>${hour12(h).replace('a', ' am').replace('p', ' pm')}</option>`).join('');
  $('#serverSettings').innerHTML = `
    <div class="card">
      <h2>Weather & outfits</h2>
      <div class="two">
        <label class="field"><span>Latitude</span><input type="text" id="sLat" value="${esc(s.latitude)}" inputmode="decimal"></label>
        <label class="field"><span>Longitude</span><input type="text" id="sLon" value="${esc(s.longitude)}" inputmode="decimal"></label>
      </div>
      <button class="btn small" id="sLoc" style="margin:-4px 0 12px">📍 Use my location</button>
      <div class="two">
        <label class="field"><span>Units</span><select id="sUnits"><option value="F" ${s.units !== 'C' ? 'selected' : ''}>°F</option><option value="C" ${s.units === 'C' ? 'selected' : ''}>°C</option></select></label>
        <label class="field"><span>Indoor temp</span><input type="number" id="sIndoor" value="${esc(s.indoor_temp)}"></label>
      </div>
      <label class="field"><span>Your clothes & style (optional)</span>
        <textarea id="sClothes" rows="3" placeholder="e.g. I run cold. Mostly jeans, sweaters, a navy rain shell and a puffer. Office is business casual.">${esc(s.clothes_notes)}</textarea></label>
    </div>
    <div class="card">
      <h2>Notifications</h2>
      <div class="muted small" style="margin-bottom:10px">Install the free <b>ntfy</b> app, tap +, and subscribe to this topic (server ntfy.sh). Keep it private.</div>
      <div class="row" style="margin-bottom:12px"><input type="text" readonly value="${esc(s.ntfy_topic)}" id="sTopic"><button class="btn small" id="sCopy">Copy</button></div>
      <div class="two">
        <label class="field"><span>Morning brief</span><select id="sBrief">${hourOpts(s.brief_hour, true)}</select></label>
        <label class="field"><span>Evening check-in</span><select id="sEve">${hourOpts(s.evening_hour, true)}</select></label>
      </div>
      <button class="btn small" id="sTestN">Send test notification</button>
    </div>
    <div class="card">
      <h2>Assistant</h2>
      <label class="field"><span>About your household (the AI uses this)</span>
        <textarea id="sAbout" rows="3" placeholder="e.g. One indoor cat. One kid in elementary school. I work from home Mon/Fri, office Tue–Thu. I prefer comfortable, simple clothes.">${esc(s.about_me)}</textarea></label>
      <label class="field"><span>Watch these emails (Gmail search; blank = off)</span>
        <input type="text" id="sEmail" value="${esc(s.email_watch_query)}" placeholder="from:(school.org OR dentist.com OR vet.com)">
        <span class="muted small" style="display:block;margin-top:5px">Only emails matching this are ever read, by the hourly check and by chat. Blank turns all email reading off.</span></label>
      <details class="why" style="margin-bottom:12px"><summary>AI models & today's usage</summary>
        <div class="muted small" style="margin:8px 0">"auto" picks the newest free Gemini models for your key: Flash-Lite for everyday work (big free quota) and Flash for outfit advice (smarter, small quota). If one runs out, the other takes over.</div>
        <div class="two">
          <label class="field"><span>Everyday model</span><input type="text" id="sModelMain" value="${esc(s.model_main || 'auto')}"></label>
          <label class="field"><span>Outfit model</span><input type="text" id="sModelSmart" value="${esc(s.model_smart || 'auto')}"></label>
        </div>
        <div id="sUsage" class="muted small">Loading usage…</div>
      </details>
      <div class="btn-row"><button class="btn" id="sScan">Check email now</button><button class="btn ghost" id="sClear">Clear chat history</button></div>
    </div>
    <button class="btn primary block" id="sSave">Save settings</button>
    <div class="spacer"></div>`;

  api('usage').then(u => {
    const el = $('#sUsage'); if (!el) return;
    const rows = Object.entries(u.calls || {});
    el.innerHTML = `In use: <b>${esc(u.models?.main || '?')}</b> (everyday), <b>${esc(u.models?.smart || '?')}</b> (outfits).<br>` +
      (rows.length ? 'Requests today: ' + rows.map(([m, n]) => `${esc(m)} ${n}`).join(' · ') : 'No AI requests yet today.') +
      '<br>Your exact free limits are listed in Google AI Studio.';
  }).catch(() => { $('#sUsage') && ($('#sUsage').textContent = ''); });

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
  $('#sTestN').onclick = e => busy(e.currentTarget, async () => { await api('notify.test'); toast('Sent. Check your phone.'); }).catch(fail);
  $('#sScan').onclick = e => busy(e.currentTarget, async () => {
    const list = await api('email.scan', {}, { timeoutMs: 180000 });
    toast(list.length ? `${list.length} item(s) waiting on Today.` : 'Nothing new found.');
    state.today = null;
  }).catch(fail);
  $('#sClear').onclick = e => { if (confirm('Clear chat history?')) busy(e.currentTarget, async () => { await api('chat.clear'); state.chat = []; toast('Cleared.'); }).catch(fail); };
  $('#sSave').onclick = e => busy(e.currentTarget, async () => {
    state.settings = await api('settings.save', {
      latitude: $('#sLat').value.trim(), longitude: $('#sLon').value.trim(), units: $('#sUnits').value,
      indoor_temp: $('#sIndoor').value, clothes_notes: $('#sClothes').value.trim(),
      brief_hour: $('#sBrief').value, evening_hour: $('#sEve').value,
      about_me: $('#sAbout').value.trim(), email_watch_query: $('#sEmail').value.trim(),
      model_main: $('#sModelMain').value.trim() || 'auto', model_smart: $('#sModelSmart').value.trim() || 'auto',
      app_url: location.origin + location.pathname
    });
    state.today = null; localStorage.removeItem('homebase.today');
    toast('Saved.');
  }).catch(fail);
}

// ---------------- boot ----------------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
