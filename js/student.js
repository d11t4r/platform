import { sb, state, q, all, esc, $, $$, toast, fail, rich, asset, topicsOf, SUBJ, STATUS, topicStats, statusOf, starLevel, starSVG, gradeFor, fmtDate, fmtDT, plural, uploadSubmission, signedUrl } from './core.js';
import { frame, logout, rerender } from './app.js';

async function myData() {
  const uid = state.user.id;
  const [attempts, ov, hw, asg, scales] = await Promise.all([
    all(() => sb.from('attempts').select('id,task_id,is_correct,points,status,created_at,comment,assignment_id,tasks(topic_id)').eq('student_id', uid).neq('status', 'draft').order('created_at', { ascending: false })),
    q(sb.from('topic_status').select('*').eq('student_id', uid)),
    q(sb.from('homework').select('*').eq('student_id', uid).order('created_at', { ascending: false })),
    q(sb.from('exam_assignments').select('*, exams(id,title,subject,duration_min,task_ids)').eq('student_id', uid).order('created_at', { ascending: false })),
    q(sb.from('settings').select('*')),
  ]);
  const overrides = Object.fromEntries(ov.map(o => [o.topic_id, o.status]));
  return { attempts, stats: topicStats(attempts, overrides), hw, asg, scale: Object.fromEntries(scales.map(s => [s.key, s.value])) };
}

function subjTabs() {
  const subs = state.profile.subjects || [];
  if (subs.length < 2) return '';
  return `<div class="nav" role="tablist" style="width:fit-content">${subs.map(s => `<a href="#" data-subj="${s}" class="${s === state.subject ? 'on' : ''}" role="tab">${SUBJ[s]}</a>`).join('')}</div>`;
}
function bindTabs() {
  $$('[data-subj]').forEach(a => a.onclick = e => { e.preventDefault(); state.subject = a.dataset.subj; localStorage.setItem('subject', state.subject); rerender(); });
}
function tilesHTML(stats, subj, link = true) {
  return `<div class="tiles">${topicsOf(subj).map(t => { const s = statusOf(stats, t.id);
    return `<a class="tile ${STATUS[s].cls}" href="${link ? '#/n/' + t.id : '#'}" title="задание ${t.num}: ${STATUS[s].label}" aria-label="задание ${t.num}: ${STATUS[s].label}">${t.num}</a>`; }).join('')}</div>
  <div class="legend">${Object.values(STATUS).map(s => `<span><i style="background:${s.color};${s.color === '#ffffff' ? 'border:1px solid #ecc6c6' : ''}"></i>${s.label}</span>`).join('')}</div>`;
}
function ring(score, max) {
  const c = 239, d = Math.round((score / max) * c);
  return `<div style="position:relative;width:84px;height:84px;flex-shrink:0"><svg width="84" height="84" viewBox="0 0 92 92" aria-hidden="true"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e88b98"/><stop offset="1" stop-color="#b54a5f"/></linearGradient></defs><circle cx="46" cy="46" r="38" fill="none" stroke="#fbe1df" stroke-width="10"/><circle cx="46" cy="46" r="38" fill="none" stroke="url(#rg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${d} ${c}" transform="rotate(-90 46 46)"/></svg>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><b style="font-family:var(--f-head);font-size:22px">${score}</b><span class="small muted">из ${max}</span></div></div>`;
}
const MAX = { inf: 21, math: 31 };

