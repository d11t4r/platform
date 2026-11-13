import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
export const state = { user: null, profile: null, topics: [], subject: localStorage.getItem('subject') || 'inf' };

export async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

// загрузка всех строк (supabase отдаёт максимум 1000 за раз)
export async function all(make) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const rows = await q(make().range(from, from + step - 1));
    out.push(...rows); if (rows.length < step) break;
  }
  return out;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, ms = 2600) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
  document.body.appendChild(d); setTimeout(() => d.remove(), ms);
}
export function fail(e) { console.error(e); toast('ошибка: ' + (e.message || e)); }

export const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
export const fmtDT = d => d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; return n > 10 && n < 20 ? c : n1 > 1 && n1 < 5 ? b : n1 === 1 ? a : c; };

export function rich(text) {
  return esc(text || '').replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
}
export function asset(path) { return path.startsWith('http') ? path : 'data/' + path.split('/').map(encodeURIComponent).join('/'); }

// ---------- темы ----------
export async function loadTopics() {
  if (!state.topics.length) state.topics = await q(sb.from('topics').select('*').order('subject').order('num'));
  return state.topics;
}
export const topicsOf = subj => state.topics.filter(t => t.subject === subj);
export const SUBJ = { inf: 'информатика', math: 'математика' };

// ---------- прогресс ----------
export const STATUS = {
  done: { label: 'освоено', cls: 'st-done', color: '#b54a5f' },
  errors: { label: 'с ошибками', cls: 'st-errors', color: '#f5a77e' },
  learning: { label: 'разбираем', cls: 'st-learning', color: '#f8cdcd' },
  new: { label: 'не начинали', cls: 'st-new', color: '#ffffff' },
};

// attempts: [{task_id, is_correct, points, status, created_at, tasks:{topic_id}}]
export function topicStats(attempts, overrides = {}) {
  const by = {};
  const sorted = [...attempts].filter(a => a.status === 'checked').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const a of sorted) {
    const tid = a.tasks?.topic_id || a.topic_id; if (!tid) continue;
    const s = by[tid] ||= { checked: 0, correct: 0, solved: new Set(), recent: [], last: a.created_at };
    s.checked++; if (a.is_correct) { s.correct++; s.solved.add(a.task_id); }
    if (s.recent.length < 10) s.recent.push(!!a.is_correct);
  }
  const res = {};
  for (const [tid, s] of Object.entries(by)) {
    const acc = s.recent.filter(Boolean).length / s.recent.length;
    let st = 'learning';
    if (s.solved.size >= 3 && acc >= 0.8) st = 'done';
    else if (s.recent.length >= 3 && acc < 0.5) st = 'errors';
    res[tid] = { ...s, solved: s.solved.size, acc, status: st, auto: st };
  }
  for (const [tid, st] of Object.entries(overrides)) {
    res[tid] = { ...(res[tid] || { checked: 0, correct: 0, solved: 0, acc: 0, auto: 'new' }), status: st, override: true };
  }
  return res;
}
export const statusOf = (stats, tid) => stats[tid]?.status || 'new';

export function gradeFor(scale, score) {
  for (const [a, b, g] of scale || []) if (score >= a && score <= b) return g;
  return null;
}

// уровень звёздочки: освоенные номера + последний пробник
export function starLevel(stats, subj, lastGrade, lastActivity) {
  const done = topicsOf(subj).filter(t => statusOf(stats, t.id) === 'done').length;
  let lvl = 1;
  if (done >= 3) lvl = 2;
  if (done >= 6) lvl = 3;
  if (done >= 10 && (lastGrade || 0) >= 4) lvl = 4;
  if (done >= 14 && lastGrade === 5) lvl = 5;
  const sleepy = !!lastActivity && (Date.now() - new Date(lastActivity)) > 7 * 864e5;
  const next = [3, 6, 10, 14, 99][lvl - 1];
  return { lvl, sleepy, done, toNext: Math.max(0, next - done) };
}

