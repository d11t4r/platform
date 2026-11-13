import { sb, state, q, all, esc, $, $$, toast, fail, rich, asset, topicsOf, SUBJ, STATUS, topicStats, statusOf, gradeFor, fmtDate, fmtDT, plural, signedUrl } from './core.js';
import { frame, rerender } from './app.js';
import { taskCard } from './student.js';

const MAX = { inf: 21, math: 31 };
const DUR = { inf: 150, math: 235 };
let rubricsCache = null;
async function rubrics() {
  if (!rubricsCache) { try { rubricsCache = await (await fetch('data/rubrics.json')).json(); } catch { rubricsCache = {}; } }
  return rubricsCache;
}
const rubricKey = (topic, task) => topic.subject === 'inf' && topic.num === 13 ? (task.type?.includes('13.2') || /13\.2/.test(task.source) ? '13.2' : '13.1') : topic.subject === 'inf' ? String(topic.num) : topic.id;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const nameOf = p => esc(p?.full_name || 'без имени');

async function students_() { return q(sb.from('profiles').select('*').eq('role', 'student').order('full_name')); }
async function pendingCount() {
  const { count } = await sb.from('attempts').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  state.pending = count || 0; return state.pending;
}
function subjSwitch() {
  return `<div class="nav" style="width:fit-content">${Object.entries(SUBJ).map(([k, v]) => `<a href="#" data-subj="${k}" class="${state.subject === k ? 'on' : ''}">${v}</a>`).join('')}</div>`;
}
function bindSubj() { $$('[data-subj]').forEach(a => a.onclick = e => { e.preventDefault(); state.subject = a.dataset.subj; localStorage.setItem('subject', state.subject); rerender(); }); }

// =====================================================================
//  ученики: матрица прогресса
// =====================================================================
export async function students() {
  const subj = state.subject;
  const [ps, att, ov, asg] = await Promise.all([
    students_(),
    all(() => sb.from('attempts').select('student_id,task_id,is_correct,status,created_at,tasks(topic_id)').neq('status', 'draft')),
    q(sb.from('topic_status').select('*')),
    q(sb.from('exam_assignments').select('student_id,score,grade,submitted_at,exams(subject)').not('score', 'is', null).order('submitted_at', { ascending: false })),
  ]);
  await pendingCount();
  const active = ps.filter(p => !p.archived);
  const fresh = active.filter(p => !(p.subjects || []).length);
  const inSubj = active.filter(p => (p.subjects || []).includes(subj));
  const tps = topicsOf(subj);
  const rows = inSubj.map(p => {
    const mine = att.filter(a => a.student_id === p.id);
    const overrides = Object.fromEntries(ov.filter(o => o.student_id === p.id).map(o => [o.topic_id, o.status]));
    const st = topicStats(mine, overrides);
    const last = asg.find(a => a.student_id === p.id && a.exams?.subject === subj);
    const lastAct = mine[0] ? mine.reduce((m, a) => a.created_at > m ? a.created_at : m, mine[0].created_at) : null;
    const pend = mine.filter(a => a.status === 'pending').length;
    return `<tr><td class="name"><a href="#/st/${p.id}" style="color:inherit">${nameOf(p)}</a><div class="small muted" style="font-weight:400">${lastAct ? 'был(а) ' + fmtDate(lastAct) : 'ещё не заходил(а)'}${pend ? ` · <a href="#/review">${pend} на проверке</a>` : ''}</div></td>
      ${tps.map(t => { const s = st[t.id]; const k = statusOf(st, t.id);
        return `<td class="c" style="background:${STATUS[k].color};color:${k === 'done' ? '#fff' : '#4a2a31'};${k === 'new' ? 'box-shadow:inset 0 0 0 1px #f0d6d6' : ''}" title="${t.num}: ${STATUS[k].label}${s ? ` · верно ${s.correct} из ${s.checked}` : ''}">${s && s.checked ? s.correct + '/' + s.checked : ''}</td>`; }).join('')}
      <td class="c" style="background:#fff6f2">${last ? `${last.score}<div class="small muted">«${last.grade ?? '?'}»</div>` : '—'}</td></tr>`;
  }).join('');
  frame('ученики', `<div class="col" style="gap:16px">
    ${fresh.length ? `<div class="card col"><h2>новые ученики</h2><div class="small muted">отметь предметы, чтобы открыть им задания</div>
      ${fresh.map(p => `<div class="row" style="justify-content:space-between"><a href="#/st/${p.id}"><b>${nameOf(p)}</b></a><span class="small muted">${esc(p.grade || '')} класс · ${fmtDate(p.created_at)}</span>
      <div class="row">${Object.entries(SUBJ).map(([k, v]) => `<button class="btn sm soft" data-open="${p.id}" data-s="${k}">+ ${v}</button>`).join('')}</div></div>`).join('')}</div>` : ''}
    <div class="row" style="justify-content:space-between">${subjSwitch()}${state.pending ? `<a class="btn sm" href="#/review">проверить работы · ${state.pending}</a>` : ''}</div>
    <div class="card matrix">${inSubj.length ? `<table><tr><th></th>${tps.map(t => `<th>${t.num}</th>`).join('')}<th>пробник</th></tr>${rows}</table>
      <div class="legend" style="margin-top:10px">${Object.values(STATUS).map(s => `<span><i style="background:${s.color};${s.color === '#ffffff' ? 'border:1px solid #ecc6c6' : ''}"></i>${s.label}</span>`).join('')}<span class="muted">в клетке: верно / всего попыток</span></div>`
      : `<div class="empty-state">по предмету «${SUBJ[subj]}» учеников пока нет</div>`}</div>
    ${ps.some(p => p.archived) ? `<details class="card"><summary>архив (${ps.filter(p => p.archived).length})</summary>${ps.filter(p => p.archived).map(p => `<div><a href="#/st/${p.id}">${nameOf(p)}</a></div>`).join('')}</details>` : ''}
  </div>`);
  bindSubj();
  $$('[data-open]').forEach(b => b.onclick = async () => {
    const p = fresh.find(x => x.id === b.dataset.open);
    try { await q(sb.from('profiles').update({ subjects: [...new Set([...(p.subjects || []), b.dataset.s])] }).eq('id', p.id)); toast('открыто'); rerender(); } catch (e) { fail(e); }
  });
}