// ---------- главная ----------
export async function home() {
  const subs = state.profile.subjects || [];
  if (!subs.length) return frame('', `<div class="card empty-state"><h2>привет, ${esc(state.profile.full_name.split(' ')[0] || '')}!</h2><p>учитель скоро откроет тебе предметы — загляни чуть позже.</p></div>`);
  const subj = state.subject; const d = await myData();
  const lastAct = d.attempts[0]?.created_at;
  const mine = d.asg.filter(a => a.exams?.subject === subj);
  const done = mine.filter(a => a.status === 'checked' || a.status === 'submitted');
  const last = done.find(a => a.score != null);
  const prev = done.filter(a => a.score != null)[1];
  const lastGrade = last ? gradeFor(d.scale['scale_' + subj], last.score) : null;
  const st = starLevel(d.stats, subj, lastGrade, lastAct);
  const next = mine.find(a => a.status === 'assigned' || a.status === 'in_progress');
  const hwOpen = d.hw.filter(h => h.task_ids.length);
  const solvedIds = new Set(d.attempts.filter(a => a.is_correct || a.status === 'pending').map(a => a.task_id));
  const scale = d.scale['scale_' + subj] || [];
  let toNextGrade = '';
  if (last) { const nxt = scale.find(([a]) => a > last.score); toNextGrade = nxt ? `до «${nxt[2]}» не хватает ${nxt[0] - last.score} ${plural(nxt[0] - last.score, 'балла', 'баллов', 'баллов')}` : 'это «5» — так держать'; }
  const comments = d.attempts.filter(a => a.comment).slice(0, 3);
  const name = esc((state.profile.full_name || '').split(' ')[0]);
  frame('', `
  <div class="col" style="gap:18px">
    <div class="star-wrap">${starSVG(st.lvl, st.sleepy, 96)}
      <div class="small muted">${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>привет${name ? ', ' + name : ''}</h1>
      ${st.sleepy ? '<div class="small muted">звёздочка заскучала — реши хоть одну задачу, и она снова засветится</div>' : ''}</div>
    ${subjTabs()}
    <div class="grid">
      ${last ? `<a class="card row" href="#/exam-res/${last.id}" style="text-decoration:none;color:inherit">${ring(last.score, MAX[subj])}
        <div class="col" style="gap:4px"><div class="small muted">последний пробник · ${fmtDate(last.submitted_at)}</div>
        <h2>${lastGrade ? `оценка «${lastGrade}»` : 'проверяется'}</h2><div class="small" style="color:var(--ink2)">${toNextGrade}</div>
        ${prev ? `<span class="chip" style="align-self:flex-start">${last.score - prev.score >= 0 ? '+' : ''}${last.score - prev.score} к прошлому</span>` : ''}</div></a>` : ''}
      ${next ? `<a class="card col" href="#/exams" style="text-decoration:none;color:inherit;gap:6px"><div class="small muted">пробник</div><h2>${esc(next.exams.title)}</h2><div class="small">${next.status === 'in_progress' ? 'идёт — продолжить' : 'ждёт тебя · ' + next.exams.duration_min + ' мин'}</div></a>` : ''}
      ${hwOpen.slice(0, 2).map(h => { const n = h.task_ids.filter(id => solvedIds.has(id)).length;
        return `<a class="card col" href="#/hw/${h.id}" style="text-decoration:none;color:inherit;gap:8px">
        <div class="row" style="justify-content:space-between"><h2>${esc(h.title)}</h2><span class="small muted">${h.due ? 'до ' + fmtDate(h.due) : ''}</span></div>
        <div class="bar"><i style="width:${Math.round(100 * n / h.task_ids.length)}%"></i></div><div class="small muted">решено ${n} из ${h.task_ids.length} →</div></a>`; }).join('')}
    </div>
    <div class="card col">
      <div class="row" style="justify-content:space-between"><h2>мои задания</h2><span class="small muted">освоено ${st.done} из ${topicsOf(subj).length}</span></div>
      ${tilesHTML(d.stats, subj)}
    </div>
    ${comments.length ? `<div class="card col"><h2>комментарии учителя</h2>${comments.map(c => `<a href="#/task/${c.task_id}" style="text-decoration:none;color:inherit" class="col"><div style="background:#fff6f2;border-radius:16px;padding:12px 14px">${esc(c.comment)}</div><div class="small muted">${fmtDT(c.created_at)}</div></a>`).join('')}</div>` : ''}
  </div>`);
  bindTabs();
}

