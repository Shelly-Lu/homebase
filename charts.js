// charts.js: draws the charts the chat makes (line, bar, scatter, pie, growth) as SVG. No libraries.
// Every chart has a tooltip (tap or drag across it) and a "Data" table underneath.
// Labels are always set with textContent (they can come from your records).

const NS = 'http://www.w3.org/2000/svg';
const FONT = 11;                      // axis text size
const CH = FONT * 0.6;                // rough width of one character, for spacing labels
const PCTS = [5, 10, 25, 50, 75, 90, 95];
const Z = { 5: -1.6449, 10: -1.2816, 25: -0.6745, 50: 0, 75: 0.6745, 90: 1.2816, 95: 1.6449 };

// ---------- small DOM helpers ----------
function el(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function sv(tag, attrs, parent, style) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  if (style) e.setAttribute('style', style);
  if (parent) parent.appendChild(e);
  return e;
}
function svText(x, y, text, parent, opts = {}) {
  const t = sv('text', { x, y, 'text-anchor': opts.anchor || 'start', 'dominant-baseline': opts.base || 'middle', class: opts.cls || 'ct-axis' }, parent);
  t.textContent = text;
  return t;
}
const color = i => `var(--c${(i % 8) + 1})`;
const r1 = v => Math.round(v * 10) / 10;

// ---------- numbers & dates ----------
function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}
function niceTicks(min, max, count = 4) {
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { min: lo, max: hi, ticks, step };
}
function fmtNum(v, unit = '', compact = false) {
  if (v === null || v === undefined || !isFinite(v)) return '–';
  const abs = Math.abs(v);
  const s = compact && abs >= 10000
    ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: abs >= 100 ? 0 : abs >= 10 ? 1 : 2 }).format(v);
  if (!unit) return s;
  if (/^[$€£¥₹]$/.test(unit)) return (v < 0 ? '-' : '') + unit + s.replace('-', '');
  if (unit === '%') return s + '%';
  return s + ' ' + unit;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayMs(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
function fmtDay(ms, style = 'day') {
  const d = new Date(ms);
  const mo = MONTHS[d.getUTCMonth()], y = d.getUTCFullYear();
  if (style === 'year') return String(y);
  if (style === 'month') return mo;
  if (style === 'monthyear') return `${mo} ’${String(y).slice(2)}`;
  if (style === 'full') return `${mo} ${d.getUTCDate()}, ${y}`;
  return `${mo} ${d.getUTCDate()}`;
}
/** Up to ~5 tidy date ticks between two dates (ms). */
function dateTicks(min, max, maxTicks = 5) {
  const DAY = 864e5, span = (max - min) / DAY;
  const steps = [[1, 'd'], [2, 'd'], [7, 'd'], [14, 'd'], [1, 'm'], [2, 'm'], [3, 'm'], [6, 'm'], [1, 'y'], [2, 'y'], [5, 'y'], [10, 'y']];
  for (const [n, u] of steps) {
    const est = u === 'd' ? span / n : u === 'm' ? span / (30.4 * n) : span / (365.25 * n);
    if (est > maxTicks) continue;
    const out = [];
    const d = new Date(min);
    let cur;
    if (u === 'd') cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    else if (u === 'm') { cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); while (new Date(cur).getUTCMonth() % n) cur = Date.UTC(new Date(cur).getUTCFullYear(), new Date(cur).getUTCMonth() + 1, 1); }
    else { let y = d.getUTCFullYear(); y = Math.floor(y / n) * n; cur = Date.UTC(y, 0, 1); }
    for (let guard = 0; cur <= max && guard < 60; guard++) {
      if (cur >= min) out.push(cur);
      const c = new Date(cur);
      cur = u === 'd' ? cur + n * DAY : u === 'm' ? Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + n, 1) : Date.UTC(c.getUTCFullYear() + n, 0, 1);
    }
    const yearsDiffer = new Date(min).getUTCFullYear() !== new Date(max).getUTCFullYear();
    const style = u === 'y' ? 'year' : u === 'm' ? (yearsDiffer ? 'monthyear' : 'month') : 'day';
    if (out.length) return { ticks: out, style };
  }
  return { ticks: [min, max], style: 'day' };
}
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// ---------- tooltip ----------
function makeTip(plot) {
  const tip = el('div', 'chart-tip', null, plot);
  tip.hidden = true;
  return {
    show(x, y, rows, head, W) {
      tip.textContent = '';
      if (head) el('div', 'ct-head', head, tip);
      rows.forEach(r => {
        const row = el('div', 'ct-row', null, tip);
        if (r.color) { const k = el('span', 'ct-key' + (r.shape ? ' ' + r.shape : ''), null, row); k.style.background = r.color; }
        el('b', null, r.value, row);
        if (r.label) el('span', 'ct-lab', r.label, row);
      });
      tip.hidden = false;
      // chart units → pixels inside the plot box
      const svg = plot.querySelector('svg');
      const sr = svg && svg.getBoundingClientRect(), pr = plot.getBoundingClientRect();
      const k = sr && sr.width ? sr.width / W : 1;
      const px = (sr ? sr.left - pr.left : 0) + x * k, py = (sr ? sr.top - pr.top : 0) + y * k;
      const pw = plot.clientWidth || W, ph = plot.clientHeight || 0, tw = tip.offsetWidth || 120, th = tip.offsetHeight || 50;
      tip.style.left = Math.max(0, Math.min(pw - tw, px > pw / 2 ? px - tw - 10 : px + 10)) + 'px';
      tip.style.top = (py - th - 12 >= 0 ? py - th - 12 : Math.max(0, Math.min(ph - th, py + 14))) + 'px';
    },
    hide() { tip.hidden = true; }
  };
}
/** Calls move(x, y) in chart units while the finger/mouse is over the chart; leave() when it goes. */
function track(svg, W, H, move, leave) {
  const at = e => { const r = svg.getBoundingClientRect(); const s = r.width ? W / r.width : 1; return [(e.clientX - r.left) * s, (e.clientY - r.top) * (r.height ? H / r.height : s)]; };
  svg.addEventListener('pointermove', e => move(...at(e)));
  svg.addEventListener('pointerdown', e => move(...at(e)));
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') leave(); });
  tracked.add({ svg, leave });
  if (!trackBound) {
    trackBound = true;
    document.addEventListener('pointerdown', onDocDown, { passive: true });
  }
}
// One listener for every chart: a tap elsewhere hides the open tooltips. Charts no longer on screen are dropped.
const tracked = new Set();
let trackBound = false;
function onDocDown(e) {
  tracked.forEach(t => {
    if (!t.svg.isConnected) { tracked.delete(t); return; }
    if (!t.svg.contains(e.target)) t.leave();
  });
}

