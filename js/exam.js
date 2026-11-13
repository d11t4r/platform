import { sb, state, q, esc, $, $$, toast, fail, fmtDT } from './core.js';
import { frame } from './app.js';
import { taskCard, answerForm, readForm } from './student.js';

let tick = null;
window.addEventListener('hashchange', () => { if (tick && !location.hash.startsWith('#/exam/')) { clearInterval(tick); tick = null; } });

export async function run(asgId) {
  if (tick) { clearInterval(tick); tick = null; }
  const ex = await q(sb.rpc('start_exam', { p_assignment: +asgId }));
  if (ex.status === 'submitted' || ex.status === 'checked') return (location.hash = '#/exam-res/' + asgId);
  const skew = new Date(ex.now).getTime() - Date.now();
  const end = new Date(ex.started_at).getTime() + ex.duration_min * 60000;
  const [tasks, drafts] = await Promise.all([
    q(sb.from('tasks').select('*').in('id', ex.task_ids)),
    q(sb.from('attempts').select('task_id,answer,code,file_name').eq('assignment_id', +asgId)),
  ]);
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  const saved = Object.fromEntries(drafts.map(d => [d.task_id, d]));
  const list = ex.task_ids.map(id => byId[id]).filter(Boolean);
  let cur = 0, finishing = false;

  const isSaved = t => { const d = saved[t.id]; return d && ((d.answer && d.answer.trim()) || d.code || d.file_name); };
  const topicOf = t => state.topics.find(x => x.id === t.topic_id);

  frame(esc(ex.title), `<div class="col" style="gap:16px">
    <div class="row" style="justify-content:space-between;position:sticky;top:8px;z-index:5">
      <div class="timer" id="timer" role="timer" aria-live="off">--:--:--</div>
      <button class="btn" id="fin">сдать работу</button></div>
    <div class="cells" id="cells"></div>
    <div id="pane"></div></div>`);

  const drawCells = () => {
    $('#cells').innerHTML = list.map((t, i) => `<button class="cell ${i === cur ? 'on' : ''} ${isSaved(t) ? 'saved' : i === cur ? '' : 'empty'}" data-i="${i}" aria-label="задание ${topicOf(t)?.num}${isSaved(t) ? ', ответ сохранён' : ''}">${topicOf(t)?.num}</button>`).join('');
    $$('#cells [data-i]').forEach(b => b.onclick = () => { cur = +b.dataset.i; draw(); });
  };
  const draw = () => {
    drawCells();
    const t = list[cur], tp = topicOf(t), d = saved[t.id];
    $('#pane').innerHTML = `${taskCard(t, tp)}
      <div class="card col" style="margin-top:16px">${answerForm(tp, 'x')}
      ${d?.file_name ? `<div class="small muted">загружен файл: ${esc(d.file_name)}</div>` : ''}
      <div class="row" style="justify-content:space-between">
        <button class="btn ghost sm" id="prev" ${cur === 0 ? 'disabled' : ''}>← назад</button>
        <button class="btn soft sm" id="nxt">${cur === list.length - 1 ? 'к первому' : 'дальше →'}</button></div></div>`;
    if (d?.answer && $('#x-ans')) $('#x-ans').value = d.answer;
    if (d?.code && $('#x-code')) $('#x-code').value = d.code;
    const go = $('#x-go'); go.textContent = tp.auto ? 'сохранить' : 'сохранить ответ';
    const save = async () => {
      go.disabled = true;
      try {
        const f = await readForm(tp, 'x');
        await q(sb.rpc('save_exam_answer', { p_assignment: +asgId, p_task: t.id, p_answer: f.ans, p_code: f.code, p_file_path: f.file?.path || null, p_file_name: f.file?.name || d?.file_name || null }));
        saved[t.id] = { answer: f.ans, code: f.code, file_name: f.file?.name || d?.file_name };
        toast('сохранено'); if (tp.auto && cur < list.length - 1) { cur++; } draw();
      } catch (e) { fail(e); go.disabled = false; }
    };
    go.onclick = save;
    $('#x-ans')?.addEventListener('keydown', e => { if (e.key === 'Enter' && tp.auto) save(); });
    $('#prev').onclick = () => { cur--; draw(); };
    $('#nxt').onclick = () => { cur = cur === list.length - 1 ? 0 : cur + 1; draw(); };
    if (window.renderMathInElement) renderMathInElement($('#pane'), { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const finish = async (auto = false) => {
    if (finishing) return; finishing = true;
    try {
      const r = await q(sb.rpc('finish_exam', { p_assignment: +asgId }));
      clearInterval(tick); tick = null;
      toast(auto ? 'время вышло — работа сдана' : 'работа сдана');
      location.hash = '#/exam-res/' + asgId;
      return r;
    } catch (e) { finishing = false; fail(e); }
  };

  $('#fin').onclick = () => {
    const empty = list.filter(t => !isSaved(t)).map(t => topicOf(t)?.num);
    const sh = document.createElement('div'); sh.className = 'sheet';
    sh.innerHTML = `<div role="dialog" aria-label="сдать работу"><h2>сдать работу?</h2>
      ${empty.length ? `<div style="color:var(--ink2)">без ответа: ${empty.join(', ')}</div>` : '<div style="color:var(--ink2)">все ответы сохранены</div>'}
      <div class="small muted">после сдачи изменить ответы будет нельзя</div>
      <div class="row"><button class="btn ghost grow" id="no">вернуться</button><button class="btn grow" id="yes">сдать</button></div></div>`;
    document.body.appendChild(sh);
    $('#no', sh).onclick = () => sh.remove();
    $('#yes', sh).onclick = () => { sh.remove(); finish(); };
  };

  const upd = () => {
    const left = Math.max(0, end - (Date.now() + skew));
    const s = Math.floor(left / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    const el = $('#timer'); if (!el) return;
    el.textContent = `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    el.classList.toggle('low', left < 10 * 60000);
    if (left <= 0) finish(true);
  };
  upd(); tick = setInterval(upd, 1000);
  draw();
}