// ---------- список номеров ----------
export async function tasksIndex() {
  const subj = state.subject; const d = await myData();
  frame('задания', `${subjTabs()}<div class="card" style="margin-top:14px"><table class="simple">
  <tr><th>№</th><th>тема</th><th>решено</th><th>верно</th><th>статус</th></tr>
  ${topicsOf(subj).map(t => { const s = d.stats[t.id]; const stt = statusOf(d.stats, t.id);
    return `<tr><td><a class="tile ${STATUS[stt].cls}" style="width:40px;height:40px;font-size:14px;border-radius:13px" href="#/n/${t.id}">${t.num}</a></td>
    <td><a href="#/n/${t.id}" style="color:inherit;text-decoration:none">${esc(t.title)}</a></td><td>${s ? s.solved : 0}</td><td>${s ? Math.round(s.acc * 100) + '%' : '—'}</td><td><span class="chip ghost">${STATUS[stt].label}</span></td></tr>`; }).join('')}
  </table></div>`);
  bindTabs();
}

// ---------- один номер ----------
export async function topic(tid) {
  const t = state.topics.find(x => x.id === tid); if (!t) return (location.hash = '#/');
  const [tasks, d] = await Promise.all([all(() => sb.from('tasks').select('id,type').eq('topic_id', tid).eq('published', true)), myData()]);
  const mine = d.attempts.filter(a => a.tasks?.topic_id === tid);
  const solved = new Set(mine.filter(a => a.is_correct).map(a => a.task_id));
  const tried = new Set(mine.map(a => a.task_id));
  const types = {}; for (const x of tasks) { const k = x.type || 'все задачи'; (types[k] ||= { n: 0, s: 0 }); types[k].n++; if (solved.has(x.id)) types[k].s++; }
  const s = d.stats[tid]; const stt = statusOf(d.stats, tid);
  frame(`задание ${t.num}`, `
  <div class="col" style="gap:16px">
    <div class="row"><span class="chip">${esc(t.title)}</span><span class="chip ghost">${STATUS[stt].label}</span>${s ? `<span class="chip ghost">решено ${s.solved} · верно ${Math.round(s.acc * 100)}%</span>` : ''}</div>
    <div class="card col">
      <h2>что решать</h2>
      ${Object.entries(types).map(([k, v]) => `<div class="row"><div class="grow">${esc(k)}<div class="bar" style="margin-top:6px"><i style="width:${Math.round(100 * v.s / v.n)}%"></i></div><div class="small muted">решено ${v.s} из ${v.n}</div></div>
        <button class="btn sm soft" data-type="${esc(k)}">решать</button></div>`).join('') || '<div class="muted">задач пока нет</div>'}
      ${tasks.length ? '<button class="btn" data-type="">случайная задача</button>' : ''}
    </div>
    ${mine.length ? `<div class="card col"><h2>мои попытки</h2><div>${mine.slice(0, 40).map(a => `<a href="#/task/${a.task_id}" class="att ${a.status === 'pending' ? 'wait' : a.is_correct ? 'ok' : 'bad'}">№${a.task_id} · ${a.status === 'pending' ? 'на проверке' : a.is_correct ? 'верно' : a.points ? a.points + ' б.' : 'неверно'}</a>`).join('')}</div></div>` : ''}
  </div>`, { sub: SUBJ[t.subject] });
  $$('[data-type]').forEach(b => b.onclick = () => {
    const pool = tasks.filter(x => !b.dataset.type || (x.type || 'все задачи') === b.dataset.type);
    const fresh = pool.filter(x => !tried.has(x.id)); const unsolved = pool.filter(x => !solved.has(x.id));
    const from = fresh.length ? fresh : unsolved.length ? unsolved : pool;
    const pick = from[Math.floor(Math.random() * from.length)];
    location.hash = `#/task/${pick.id}?type=${encodeURIComponent(b.dataset.type)}`;
  });
}