// ---------- frame ----------
function frame(host, spec) {
  host.textContent = '';
  const fig = el('figure', 'chart', null, host);
  const cap = el('figcaption', null, null, fig);
  el('b', null, spec.title || 'Chart', cap);
  if (spec.subtitle) el('span', null, spec.subtitle, cap);
  const legend = el('div', 'chart-legend', null, fig);
  const ylab = el('div', 'chart-yl', null, fig);
  const plot = el('div', 'chart-plot', null, fig);
  const note = el('div', 'chart-note', null, fig);
  const det = el('details', 'chart-data', null, fig);
  el('summary', null, 'Data', det);
  return { fig, legend, ylab, plot, note, det };
}
function legendItems(legend, series, shape) {
  if (series.length < 2) { legend.remove(); return; }
  series.forEach((s, i) => {
    const it = el('span', 'cl-item', null, legend);
    const k = el('span', 'cl-key ' + shape, null, it); k.style.background = color(i);
    el('span', null, s.name || `Series ${i + 1}`, it);
  });
}
function table(det, head, rows) {
  const t = el('table', null, null, det);
  const tr = el('tr', null, null, el('thead', null, null, t));
  head.forEach(h => el('th', null, h, tr));
  const tb = el('tbody', null, null, t);
  rows.slice(0, 400).forEach(r => { const row = el('tr', null, null, tb); r.forEach(c => el('td', null, c, row)); });
}
function newSvg(plot, W, H, title) {
  return sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': title || 'Chart', class: 'chart-svg' }, plot);
}
function yAxis(svg, yt, sy, x0, x1, unit) {
  yt.ticks.forEach(v => {
    const y = sy(v);
    sv('line', { x1: x0, x2: x1, y1: y, y2: y, class: v === 0 ? 'ct-base' : 'ct-grid' }, svg);
    svText(x0 - 6, y, fmtNum(v, unit, true), svg, { anchor: 'end' });
  });
}
const labelWidth = (yt, unit) => Math.max(...yt.ticks.map(v => fmtNum(v, unit, true).length)) * CH + 10;
function roundedBar(x, y, w, h, horizontal, positive) {
  // rounded 4px at the data end, square at the baseline
  const r = Math.max(0, Math.min(4, (horizontal ? h : w) / 2, (horizontal ? w : h)));
  if (!horizontal) {
    if (positive) return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  }
  if (positive) return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
}