// пухлая светящаяся звёздочка (как в макете)
export function starSVG(level = 3, sleepy = false, size = 96) {
  const k = [0.86, 0.88, 0.9, 0.92, 0.94][level - 1];
  const glow = sleepy ? 0.12 : [0.3, 0.48, 0.66, 0.84, 1][level - 1];
  const cols = [['#fff3cf', '#fff8e2', '#fffcf3'], ['#ffeeb8', '#fff5d6', '#fffbee'], ['#ffe8a3', '#fff2c8', '#fff9e6'], ['#ffe08a', '#ffeebb', '#fff7df'], ['#ffd66e', '#ffe9a8', '#fff4d2']];
  const c = sleepy ? ['#f6f1e6', '#efe8d8', '#e3d8c2'] : cols[level - 1];
  const id = 'st' + level + (sleepy ? 's' : '') + Math.random().toString(36).slice(2, 6);
  const P = 'M100 42 L120.6 75.7 L159 84.8 L133.3 114.8 L136.4 154.2 L100 139 L63.6 154.2 L66.7 114.8 L41 84.8 L79.4 75.7Z';
  const spots = [[.86, .18, .09], [.1, .3, .07], [.9, .7, .07], [.2, .86, .08], [.6, .04, .06], [.04, .6, .06], [.72, .94, .06], [.34, .02, .05]];
  const n = sleepy ? 0 : [0, 2, 4, 6, 8][level - 1];
  const sp = spots.slice(0, n).map(([x, y, s]) => { const w = Math.max(6, Math.round(size * s)); return `<svg viewBox="0 0 100 100" style="position:absolute;left:${Math.round(size * x - w / 2)}px;top:${Math.round(size * y - w / 2)}px;width:${w}px;height:${w}px;filter:drop-shadow(0 0 ${Math.max(2, w / 2)}px rgba(255,170,70,.9))"><path fill="#ffd36b" d="M50 4 C54 38 62 46 96 50 C62 54 54 62 50 96 C46 62 38 54 4 50 C38 46 46 38 50 4Z"/></svg>`; }).join('');
  const dots = [[86, 62, 1.8], [128, 70, 1.4], [146, 88, 2], [64, 94, 1.6], [108, 96, 1.2], [122, 112, 1.9], [82, 122, 1.5], [132, 138, 1.3], [94, 142, 1.7], [70, 146, 1.1], [100, 76, 1.1], [54, 84, 1.2]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
  return `<div aria-label="${sleepy ? 'звёздочка погасла' : 'звёздочка, уровень ' + level}" role="img" style="position:relative;width:${size}px;height:${size}px">
  <div style="position:absolute;left:-20%;top:-20%;width:140%;height:140%;border-radius:50%;background:radial-gradient(circle,rgba(255,190,90,${glow * .55}) 0%,rgba(255,214,150,${glow * .3}) 40%,rgba(255,235,210,0) 68%)"></div>${sp}
  <svg viewBox="0 0 200 200" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"><defs>
  <radialGradient id="${id}" cx="52%" cy="58%" r="62%"><stop offset="0" stop-color="${c[0]}"/><stop offset=".55" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></radialGradient>
  <filter id="${id}h" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="${id}d" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation=".9"/></filter></defs>
  <g transform="rotate(-14 100 100) translate(100 100) scale(${k}) translate(-100 -100)">
  <path d="${P}" fill="${sleepy ? '#e6d8bf' : '#ffa94d'}" stroke="${sleepy ? '#e6d8bf' : '#ffa94d'}" stroke-width="34" stroke-linejoin="round" opacity="${glow}" filter="url(#${id}h)"/>
  <path d="${P}" fill="url(#${id})" stroke="url(#${id})" stroke-width="30" stroke-linejoin="round"/>
  <g fill="#fff" opacity="${sleepy ? 0 : [0.25, .45, .65, .85, 1][level - 1]}" filter="url(#${id}d)">${dots}</g></g></svg></div>`;
}

// ---------- файлы учеников ----------
export async function uploadSubmission(file) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${state.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await q(sb.storage.from('submissions').upload(path, file));
  return { path, name: file.name };
}
export async function signedUrl(path) {
  const { data } = await sb.storage.from('submissions').createSignedUrl(path, 3600);
  return data?.signedUrl;
}

// значки нижнего меню
export const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="7" height="7" rx="2.5"/><rect x="13" y="4" width="7" height="7" rx="2.5"/><rect x="4" y="13" width="7" height="7" rx="2.5"/><rect x="13" y="13" width="7" height="7" rx="2.5"/></svg>',
  exam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M10 3h4"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-10"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5h14v14H5zM9 9h6M9 13h6"/></svg>',
};