// ---------- карточка задачи (общая для тренировки и проверки) ----------
export function taskCard(task, topic) {
  const files = (task.files || []).map(f => `<a class="btn sm ghost" href="${asset(f)}" download>скачать файл: ${esc(f.split('/').pop())}</a>`).join('');
  return `<div class="card col">
    ${(task.images || []).map(src => `<img class="task-img" src="${asset('img/' + src)}" alt="условие задачи" loading="lazy">`).join('')}
    ${!(task.images || []).length || topic.num >= 13 ? `<div class="task-body">${rich(task.body)}</div>` : ''}
    ${files ? `<div class="row">${files}</div>` : ''}
  </div>`;
}
export function answerForm(topic, prefix = 'a') {
  if (topic.auto) return `<div class="field"><label for="${prefix}-ans">твой ответ</label><div class="row" style="flex-wrap:nowrap"><input id="${prefix}-ans" class="mono" autocomplete="off" style="font-size:17px"><button class="btn" id="${prefix}-go">проверить</button></div></div>`;
  const code = topic.subject === 'inf' && (topic.num === 16 || topic.num === 15);
  return `<div class="col">
    ${code ? `<div class="field"><label for="${prefix}-code">${topic.num === 16 ? 'твоя программа (python)' : 'твой алгоритм'}</label><textarea id="${prefix}-code" class="code" spellcheck="false"></textarea></div>` : `<div class="field"><label for="${prefix}-ans">комментарий к работе (если нужно)</label><input id="${prefix}-ans"></div>`}
    <div class="field"><label for="${prefix}-file">файл с решением ${code ? '(необязательно)' : ''}</label><input id="${prefix}-file" type="file"></div>
    <button class="btn" id="${prefix}-go">отправить на проверку</button></div>`;
}
export async function readForm(topic, prefix = 'a') {
  const ans = $('#' + prefix + '-ans')?.value || '';
  const code = $('#' + prefix + '-code')?.value || null;
  const f = $('#' + prefix + '-file')?.files?.[0];
  let file = null;
  if (f) { if (f.size > 20 * 1024 * 1024) throw new Error('файл больше 20 мб'); file = await uploadSubmission(f); }
  return { ans, code: code && code.trim() ? code : null, file };
}

export async function task(id) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const t = await q(sb.from('tasks').select('*').eq('id', id).single());
  const topic = state.topics.find(x => x.id === t.topic_id);
  const hist = await q(sb.from('attempts').select('*').eq('task_id', id).eq('student_id', state.user.id).neq('status', 'draft').order('created_at', { ascending: false }));
  const hwId = params.get('hw');
  frame(`задание ${topic.num}`, `
  <div class="col" style="gap:16px;max-width:760px">
    <div class="row"><a class="btn sm ghost" href="${hwId ? '#/hw/' + hwId : '#/n/' + topic.id}">← назад</a><span class="chip ghost">${esc(t.type || topic.title)}</span><span class="small muted">№${t.id}</span></div>
    ${taskCard(t, topic)}
    <div class="card col">${answerForm(topic)}<div id="res"></div></div>
    ${hist.length ? `<div class="card col"><h2>мои попытки</h2>${hist.map(a => `<div class="col" style="gap:4px">
      <div class="row"><span class="att ${a.status === 'pending' ? 'wait' : a.is_correct ? 'ok' : 'bad'}">${esc(a.answer || (a.code ? 'программа' : a.file_name || 'файл'))}</span>
      <span class="small muted">${a.status === 'pending' ? 'на проверке' : topic.auto ? (a.is_correct ? 'верно' : 'неверно') : `${a.points} из ${topic.max_points} б.`} · ${fmtDT(a.created_at)}</span></div>
      ${a.comment ? `<div style="background:#fff6f2;border-radius:14px;padding:10px 12px">${esc(a.comment)}</div>` : ''}</div>`).join('')}</div>` : ''}
    <div class="row"><button class="btn soft" id="next">следующее →</button></div>
  </div>`, { sub: SUBJ[topic.subject] });
  const go = $('#a-go');
  const submit = async () => {
    go.disabled = true;
    try {
      const f = await readForm(topic);
      const r = await q(sb.rpc('submit_answer', { p_task: t.id, p_answer: f.ans, p_code: f.code, p_file_path: f.file?.path || null, p_file_name: f.file?.name || null }));
      $('#res').innerHTML = r.status === 'pending'
        ? `<div class="result"><b>отправлено!</b><span class="muted">учитель проверит и поставит балл</span></div>`
        : r.is_correct ? `<div class="result ok"><span style="width:44px;height:44px;display:inline-flex">${starSVG(4, false, 44)}</span><div><b style="font-family:var(--f-head);font-size:18px;color:var(--rose3)">верно!</b></div></div>`
          : `<div class="result bad"><b>пока неверно</b><span class="muted">попробуй ещё раз</span></div>`;
      if (r.is_correct || r.status === 'pending') setTimeout(() => rerender(), 1600);
    } catch (e) { fail(e); } finally { go.disabled = false; }
  };
  go.onclick = submit;
  $('#a-ans')?.addEventListener('keydown', e => { if (e.key === 'Enter' && topic.auto) submit(); });
  $('#next').onclick = async () => {
    if (hwId) {
      const hw = await q(sb.from('homework').select('task_ids').eq('id', hwId).single());
      const i = hw.task_ids.indexOf(+id); const nx = hw.task_ids[i + 1];
      location.hash = nx ? `#/task/${nx}?hw=${hwId}` : `#/hw/${hwId}`; return;
    }
    const ids = await all(() => sb.from('tasks').select('id,type').eq('topic_id', topic.id).eq('published', true));
    const type = params.get('type');
    const pool = ids.filter(x => x.id !== +id && (!type || (x.type || 'все задачи') === type));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    location.hash = pick ? `#/task/${pick.id}${type ? '?type=' + encodeURIComponent(type) : ''}` : `#/n/${topic.id}`;
  };
}