// ---------- line & scatter ----------
function drawXY(f, spec, W, scatter) {
  const series = spec.series;
  const isDate = spec.x_type === 'date', isNum = spec.x_type === 'number';
  const cats = [];
  if (!isDate && !isNum) series.forEach(s => s.points.forEach(p => { if (!cats.includes(p.x)) cats.push(p.x); }));
  const xv = p => isDate ? dayMs(p.x) : isNum ? Number(p.x) : cats.indexOf(p.x);
  const all = series.flatMap(s => s.points);
  const xs = all.map(xv), ys = all.map(p => p.y);
  let xmin = Math.min(...xs), xmax = Math.max(...xs);
  if (xmin === xmax) { xmin -= isDate ? 864e5 * 3 : 1; xmax += isDate ? 864e5 * 3 : 1; }
  if (isNum) { const t = niceTicks(xmin, xmax, 5); xmin = t.min; xmax = t.max; }
  // lines start at zero when the values are near it; otherwise the axis fits the data so changes stay visible
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const yt = niceTicks(!scatter && ymin >= 0 && ymin < ymax * 0.35 ? 0 : ymin, ymax, 4);
  const single = series.length === 1;
  const lastLab = single && !scatter ? fmtNum(series[0].points.at(-1).y, spec.unit) : '';
  const L = labelWidth(yt, spec.unit), R = Math.max(12, lastLab ? lastLab.length * CH + 12 : 12), T = 10, B = 24 + (spec.x_label ? 14 : 0);
  const H = 200 + T + B;
  const svg = newSvg(f.plot, W, H, spec.title);
  const sx = v => L + (v - xmin) / (xmax - xmin) * (W - L - R);
  const sy = v => T + (1 - (v - yt.min) / (yt.max - yt.min)) * (H - T - B);
  yAxis(svg, yt, sy, L, W - R, spec.unit);
  // x ticks
  let xt;
  if (isDate) { const d = dateTicks(xmin, xmax, Math.max(2, Math.floor((W - L - R) / 70))); xt = d.ticks.map(v => [v, fmtDay(v, d.style)]); }
  else if (isNum) { const t = niceTicks(xmin, xmax, Math.max(2, Math.floor((W - L - R) / 60))); xt = t.ticks.filter(v => v >= xmin && v <= xmax).map(v => [v, fmtNum(v, '', true)]); }
  else { const every = Math.ceil(cats.length / Math.max(1, Math.floor((W - L - R) / 56))); xt = cats.map((c, i) => [i, c.length > 9 ? c.slice(0, 8) + '…' : c]).filter((_, i) => i % every === 0); }
  xt.forEach(([v, lab]) => svText(sx(v), H - B + 14, lab, svg, { anchor: 'middle' }));
  if (spec.x_label) svText((L + W - R) / 2, H - 6, spec.x_label, svg, { anchor: 'middle', cls: 'ct-axis ct-title' });
  if (spec.y_label) f.ylab.textContent = spec.y_label + (spec.unit && !spec.y_label.includes(spec.unit) && !/^[$€£¥₹%]$/.test(spec.unit) ? ` (${spec.unit})` : '');

  series.forEach((s, i) => {
    const pts = s.points.map(p => [sx(xv(p)), sy(p.y)]);
    if (!scatter) {
      if (single && pts.length > 1) sv('path', { d: `M${pts[0][0]},${sy(yt.min)}` + pts.map(p => `L${p[0]},${p[1]}`).join('') + `L${pts.at(-1)[0]},${sy(yt.min)}Z` }, svg, `fill:${color(i)};opacity:.1`);
      sv('path', { d: pts.map((p, j) => (j ? 'L' : 'M') + p[0] + ',' + p[1]).join(''), class: 'ct-line' }, svg, `stroke:${color(i)}`);
    }
    const dots = scatter || pts.length <= 24 ? pts : [pts.at(-1)];
    dots.forEach(p => sv('circle', { cx: p[0], cy: p[1], r: 4, class: 'ct-dot' }, svg, `fill:${color(i)}`));
  });
  if (lastLab) { const p = series[0].points.at(-1); svText(sx(xv(p)) + 8, sy(p.y), lastLab, svg, { cls: 'ct-val' }); }
  legendItems(f.legend, series, scatter ? 'dot' : 'line');

  // hover: line → crosshair snapped to the nearest x, listing every series; scatter → nearest point
  const tip = makeTip(f.plot);
  const cross = sv('line', { y1: T, y2: H - B, class: 'ct-cross' }, svg);
  cross.style.display = 'none';
  const fmtX = v => isDate ? fmtDay(v, 'full') : isNum ? fmtNum(v) : cats[v];
  const uniq = [...new Set(xs)].sort((a, b) => a - b);
  track(svg, W, H, (mx, my) => {
    if (scatter) {
      let best = null;
      series.forEach((s, i) => s.points.forEach(p => { const d = Math.hypot(sx(xv(p)) - mx, sy(p.y) - my); if (d < 32 && (!best || d < best.d)) best = { d, p, i, s }; }));
      if (!best) return tip.hide();
      tip.show(sx(xv(best.p)), sy(best.p.y), [{ color: color(best.i), shape: 'dot', value: fmtNum(best.p.y, spec.unit), label: series.length > 1 ? best.s.name : '' }], (spec.x_label ? spec.x_label + ': ' : '') + fmtX(xv(best.p)), W);
      return;
    }
    let bx = uniq[0];
    uniq.forEach(v => { if (Math.abs(sx(v) - mx) < Math.abs(sx(bx) - mx)) bx = v; });
    cross.setAttribute('x1', sx(bx)); cross.setAttribute('x2', sx(bx)); cross.style.display = '';
    const rows = [];
    series.forEach((s, i) => { const p = s.points.find(q => xv(q) === bx); if (p) rows.push({ color: color(i), shape: 'line', value: fmtNum(p.y, spec.unit), label: series.length > 1 ? s.name : '' }); });
    const topY = Math.min(...series.map(s => { const p = s.points.find(q => xv(q) === bx); return p ? sy(p.y) : H; }));
    tip.show(sx(bx), topY, rows, fmtX(bx), W);
  }, () => { tip.hide(); cross.style.display = 'none'; });

  const head = [spec.x_label || (isDate ? 'Date' : 'x')].concat(series.map(s => s.name || spec.y_label || 'Value'));
  const keys = isDate || isNum ? uniq : cats.map((_, i) => i);
  table(f.det, head, keys.map(k => [fmtX(k)].concat(series.map(s => { const p = s.points.find(q => xv(q) === k); return p ? fmtNum(p.y, spec.unit) : ''; }))));
}