// =====================================================================
//  один ученик
// =====================================================================
export async function student(id) {
  const [p, att, ov, hw, asg, exams] = await Promise.all([
    q(sb.from('profiles').select('*').eq('id', id).single()),
    all(() => sb.from('attempts').select('id,task_id,is_correct,points,status,created_at,answer,comment,assignment_id,tasks(topic_id)').eq('student_id', id).neq('status', 'draft').order('created_at', { ascending: false })),
    q(sb.from('topic_status').select('*').eq('student_id', id)),
    q(sb.from('homework').select('*').eq('student_id', id).order('created_at', { ascending: false })),
    q(sb.from('exam_assignments').select('*, exams(id,title,subject)').eq('student_id', id).order('created_at', { ascending: false })),
    q(sb.from('exams').select('id,title,subject').order('created_at', { ascending: false })),
  ]);
  const subs = p.subjects || [];
  const subj = subs.includes(state.subject) ? state.subject : subs[0] || state.subject;
  const overrides = Object.fromEntries(ov.map(o => [o.topic_id, o.status]));
  const st = topicStats(att, overrides);
  const tps = topicsOf(subj);
  const solvedIds = new Set(att.filter(a => a.is_correct || a.status === 'pending').map(a => a.task_id));
  frame(nameOf(p), `<div class="col" style="gap:16px">
    <div class="card col">
      <div class="row">${Object.entries(SUBJ).map(([k, v]) => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-sub="${k}" ${subs.includes(k) ? 'checked' : ''} style="width:auto;min-height:auto"> ${v}</label>`).join('')}
        <span class="small muted">${esc(p.grade || '')} класс · с ${fmtDate(p.created_at)}</span>
        <button class="btn sm ghost" id="arch">${p.archived ? 'вернуть из архива' : 'в архив'}</button></div>
    </div>
    ${subs.length > 1 ? `<div class="nav" style="width:fit-content">${subs.map(s => `<a href="#" data-subj="${s}" class="${s === subj ? 'on' : ''}">${SUBJ[s]}</a>`).join('')}</div>` : ''}
    <div class="card col"><h2>номера — ${SUBJ[subj]}</h2>
      <div class="small muted">статус считается сам; можно поставить свой — он будет главнее</div>
      <table class="simple"><tr><th>№</th><th>тема</th><th>верно</th><th>статус</th></tr>
      ${tps.map(t => { const s = st[t.id]; const k = statusOf(st, t.id);
        return `<tr><td><span class="tile ${STATUS[k].cls}" style="width:36px;height:36px;font-size:13px;border-radius:12px">${t.num}</span></td><td>${esc(t.title)}</td>
        <td>${s && s.checked ? `${s.correct} из ${s.checked} · ${Math.round(s.acc * 100)}%` : '—'}</td>
        <td><select data-ov="${t.id}" style="min-height:36px;padding:6px 10px"><option value="">авто${s ? ': ' + STATUS[s.auto].label : ''}</option>
        ${Object.entries(STATUS).map(([k2, v]) => `<option value="${k2}" ${overrides[t.id] === k2 ? 'selected' : ''}>${v.label}</option>`).join('')}</select></td></tr>`; }).join('')}</table></div>
    <div class="grid">
      <div class="card col"><h2>домашка</h2>
        <div class="field"><label for="hw-t">название</label><input id="hw-t" value="домашка ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}"></div>
        <div class="field"><label for="hw-d">сдать до</label><input id="hw-d" type="date"></div>
        <div class="col" id="hw-rows" style="gap:8px"></div>
        <button class="btn sm ghost" id="hw-add">+ ещё номер</button>
        <label class="small"><input type="checkbox" id="hw-new" checked style="width:auto;min-height:auto"> только задачи, которые ученик ещё не решал</label>
        <button class="btn" id="hw-go">выдать</button>
        ${hw.map(h => { const n = h.task_ids.filter(x => solvedIds.has(x)).length;
          return `<div class="row" style="justify-content:space-between;border-top:1px solid #f6e3e0;padding-top:8px"><div><b>${esc(h.title)}</b><div class="small muted">${h.due ? 'до ' + fmtDate(h.due) + ' · ' : ''}решено ${n} из ${h.task_ids.length}</div></div><button class="btn sm ghost" data-delhw="${h.id}" aria-label="удалить домашку">✕</button></div>`; }).join('')}
      </div>
      <div class="card col"><h2>пробники</h2>
        ${exams.filter(e => e.subject === subj).length ? `<div class="row" style="flex-wrap:nowrap"><select id="ex-s">${exams.filter(e => e.subject === subj).map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('')}</select><button class="btn" id="ex-go">назначить</button></div>` : `<div class="small muted">сначала создай пробник во вкладке «пробники»</div>`}
        ${asg.map(a => `<div class="row" style="justify-content:space-between;border-top:1px solid #f6e3e0;padding-top:8px"><div><b>${esc(a.exams?.title || '')}</b><div class="small muted">${{ assigned: 'назначен', in_progress: 'пишет сейчас', submitted: 'сдан, ждёт проверки', checked: 'проверен' }[a.status]}${a.submitted_at ? ' · ' + fmtDT(a.submitted_at) : ''}</div></div>
          ${a.score != null ? `<a class="btn sm soft" href="#/exam-res/${a.exam_id}">${a.score} б. · «${a.grade ?? '?'}»</a>` : `<button class="btn sm ghost" data-delasg="${a.id}" aria-label="отменить">✕</button>`}</div>`).join('')}
      </div>
    </div>
    <div class="card col"><h2>последние попытки</h2>
      ${att.slice(0, 60).map(a => { const t = state.topics.find(x => x.id === a.tasks?.topic_id);
        return `<a href="#/task/${a.task_id}" class="att ${a.status === 'pending' ? 'wait' : a.is_correct ? 'ok' : 'bad'}" title="${fmtDT(a.created_at)}">${t ? SUBJ[t.subject].slice(0, 3) + ' ' + t.num : ''} · ${esc((a.answer || '').slice(0, 18)) || (a.status === 'pending' ? 'на проверке' : a.points + ' б.')}</a>`; }).join('') || '<div class="muted">пока пусто</div>'}
    </div>
  </div>`, { sub: 'ученик' });

  $$('[data-subj]').forEach(a => a.onclick = e => { e.preventDefault(); state.subject = a.dataset.subj; rerender(); });
  $$('[data-sub]').forEach(c => c.onchange = async () => {
    const next = $$('[data-sub]').filter(x => x.checked).map(x => x.dataset.sub);
    try { await q(sb.from('profiles').update({ subjects: next }).eq('id', id)); toast('сохранено'); rerender(); } catch (e) { fail(e); }
  });
  $('#arch').onclick = async () => { try { await q(sb.from('profiles').update({ archived: !p.archived }).eq('id', id)); rerender(); } catch (e) { fail(e); } };
  $$('[data-ov]').forEach(s => s.onchange = async () => {
    try {
      if (s.value) await q(sb.from('topic_status').upsert({ student_id: id, topic_id: s.dataset.ov, status: s.value }));
      else await q(sb.from('topic_status').delete().eq('student_id', id).eq('topic_id', s.dataset.ov));
      toast('статус обновлён');
    } catch (e) { fail(e); }
  });
  // домашка: строки «номер × количество»
  const addRow = () => {
    const r = document.createElement('div'); r.className = 'row'; r.style.flexWrap = 'nowrap';
    r.innerHTML = `<select class="hw-topic">${tps.map(t => `<option value="${t.id}">${t.num}. ${esc(t.title)}</option>`).join('')}</select><input class="hw-n" type="number" min="1" max="30" value="5" style="width:80px" aria-label="сколько задач"><button class="btn sm ghost" aria-label="убрать">✕</button>`;
    $('button', r).onclick = () => r.remove(); $('#hw-rows').appendChild(r);
    const weak = tps.find(t => ['errors', 'learning'].includes(statusOf(st, t.id)));
    if (weak && $('#hw-rows').children.length === 1) $('.hw-topic', r).value = weak.id;
  };
  addRow(); $('#hw-add').onclick = addRow;
  $('#hw-go').onclick = async () => {
    const onlyNew = $('#hw-new').checked; const tried = new Set(att.map(a => a.task_id)); const ids = [];
    try {
      for (const r of $$('#hw-rows .row')) {
        const tid = $('.hw-topic', r).value, n = +$('.hw-n', r).value || 1;
        const pool = await all(() => sb.from('tasks').select('id').eq('topic_id', tid).eq('published', true));
        let cand = pool.map(x => x.id).filter(x => !ids.includes(x));
        if (onlyNew) { const f = cand.filter(x => !tried.has(x)); if (f.length >= n) cand = f; }
        ids.push(...shuffle(cand).slice(0, n));
      }
      if (!ids.length) return toast('нет задач для выдачи');
      await q(sb.from('homework').insert({ student_id: id, title: $('#hw-t').value.trim() || 'домашка', due: $('#hw-d').value || null, task_ids: ids }));
      toast(`выдано ${ids.length} ${plural(ids.length, 'задача', 'задачи', 'задач')}`); rerender();
    } catch (e) { fail(e); }
  };
  $$('[data-delhw]').forEach(b => b.onclick = async () => { if (!confirm('удалить домашку?')) return; try { await q(sb.from('homework').delete().eq('id', b.dataset.delhw)); rerender(); } catch (e) { fail(e); } });
  $$('[data-delasg]').forEach(b => b.onclick = async () => { if (!confirm('отменить пробник?')) return; try { await q(sb.from('exam_assignments').delete().eq('id', b.dataset.delasg)); rerender(); } catch (e) { fail(e); } });
  $('#ex-go') && ($('#ex-go').onclick = async () => {
    try { await q(sb.from('exam_assignments').insert({ exam_id: +$('#ex-s').value, student_id: id })); toast('пробник назначен'); rerender(); }
    catch (e) { fail(e.code === '23505' ? new Error('этот пробник уже назначен') : e); }
  });
}

// =====================================================================
//  проверка развёрнутых ответов
// =====================================================================
export async function review() {
  const list = await q(sb.from('attempts').select('*, tasks(*), profiles(full_name)').eq('status', 'pending').order('created_at').limit(50));
  state.pending = list.length;
  const R = await rubrics();
  const keys = list.length ? await q(sb.from('task_keys').select('*').in('task_id', [...new Set(list.map(a => a.task_id))])) : [];
  const keyOf = Object.fromEntries(keys.map(k => [k.task_id, k]));
  frame('проверка', list.length ? `<div class="col" style="gap:20px">${list.map(a => {
    const t = a.tasks, tp = state.topics.find(x => x.id === t.topic_id), rb = R[rubricKey(tp, t)], k = keyOf[a.task_id];
    return `<div class="col" style="gap:12px" data-att="${a.id}">
      <div class="row"><b>${esc(a.profiles?.full_name || '')}</b><span class="chip">${SUBJ[tp.subject]} · задание ${tp.num}</span>${a.assignment_id ? '<span class="chip ghost">пробник</span>' : ''}<span class="small muted">${fmtDT(a.created_at)} · №${t.id}</span></div>
      <details class="card"><summary>условие</summary>${taskCard(t, tp)}</details>
      <div class="card col">
        ${a.answer ? `<div><div class="small muted">ответ / комментарий ученика</div><div class="mono">${esc(a.answer)}</div></div>` : ''}
        ${a.code ? `<div><div class="small muted">программа</div><pre class="out">${esc(a.code)}</pre></div>` : ''}
        ${a.file_path ? `<div><button class="btn sm soft" data-file="${esc(a.file_path)}">открыть файл: ${esc(a.file_name || 'файл')}</button></div>` : ''}
        ${!a.answer && !a.code && !a.file_path ? '<div class="muted">ученик ничего не прислал</div>' : ''}
        ${k?.reference ? `<div style="background:#fff6f2;border-radius:16px;padding:12px 14px"><div class="small muted">эталон</div>${Object.entries(k.reference).map(([q1, v]) => `<div><b>${esc(q1)}:</b> <span class="mono">${esc(v)}</span></div>`).join('')}</div>` : ''}
        ${k?.tests?.length && a.code ? `<div class="col"><button class="btn sm" data-run="${a.id}">прогнать тесты (${k.tests.length})</button><div data-out="${a.id}"></div></div>` : ''}
        ${rb ? `<div class="check-list col" style="gap:6px"><div class="small muted">критерии</div>${(rb.checks || []).map(c => `<label><input type="checkbox">${esc(c)}</label>`).join('')}
          ${(rb.scale || []).length ? `<div class="small muted" style="margin-top:6px">${rb.scale.map(esc).join('<br>')}</div>` : ''}</div>` : ''}
        <div class="field"><label>комментарий ученику</label><textarea data-com rows="2" style="min-height:64px"></textarea></div>
        <div class="pts">${Array.from({ length: tp.max_points + 1 }, (_, i) => `<button class="btn ${i === tp.max_points ? '' : 'soft'}" data-pts="${i}">${i}</button>`).join('')}<span class="small muted" style="align-self:center">баллов из ${tp.max_points}</span></div>
      </div></div>`; }).join('<hr style="border:none;border-top:1px dashed #efc9c9;width:100%">')}</div>`
    : `<div class="card empty-state"><h2>всё проверено</h2><p class="muted">новые работы появятся здесь</p></div>`);
  $$('[data-file]').forEach(b => b.onclick = async () => { const u = await signedUrl(b.dataset.file); if (u) window.open(u, '_blank'); else toast('файл не найден'); });
  $$('[data-run]').forEach(b => b.onclick = async () => {
    const a = list.find(x => x.id == b.dataset.run), k = keyOf[a.task_id], out = $(`[data-out="${a.id}"]`);
    b.disabled = true; out.innerHTML = '<div class="small muted">загружаю python в браузер… (первый раз ~10 секунд)</div>';
    try {
      const res = await runTests(a.code, k.tests, (i, n) => out.innerHTML = `<div class="small muted">тест ${i} из ${n}…</div>`);
      const bad = res.filter(r => !r.ok).length;
      const sugg = bad === 0 ? 2 : bad === 1 ? 1 : 0;
      out.innerHTML = `<div class="col" style="gap:6px">${res.map((r, i) => `<details><summary><span class="att ${r.ok ? 'ok' : 'bad'}" style="margin:0">тест ${i + 1}: ${r.ok ? 'верно' : r.err ? 'ошибка' : 'неверно'}</span></summary>
        <div class="small">ввод:</div><pre class="out">${esc(r.input.length > 300 ? r.input.slice(0, 300) + '\n…' : r.input)}</pre><div class="small">ожидалось: <span class="mono">${esc(r.expected)}</span></div><div class="small">получено:</div><pre class="out">${esc(r.err || r.got)}</pre></details>`).join('')}
        <div><b>неверных тестов: ${bad}</b> → по критериям ${sugg} ${plural(sugg, 'балл', 'балла', 'баллов')}</div></div>`;
      const card = b.closest('[data-att]'); $$('[data-pts]', card).forEach(x => x.classList.toggle('soft', +x.dataset.pts !== sugg));
    } catch (e) { out.innerHTML = `<div class="small" style="color:#c0392b">${esc(e.message)}</div>`; } finally { b.disabled = false; }
  });
  $$('[data-pts]').forEach(b => b.onclick = async () => {
    const card = b.closest('[data-att]');
    try {
      await q(sb.rpc('grade_attempt', { p_attempt: +card.dataset.att, p_points: +b.dataset.pts, p_comment: $('[data-com]', card).value.trim() || null }));
      card.style.transition = 'opacity .3s'; card.style.opacity = '0'; setTimeout(() => { card.remove(); state.pending--; if (!$$('[data-att]').length) rerender(); }, 300);
      toast('балл поставлен');
    } catch (e) { fail(e); }
  });
}

// ---------- python в браузере для задания 16 ----------
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const WORKER = `importScripts('${PYODIDE}pyodide.js');
let py = loadPyodide({ indexURL: '${PYODIDE}' });
const RUN = \`
import sys, io, builtins, traceback
_inp = io.StringIO(INPUT); _out = io.StringIO()
sys.stdin = _inp; sys.stdout = _out
builtins.input = lambda prompt='': (_inp.readline() or (_ for _ in ()).throw(EOFError('ввод закончился'))).rstrip('\\\\n')
_err = ''
try:
    exec(compile(CODE, 'program.py', 'exec'), {'__name__': '__main__'})
except SystemExit:
    pass
except BaseException:
    _err = traceback.format_exc(limit=-1)
sys.stdout = sys.__stdout__
RESULT = (_out.getvalue(), _err)
\`;
onmessage = async e => {
  const p = await py;
  if (e.data === 'ping') return postMessage({ ready: true });
  try {
    p.globals.set('CODE', e.data.code); p.globals.set('INPUT', e.data.input);
    await p.runPythonAsync(RUN);
    const r = p.globals.get('RESULT').toJs(); postMessage({ out: r[0], err: r[1] });
  } catch (err) { postMessage({ out: '', err: String(err) }); }
};`;
function sameOutput(got, exp) {
  const a = got.trim().split(/\s+/).filter(Boolean), b = String(exp).trim().split(/\s+/).filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]; if (x.toLowerCase() === y.toLowerCase()) return true;
    const nx = Number(x.replace(',', '.')), ny = Number(y.replace(',', '.'));
    return !isNaN(nx) && !isNaN(ny) && Math.abs(nx - ny) < 0.051;
  });
}
async function runTests(code, tests, progress) {
  const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
  let w = new Worker(url);
  const call = (msg, ms) => new Promise(res => {
    const t = setTimeout(() => res({ timeout: true }), ms);
    w.onmessage = e => { clearTimeout(t); res(e.data); };
    w.onerror = e => { clearTimeout(t); res({ out: '', err: e.message || 'ошибка загрузки python' }); };
    w.postMessage(msg);
  });
  const ready = await call('ping', 60000);
  if (!ready.ready) { w.terminate(); throw new Error('не получилось загрузить python — проверь интернет'); }
  const res = [];
  for (let i = 0; i < tests.length; i++) {
    progress?.(i + 1, tests.length);
    const r = await call({ code, input: tests[i].input }, 8000);
    if (r.timeout) {
      res.push({ input: tests[i].input, expected: tests[i].output, got: '', err: 'программа работала дольше 8 секунд (зациклилась или ждёт ввода)', ok: false });
      w.terminate(); w = new Worker(url); await call('ping', 60000);
    } else res.push({ input: tests[i].input, expected: tests[i].output, got: r.out, err: r.err, ok: !r.err && sameOutput(r.out, tests[i].output) });
  }
  w.terminate(); URL.revokeObjectURL(url);
  return res;
}