// ---------- домашка ----------
export async function homework(id) {
  const h = await q(sb.from('homework').select('*').eq('id', id).single());
  const [tasks, att] = await Promise.all([
    q(sb.from('tasks').select('id,topic_id,type').in('id', h.task_ids)),
    q(sb.from('attempts').select('task_id,is_correct,status').eq('student_id', state.user.id).in('task_id', h.task_ids)),
  ]);
  const st = id2 => att.some(a => a.task_id === id2 && a.is_correct) ? 'ok' : att.some(a => a.task_id === id2 && a.status === 'pending') ? 'wait' : att.some(a => a.task_id === id2) ? 'bad' : '';
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  frame(esc(h.title), `<div class="card col">${h.due ? `<div class="small muted">сдать до ${fmtDate(h.due)}</div>` : ''}
  ${h.task_ids.map((tid, i) => { const t = byId[tid]; if (!t) return ''; const tp = state.topics.find(x => x.id === t.topic_id); const s = st(tid);
    return `<a href="#/task/${tid}?hw=${h.id}" class="row" style="text-decoration:none;color:inherit;padding:8px 0;border-bottom:1px solid #f6e3e0">
      <span class="tile ${s === 'ok' ? 'st-done' : s === 'bad' ? 'st-errors' : s === 'wait' ? 'st-learning' : 'st-new'}" style="width:42px;height:42px;font-size:14px;border-radius:13px">${i + 1}</span>
      <span class="grow">задание ${tp?.num} · ${esc(t.type || tp?.title || '')}</span><span class="small muted">${s === 'ok' ? 'решено' : s === 'wait' ? 'на проверке' : s === 'bad' ? 'есть ошибка' : ''}</span></a>`; }).join('')}</div>`);
}

