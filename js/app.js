import { sb, state, q, esc, $, toast, fail, loadTopics, ICON } from './core.js';
import { WATERMARK } from './config.js';
import * as S from './student.js';
import * as T from './teacher.js';
import * as X from './exam.js';

const app = $('#app');
$('#mark').textContent = WATERMARK;

// ---------- вход / регистрация ----------
function renderAuth(mode = 'in') {
  document.getElementById('tabbar').innerHTML = '';
  app.innerHTML = `
  <div style="max-width:420px;margin:30px auto" class="col">
    <div class="star-wrap"><h1>${mode === 'in' ? 'вход' : 'регистрация'}</h1>
      <div class="muted">кабинет подготовки к огэ</div></div>
    <form class="card col" id="f">
      ${mode === 'up' ? `<div class="field"><label for="nm">имя и фамилия</label><input id="nm" required autocomplete="name"></div>
      <div class="field"><label for="gr">класс</label><input id="gr" value="9" inputmode="numeric"></div>` : ''}
      <div class="field"><label for="em">почта</label><input id="em" type="email" required autocomplete="email"></div>
      <div class="field"><label for="pw">пароль</label><input id="pw" type="password" required minlength="6" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}"></div>
      <button class="btn">${mode === 'in' ? 'войти' : 'создать аккаунт'}</button>
      <div class="small muted" id="msg"></div>
    </form>
    <div class="row" style="justify-content:center"><a href="#" id="sw">${mode === 'in' ? 'нет аккаунта? зарегистрироваться' : 'уже есть аккаунт? войти'}</a></div>
  </div>`;
  $('#sw').onclick = e => { e.preventDefault(); renderAuth(mode === 'in' ? 'up' : 'in'); };
  $('#f').onsubmit = async e => {
    e.preventDefault(); const msg = $('#msg'); msg.textContent = '…';
    const email = $('#em').value.trim(), password = $('#pw').value;
    try {
      if (mode === 'in') await q(sb.auth.signInWithPassword({ email, password }));
      else {
        const r = await q(sb.auth.signUp({ email, password, options: { data: { full_name: $('#nm').value.trim(), grade: $('#gr').value.trim() } } }));
        if (!r.session) msg.textContent = 'проверь почту и подтверди регистрацию, потом войди';
      }
    } catch (err) { msg.textContent = err.message.includes('Invalid login') ? 'неверная почта или пароль' : err.message; }
  };
}

// ---------- шапка ----------
const NAV = {
  student: [['', 'главная', 'home'], ['tasks', 'задания', 'tasks'], ['exams', 'пробники', 'exam'], ['me', 'профиль', 'me']],
  teacher: [['', 'ученики', 'home'], ['review', 'проверка', 'check'], ['exams', 'пробники', 'exam'], ['bank', 'банк', 'bank'], ['settings', 'настройки', 'me']],
};
export function frame(title, html, opts = {}) {
  const role = state.profile.role; const cur = location.hash.replace(/^#\/?/, '').split('/')[0];
  const items = NAV[role];
  const nav = items.map(([h, l]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">${l}${h === 'review' && state.pending ? ` · ${state.pending}` : ''}</a>`).join('');
  app.innerHTML = `<div class="top">${title ? `<div class="col" style="gap:2px">${opts.sub ? `<div class="small muted">${opts.sub}</div>` : ''}<h1>${title}</h1></div>` : '<div></div>'}
    <nav class="nav main" aria-label="разделы">${nav}</nav></div>${html}`;
  document.getElementById('tabbar').innerHTML = items.slice(0, 5).map(([h, l, ic]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">${ICON[ic]}${l}</a>`).join('');
  if (window.renderMathInElement) renderMathInElement(app, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
}

// ---------- маршруты ----------
async function route() {
  if (!state.user) return renderAuth();
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const [p0, p1] = parts;
  app.innerHTML = '<div class="spin"></div>';
  try {
    await loadTopics();
    if (state.profile.role === 'teacher') {
      if (!p0) return await T.students();
      if (p0 === 'st') return await T.student(p1);
      if (p0 === 'review') return await T.review();
      if (p0 === 'exams') return await T.exams();
      if (p0 === 'exam-res') return await T.examResult(p1);
      if (p0 === 'bank') return await T.bank(p1);
      if (p0 === 'task') return await T.taskView(p1);
      if (p0 === 'settings') return await T.settings();
    } else {
      if (!p0) return await S.home();
      if (p0 === 'tasks') return await S.tasksIndex();
      if (p0 === 'n') return await S.topic(p1);
      if (p0 === 'task') return await S.task(p1);
      if (p0 === 'hw') return await S.homework(p1);
      if (p0 === 'exams') return await S.exams();
      if (p0 === 'exam') return await X.run(p1);
      if (p0 === 'exam-res') return await S.examResult(p1);
      if (p0 === 'me') return await S.me();
    }
    location.hash = '#/';
  } catch (e) { fail(e); app.innerHTML = `<div class="card empty-state">что-то пошло не так: ${esc(e.message)}</div>`; }
}

async function loadProfile() {
  state.profile = await q(sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle());
  if (!state.profile) { await new Promise(r => setTimeout(r, 800)); state.profile = await q(sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle()); }
  if (!state.profile) throw new Error('профиль не найден — схема базы не установлена?');
  if (state.profile.role === 'student' && state.profile.subjects?.length && !state.profile.subjects.includes(state.subject)) state.subject = state.profile.subjects[0];
}

let booted = false;
sb.auth.onAuthStateChange((ev, session) => {
  const uid = session?.user?.id;
  if (uid && booted && state.user?.id === uid) return;   // обновление токена — ничего не перерисовываем
  setTimeout(async () => {
    state.user = session?.user || null; state.profile = null; booted = true;
    if (state.user) { try { await loadProfile(); } catch (e) { fail(e); } }
    route();
  });
});
window.addEventListener('hashchange', route);
export const logout = () => sb.auth.signOut();
export const rerender = route;