// =====================================================================
//  пробники
// =====================================================================
export async function exams() {
  const [ex, asg, ps] = await Promise.all([
    q(sb.from('exams').select('*').order('created_at', { ascending: false })),
    q(sb.from('exam_assignments').select('exam_id,status,score')),
    students_(),
  ]);
  const active = ps.filter(p => !p.archived);
  frame('пробники', `<div class="col" style="gap:16px">
    <div class="card col"><h2>новый пробник</h2>
      <div class="grid">
        <div class="field"><label for="e-s">предмет</label><select id="e-s">${Object.entries(SUBJ).map(([k, v]) => `<option value="${k}" ${k === state.subject ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label for="e-t">название</label><input id="e-t" value="пробник ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}"></div>
        <div class="field"><label for="e-d">минут</label><input id="e-d" type="number" value="${DUR[state.subject]}"></div>
      </div>
      <div class="small muted">по одной случайной задаче на каждый номер из банка (опубликованные). ученикам, отмеченным ниже, он сразу назначится.</div>
      <div class="row" id="e-st">${active.map(p => `<label class="chip" style="cursor:pointer" data-subs="${(p.subjects || []).join(',')}"><input type="checkbox" value="${p.id}" style="width:auto;min-height:auto"> ${nameOf(p)}</label>`).join('') || '<span class="muted">учеников пока нет</span>'}</div>
      <button class="btn" id="e-go">собрать пробник</button>
    </div>
    <div class="card">${ex.length ? `<table class="simple"><tr><th>пробник</th><th>предмет</th><th>назначен</th><th>сдали</th><th>средний балл</th><th></th></tr>
      ${ex.map(e => { const a = asg.filter(x => x.exam_id === e.id), d = a.filter(x => x.score != null);
        return `<tr><td><a href="#/exam-res/${e.id}"><b>${esc(e.title)}</b></a><div class="small muted">${fmtDate(e.created_at)} · ${e.duration_min} мин</div></td><td>${SUBJ[e.subject]}</td><td>${a.length}</td><td>${d.length}</td><td>${d.length ? (d.reduce((s, x) => s + x.score, 0) / d.length).toFixed(1) : '—'}</td>
        <td><button class="btn sm ghost" data-del="${e.id}" aria-label="удалить">✕</button></td></tr>`; }).join('')}</table>` : '<div class="empty-state">пробников ещё нет</div>'}</div>
  </div>`);
  const syncStudents = () => { const s = $('#e-s').value; $$('#e-st [data-subs]').forEach(l => l.style.display = l.dataset.subs.split(',').includes(s) ? '' : 'none'); };
  $('#e-s').onchange = () => { $('#e-d').value = DUR[$('#e-s').value]; syncStudents(); }; syncStudents();
  $('#e-go').onclick = async () => {
    const subj = $('#e-s').value, b = $('#e-go'); b.disabled = true;
    try {
      const ids = [], miss = [];
      for (const t of topicsOf(subj)) {
        const pool = await all(() => sb.from('tasks').select('id').eq('topic_id', t.id).eq('published', true));
        if (pool.length) ids.push(pool[Math.floor(Math.random() * pool.length)].id); else miss.push(t.num);
      }
      if (!ids.length) throw new Error('в банке нет задач по этому предмету');
      const e = await q(sb.from('exams').insert({ subject: subj, title: $('#e-t').value.trim() || 'пробник', duration_min: +$('#e-d').value || DUR[subj], task_ids: ids }).select().single());
      const who = $$('#e-st input:checked').filter(x => x.closest('label').style.display !== 'none').map(x => ({ exam_id: e.id, student_id: x.value }));
      if (who.length) await q(sb.from('exam_assignments').insert(who));
      toast(`пробник собран${miss.length ? ` (нет задач на №${miss.join(', ')})` : ''}${who.length ? ', назначен: ' + who.length : ''}`);
      location.hash = '#/exam-res/' + e.id;
    } catch (err) { fail(err); b.disabled = false; }
  };
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('удалить пробник вместе с результатами?')) return;
    try { await q(sb.from('exams').delete().eq('id', b.dataset.del)); rerender(); } catch (e) { fail(e); }
  });
}

export async function examResult(id) {
  const e = await q(sb.from('exams').select('*').eq('id', id).single());
  const [asg, tasks, ps] = await Promise.all([
    q(sb.from('exam_assignments').select('*, profiles(full_name)').eq('exam_id', id)),
    q(sb.from('tasks').select('id,topic_id,type').in('id', e.task_ids)),
    students_(),
  ]);
  const att = asg.length ? await q(sb.from('attempts').select('assignment_id,task_id,points,status,answer').in('assignment_id', asg.map(a => a.id))) : [];
  const tById = Object.fromEntries(tasks.map(t => [t.id, t]));
  const tp = tid => state.topics.find(x => x.id === tById[tid]?.topic_id);
  const free = ps.filter(p => !p.archived && (p.subjects || []).includes(e.subject) && !asg.some(a => a.student_id === p.id));
  frame(esc(e.title), `<div class="col" style="gap:16px">
    <div class="row"><span class="chip">${SUBJ[e.subject]}</span><span class="chip ghost">${e.duration_min} мин</span><span class="chip ghost">${e.task_ids.length} заданий</span><a class="btn sm ghost" href="#/exams">← все пробники</a></div>
    <div class="card col"><h2>задания</h2><div class="row">${e.task_ids.map(tid => `<a class="tile st-new" style="width:42px;height:42px;font-size:14px;border-radius:13px" href="#/task/${tid}" title="${esc(tById[tid]?.type || '')}">${tp(tid)?.num ?? '?'}</a>`).join('')}</div></div>
    ${free.length ? `<div class="card col"><h2>назначить ещё</h2><div class="row">${free.map(p => `<label class="chip" style="cursor:pointer"><input type="checkbox" value="${p.id}" style="width:auto;min-height:auto"> ${nameOf(p)}</label>`).join('')}</div><button class="btn sm" id="as-go" style="align-self:flex-start">назначить</button></div>` : ''}
    <div class="card matrix">${asg.length ? `<table><tr><th></th>${e.task_ids.map(tid => `<th>${tp(tid)?.num}</th>`).join('')}<th>итог</th></tr>
      ${asg.map(a => `<tr><td class="name"><a href="#/st/${a.student_id}" style="color:inherit">${esc(a.profiles?.full_name || '')}</a><div class="small muted" style="font-weight:400">${{ assigned: 'не начинал(а)', in_progress: 'пишет', submitted: 'ждёт проверки', checked: 'проверен' }[a.status]}</div></td>
        ${e.task_ids.map(tid => { const x = att.find(z => z.assignment_id === a.id && z.task_id === tid), mx = tp(tid)?.max_points || 1;
          const bg = !x || a.status === 'assigned' || a.status === 'in_progress' ? '#fff' : x.status === 'pending' ? '#f8cdcd' : x.points === mx ? '#b54a5f' : x.points ? '#f7c3a6' : '#fde3d6';
          return `<td class="c" style="background:${bg};color:${bg === '#b54a5f' ? '#fff' : '#4a2a31'};box-shadow:inset 0 0 0 1px #f3dcdc" title="${esc(x?.answer || '')}">${x && a.status !== 'in_progress' ? (x.status === 'pending' ? '…' : x.points) : ''}</td>`; }).join('')}
        <td class="c" style="background:#fff6f2">${a.score ?? '—'}${a.grade ? `<div class="small muted">«${a.grade}»</div>` : ''}</td></tr>`).join('')}</table>` : '<div class="empty-state">пока никому не назначен</div>'}</div>
  </div>`, { sub: 'пробник' });
  $('#as-go') && ($('#as-go').onclick = async () => {
    const who = $$('.card input[type=checkbox]:checked').map(x => ({ exam_id: e.id, student_id: x.value }));
    if (!who.length) return toast('отметь учеников');
    try { await q(sb.from('exam_assignments').insert(who)); toast('назначено'); rerender(); } catch (er) { fail(er); }
  });
}

// =====================================================================
//  банк задач
// =====================================================================
export async function bank(tid) {
  const subj = tid ? tid.split('-')[0] : state.subject;
  const tps = topicsOf(subj);
  const topic = tps.find(t => t.id === tid);
  const counts = await Promise.all(tps.map(t => sb.from('tasks').select('id', { count: 'exact', head: true }).eq('topic_id', t.id).then(r => r.count || 0)));
  let body = '';
  if (topic) {
    const tasks = await all(() => sb.from('tasks').select('id,type,body,published,images').eq('topic_id', tid).order('id'));
    const keys = await all(() => sb.from('task_keys').select('task_id,answer').in('task_id', tasks.map(t => t.id)));
    const ans = Object.fromEntries(keys.map(k => [k.task_id, k.answer]));
    const types = [...new Set(tasks.map(t => t.type || ''))];
    body = `<div class="card col"><div class="row" style="justify-content:space-between"><h2>задание ${topic.num}: ${esc(topic.title)}</h2><span class="small muted">${tasks.length} ${plural(tasks.length, 'задача', 'задачи', 'задач')}</span></div>
      ${types.length > 1 ? `<select id="bt"><option value="">все типы</option>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select>` : ''}
      <table class="simple" id="bl"><tr><th>№</th><th>тип</th><th>начало условия</th><th>ответ</th><th>видно ученикам</th></tr>
      ${tasks.map(t => `<tr data-type="${esc(t.type || '')}"><td><a href="#/task/${t.id}">${t.id}</a></td><td class="small">${esc(t.type || '')}</td><td class="small">${esc((t.body || '').slice(0, 90))}${(t.body || '').length > 90 ? '…' : ''}</td><td class="mono small">${esc(ans[t.id] ?? (topic.auto ? '—' : 'ручная'))}</td>
        <td><input type="checkbox" data-pub="${t.id}" ${t.published ? 'checked' : ''} style="width:auto;min-height:auto" aria-label="опубликована"></td></tr>`).join('')}</table></div>`;
  }
  frame('банк задач', `<div class="col" style="gap:16px">
    <div class="nav" style="width:fit-content">${Object.entries(SUBJ).map(([k, v]) => `<a href="#/bank/${k}-1" class="${subj === k ? 'on' : ''}">${v}</a>`).join('')}</div>
    <div class="tiles">${tps.map((t, i) => `<a class="tile ${t.id === tid ? 'st-done' : counts[i] ? 'st-learning' : 'st-new'}" href="#/bank/${t.id}" title="${esc(t.title)}: ${counts[i]}">${t.num}<span style="font-size:10px;font-weight:500;display:block">${counts[i]}</span></a>`).join('')}</div>
    ${body || '<div class="card empty-state">выбери номер</div>'}</div>`);
  $('#bt') && ($('#bt').onchange = () => $$('#bl tr[data-type]').forEach(r => r.style.display = !$('#bt').value || r.dataset.type === $('#bt').value ? '' : 'none'));
  $$('[data-pub]').forEach(c => c.onchange = async () => { try { await q(sb.from('tasks').update({ published: c.checked }).eq('id', c.dataset.pub)); toast(c.checked ? 'видна ученикам' : 'скрыта'); } catch (e) { fail(e); } });
}

export async function taskView(id) {
  const t = await q(sb.from('tasks').select('*').eq('id', id).single());
  const topic = state.topics.find(x => x.id === t.topic_id);
  const [k, att] = await Promise.all([
    q(sb.from('task_keys').select('*').eq('task_id', id).maybeSingle()),
    q(sb.from('attempts').select('is_correct,status,answer,created_at,profiles(full_name)').eq('task_id', id).neq('status', 'draft').order('created_at', { ascending: false }).limit(50)),
  ]);
  const ok = att.filter(a => a.is_correct).length;
  frame(`задача №${t.id}`, `<div class="col" style="gap:16px;max-width:820px">
    <div class="row"><a class="btn sm ghost" href="#/bank/${topic.id}">← банк</a><span class="chip">${SUBJ[topic.subject]} · задание ${topic.num}</span>${t.type ? `<span class="chip ghost">${esc(t.type)}</span>` : ''}<span class="small muted">${esc(t.source || '')}</span></div>
    ${taskCard(t, topic)}
    <div class="card col"><h2>ключ</h2>
      ${topic.auto ? `<div class="field"><label for="k-a">правильный ответ (несколько вариантов — через |)</label><div class="row" style="flex-wrap:nowrap"><input id="k-a" class="mono" value="${esc(k?.answer || '')}"><button class="btn" id="k-s">сохранить</button></div></div>`
        : k?.reference ? Object.entries(k.reference).map(([a, b]) => `<div><b>${esc(a)}:</b> <span class="mono">${esc(b)}</span></div>`).join('') : k?.tests ? `<div class="small muted">тестов для автопроверки: ${k.tests.length}</div>` : '<div class="muted">проверяется по критериям</div>'}
      <label class="small"><input type="checkbox" id="k-p" ${t.published ? 'checked' : ''} style="width:auto;min-height:auto"> видна ученикам</label>
    </div>
    <div class="card col"><h2>кто решал</h2>${att.length ? `<div class="small muted">верно ${ok} из ${att.length}</div>${att.map(a => `<div class="row small"><span class="att ${a.status === 'pending' ? 'wait' : a.is_correct ? 'ok' : 'bad'}">${esc(a.answer || '—')}</span>${esc(a.profiles?.full_name || '')} · ${fmtDT(a.created_at)}</div>`).join('')}` : '<div class="muted">ещё никто</div>'}</div>
  </div>`, { sub: 'банк' });
  $('#k-s') && ($('#k-s').onclick = async () => { try { await q(sb.from('task_keys').upsert({ task_id: t.id, answer: $('#k-a').value.trim() })); toast('ключ сохранён'); } catch (e) { fail(e); } });
  $('#k-p').onchange = async () => { try { await q(sb.from('tasks').update({ published: $('#k-p').checked }).eq('id', t.id)); toast('сохранено'); } catch (e) { fail(e); } };
}

// =====================================================================
//  настройки: шкалы и импорт банка
// =====================================================================
export async function settings() {
  const s = Object.fromEntries((await q(sb.from('settings').select('*'))).map(x => [x.key, x.value]));
  const scaleRows = subj => (s['scale_' + subj] || []).map(([a, b, g]) => `<div class="row" style="flex-wrap:nowrap" data-sc="${subj}"><span style="width:50px"><b>«${g}»</b></span><input type="number" value="${a}" style="width:80px" aria-label="от"><span>–</span><input type="number" value="${b}" style="width:80px" aria-label="до"><input type="hidden" value="${g}"></div>`).join('');
  frame('настройки', `<div class="col" style="gap:16px;max-width:760px">
    <div class="grid">${Object.entries(SUBJ).map(([k, v]) => `<div class="card col"><h2>шкала: ${v}</h2><div class="small muted">первичные баллы (макс. ${MAX[k]}) → оценка</div>${scaleRows(k)}<button class="btn sm" data-save="${k}">сохранить</button></div>`).join('')}</div>
    <div class="card col"><h2>загрузить банк задач</h2>
      <div class="small" style="color:var(--ink2)">задачи берутся из файла <span class="mono">data/bank.json</span> на сайте, ответы — из файла <span class="mono">keys.json</span>, который лежит только у тебя на компьютере. повторная загрузка безопасна: задачи обновятся, дублей не будет.</div>
      <div class="field"><label for="kf">файл keys.json</label><input id="kf" type="file" accept=".json,application/json"></div>
      <button class="btn" id="imp">загрузить</button><div id="imp-log" class="small muted"></div>
    </div>
    <div class="card col"><h2>аккаунт</h2><div class="small muted">${esc(state.user.email)}</div><button class="btn ghost sm" id="lo" style="align-self:flex-start">выйти</button></div>
  </div>`);
  $$('[data-save]').forEach(b => b.onclick = async () => {
    const k = b.dataset.save;
    const v = $$(`[data-sc="${k}"]`).map(r => $$('input', r).map(i => +i.value)).map(([a, c, g]) => [a, c, g]);
    try { await q(sb.from('settings').upsert({ key: 'scale_' + k, value: v })); toast('шкала сохранена'); } catch (e) { fail(e); }
  });
  $('#lo').onclick = () => sb.auth.signOut();
  $('#imp').onclick = async () => {
    const log = $('#imp-log'), b = $('#imp'); const say = m => log.textContent = m;
    b.disabled = true;
    try {
      say('читаю data/bank.json…');
      const bankRes = await fetch('data/bank.json', { cache: 'no-store' });
      if (!bankRes.ok) throw new Error('не нашла data/bank.json на сайте');
      const items = await bankRes.json();
      const f = $('#kf').files[0]; const keys = f ? JSON.parse(await f.text()) : {};
      if (!f && !confirm('файл keys.json не выбран — загрузить задачи без ответов?')) { b.disabled = false; return say(''); }
      const idByExt = {};
      for (let i = 0; i < items.length; i += 200) {
        const chunk = items.slice(i, i + 200).map(x => ({ topic_id: x.topic_id, type: x.type || '', body: x.body || '', images: x.images || [], files: x.files || [], source: x.source || '', ext_id: x.ext_id }));
        const rows = await q(sb.from('tasks').upsert(chunk, { onConflict: 'ext_id' }).select('id,ext_id'));
        rows.forEach(r => idByExt[r.ext_id] = r.id);
        say(`задачи: ${Math.min(i + 200, items.length)} из ${items.length}`);
      }
      const kr = Object.entries(keys).filter(([ext]) => idByExt[ext]).map(([ext, v]) => ({ task_id: idByExt[ext], answer: v.answer ?? null, reference: v.reference ?? null, tests: v.tests ?? null }));
      for (let i = 0; i < kr.length; i += 200) { await q(sb.from('task_keys').upsert(kr.slice(i, i + 200))); say(`ответы: ${Math.min(i + 200, kr.length)} из ${kr.length}`); }
      say(`готово: ${items.length} ${plural(items.length, 'задача', 'задачи', 'задач')}, ${kr.length} ${plural(kr.length, 'ключ', 'ключа', 'ключей')}`);
      toast('банк загружен');
    } catch (e) { fail(e); say('ошибка: ' + e.message); } finally { b.disabled = false; }
  };
}
