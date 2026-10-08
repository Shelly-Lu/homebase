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
function saveToday() {
  if (state.today && typeof state.today === 'object') localStorage.setItem('homebase.today', JSON.stringify(state.today));
  else localStorage.removeItem('homebase.today');
}

const state = {
  today: loadSaved('homebase.today'),
  tasks: null, chat: null, settings: null
};

// ---------------- router ----------------
const VIEWS = { today: renderToday, chat: renderChat, wardrobe: renderWardrobe, tasks: renderTasks, settings: renderSettings };
const TITLES = { today: 'Homebase', chat: 'Chat', wardrobe: 'Wardrobe', tasks: 'Tasks', settings: 'Settings' };

function route() {
  let name = (location.hash || '#today').slice(1).split('?')[0];
  if (!VIEWS[name]) name = 'today';
  if (!isConfigured() && name !== 'settings') { location.hash = '#settings'; return; }
  $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
  $('#title').textContent = TITLES[name];
  $('.fab')?.remove();
  $('.composer')?.remove();
  $('.wsel')?.remove();
  window.scrollTo(0, 0);
  VIEWS[name]();
}
window.addEventListener('hashchange', route);
$('#settingsBtn').addEventListener('click', () => (location.hash = '#settings'));

// ================= TODAY =================
async function renderToday() {
  paintToday();
  try {
    const t = await api('today');
    if (!t || typeof t !== 'object') throw new Error('The backend sent an empty answer. Deploy a New version of the web app and try again.');
    state.today = t;
    saveToday();
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
    <div class="card" id="outfitCard">${outfitCardInner(outfitFor(currentPerson(), 'today'))}</div>
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

// Outfits are kept per person: "me" in today/tomorrow_outfit, everyone else in person_outfits[id].{today,tomorrow}.
function outfitFor(pid, which = 'today') {
  const t = state.today;
  if (!t) return null;
  if (pid === 'me') return (which === 'today' ? t.outfit : t.tomorrow_outfit) || null;
  return t.person_outfits?.[pid]?.[which] || null;
}
function setOutfit(pid, which, o) {
  const t = state.today;
  if (!t) return;
  if (pid === 'me') { if (which === 'today') t.outfit = o; else t.tomorrow_outfit = o; return; }
  t.person_outfits = t.person_outfits || {};
  t.person_outfits[pid] = t.person_outfits[pid] || {};
  t.person_outfits[pid][which] = o;
}
function repaintOutfitCard() {
  const c = $('#outfitCard');
  if (!c || !state.today) return;
  c.innerHTML = outfitCardInner(outfitFor(currentPerson(), 'today'));
  bindOutfitCard();
}

function outfitCardInner(o) {
  const pid = currentPerson();
  const who = pid === 'me' ? '' : personName(pid);
  const title = o && o.date !== todayStr() ? 'What to wear ' + esc(rel(o.date))
    : who ? `What ${esc(who)} wears today` : 'What to wear today';
  const chips = personChipsHtml();
  if (!o) {
    return `${chips}<h2>${title}</h2>
      <div class="muted small" style="margin-bottom:10px">Based on the hourly weather, the calendar, and time indoors vs outdoors${state.wardrobe?.items?.some(i => i.owner === pid) ? ', using clean clothes from the wardrobe' : ''}.</div>
      <label class="field"><input type="text" id="outfitNote" placeholder="Anything special? e.g. soccer game, dinner out"></label>
      <div class="btn-row"><button class="btn primary" id="pickOutfit">Suggest an outfit</button>
      <button class="btn" id="planTomorrow">Tomorrow</button></div>`;
  }
  return `${chips}<h2>${title}</h2>
    ${outfitBody(o)}
    <div class="spacer"></div>
    <div class="btn-row">
      <button class="btn" id="another">Different idea</button>
      <button class="btn ghost" id="planTomorrow">Tomorrow</button>
    </div>`;
}

function outfitBody(o, withWear = true) {
  const layers = o.layers || [];
  const ids = layers.map(l => l.item_id).filter(Boolean);
  const allWorn = ids.length && ids.every(id => wById(id)?.worn_today);
  const row = l => {
    const pid = l.item_id ? wPhotoId(l.item_id) : '';
    return `<li>${pid ? `<span class="ph sm" data-photo="${esc(pid)}"></span>` : ''}<span class="li-item">${esc(l.item)}</span>${l.why ? `<span class="li-why">${esc(l.why)}</span>` : ''}</li>`;
  };
  return `<div class="outfit-summary">${esc(o.summary || '')}</div>
    ${layers.length ? `<ul class="layers">${layers.map(row).join('')}</ul>` : ''}
    ${o.bring?.length ? `<div class="bring"><span class="muted small">Bring</span>${o.bring.map(b => `<span class="pill">${esc(b)}</span>`).join('')}</div>` : ''}
    ${o.tips ? `<p class="tips">${esc(o.tips)}</p>` : ''}
    ${ids.length ? `<div class="btn-row outfit-actions">
      ${withWear ? (allWorn ? '<span class="wear-done muted small">Logged as worn ✓</span>'
        : `<button class="btn small" data-wear-outfit data-ids="${esc(ids.join(','))}" data-date="${esc(o.date || todayStr())}">I'm wearing this</button>`) : ''}
      ${ids.length > 1 ? `<button class="btn small ghost" data-collage data-ids="${esc(ids.join(','))}">Collage</button>` : ''}
    </div>` : ''}`;
}

function bindOutfitCard() {
  const card = $('#outfitCard');
  if (!card) return;
  const pid = currentPerson();
  const cur = outfitFor(pid, 'today');
  if (cur?.layers?.some(l => l.item_id)) {
    if (!state.wardrobe) {
      api('wardrobe.list').then(w => { state.wardrobe = w; repaintOutfitCard(); }).catch(() => {});
    } else ensurePhotos();
  }
  const gen = async (btn, date, note) => busy(btn, async () => {
    const o = await api('outfit.generate', { date, note, person: pid });
    setOutfit(pid, date === 'today' ? 'today' : 'tomorrow', o);
    saveToday();
    if (date === 'today') repaintOutfitCard();
    else showOutfitModal(o);
  }).catch(fail);

  $('#pickOutfit', card)?.addEventListener('click', e => gen(e.currentTarget, 'today', $('#outfitNote', card).value));
  $('#another', card)?.addEventListener('click', e => gen(e.currentTarget, 'today', 'Give a different idea than: ' + (cur?.summary || '')));
  $('#planTomorrow', card)?.addEventListener('click', e => {
    const tm = outfitFor(pid, 'tomorrow');
    if (tm) showOutfitModal(tm);
    else gen(e.currentTarget, 'tomorrow', '');
  });
}

function showOutfitModal(o) {
  const pid = o.person || 'me';
  openModal(`<h3>${pid === 'me' ? 'What to wear' : esc(personName(pid)) + ' wears'} ${esc(rel(o.date))}</h3>${outfitBody(o)}
    <div class="spacer"></div>
    <div class="btn-row"><button class="btn" id="mAnother">Different idea</button><button class="btn primary" id="mClose">Got it</button></div>`);
  ensurePhotos();
  $('#mClose').onclick = closeModal;
  $('#mAnother').onclick = e => busy(e.currentTarget, async () => {
    const n = await api('outfit.generate', { date: o.date, note: 'Give a different idea than: ' + o.summary, person: pid });
    if (state.today) setOutfit(pid, o.date === todayStr() ? 'today' : 'tomorrow', n);
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

// ================= WARDROBE =================
const W_CATS = [['top', 'Tops'], ['bottom', 'Bottoms'], ['dress', 'Dresses'], ['outerwear', 'Outerwear'], ['shoes', 'Shoes'], ['accessory', 'Accessories'], ['other', 'Other']];
const W_WARMTH = ['', 'Very light', 'Light', 'Medium', 'Warm', 'Very warm'];
const W_FORMAL = [['athletic', 'Athletic'], ['casual', 'Casual'], ['smart', 'Smart casual'], ['dressy', 'Dressy']];
const W_DEFAULT_WEARS = { top: 1, bottom: 3, dress: 1, outerwear: 10, shoes: 7, accessory: 10, other: 3 };
const CUT_MODES = [['keep', 'Keep the photo as it is'], ['ai', 'Remove background (AI, on this phone)'], ['flat', 'Remove a plain background (quick)']];
const BG_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs';
state.wardrobe = null;
state.wsel = new Set();
state.wfilter = 'all';
state.wsize = 'all';
state.job = null;
state.person = (() => { try { return localStorage.getItem('homebase.person') || 'me'; } catch { return 'me'; } })();

const wById = id => (state.wardrobe?.items || []).find(i => i.id === id);
const wPhotoId = id => wById(id)?.photo_id || '';
const isPickable = i => i.active && !i.dirty;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* optional */ } };

// --- people (each has their own wardrobe) ---
function parsePeople(str) {
  try { const l = JSON.parse(str || '[]'); if (Array.isArray(l) && l.length) return l; } catch { /* default */ }
  return [{ id: 'me', name: 'Me', kind: 'adult', size: '', notes: '' }];
}
function people() { return state.wardrobe?.people || state.today?.people || parsePeople(state.settings?.people); }
function personName(id) { const ps = people(); return (ps.find(p => p.id === id) || ps[0]).name; }
function currentPerson() { if (!people().some(p => p.id === state.person)) state.person = 'me'; return state.person; }
function setPerson(id) { state.person = id; lsSet('homebase.person', id); }
function personChipsHtml() {
  const ps = people();
  if (ps.length < 2) return '';
  return `<div class="fchips pchips">${ps.map(p => `<button data-person="${esc(p.id)}" class="${currentPerson() === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-person]');
  if (!b) return;
  setPerson(b.dataset.person);
  if (location.hash === '#wardrobe') { state.wsel.clear(); state.wfilter = 'all'; state.wsize = 'all'; paintWardrobe(); }
  else repaintOutfitCard();
});

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
  for (const id of ids) {
    if (photoMem.has(id)) continue;
    const c = await idbGet(id);
    if (c) photoMem.set(id, c); else need.push(id);
  }
  paintPhotos();
  const todo = need.filter(id => !photoInflight.has(id));
  todo.forEach(id => photoInflight.add(id));
  for (let i = 0; i < todo.length; i += 12) {
    const chunk = todo.slice(i, i + 12);
    try {
      const got = await api('wardrobe.photos', { ids: chunk });
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
function canvasBlob(c, type, q) { return new Promise(res => c.toBlob(b => res(b), type, q)); }

// JPEG, longest side `max`, white behind transparency. Returns {url, data, mime, canvas}.
async function shrinkImage(file, max = 420) {
  const bmp = await decodeImage(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const url = c.toDataURL('image/jpeg', 0.78);
  return { url, data: url.split(',')[1], mime: 'image/jpeg', canvas: c };
}

// Crops transparent margins, fits into `max`, returns a PNG {url, data, mime}.
function trimToPng(src, max = 420) {
  const w = src.width, h = src.height;
  const px = src.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('Nothing was left after removing the background.');
  const m = 4;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = Math.min(1, max / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * k)); out.height = Math.max(1, Math.round(ch * k));
  out.getContext('2d').drawImage(src, x0, y0, cw, ch, 0, 0, out.width, out.height);
  const url = out.toDataURL('image/png');
  return { url, data: url.split(',')[1], mime: 'image/png' };
}

// Plain-background cutout: flood-fills from the photo's edges over pixels close to the border colour.
// Works on ImageData-like {data, width, height}; returns null when the background isn't plain enough.
function flatCutout(img, tol = 42) {
  const { data, width: w, height: h } = img;
  const samples = [];
  const take = (x, y) => { const i = (y * w + x) * 4; samples.push([data[i], data[i + 1], data[i + 2]]); };
  for (let x = 0; x < w; x += 2) { take(x, 0); take(x, h - 1); }
  for (let y = 0; y < h; y += 2) { take(0, y); take(w - 1, y); }
  const med = c => { const v = samples.map(s => s[c]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const dist = p => { const i = p * 4; return Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]); };
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let sp = 0, removed = 0;
  const push = (x, y) => { const p = y * w + x; if (!seen[p] && dist(p) <= tol) { seen[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (sp) {
    const p = stack[--sp]; removed++;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  const frac = removed / (w * h);
  if (frac < 0.08 || frac > 0.92) return null;
  const out = new Uint8ClampedArray(data);
  for (let p = 0; p < w * h; p++) {
    if (seen[p]) { out[p * 4 + 3] = 0; continue; }
    const x = p % w, y = (p / w) | 0;
    if ((x > 0 && seen[p - 1]) || (x < w - 1 && seen[p + 1]) || (y > 0 && seen[p - w]) || (y < h - 1 && seen[p + w])) out[p * 4 + 3] = 150;   // soften the edge
  }
  return { data: out, width: w, height: h, removed: frac };
}

let bgLib = null;
function loadBgLib() {
  if (!bgLib) bgLib = import(BG_LIB).then(m => m.removeBackground || m.default).catch(() => { bgLib = null; throw new Error("Couldn't load the cutout tool. Check your connection, or use the quick option."); });
  return bgLib;
}

// mode: keep | ai | flat. `src` comes from shrinkImage(). Returns {url, data, mime} to store.
async function applyCutout(src, mode, onStatus = () => {}) {
  if (mode === 'ai') {
    onStatus('Loading the cutout tool… (the first time downloads about 80 MB)');
    const remove = await loadBgLib();
    const small = await shrinkImage(await canvasBlob(src.canvas, 'image/jpeg', 0.85), 512);
    onStatus('Cutting out the clothing…');
    const blob = await remove(await canvasBlob(small.canvas, 'image/jpeg', 0.9), {
      output: { format: 'image/png' },
      progress: (key, cur, tot) => { if (tot) onStatus(`Downloading the cutout tool… ${Math.round(100 * cur / tot)}%`); }
    });
    const bmp = await decodeImage(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    return trimToPng(c);
  }
  if (mode === 'flat') {
    onStatus('Removing the background…');
    const ctx = src.canvas.getContext('2d');
    const res = flatCutout(ctx.getImageData(0, 0, src.canvas.width, src.canvas.height));
    if (!res) throw new Error("The background isn't plain enough for the quick option. Try the AI option or keep the photo.");
    const c = document.createElement('canvas'); c.width = res.width; c.height = res.height;
    c.getContext('2d').putImageData(new ImageData(res.data, res.width, res.height), 0, 0);
    return trimToPng(c);
  }
  return { url: src.url, data: src.data, mime: src.mime };
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

// --- background job (bulk add, describe with AI): runs while you use the app ---
function paintJobBar() {
  $('.jobbar')?.remove();
  const j = state.job;
  if (!j) return;
  const bar = document.createElement('div');
  bar.className = 'jobbar';
  bar.innerHTML = `<div class="grow"><div class="small"><b>${esc(j.title)}</b> · ${esc(j.label)}</div>
    <div class="progress"><i style="width:${j.total ? Math.round(100 * j.done / j.total) : 0}%"></i></div></div>
    <button class="btn small ghost" id="jobStop">Stop</button>`;
  document.body.appendChild(bar);
  $('#jobStop').onclick = () => { j.cancel = true; j.label = 'Stopping…'; paintJobBar(); };
}
async function runJob(title, total, fn) {
  if (state.job) return toast('Another job is still running.', true);
  const job = state.job = { title, total, done: 0, label: 'Starting…', cancel: false, notes: [] };
  paintJobBar();
  try { await fn(job, () => paintJobBar()); }
  catch (e) { job.notes.push(e.message || String(e)); }
  state.job = null; paintJobBar();
  if (location.hash === '#wardrobe') paintWardrobe();
  toast(job.notes.length ? job.notes.slice(0, 2).join(' · ') : `${title}: done.`, job.notes.length > 0);
}

// Asks AI to describe one saved item from its photo and saves the details.
async function describeItem(item, jpegData) {
  const data = jpegData || await urlToJpegData(photoMem.get(item.photo_id));
  const f = await api('wardrobe.analyze', { photo: { data, mime: 'image/jpeg' } });
  const res = await api('wardrobe.save', {
    id: item.id, name: f.name, category: f.category, color: f.color, warmth: f.warmth, waterproof: f.waterproof,
    formality: f.formality, notes: f.notes, wears_limit: f.wears_limit, size: item.size || f.size || '', needs_details: false
  });
  state.wardrobe = res;
}
const isQuotaError = e => /limit|quota|429/i.test(e.message || '');

async function describePending(items) {
  const list = items.filter(i => i.needs_details && i.photo_id);
  if (!list.length) return toast('Nothing to describe.');
  await runJob('Describing with AI', list.length, async (job, repaint) => {
    await ensurePhotos(list.map(i => i.photo_id));
    for (const it of list) {
      if (job.cancel) break;
      job.label = `${job.done + 1} of ${list.length}`; repaint();
      try { await describeItem(wById(it.id) || it); }
      catch (e) { if (isQuotaError(e)) { job.notes.push('AI limit reached. The rest can wait until tomorrow.'); break; } job.notes.push(`${it.name}: ${e.message}`); }
      job.done++; repaint();
      if (location.hash === '#wardrobe') paintWardrobe();
      await sleep(3500);
    }
  });
}

// --- list view ---
async function renderWardrobe() {
  if (state.wardrobe) paintWardrobe();
  else view.innerHTML = '<div class="card"><div class="skeleton" style="height:220px"></div></div>';
  try {
    state.wardrobe = await api('wardrobe.list');
    state.wsel.forEach(id => { const it = wById(id); if (!it || !isPickable(it)) state.wsel.delete(id); });
    if (location.hash === '#wardrobe') paintWardrobe();
  } catch (e) { fail(e); }
}

function wCardHtml(i) {
  const off = !i.active || (i.dirty && !i.worn_today);
  const sel = state.wsel.has(i.id);
  const badge = !i.active ? '<span class="wbadge">Retired</span>'
    : i.worn_today ? `<span class="wbadge ok">Worn today${i.dirty ? ' · wash' : ''}</span>`
    : i.dirty ? '<span class="wbadge warn">Laundry</span>'
    : i.needs_details ? '<span class="wbadge">Needs details</span>' : '';
  const initial = esc((i.name || '?').trim().charAt(0).toUpperCase());
  return `<div class="wcard${sel ? ' sel' : ''}${off ? ' off' : ''}" data-id="${i.id}">
    <div class="ph" data-photo="${esc(i.photo_id || '')}"><span class="ph-i">${initial}</span>${badge}${sel ? `<span class="wtick">${CHECK}</span>` : ''}</div>
    <button class="wedit" data-edit="${i.id}" aria-label="Edit ${esc(i.name)}">✎</button>
    <div class="wname">${esc(i.name)}</div>
    <div class="wmeta">${esc([i.color, i.size, `${i.wears}/${i.wears_limit}`].filter(Boolean).join(' · '))}</div>
  </div>`;
}

function paintWardrobe() {
  const w = state.wardrobe;
  const pid = currentPerson();
  const mine = (w?.items || []).filter(i => i.owner === pid);
  const present = W_CATS.filter(([v]) => mine.some(i => i.category === v));
  if (state.wfilter !== 'all' && !present.some(([v]) => v === state.wfilter)) state.wfilter = 'all';
  const sizes = [...new Set(mine.map(i => i.size).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (state.wsize !== 'all' && !sizes.includes(state.wsize)) state.wsize = 'all';
  const shown = mine.filter(i => (state.wfilter === 'all' || i.category === state.wfilter) && (state.wsize === 'all' || i.size === state.wsize));
  const dirty = mine.filter(i => i.active && i.dirty);
  const pending = mine.filter(i => i.needs_details && i.photo_id);
  const who = pid === 'me' ? 'you' : personName(pid);

  view.innerHTML = `${personChipsHtml()}${!mine.length
    ? `<div class="empty"><div class="big">No clothes yet${pid === 'me' ? '' : ' for ' + esc(personName(pid))}</div>Tap + to add one item, or many photos at once.<br>AI fills in the details for you.</div>`
    : `<div class="card" id="aiPick">
        <h2>Let AI pick${pid === 'me' ? '' : ' for ' + esc(personName(pid))}</h2>
        <div class="muted small" style="margin-bottom:8px">Uses only clean clothes, matched to today's weather and calendar.</div>
        <label class="field" style="margin-bottom:8px"><input type="text" id="aiNote" placeholder="Anything special? e.g. dinner out" autocomplete="off"></label>
        <button class="btn primary block" id="aiGo">Suggest from the wardrobe</button>
      </div>
      ${pending.length ? `<div class="laundry-bar info"><span>✨ <b>${pending.length}</b> need${pending.length > 1 ? '' : 's'} details</span><button class="btn small" id="descBtn">Describe with AI</button></div>` : ''}
      ${dirty.length ? `<div class="laundry-bar"><span>🧺 <b>${dirty.length}</b> item${dirty.length > 1 ? 's' : ''} need washing</span><button class="btn small" id="washBtn">Mark washed</button></div>` : ''}
      <div class="fchips" id="wFilter">
        <button data-f="all" class="${state.wfilter === 'all' ? 'on' : ''}">All <span>${mine.length}</span></button>
        ${present.map(([v, l]) => `<button data-f="${v}" class="${state.wfilter === v ? 'on' : ''}">${l} <span>${mine.filter(i => i.category === v).length}</span></button>`).join('')}
      </div>
      ${sizes.length > 1 ? `<label class="size-filter"><span class="muted small">Size</span><select id="wSize"><option value="all">All sizes</option>${sizes.map(z => `<option ${state.wsize === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>` : ''}
      <div class="muted small" style="margin:4px 2px 8px">Tap clothes to select what ${esc(who)} ${pid === 'me' ? 'are' : 'is'} wearing, then tap “Wear today”.</div>
      <div class="wgrid" id="wGrid">${shown.map(wCardHtml).join('')}</div>`}`;

  $('#aiGo')?.addEventListener('click', e => busy(e.currentTarget, async () => {
    const o = await api('outfit.generate', { date: 'today', note: $('#aiNote').value.trim(), person: pid });
    setOutfit(pid, 'today', o); saveToday();
    showWardrobeOutfit(o);
  }).catch(fail));
  $('#washBtn')?.addEventListener('click', () => openLaundry(mine));
  $('#descBtn')?.addEventListener('click', () => describePending(mine));
  $$('#wFilter button').forEach(b => b.addEventListener('click', () => { state.wfilter = b.dataset.f; paintWardrobe(); }));
  $('#wSize')?.addEventListener('change', e => { state.wsize = e.target.value; paintWardrobe(); });
  $('#wGrid')?.addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return openItemEditor(wById(ed.dataset.edit));
    const card = e.target.closest('.wcard');
    if (!card) return;
    const it = wById(card.dataset.id);
    if (!it) return;
    if (!isPickable(it)) return openItemEditor(it);          // retired, in laundry or already worn: details + actions
    if (state.wsel.has(it.id)) state.wsel.delete(it.id); else state.wsel.add(it.id);
    card.classList.toggle('sel', state.wsel.has(it.id));
    const ph = $('.ph', card);
    $('.wtick', ph)?.remove();
    if (state.wsel.has(it.id)) ph.insertAdjacentHTML('beforeend', `<span class="wtick">${CHECK}</span>`);
    paintSelBar();
  });
  addFab(openAddChooser);
  paintSelBar();
  ensurePhotos();
}

function paintSelBar() {
  $('.wsel')?.remove();
  const n = state.wsel.size;
  $('.fab')?.classList.toggle('hidden', n > 0);
  if (!n) return;
  const bar = document.createElement('div');
  bar.className = 'wsel';
  bar.innerHTML = `<span><b>${n}</b> selected</span><button class="btn small ghost" id="wClear">Clear</button>${n > 1 ? '<button class="btn small" id="wColl">Collage</button>' : ''}<button class="btn small primary" id="wWear">Wear today</button>`;
  document.body.appendChild(bar);
  $('#wClear').onclick = () => { state.wsel.clear(); paintWardrobe(); };
  $('#wColl')?.addEventListener('click', () => openCollage([...state.wsel]));
  $('#wWear').onclick = e => busy(e.currentTarget, () => wearIds([...state.wsel], todayStr())).catch(fail);
}

// Records items as worn; the backend skips anything that needs washing.
async function wearIds(ids, date) {
  const res = await api('wardrobe.wear', { ids, date });
  state.wardrobe = { today: res.today, items: res.items, people: res.people };
  state.wsel.clear();
  const skipped = res.skipped || [];
  toast(skipped.length
    ? `Logged ${res.worn.length}. Skipped: ${skipped.map(s => `${s.name} (${s.reason})`).join(', ')}`
    : `Logged ${res.worn.length} item${res.worn.length === 1 ? '' : 's'} as worn.`, skipped.length > 0);
  if (location.hash === '#wardrobe') paintWardrobe();
  return res;
}

function openLaundry(pool) {
  const list = (pool || state.wardrobe?.items || []).filter(i => i.wears > 0);
  if (!list.length) return toast('Nothing to wash.');
  openModal(`<h3>Mark washed</h3>
    <div class="muted small" style="margin-bottom:8px">Washed items go back to 0 wears and can be picked again.</div>
    ${list.map(i => `<label class="wash-row"><input type="checkbox" value="${i.id}" ${i.dirty ? 'checked' : ''}>
      <span class="ph sm" data-photo="${esc(i.photo_id || '')}"></span>
      <span class="grow"><b>${esc(i.name)}</b><br><span class="muted small">${i.wears}/${i.wears_limit} wears${i.dirty ? ' · needs washing' : ''}</span></span></label>`).join('')}
    <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="washGo">Mark washed</button><button class="btn" id="washAll">All of these</button></div>`);
  ensurePhotos();
  const go = (all) => e => busy(e.currentTarget, async () => {
    const ids = all ? list.map(i => i.id) : $$('#modalBody input:checked').map(c => c.value);
    if (!ids.length) throw new Error('Pick at least one item.');
    state.wardrobe = await api('wardrobe.laundry', { ids });
    closeModal(); toast('Washed. They are available again.');
    if (location.hash === '#wardrobe') paintWardrobe();
  }).catch(fail);
  $('#washGo').onclick = go(false);
  $('#washAll').onclick = go(true);
}

function showWardrobeOutfit(o) {
  const ids = (o.layers || []).map(l => l.item_id).filter(Boolean);
  const pid = o.person || 'me';
  openModal(`<h3>${pid === 'me' ? 'Today from your wardrobe' : esc(personName(pid)) + ' today'}</h3>${outfitBody(o, false)}
    <div class="spacer"></div>
    <div class="btn-row">
      ${ids.length ? '<button class="btn primary" id="aiWear">Wear this</button><button class="btn" id="aiEdit">Pick myself</button>' : ''}
      <button class="btn" id="aiAgain">Different idea</button>
    </div>`);
  ensurePhotos();
  $('#aiWear')?.addEventListener('click', e => busy(e.currentTarget, async () => { await wearIds(ids, o.date); closeModal(); }).catch(fail));
  $('#aiEdit')?.addEventListener('click', () => { state.wsel = new Set(ids.filter(id => { const i = wById(id); return i && isPickable(i); })); closeModal(); paintWardrobe(); });
  $('#aiAgain')?.addEventListener('click', e => busy(e.currentTarget, async () => {
    const n = await api('outfit.generate', { date: o.date, note: 'Give a different idea than: ' + o.summary, person: pid });
    setOutfit(pid, o.date === todayStr() ? 'today' : 'tomorrow', n); saveToday();
    showWardrobeOutfit(n);
  }).catch(fail));
}

// --- adding clothes ---
function openAddChooser() {
  openModal(`<h3>Add clothes</h3>
    <div class="muted small" style="margin-bottom:12px">For ${esc(personName(currentPerson()))}. Photos are shrunk on your phone before they are saved.</div>
    <div class="btn-row"><button class="btn primary" id="addOne">One item</button><button class="btn" id="addMany">Many photos at once</button></div>`);
  $('#addOne').onclick = () => openItemEditor(null);
  $('#addMany').onclick = openBulkAdd;
}

function cutSelectHtml(id, value) {
  return `<select id="${id}">${CUT_MODES.map(([v, l]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}

function openBulkAdd() {
  const ps = people();
  openModal(`<h3>Add many photos</h3>
    <label class="field"><span>Photos (one clothing item per photo)</span><input type="file" id="bFiles" accept="image/*" multiple></label>
    ${ps.length > 1 ? `<label class="field"><span>Belongs to</span><select id="bWho">${ps.map(p => `<option value="${esc(p.id)}" ${p.id === currentPerson() ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    <label class="field"><span>Background</span>${cutSelectHtml('bCut', lsGet('homebase.cut', 'keep'))}</label>
    <label class="field check-field row-field"><input type="checkbox" id="bDesc" checked><span>Describe each with AI afterwards (one at a time, paced to stay within the free limit)</span></label>
    <div class="muted small" id="bInfo" style="margin-bottom:10px">Tip: lay each item flat on a plain, contrasting surface. You can keep using the app while this runs.</div>
    <button class="btn primary block" id="bGo">Start</button>`);
  $('#bGo').onclick = () => {
    const files = [...($('#bFiles').files || [])];
    if (!files.length) return toast('Choose at least one photo.', true);
    const owner = $('#bWho')?.value || currentPerson();
    const mode = $('#bCut').value, describe = $('#bDesc').checked;
    lsSet('homebase.cut', mode);
    closeModal();
    runBulk(files, owner, mode, describe);
  };
}

async function runBulk(files, owner, mode, describe) {
  const added = [];
  await runJob('Adding photos', files.length * (describe ? 2 : 1), async (job, repaint) => {
    if (!state.wardrobe) state.wardrobe = await api('wardrobe.list');
    let cutFailures = 0;
    for (let i = 0; i < files.length; i++) {
      if (job.cancel) break;
      job.label = `photo ${i + 1} of ${files.length}`; repaint();
      try {
        const src = await shrinkImage(files[i]);
        let photo;
        try { photo = await applyCutout(src, mode, t => { job.label = `photo ${i + 1} of ${files.length}: ${t}`; repaint(); }); }
        catch (e) { cutFailures++; photo = { data: src.data, mime: src.mime }; if (mode === 'ai' && cutFailures === 1) job.notes.push(e.message); }
        const before = new Set(state.wardrobe.items.map(x => x.id));
        const res = await api('wardrobe.save', { name: 'New item', category: 'other', owner, needs_details: true, photo: { data: photo.data, mime: photo.mime } });
        state.wardrobe = res;
        const item = res.items.find(x => !before.has(x.id));
        if (item) added.push({ id: item.id, jpeg: src.data });
      } catch (e) { job.notes.push(`Photo ${i + 1}: ${e.message}`); }
      job.done++; repaint();
      if (location.hash === '#wardrobe') paintWardrobe();
    }
    if (describe && !job.cancel) {
      for (let i = 0; i < added.length; i++) {
        if (job.cancel) break;
        job.label = `describing ${i + 1} of ${added.length}`; repaint();
        try { await describeItem(wById(added[i].id), added[i].jpeg); }
        catch (e) { if (isQuotaError(e)) { job.notes.push('AI limit reached. Describe the rest later (tap “Describe with AI”).'); break; } job.notes.push(e.message); }
        job.done++; repaint();
        if (location.hash === '#wardrobe') paintWardrobe();
        await sleep(3500);
      }
    }
  });
}

// --- add / edit one item ---
function openItemEditor(item) {
  const isNew = !item;
  const ps = people();
  const it = item || { name: '', category: 'top', color: '', warmth: 3, waterproof: false, formality: 'casual', notes: '', wears_limit: W_DEFAULT_WEARS.top, wears: 0, active: true, owner: currentPerson(), size: '' };
  let src = null;              // newly chosen photo (shrunk JPEG)
  let photo = null;            // what will be stored: src or its cutout {url, data, mime}
  let limitTouched = !isNew;
  openModal(`
    <h3>${isNew ? 'Add clothes' : 'Edit item'}</h3>
    <div class="item-photo">
      <div class="ph big" id="iPh" data-photo="${esc(it.photo_id || '')}"><span class="ph-i">${esc((it.name || '+').charAt(0).toUpperCase())}</span></div>
      <div class="grow">
        <input type="file" id="iFile" accept="image/*" hidden>
        <button type="button" class="btn small" id="iPick">${it.photo_id ? 'Change photo' : 'Add photo'}</button>
        <button type="button" class="btn small ghost hidden" id="iAi">Fill in with AI</button>
        <div class="muted small" id="iAiMsg" style="margin-top:6px">${isNew ? 'Add a photo and AI fills in the details.' : ''}</div>
      </div>
    </div>
    <label class="field hidden" id="iCutF"><span>Background</span>${cutSelectHtml('iCut', lsGet('homebase.cut', 'keep'))}</label>
    ${isNew ? '' : itemStatusHtml(it)}
    <label class="field"><span>Name</span><input type="text" id="iName" value="${esc(it.name)}" placeholder="Navy quarter-zip sweater"></label>
    <div class="two">
      ${ps.length > 1 ? `<label class="field"><span>Belongs to</span><select id="iOwner">${ps.map(p => `<option value="${esc(p.id)}" ${it.owner === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Size</span><input type="text" id="iSize" value="${esc(it.size || '')}" placeholder="e.g. Age 7, M, 9"></label>
      <label class="field"><span>Type</span><select id="iCat">${W_CATS.map(([v, l]) => `<option value="${v}" ${it.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Color</span><input type="text" id="iColor" value="${esc(it.color)}" placeholder="navy"></label>
      <label class="field"><span>Warmth</span><select id="iWarm">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Number(it.warmth) === n ? 'selected' : ''}>${n} · ${W_WARMTH[n]}</option>`).join('')}</select></label>
      <label class="field"><span>Dress code</span><select id="iForm">${W_FORMAL.map(([v, l]) => `<option value="${v}" ${it.formality === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Wears before wash</span><input type="number" min="1" max="60" id="iLimit" value="${it.wears_limit || 1}"></label>
      <label class="field check-field"><span>Waterproof</span><input type="checkbox" id="iWater" ${it.waterproof ? 'checked' : ''}></label>
    </div>
    <label class="field"><span>Notes</span><input type="text" id="iNotes" value="${esc(it.notes || '')}" placeholder="scratchy wool, only dry days…"></label>
    ${isNew ? '' : `<label class="field check-field row-field"><input type="checkbox" id="iRetired" ${it.active ? '' : 'checked'}><span>Retired (don't suggest or let me pick it)</span></label>`}
    <div class="btn-row"><button class="btn primary" id="iSave">Save</button>${isNew ? '' : '<button class="btn danger" id="iDel">Delete</button>'}</div>`);
  ensurePhotos();

  const msg = t => { $('#iAiMsg').textContent = t; };
  const showPhoto = p => {
    const ph = $('#iPh');
    ph.style.backgroundImage = `url("${p.url}")`; ph.classList.add('has'); ph.dataset.shown = '1'; ph.dataset.photo = '';
  };
  const fill = f => {
    if (f.name) $('#iName').value = f.name;
    if (f.category) $('#iCat').value = f.category;
    if (f.color !== undefined) $('#iColor').value = f.color;
    if (f.warmth) $('#iWarm').value = String(f.warmth);
    if (f.formality) $('#iForm').value = f.formality;
    if (f.wears_limit) { $('#iLimit').value = f.wears_limit; limitTouched = true; }
    if (f.size && !$('#iSize').value.trim()) $('#iSize').value = f.size;
    $('#iWater').checked = !!f.waterproof;
    if (f.notes !== undefined) $('#iNotes').value = f.notes;
  };
  const runAi = async btn => {
    if (!src) return toast('Add a photo first.', true);
    msg('Looking at your photo…');
    try {
      const call = () => api('wardrobe.analyze', { photo: { data: src.data, mime: src.mime } });
      const f = await (btn ? busy(btn, call) : call());
      fill(f); msg('Filled in by AI. Check it, then save.');
    } catch (e) { msg(''); fail(e); }
  };
  const runCut = async () => {
    const mode = $('#iCut').value;
    lsSet('homebase.cut', mode);
    photo = src;
    showPhoto(photo);
    if (mode === 'keep') return;
    try { photo = await applyCutout(src, mode, msg); showPhoto(photo); msg('Background removed. Not happy? Pick “Keep the photo as it is”.'); }
    catch (e) { photo = src; showPhoto(photo); msg(''); fail(e); }
  };
  $('#iPick').onclick = () => $('#iFile').click();
  $('#iFile').onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      src = await shrinkImage(file);
      photo = src; showPhoto(photo);
      $('#iAi').classList.remove('hidden'); $('#iCutF').classList.remove('hidden');
      const cutting = $('#iCut').value !== 'keep';
      const jobs = [];
      if (cutting) jobs.push(runCut());
      if (isNew && !$('#iName').value.trim()) jobs.push(runAi(null));
      if (!jobs.length) msg('Photo ready. Tap “Fill in with AI” if you want it to describe the item.');
      await Promise.all(jobs);
    } catch (err) { fail(err); }
  };
  $('#iCut').onchange = () => { if (src) runCut(); };
  $('#iAi').onclick = e => runAi(e.currentTarget);
  $('#iLimit').oninput = () => { limitTouched = true; };
  $('#iCat').onchange = () => { if (!limitTouched) $('#iLimit').value = W_DEFAULT_WEARS[$('#iCat').value] || 3; };

  $('#iSave').onclick = e => {
    const name = $('#iName').value.trim();
    if (!name) return toast('Give it a name.', true);
    const data = {
      name, category: $('#iCat').value, color: $('#iColor').value.trim(), warmth: Number($('#iWarm').value),
      formality: $('#iForm').value, waterproof: $('#iWater').checked, wears_limit: Number($('#iLimit').value) || 1,
      notes: $('#iNotes').value.trim(), size: $('#iSize').value.trim(), needs_details: false,
      owner: $('#iOwner')?.value || it.owner || 'me'
    };
    if (!isNew) { data.id = it.id; data.active = !$('#iRetired').checked; }
    if (photo) data.photo = { data: photo.data, mime: photo.mime };
    busy(e.currentTarget, async () => {
      state.wardrobe = await api('wardrobe.save', data);
      closeModal(); toast('Saved.');
      if (location.hash === '#wardrobe') paintWardrobe();
    }).catch(fail);
  };
  $('#iDel')?.addEventListener('click', e => {
    if (!confirm(`Delete "${it.name}" and its photo?`)) return;
    busy(e.currentTarget, async () => {
      state.wsel.delete(it.id);
      state.wardrobe = await api('wardrobe.delete', { id: it.id });
      closeModal(); toast('Deleted.');
      if (location.hash === '#wardrobe') paintWardrobe();
    }).catch(fail);
  });
  $('#iWash')?.addEventListener('click', e => busy(e.currentTarget, async () => {
    state.wardrobe = await api('wardrobe.laundry', { ids: [it.id] });
    closeModal(); toast('Marked washed.');
    if (location.hash === '#wardrobe') paintWardrobe();
  }).catch(fail));
  $('#iUndo')?.addEventListener('click', e => busy(e.currentTarget, async () => {
    state.wardrobe = await api('wardrobe.unwear', { ids: [it.id], date: todayStr() });
    state.wsel.delete(it.id);
    closeModal(); toast('Removed from today.');
    if (location.hash === '#wardrobe') paintWardrobe();
  }).catch(fail));
}

function itemStatusHtml(it) {
  const bits = [];
  if (it.worn_today) bits.push('<button type="button" class="btn small" id="iUndo">Undo “worn today”</button>');
  if (it.wears > 0) bits.push('<button type="button" class="btn small" id="iWash">Mark washed</button>');
  const state_ = !it.active ? 'Retired' : it.dirty ? 'Needs washing' : it.worn_today ? 'Worn today' : it.needs_details ? 'Needs details' : 'Clean';
  return `<div class="item-status"><div><b>${state_}</b> · ${it.wears}/${it.wears_limit} wears${it.last_worn ? ' · last worn ' + esc(rel(it.last_worn)) : ''}</div>${bits.length ? `<div class="btn-row" style="margin-top:8px">${bits.join('')}</div>` : ''}</div>`;
}

// --- collage: the chosen photos laid out on one picture (drawn on the phone, no AI) ---
const CAT_ORDER = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'accessory', 'other'];
function collageLayout(n, W, H, pad = 36) {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cw = (W - pad * (cols + 1)) / cols, ch = (H - pad * (rows + 1)) / rows;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols), c = i % cols;
    const rowW = inRow * cw + (inRow - 1) * pad;
    const x0 = (W - rowW) / 2;
    cells.push({ x: x0 + c * (cw + pad), y: pad + r * (ch + pad), w: cw, h: ch });
  }
  return cells;
}
async function renderCollage(items) {
  const W = 900, H = 1100;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5f1ea'; ctx.fillRect(0, 0, W, H);
  const cells = collageLayout(items.length, W, H);
  for (let i = 0; i < items.length; i++) {
    const cell = cells[i], it = items[i], u = photoMem.get(it.photo_id);
    if (u) {
      try {
        const img = await loadImg(u);
        const k = Math.min(cell.w / img.width, (cell.h - 30) / img.height);
        const w = img.width * k, h = img.height * k;
        ctx.drawImage(img, cell.x + (cell.w - w) / 2, cell.y + (cell.h - 30 - h) / 2, w, h);
      } catch { /* leave blank */ }
    } else {
      ctx.fillStyle = '#e3dbcd'; ctx.fillRect(cell.x, cell.y, cell.w, cell.h - 30);
    }
    ctx.fillStyle = '#6b645a'; ctx.font = '22px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText((it.name || '').slice(0, 28), cell.x + cell.w / 2, cell.y + cell.h - 6);
  }
  return c.toDataURL('image/png');
}
async function openCollage(ids) {
  const items = ids.map(wById).filter(Boolean).sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
  if (items.length < 2) return toast('Pick at least two items.', true);
  openModal('<h3>Collage</h3><div class="skeleton" style="height:260px"></div>');
  try {
    await ensurePhotos(items.map(i => i.photo_id));
    const url = await renderCollage(items);
    $('#modalBody').innerHTML = `<h3>Collage</h3><img class="collage" src="${url}" alt="Outfit collage">
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="colShare">Share / save</button><button class="btn" id="colClose">Close</button></div>`;
    $('#colClose').onclick = closeModal;
    $('#colShare').onclick = async () => {
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], 'outfit.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Outfit' });
        else { const a = document.createElement('a'); a.href = url; a.download = 'outfit.png'; a.click(); }
      } catch (e) { if (e.name !== 'AbortError') fail(e); }
    };
  } catch (e) { closeModal(); fail(e); }
}

// Delegated clicks: work in the Today card, chat, and modals.
document.addEventListener('click', e => {
  const c = e.target.closest('[data-collage]');
  if (c) { openCollage(c.dataset.ids.split(',').filter(Boolean)); return; }
  const b = e.target.closest('[data-wear-outfit]');
  if (!b) return;
  const ids = b.dataset.ids.split(',').filter(Boolean);
  busy(b, async () => {
    const res = await wearIds(ids, b.dataset.date);
    $$(`[data-wear-outfit][data-date="${b.dataset.date}"]`).forEach(x => { x.outerHTML = '<span class="muted small wear-done">Logged as worn ✓</span>'; });
    return res;
  }).catch(fail);
});

// ================= CHAT =================
const CHAT_CHIPS = ['What should I wear today?', "What's due this week?", 'What should I wear tomorrow?', 'Anything in my watched emails to act on?'];

async function renderChat() {
  view.innerHTML = '<div class="chat" id="chatList"></div>';
  const composer = document.createElement('form');
  composer.className = 'composer';
  composer.innerHTML = `<textarea id="chatInput" rows="1" placeholder="Ask or tell me anything…" autocomplete="off"></textarea>
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
  composer.addEventListener('submit', e => { e.preventDefault(); const v = ta.value.trim(); if (v) { ta.value = ''; grow(); sendChat(v); } });

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
    if (r.outfit && r.outfit.date === todayStr() && state.today) setOutfit(r.outfit.person || 'me', 'today', r.outfit);
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
  const watch = parseWatch(s.email_watch_query);
  const watchList = watch.list;
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
      <h2>People & sizes</h2>
      <div class="muted small" style="margin-bottom:8px">Each person gets their own wardrobe and outfit advice. For a child, set the current size so picks and shopping notes fit.</div>
      <div id="sPeople"></div>
      <button type="button" class="btn small" id="sPeopleAdd">+ Add person</button>
    </div>
    <div class="card">
      <h2>Calendars</h2>
      <div class="muted small" style="margin-bottom:8px">Which calendars Homebase reads for Today, reminders and outfit advice. Shared calendars (like Family) appear here once they're in your Google Calendar.</div>
      <div id="sCals" class="muted small">Loading calendars…</div>
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
    <div class="card">
      <h2>Assistant</h2>
      <label class="field"><span>About your household (the AI uses this)</span>
        <textarea id="sAbout" rows="3" placeholder="e.g. One indoor cat. One kid in elementary school. I work from home Mon/Fri, office Tue–Thu. I prefer comfortable, simple clothes.">${esc(s.about_me)}</textarea></label>
      <div class="field"><span>Watch these emails (blank = email reading off)</span>
        <details class="why watch" id="sWatch">
          <summary id="sWatchSum"></summary>
          <div id="sWatchRows" class="watch-rows"></div>
          <div class="watch-add"><input type="text" id="sWatchNew" placeholder="name@school.org or school.org" autocapitalize="off" autocomplete="off"><button type="button" class="btn small" id="sWatchAdd">Add</button></div>
          <details class="why" style="margin-top:8px"><summary>Advanced: extra Gmail search words</summary>
            <input type="text" id="sWatchExtra" value="${esc(watch.extra)}" placeholder="e.g. newer_than:30d" style="margin-top:6px"></details>
        </details>
        <span class="muted small" style="display:block;margin-top:5px">Only emails from these senders are ever read, by the hourly check and by chat.</span></div>
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
      <div class="two">
        <label class="field"><span>${i === 0 ? 'You' : 'Name'}</span><input type="text" data-f="name" value="${esc(p.name)}" maxlength="30"></label>
        <label class="field"><span>Current size</span><input type="text" data-f="size" value="${esc(p.size || '')}" placeholder="${p.kind === 'child' ? 'e.g. age 7' : 'e.g. M'}" maxlength="20"></label>
      </div>
      ${i === 0 ? '' : `<div class="row"><div class="seg grow"><button type="button" data-f="kind" data-v="adult" class="${p.kind !== 'child' ? 'on' : ''}">Adult</button><button type="button" data-f="kind" data-v="child" class="${p.kind === 'child' ? 'on' : ''}">Child</button></div>
        <button type="button" class="x" data-rmp="${i}" aria-label="Remove ${esc(p.name)}">✕</button></div>`}
      <label class="field"><span>Notes (optional)</span><input type="text" data-f="notes" value="${esc(p.notes || '')}" placeholder="${p.kind === 'child' ? 'e.g. grows fast, hates itchy sweaters' : 'style, fit, what you avoid'}" maxlength="400"></label>
    </div>`).join('');
    $('#sPeopleAdd').hidden = plist.length >= 6;
  };
  $('#sPeople').addEventListener('input', e => {
    const row = e.target.closest('[data-i]'); const f = e.target.dataset.f;
    if (row && f && f !== 'kind') plist[+row.dataset.i][f] = e.target.value;
  });
  $('#sPeople').addEventListener('click', e => {
    const k = e.target.closest('button[data-f="kind"]');
    if (k) { plist[+k.closest('[data-i]').dataset.i].kind = k.dataset.v; paintPeople(); return; }
    const r = e.target.closest('[data-rmp]');
    if (r && confirm(`Remove ${plist[+r.dataset.rmp].name}? Their clothes stay in the sheet but are hidden.`)) { plist.splice(+r.dataset.rmp, 1); paintPeople(); }
  });
  $('#sPeopleAdd').onclick = () => {
    if (plist.length < 6) plist.push({ id: 'p' + Math.random().toString(36).slice(2, 8), name: '', kind: 'child', size: '', notes: '' });
    paintPeople();
  };
  paintPeople();

  api('usage').then(u => {
    const el = $('#sUsage'); if (!el) return;
    const rows = Object.entries(u.calls || {});
    el.innerHTML = `In use: <b>${esc(u.models?.main || '?')}</b> (everyday), <b>${esc(u.models?.smart || '?')}</b> (outfits).<br>` +
      (rows.length ? 'Requests today: ' + rows.map(([m, n]) => `${esc(m)} ${n}`).join(' · ') : 'No AI requests yet today.') +
      '<br>Your exact free limits are listed in Google AI Studio.';
  }).catch(() => { $('#sUsage') && ($('#sUsage').textContent = ''); });

  api('calendars.list').then(cals => {
    const el = $('#sCals'); if (!el) return;
    el.classList.remove('muted', 'small');
    el.innerHTML = cals.map(c => `<label class="row cal-row"><input type="checkbox" value="${esc(c.id)}" ${c.selected ? 'checked' : ''}>
      <span class="grow">${esc(c.name)}${c.primary ? ' <span class="muted small">(yours)</span>' : ''}${!c.owned && !c.primary ? ' <span class="muted small">shared</span>' : ''}</span></label>`).join('');
  }).catch(e => { $('#sCals') && ($('#sCals').textContent = 'Could not load calendars: ' + e.message); });

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
    state.today = null;
  }).catch(fail);
  $('#sClear').onclick = e => { if (confirm('Clear chat history?')) busy(e.currentTarget, async () => { await api('chat.clear'); state.chat = []; toast('Cleared.'); }).catch(fail); };
  $('#sSave').onclick = e => busy(e.currentTarget, async () => {
    const calBoxes = $$('#sCals input[type=checkbox]');
    const calendar_ids = calBoxes.filter(b => b.checked).map(b => b.value);
    if (calBoxes.length && !calendar_ids.length) throw new Error('Pick at least one calendar.');
    state.settings = await api('settings.save', {
      ...(calBoxes.length ? { calendar_ids } : {}),
      latitude: $('#sLat').value.trim(), longitude: $('#sLon').value.trim(), units: $('#sUnits').value,
      indoor_temp: $('#sIndoor').value, clothes_notes: $('#sClothes').value.trim(),
      brief_hour: $('#sBrief').value, evening_hour: $('#sEve').value, notify_channel: $('#sChan').dataset.value || 'ntfy',
      about_me: $('#sAbout').value.trim(), email_watch_query: buildWatch(watchList, $('#sWatchExtra').value),
      model_main: $('#sModelMain').value.trim() || 'auto', model_smart: $('#sModelSmart').value.trim() || 'auto',
      people: plist.map(p => ({ ...p, name: String(p.name || '').trim() || 'Person' })),
      app_url: location.origin + location.pathname
    });
    state.wardrobe = null;
    state.today = null; localStorage.removeItem('homebase.today');
    toast('Saved.');
  }).catch(fail);
}

// ---------------- boot ----------------
window.__hbBooted = true;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