// ---------- пробники ----------
export async function exams() {
  const d = await myData();
  const mine = d.asg.filter(a => a.exams);
  const done = mine.filter(a => a.score != null).reverse();
  const chart = done.length ? (() => { const W = 60 * done.length + 20, H = 150, mx = Math.max(...done.map(a => MAX[a.exams.subject]));
    return `<svg viewBox="0 0 ${W} ${H + 24}" style="width:100%;max-width:${W * 1.4}px" role="img" aria-label="баллы за пробники"><defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9707f"/><stop offset="1" stop-color="#f8cdcd"/></linearGradient></defs>
    ${done.map((a, i) => { const h = Math.max(6, (a.score / mx) * (H - 24)); return `<rect x="${14 + i * 60}" y="${H - h}" width="40" height="${h}" rx="12" fill="url(#bg1)"/><text x="${34 + i * 60}" y="${H - h - 6}" text-anchor="middle" font-size="13" font-family="Comfortaa" font-weight="700" fill="#4a2a31">${a.score}</text><text x="${34 + i * 60}" y="${H + 16}" text-anchor="middle" font-size="10" fill="#8a5560">${new Date(a.submitted_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</text>`; }).join('')}</svg>`; })() : '';
  frame('пробники', `<div class="col" style="gap:16px">
    ${chart ? `<div class="card col"><h2>мои баллы</h2>${chart}</div>` : ''}
    <div class="card col">${mine.length ? mine.map(a => `<div class="row" style="padding:10px 0;border-bottom:1px solid #f6e3e0">
      <div class="grow"><b>${esc(a.exams.title)}</b><div class="small muted">${SUBJ[a.exams.subject]} · ${a.exams.duration_min} мин · ${a.exams.task_ids.length} заданий</div></div>
      ${a.status === 'assigned' ? `<button class="btn" data-start="${a.id}">начать</button>` : a.status === 'in_progress' ? `<a class="btn" href="#/exam/${a.id}">продолжить</a>`
        : `<a class="btn sm soft" href="#/exam-res/${a.id}">${a.score ?? '…'} б.${a.grade ? ' · «' + a.grade + '»' : ''}${a.status === 'submitted' ? ' · проверяется' : ''}</a>`}</div>`).join('') : '<div class="empty-state">пробников пока нет</div>'}</div></div>`);
  $$('[data-start]').forEach(b => b.onclick = () => {
    const a = mine.find(x => x.id == b.dataset.start);
    const sh = document.createElement('div'); sh.className = 'sheet';
    sh.innerHTML = `<div role="dialog"><h2>начать пробник?</h2><div style="color:var(--ink2)">${esc(a.exams.title)}: ${a.exams.task_ids.length} заданий, ${a.exams.duration_min} минут. таймер пойдёт сразу и не остановится, даже если закрыть страницу.</div>
    <div class="row"><button class="btn ghost grow" id="no">позже</button><button class="btn grow" id="yes">начать</button></div></div>`;
    document.body.appendChild(sh); $('#no', sh).onclick = () => sh.remove(); $('#yes', sh).onclick = () => { sh.remove(); location.hash = '#/exam/' + a.id; };
  });
}

export async function examResult(id) {
  const a = await q(sb.from('exam_assignments').select('*, exams(*)').eq('id', id).single());
  const att = await q(sb.from('attempts').select('*').eq('assignment_id', id));
  const tasks = await q(sb.from('tasks').select('id,topic_id').in('id', a.exams.task_ids));
  const tp = Object.fromEntries(tasks.map(t => [t.id, state.topics.find(x => x.id === t.topic_id)]));
  frame(esc(a.exams.title), `<div class="col" style="gap:16px">
  <div class="card row">${ring(a.score ?? 0, MAX[a.exams.subject])}<div class="col" style="gap:4px"><h2>${a.grade ? `оценка «${a.grade}»` : 'проверяется'}</h2><div class="small muted">сдан ${fmtDT(a.submitted_at)}</div></div></div>
  <div class="card"><table class="simple"><tr><th>№</th><th>ответ</th><th>балл</th></tr>
  ${a.exams.task_ids.map(tid => { const x = att.find(z => z.task_id === tid); const t = tp[tid];
    return `<tr><td><a href="#/task/${tid}">${t?.num}</a></td><td class="mono">${esc(x?.answer || (x?.code ? 'программа' : x?.file_name || '—'))}${x?.comment ? `<div class="small" style="font-family:var(--f-body);color:var(--ink2)">${esc(x.comment)}</div>` : ''}</td>
    <td>${x?.status === 'pending' ? 'проверяется' : (x?.points ?? 0) + ' / ' + (t?.max_points ?? 1)}</td></tr>`; }).join('')}</table></div></div>`);
}

// ---------- профиль ----------
export async function me() {
  const p = state.profile;
  frame('профиль', `<div class="card col" style="max-width:480px">
    <div class="field"><label for="nm">имя и фамилия</label><input id="nm" value="${esc(p.full_name)}"></div>
    <div class="field"><label for="gr">класс</label><input id="gr" value="${esc(p.grade)}"></div>
    <div class="row"><button class="btn" id="sv">сохранить</button><button class="btn ghost" id="lo">выйти</button></div></div>`);
  $('#sv').onclick = async () => { try { await q(sb.from('profiles').update({ full_name: $('#nm').value.trim(), grade: $('#gr').value.trim() }).eq('id', p.id)); p.full_name = $('#nm').value.trim(); toast('сохранено'); } catch (e) { fail(e); } };
  $('#lo').onclick = logout;
}