// ---------- bar ----------
function drawBar(f, spec, W) {
  const series = spec.series, n = series.length;
  const isDate = spec.x_type === 'date';
  let cats = [];
  series.forEach(s => s.points.forEach(p => { if (!cats.includes(p.x)) cats.push(p.x); }));
  if (isDate) cats.sort((a, b) => dayMs(a) - dayMs(b));
  const dates = isDate ? cats.map(dayMs) : [];
  const monthly = isDate && cats.every(c => c.endsWith('-01'));
  const catLabel = (c, i) => isDate ? fmtDay(dates[i], monthly ? (new Date(dates[0]).getUTCFullYear() !== new Date(dates.at(-1)).getUTCFullYear() ? 'monthyear' : 'month') : 'day') : c;
  const labels = cats.map(catLabel);
  const val = (s, c) => { const p = s.points.find(q => q.x === c); return p ? p.y : null; };
  const totals = cats.map(c => series.reduce((t, s) => t + (val(s, c) || 0), 0));
  const vals = spec.stacked ? totals.concat(cats.map(c => Math.min(0, ...series.map(s => val(s, c) || 0)))) : series.flatMap(s => s.points.map(p => p.y));
  const vt = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const groupN = spec.stacked ? 1 : n;
  const maxLab = Math.max(...labels.map(l => String(l).length));
  const colsFit = cats.length * Math.max(groupN * 10 + 8, maxLab * CH + 6) <= W - 60;
  const horizontal = spec.horizontal || !colsFit;
  const showVals = (n === 1 || spec.stacked) && cats.length <= 16;
  const tip = makeTip(f.plot);
  const unit = spec.unit;
  const rows = [];   // hit areas: {x,y,w,h, rows, head}
  let svg, H;

  if (!horizontal) {
    const L = labelWidth(vt, unit), R = 8, T = showVals ? 18 : 10, B = 24 + (spec.x_label ? 14 : 0);
    H = 200 + T + B;
    svg = newSvg(f.plot, W, H, spec.title);
    const sy = v => T + (1 - (v - vt.min) / (vt.max - vt.min)) * (H - T - B);
    yAxis(svg, vt, sy, L, W - R, unit);
    const band = (W - L - R) / cats.length;
    const t = Math.max(4, Math.min(24, (band * 0.72 - (groupN - 1) * 2) / groupN));
    cats.forEach((c, ci) => {
      const gx = L + ci * band + (band - (t * groupN + 2 * (groupN - 1))) / 2;
      let posBase = 0, negBase = 0;
      series.forEach((s, si) => {
        const v = val(s, c); if (v === null) return;
        let x, y0, y1;
        if (spec.stacked) {
          x = gx;
          if (v >= 0) { y0 = posBase; y1 = posBase + v; posBase = y1; } else { y0 = negBase; y1 = negBase + v; negBase = y1; }
        } else { x = gx + si * (t + 2); y0 = 0; y1 = v; }
        const top = sy(Math.max(y0, y1)), bot = sy(Math.min(y0, y1));
        const isEnd = !spec.stacked || si === series.map(q => val(q, c)).map((q, k) => (q !== null && (q >= 0) === (v >= 0) ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
        const gap = spec.stacked && si > 0 ? 2 : 0;   // 2px surface gap between stacked parts
        const h = Math.max(0, bot - top - gap);
        const d = isEnd ? roundedBar(x, v >= 0 ? top : top + gap, t, h, false, v >= 0) : `M${x},${v >= 0 ? top : top + gap}h${t}v${h}h${-t}Z`;
        sv('path', { d, class: 'ct-bar' }, svg, `fill:${color(si)}`);
      });
      if (showVals) {
        const v = spec.stacked ? totals[ci] : val(series[0], c);
        if (v !== null) svText(L + ci * band + band / 2, v >= 0 ? sy(spec.stacked ? posBase : v) - 8 : sy(v) + 10, fmtNum(v, unit, true), svg, { anchor: 'middle', cls: 'ct-val' });
      }
      const every = Math.ceil(cats.length * (maxLab * CH + 6) / (W - L - R));
      if (ci % Math.max(1, every) === 0) svText(L + ci * band + band / 2, H - B + 14, String(labels[ci]).length > 12 ? String(labels[ci]).slice(0, 11) + '…' : labels[ci], svg, { anchor: 'middle' });
      rows.push({ x: L + ci * band, y: T, w: band, h: H - T - B, ci });
    });
    if (spec.x_label) svText((L + W - R) / 2, H - 6, spec.x_label, svg, { anchor: 'middle', cls: 'ct-axis ct-title' });
  } else {
    const labW = Math.min(W * 0.38, maxLab * CH + 10);
    const valW = showVals ? Math.max(...(spec.stacked ? totals : series[0].points.map(p => p.y)).map(v => fmtNum(v, unit, true).length)) * CH + 10 : 10;
    const L = labW, R = valW, T = 6, B = 22;
    const t = Math.min(18, n > 1 && !spec.stacked ? 14 : 18);
    const band = (groupN * t + (groupN - 1) * 2) + 12;
    H = T + B + band * cats.length;
    svg = newSvg(f.plot, W, H, spec.title);
    const sx = v => L + (v - vt.min) / (vt.max - vt.min) * (W - L - R);
    vt.ticks.forEach(v => { sv('line', { x1: sx(v), x2: sx(v), y1: T, y2: H - B, class: v === 0 ? 'ct-base' : 'ct-grid' }, svg); svText(sx(v), H - B + 13, fmtNum(v, unit, true), svg, { anchor: 'middle' }); });
    cats.forEach((c, ci) => {
      const gy = T + ci * band + 6;
      let posBase = 0, negBase = 0, lastX = sx(0);
      series.forEach((s, si) => {
        const v = val(s, c); if (v === null) return;
        let y, a, b;
        if (spec.stacked) { y = gy; if (v >= 0) { a = posBase; b = posBase + v; posBase = b; } else { a = negBase; b = negBase + v; negBase = b; } }
        else { y = gy + si * (t + 2); a = 0; b = v; }
        const x0 = sx(Math.min(a, b)), x1 = sx(Math.max(a, b));
        const isEnd = !spec.stacked || si === series.map(q => val(q, c)).map((q, k) => (q !== null && (q >= 0) === (v >= 0) ? k : -1)).reduce((p, q) => Math.max(p, q), -1);
        const gap = spec.stacked && si > 0 ? 2 : 0;
        const w = Math.max(0, x1 - x0 - gap);
        const xs = v >= 0 ? x0 + gap : x0;
        sv('path', { d: isEnd ? roundedBar(xs, y, w, t, true, v >= 0) : `M${xs},${y}h${w}v${t}h${-w}Z`, class: 'ct-bar' }, svg, `fill:${color(si)}`);
        lastX = v >= 0 ? sx(spec.stacked ? posBase : v) : sx(v);
      });
      const lab = String(labels[ci]);
      const fit = Math.floor((labW - 8) / CH);
      svText(L - 6, gy + (groupN * t + (groupN - 1) * 2) / 2, lab.length > fit ? lab.slice(0, fit - 1) + '…' : lab, svg, { anchor: 'end', cls: 'ct-axis ct-cat' });
      if (showVals) {
        const v = spec.stacked ? totals[ci] : val(series[0], c);
        if (v !== null) svText(v >= 0 ? lastX + 6 : lastX - 6, gy + t / 2, fmtNum(v, unit, true), svg, { anchor: v >= 0 ? 'start' : 'end', cls: 'ct-val' });
      }
      rows.push({ x: 0, y: T + ci * band, w: W, h: band, ci });
    });
  }
  legendItems(f.legend, series, 'rect');
  const hl = sv('rect', { class: 'ct-hl', rx: 6 }, svg);
  svg.insertBefore(hl, svg.firstChild);
  hl.style.display = 'none';
  track(svg, W, H, (mx, my) => {
    const r = rows.find(q => mx >= q.x && mx <= q.x + q.w && my >= q.y - 4 && my <= q.y + q.h + 4);
    if (!r) { tip.hide(); hl.style.display = 'none'; return; }
    Object.entries({ x: r.x + (horizontal ? 0 : 2), y: r.y, width: Math.max(0, r.w - (horizontal ? 0 : 4)), height: r.h }).forEach(([k, v]) => hl.setAttribute(k, v));
    hl.style.display = '';
    const c = cats[r.ci];
    const tr = series.map((s, i) => ({ color: color(i), value: fmtNum(val(s, c), unit), label: n > 1 ? s.name : '' })).filter((_, i) => val(series[i], c) !== null);
    if (spec.stacked && n > 1) tr.push({ value: fmtNum(totals[r.ci], unit), label: 'Total' });
    tip.show(horizontal ? Math.min(W - 10, mx) : r.x + r.w / 2, horizontal ? r.y : my, tr, String(isDate ? fmtDay(dates[r.ci], 'full') : labels[r.ci]), W);
  }, () => { tip.hide(); hl.style.display = 'none'; });
  table(f.det, [spec.x_label || (isDate ? 'Date' : '')].concat(series.map(s => s.name || spec.y_label || 'Value')).concat(spec.stacked && n > 1 ? ['Total'] : []),
    cats.map((c, ci) => [isDate ? fmtDay(dates[ci], monthly ? 'monthyear' : 'full') : c].concat(series.map(s => fmtNum(val(s, c), unit))).concat(spec.stacked && n > 1 ? [fmtNum(totals[ci], unit)] : [])));
}

// ---------- pie (donut) ----------
function drawPie(f, spec, W) {
  const pts = spec.series[0].points;
  const total = pts.reduce((t, p) => t + p.y, 0);
  const side = W >= 380;
  const D = Math.min(side ? 190 : 200, W - 20), H = D + 8;
  const svgW = side ? D + 8 : W;
  const svg = newSvg(f.plot, svgW, H, spec.title);
  if (side) { f.plot.classList.add('pie-side'); svg.setAttribute('width', svgW); }
  const cx = svgW / 2, cy = H / 2, ro = D / 2, ri = ro - 30;
  let a = -Math.PI / 2;
  const arcs = [];
  pts.forEach((p, i) => {
    const frac = p.y / total, a2 = a + frac * Math.PI * 2;
    const big = a2 - a > Math.PI ? 1 : 0;
    const P = (r, ang) => `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`;
    const d = frac >= 0.9999
      ? `M${cx - ro},${cy}a${ro},${ro} 0 1,0 ${ro * 2},0a${ro},${ro} 0 1,0 ${-ro * 2},0M${cx - ri},${cy}a${ri},${ri} 0 1,1 ${ri * 2},0a${ri},${ri} 0 1,1 ${-ri * 2},0`
      : `M${P(ro, a)}A${ro},${ro} 0 ${big},1 ${P(ro, a2)}L${P(ri, a2)}A${ri},${ri} 0 ${big},0 ${P(ri, a)}Z`;
    const path = sv('path', { d, class: 'ct-slice' }, svg, `fill:${color(i)}`);
    arcs.push({ a, a2, p, i, path });
    a = a2;
  });
  svText(cx, cy - 7, fmtNum(total, spec.unit, true), svg, { anchor: 'middle', cls: 'ct-total' });
  svText(cx, cy + 12, 'total', svg, { anchor: 'middle' });
  // legend list with values and shares (the identity never depends on color alone)
  const list = el('div', 'pie-list', null, f.plot);
  pts.forEach((p, i) => {
    const row = el('div', 'pie-row', null, list);
    const k = el('span', 'cl-key rect', null, row); k.style.background = color(i);
    el('span', 'grow', p.x, row);
    el('b', null, fmtNum(p.y, spec.unit, true), row);
    el('span', 'muted', Math.round(p.y / total * 100) + '%', row);
  });
  f.legend.remove();
  const tip = makeTip(f.plot);
  track(svg, svgW, H, (mx, my) => {
    const dx = mx - cx, dy = my - cy, r = Math.hypot(dx, dy);
    if (r < ri - 6 || r > ro + 8) { tip.hide(); arcs.forEach(x => x.path.classList.remove('on')); return; }
    let ang = Math.atan2(dy, dx); if (ang < -Math.PI / 2) ang += Math.PI * 2;
    const hit = arcs.find(x => ang >= x.a && ang < x.a2) || arcs.at(-1);
    arcs.forEach(x => x.path.classList.toggle('on', x === hit));
    tip.show(mx, my, [{ color: color(hit.i), shape: 'rect', value: fmtNum(hit.p.y, spec.unit), label: Math.round(hit.p.y / total * 100) + '%' }], hit.p.x, svgW);
  }, () => { tip.hide(); arcs.forEach(x => x.path.classList.remove('on')); });
  table(f.det, ['', spec.y_label || 'Value', 'Share'], pts.map(p => [p.x, fmtNum(p.y, spec.unit), Math.round(p.y / total * 1000) / 10 + '%']));
}

// ---------- growth (CDC percentile curves) ----------
function lmsAt(rows, age) {
  if (age < rows[0][0] || age > rows.at(-1)[0]) return null;
  for (let i = 1; i < rows.length; i++) if (rows[i][0] >= age) {
    const a = rows[i - 1], b = rows[i], t = (age - a[0]) / ((b[0] - a[0]) || 1);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
  return rows[0].slice(1);
}
const valueAtZ = ([L, M, S], z) => Math.abs(L) < 1e-6 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
const zOf = (x, [L, M, S]) => Math.abs(L) < 1e-6 ? Math.log(x / M) / S : (Math.pow(x / M, L) - 1) / (L * S);
function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
export function percentileOf(data, metric, sex, age, value) {
  const lms = lmsAt(data[metric][sex === 'female' ? 'f' : 'm'], age);
  if (!lms || !(value > 0)) return null;
  return Math.round(normCdf(zOf(value, lms)) * 1000) / 10;
}
const pctText = p => p > 99 ? 'above the 99th' : p < 1 ? 'below the 1st' : 'about the ' + ordinal(Math.round(p));
const fmtAge = a => { const y = Math.floor(a), m = Math.floor((a - y) * 12 + 1e-6); return m ? `${y} y ${m} m` : `${y} y`; };

async function drawGrowth(f, spec, W, opts) {
  const data = opts.growthData || (await import('./growth-cdc.js')).default;
  const rows = data[spec.metric][spec.sex === 'female' ? 'f' : 'm'];
  const imp = (opts.imperial ?? spec.imperial) && spec.metric !== 'bmi';
  const conv = v => spec.metric === 'height' ? (imp ? v / 2.54 : v) : spec.metric === 'weight' ? (imp ? v / 0.45359237 : v) : v;
  const unit = spec.metric === 'height' ? (imp ? 'in' : 'cm') : spec.metric === 'weight' ? (imp ? 'lb' : 'kg') : 'kg/m²';
  const pts = spec.points.map(p => ({ ...p, pct: p.pct ?? percentileOf(data, spec.metric, spec.sex, p.age, p.value) }));
  const inRange = pts.filter(p => p.age >= 2 && p.age <= 20);
  const ages = (inRange.length ? inRange : pts).map(p => p.age);
  let a0 = Math.max(2, Math.floor(Math.min(...ages) - 0.5)), a1 = Math.min(20, Math.ceil(Math.max(...ages) + 0.5));
  if (a1 - a0 < 3) { a1 = Math.min(20, a0 + 3); a0 = Math.max(2, a1 - 3); }
  const curveRows = rows.filter(r => r[0] >= a0 && r[0] <= a1);
  const curves = {};
  PCTS.forEach(p => { curves[p] = curveRows.map(r => [r[0], conv(valueAtZ([r[1], r[2], r[3]], Z[p]))]); });
  const vs = inRange.map(p => conv(p.value)).concat(curves[5].map(c => c[1]), curves[95].map(c => c[1]));
  const yt = niceTicks(Math.min(...vs), Math.max(...vs), 5);
  const L = labelWidth(yt, ''), R = 34, T = 10, B = 38;
  const H = 240 + T + B;
  const svg = newSvg(f.plot, W, H, spec.title);
  const sx = a => L + (a - a0) / (a1 - a0) * (W - L - R);
  const sy = v => T + (1 - (v - yt.min) / (yt.max - yt.min)) * (H - T - B);
  yAxis(svg, yt, sy, L, W - R, '');
  f.ylab.textContent = (spec.metric === 'bmi' ? 'BMI' : spec.metric[0].toUpperCase() + spec.metric.slice(1)) + ` (${unit})`;
  const ageStep = a1 - a0 > 8 ? 2 : 1;
  for (let a = Math.ceil(a0); a <= a1; a += ageStep) svText(sx(a), H - B + 14, String(a), svg, { anchor: 'middle' });
  svText((L + W - R) / 2, H - 6, 'Age (years)', svg, { anchor: 'middle', cls: 'ct-axis ct-title' });
  // bands: 5th–95th and 25th–75th as quiet washes, then the percentile lines
  const band = (lo, hi, cls) => sv('path', { d: curves[lo].map((c, i) => (i ? 'L' : 'M') + sx(c[0]) + ',' + sy(c[1])).join('') + curves[hi].slice().reverse().map(c => 'L' + sx(c[0]) + ',' + sy(c[1])).join('') + 'Z', class: cls }, svg);
  band(5, 95, 'ct-band'); band(25, 75, 'ct-band');
  PCTS.forEach(p => {
    sv('path', { d: curves[p].map((c, i) => (i ? 'L' : 'M') + sx(c[0]) + ',' + sy(c[1])).join(''), class: p === 50 ? 'ct-pct mid' : 'ct-pct' }, svg);
    if (p !== 10 && p !== 90) svText(W - R + 4, sy(curves[p].at(-1)[1]), ordinal(p), svg, { cls: 'ct-axis ct-plab' });
  });
  // the child's measurements
  const P = inRange.map(p => [sx(p.age), sy(conv(p.value)), p]);
  if (P.length > 1) sv('path', { d: P.map((q, i) => (i ? 'L' : 'M') + q[0] + ',' + q[1]).join(''), class: 'ct-line' }, svg, `stroke:${color(0)}`);
  P.forEach(q => sv('circle', { cx: q[0], cy: q[1], r: 4, class: 'ct-dot' }, svg, `fill:${color(0)}`));
  f.legend.remove();

  const tip = makeTip(f.plot);
  const cross = sv('line', { y1: T, y2: H - B, class: 'ct-cross' }, svg);
  cross.style.display = 'none';
  track(svg, W, H, mx => {
    if (!P.length) return;
    let b = P[0]; P.forEach(q => { if (Math.abs(q[0] - mx) < Math.abs(b[0] - mx)) b = q; });
    cross.setAttribute('x1', b[0]); cross.setAttribute('x2', b[0]); cross.style.display = '';
    const p = b[2];
    tip.show(b[0], b[1], [{ color: color(0), shape: 'dot', value: fmtNum(r1(conv(p.value)), unit), label: p.pct === null ? '' : pctText(p.pct) + ' percentile' }], `${fmtDay(dayMs(p.date), 'full')} · age ${fmtAge(p.age)}`, W);
  }, () => { tip.hide(); cross.style.display = 'none'; });

  const last = pts.at(-1);
  const line1 = el('div', null, null, f.note);
  line1.textContent = `Latest: ${fmtNum(r1(conv(last.value)), unit)} on ${fmtDay(dayMs(last.date), 'full')} (age ${fmtAge(last.age)})` + (last.pct === null ? '' : ` — ${pctText(last.pct)} percentile.`);
  const skipped = pts.length - inRange.length;
  el('div', 'muted small', `CDC growth charts, ${spec.sex === 'female' ? 'girls' : 'boys'} 2–20 years. For keeping track at home; the pediatrician's chart is the reference.` + (skipped ? ` ${skipped} measurement${skipped > 1 ? 's' : ''} outside ages 2–20 ${skipped > 1 ? 'are' : 'is'} in the table only.` : ''), f.note);
  table(f.det, ['Date', 'Age', spec.metric === 'bmi' ? 'BMI' : spec.metric[0].toUpperCase() + spec.metric.slice(1), 'Percentile'],
    pts.slice().reverse().map(p => [fmtDay(dayMs(p.date), 'full'), fmtAge(p.age), fmtNum(r1(conv(p.value)), unit), p.pct === null ? '–' : p.pct > 99 ? '>99th' : p.pct < 1 ? '<1st' : ordinal(Math.round(p.pct))]));
}

/** Draws one chart spec into host. opts: {imperial, width, growthData}. Returns a promise. */
export async function renderChart(host, spec, opts = {}) {
  const W = Math.max(260, Math.round(opts.width || host.clientWidth || 300));
  const f = frame(host, spec);
  try {
    if (spec.kind === 'growth') await drawGrowth(f, spec, W, opts);
    else if (spec.kind === 'bar') drawBar(f, spec, W);
    else if (spec.kind === 'pie') drawPie(f, spec, W);
    else drawXY(f, spec, W, spec.kind === 'scatter');
    if (!f.note.childNodes.length) f.note.remove();
    if (!f.ylab.textContent) f.ylab.remove();
  } catch (e) {
    console.warn('chart', e);
    f.plot.textContent = "This chart couldn't be drawn.";
  }
}
