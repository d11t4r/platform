-- =====================================================================
--  платформа огэ · схема базы для supabase
--  выполнить один раз: supabase → sql editor → new query → вставить → run
-- =====================================================================

-- ---------- профили ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  grade text not null default '9',
  role text not null default 'student' check (role in ('student','teacher')),
  subjects text[] not null default '{}',        -- 'inf', 'math'
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, grade)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          coalesce(new.raw_user_meta_data->>'grade', '9'));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- номера заданий (темы) ----------
create table if not exists public.topics (
  id text primary key,                 -- 'inf-1' … 'inf-16', 'math-1' …
  subject text not null,               -- 'inf' | 'math'
  num int not null,
  title text not null,
  max_points int not null default 1,
  auto boolean not null default true,  -- проверяется автоматически
  unique (subject, num)
);

-- ---------- задачи ----------
create table if not exists public.tasks (
  id bigint generated always as identity primary key,
  topic_id text not null references public.topics(id) on delete cascade,
  type text not null default '',
  body text not null default '',
  images text[] not null default '{}',   -- пути к картинкам на сайте (data/img/…)
  files text[] not null default '{}',    -- пути к файлам к заданию (data/files/…)
  source text not null default '',
  ext_id text unique,                    -- ключ для повторного импорта
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists tasks_topic_idx on public.tasks(topic_id);

-- ключи и критерии — видит только учитель
create table if not exists public.task_keys (
  task_id bigint primary key references public.tasks(id) on delete cascade,
  answer text,                -- для автопроверки: варианты через |
  reference jsonb,            -- эталон для ручной проверки (14: ответы на вопросы)
  tests jsonb                 -- 16: [{input, output}]
);

-- ---------- пробники ----------
create table if not exists public.exams (
  id bigint generated always as identity primary key,
  subject text not null default 'inf',
  title text not null,
  duration_min int not null default 150,
  task_ids bigint[] not null default '{}',   -- по порядку номеров
  created_at timestamptz not null default now()
);

create table if not exists public.exam_assignments (
  id bigint generated always as identity primary key,
  exam_id bigint not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'assigned' check (status in ('assigned','in_progress','submitted','checked')),
  started_at timestamptz,
  submitted_at timestamptz,
  score int,
  grade int,
  created_at timestamptz not null default now(),
  unique (exam_id, student_id)
);

-- ---------- попытки (тренировка, домашка, пробник) ----------
create table if not exists public.attempts (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id bigint references public.exam_assignments(id) on delete cascade,
  answer text not null default '',
  code text,
  file_path text,
  file_name text,
  status text not null default 'checked' check (status in ('draft','pending','checked')),
  is_correct boolean,
  points int,
  comment text,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index if not exists attempts_student_idx on public.attempts(student_id, created_at desc);
create unique index if not exists attempts_exam_task_uniq on public.attempts(assignment_id, task_id) where assignment_id is not null;

-- ---------- домашки ----------
create table if not exists public.homework (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'домашка',
  due date,
  task_ids bigint[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- ручной статус номера (учитель может поставить свой) ----------
create table if not exists public.topic_status (
  student_id uuid references public.profiles(id) on delete cascade,
  topic_id text references public.topics(id) on delete cascade,
  status text check (status in ('new','learning','errors','done')),
  primary key (student_id, topic_id)
);

-- ---------- настройки (шкалы оценок) ----------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null
);

-- =====================================================================
--  функции
-- =====================================================================
create or replace function public.norm_answer(t text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(lower(coalesce(t,'')), 'ё', 'е'), ',', '.'), '«', ''), '»', ''), ' ', '');
$$;

create or replace function public.check_answer(p_task bigint, p_answer text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from task_keys k, unnest(string_to_array(coalesce(k.answer,''), '|')) a
    where k.task_id = p_task and public.norm_answer(a) <> '' and public.norm_answer(a) = public.norm_answer(p_answer)
  );
$$;
revoke execute on function public.check_answer(bigint, text) from public, anon, authenticated;

create or replace function public.grade_for(p_subject text, p_score int) returns int
language sql stable security definer set search_path = public as $$
  select (r->>2)::int from settings s, jsonb_array_elements(s.value) r
  where s.key = 'scale_' || p_subject and p_score between (r->>0)::int and (r->>1)::int limit 1;
$$;

-- ответ на тренировочное задание или домашку
create or replace function public.submit_answer(p_task bigint, p_answer text default '', p_code text default null,
                                                p_file_path text default null, p_file_name text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_auto boolean; v_max int; v_ok boolean; v_id bigint; v_status text;
begin
  if auth.uid() is null then raise exception 'нужно войти'; end if;
  select tp.auto, tp.max_points into v_auto, v_max
    from tasks t join topics tp on tp.id = t.topic_id
   where t.id = p_task and (t.published or is_teacher());
  if v_auto is null then raise exception 'задание не найдено'; end if;
  if p_file_path is not null and p_file_path not like auth.uid()::text || '/%' then raise exception 'неверный файл'; end if;
  if coalesce(trim(p_answer),'') = '' and p_code is null and p_file_path is null then raise exception 'пустой ответ'; end if;
  if v_auto then v_ok := check_answer(p_task, p_answer); v_status := 'checked';
  else v_ok := null; v_status := 'pending'; end if;
  insert into attempts (task_id, student_id, answer, code, file_path, file_name, status, is_correct, points, checked_at)
  values (p_task, auth.uid(), coalesce(p_answer,''), p_code, p_file_path, p_file_name, v_status, v_ok,
          case when v_ok is null then null when v_ok then v_max else 0 end,
          case when v_status = 'checked' then now() end)
  returning id into v_id;
  return json_build_object('id', v_id, 'is_correct', v_ok, 'status', v_status);
end; $$;

-- пробник: начать
create or replace function public.start_exam(p_assignment bigint) returns json
language plpgsql security definer set search_path = public as $$
declare a exam_assignments; e exams;
begin
  select * into a from exam_assignments where id = p_assignment and student_id = auth.uid();
  if a.id is null then raise exception 'пробник не найден'; end if;
  select * into e from exams where id = a.exam_id;
  if a.status = 'assigned' then
    update exam_assignments set status = 'in_progress', started_at = now() where id = a.id returning * into a;
  end if;
  return json_build_object('status', a.status, 'started_at', a.started_at, 'duration_min', e.duration_min,
                           'task_ids', e.task_ids, 'title', e.title, 'subject', e.subject, 'now', now());
end; $$;

-- пробник: сохранить ответ (сервер проверяет, что время не вышло)
create or replace function public.save_exam_answer(p_assignment bigint, p_task bigint, p_answer text default '',
                                                   p_code text default null, p_file_path text default null, p_file_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a exam_assignments; e exams;
begin
  select * into a from exam_assignments where id = p_assignment and student_id = auth.uid();
  if a.id is null or a.status <> 'in_progress' then raise exception 'пробник не идёт'; end if;
  select * into e from exams where id = a.exam_id;
  if not (p_task = any(e.task_ids)) then raise exception 'задания нет в пробнике'; end if;
  if now() > a.started_at + make_interval(mins => e.duration_min + 2) then raise exception 'время вышло'; end if;
  if p_file_path is not null and p_file_path not like auth.uid()::text || '/%' then raise exception 'неверный файл'; end if;
  insert into attempts (task_id, student_id, assignment_id, answer, code, file_path, file_name, status)
  values (p_task, auth.uid(), a.id, coalesce(p_answer,''), p_code, p_file_path, p_file_name, 'draft')
  on conflict (assignment_id, task_id) where assignment_id is not null
  do update set answer = excluded.answer,
                code = coalesce(excluded.code, attempts.code),
                file_path = coalesce(excluded.file_path, attempts.file_path),
                file_name = coalesce(excluded.file_name, attempts.file_name),
                created_at = now();
end; $$;

-- пересчёт балла пробника
create or replace function public.recalc_exam(p_assignment bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_score int; v_pending int; v_subject text;
begin
  select coalesce(sum(points),0), count(*) filter (where status = 'pending')
    into v_score, v_pending from attempts where assignment_id = p_assignment;
  select e.subject into v_subject from exam_assignments a join exams e on e.id = a.exam_id where a.id = p_assignment;
  update exam_assignments
     set score = v_score,
         grade = grade_for(v_subject, v_score),
         status = case when v_pending = 0 then 'checked' else 'submitted' end
   where id = p_assignment;
end; $$;

-- пробник: сдать (или автоматически по окончании времени)
create or replace function public.finish_exam(p_assignment bigint) returns json
language plpgsql security definer set search_path = public as $$
declare a exam_assignments; e exams; t bigint; v_auto boolean; v_max int;
begin
  select * into a from exam_assignments where id = p_assignment and (student_id = auth.uid() or is_teacher());
  if a.id is null then raise exception 'пробник не найден'; end if;
  if a.status not in ('in_progress') then return json_build_object('status', a.status); end if;
  select * into e from exams where id = a.exam_id;
  foreach t in array e.task_ids loop
    select tp.auto, tp.max_points into v_auto, v_max from tasks x join topics tp on tp.id = x.topic_id where x.id = t;
    if not exists (select 1 from attempts where assignment_id = a.id and task_id = t) then
      insert into attempts (task_id, student_id, assignment_id, answer, status, is_correct, points, checked_at)
      values (t, a.student_id, a.id, '', 'checked', false, 0, now());
    elsif v_auto then
      update attempts set status = 'checked', is_correct = check_answer(t, answer),
             points = case when check_answer(t, answer) then v_max else 0 end, checked_at = now()
       where assignment_id = a.id and task_id = t;
    else
      update attempts set status = case when coalesce(answer,'') = '' and code is null and file_path is null then 'checked' else 'pending' end,
             points = case when coalesce(answer,'') = '' and code is null and file_path is null then 0 end,
             is_correct = case when coalesce(answer,'') = '' and code is null and file_path is null then false end
       where assignment_id = a.id and task_id = t;
    end if;
  end loop;
  update exam_assignments set submitted_at = now(), status = 'submitted' where id = a.id;
  perform recalc_exam(a.id);
  select * into a from exam_assignments where id = p_assignment;
  return json_build_object('status', a.status, 'score', a.score, 'grade', a.grade);
end; $$;

-- учитель ставит балл за развёрнутый ответ
create or replace function public.grade_attempt(p_attempt bigint, p_points int, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_max int; v_asg bigint;
begin
  if not is_teacher() then raise exception 'только учитель'; end if;
  select tp.max_points, at.assignment_id into v_max, v_asg
    from attempts at join tasks t on t.id = at.task_id join topics tp on tp.id = t.topic_id where at.id = p_attempt;
  if p_points < 0 or p_points > v_max then raise exception 'балл от 0 до %', v_max; end if;
  update attempts set points = p_points, is_correct = (p_points = v_max), status = 'checked',
         comment = p_comment, checked_at = now() where id = p_attempt;
  if v_asg is not null then perform recalc_exam(v_asg); end if;
end; $$;

grant execute on function public.submit_answer(bigint, text, text, text, text) to authenticated;
grant execute on function public.start_exam(bigint) to authenticated;
grant execute on function public.save_exam_answer(bigint, bigint, text, text, text, text) to authenticated;
grant execute on function public.finish_exam(bigint) to authenticated;
grant execute on function public.grade_attempt(bigint, int, text) to authenticated;
revoke execute on function public.recalc_exam(bigint) from public, anon, authenticated;

-- =====================================================================
--  права доступа (row level security)
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.topics enable row level security;
alter table public.tasks enable row level security;
alter table public.task_keys enable row level security;
alter table public.exams enable row level security;
alter table public.exam_assignments enable row level security;
alter table public.attempts enable row level security;
alter table public.homework enable row level security;
alter table public.topic_status enable row level security;
alter table public.settings enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (id = auth.uid() or is_teacher());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid() or is_teacher());
revoke update on public.profiles from authenticated, anon;
grant update (full_name, grade, subjects, archived) on public.profiles to authenticated;
-- ученик может менять только имя и класс: предметы и архив меняет учитель
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_teacher() then new.subjects := old.subjects; new.archived := old.archived; end if;
  return new;
end; $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile();

drop policy if exists topics_read on public.topics;
create policy topics_read on public.topics for select to authenticated using (true);
drop policy if exists topics_write on public.topics;
create policy topics_write on public.topics for all using (is_teacher()) with check (is_teacher());

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using (published or is_teacher());
drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks for all using (is_teacher()) with check (is_teacher());

drop policy if exists keys_teacher on public.task_keys;
create policy keys_teacher on public.task_keys for all using (is_teacher()) with check (is_teacher());

drop policy if exists exams_read on public.exams;
create policy exams_read on public.exams for select using (
  is_teacher() or exists (select 1 from exam_assignments a where a.exam_id = exams.id and a.student_id = auth.uid()));
drop policy if exists exams_write on public.exams;
create policy exams_write on public.exams for all using (is_teacher()) with check (is_teacher());

drop policy if exists asg_read on public.exam_assignments;
create policy asg_read on public.exam_assignments for select using (student_id = auth.uid() or is_teacher());
drop policy if exists asg_write on public.exam_assignments;
create policy asg_write on public.exam_assignments for all using (is_teacher()) with check (is_teacher());

drop policy if exists attempts_read on public.attempts;
create policy attempts_read on public.attempts for select using (student_id = auth.uid() or is_teacher());
drop policy if exists attempts_teacher on public.attempts;
create policy attempts_teacher on public.attempts for update using (is_teacher());
drop policy if exists attempts_delete on public.attempts;
create policy attempts_delete on public.attempts for delete using (is_teacher());

drop policy if exists hw_read on public.homework;
create policy hw_read on public.homework for select using (student_id = auth.uid() or is_teacher());
drop policy if exists hw_write on public.homework;
create policy hw_write on public.homework for all using (is_teacher()) with check (is_teacher());

drop policy if exists ts_read on public.topic_status;
create policy ts_read on public.topic_status for select using (student_id = auth.uid() or is_teacher());
drop policy if exists ts_write on public.topic_status;
create policy ts_write on public.topic_status for all using (is_teacher()) with check (is_teacher());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all using (is_teacher()) with check (is_teacher());

-- =====================================================================
--  хранилище для файлов, которые сдают ученики
-- =====================================================================
insert into storage.buckets (id, name, public) values ('submissions', 'submissions', false)
on conflict (id) do nothing;

drop policy if exists subm_upload on storage.objects;
create policy subm_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists subm_read on storage.objects;
create policy subm_read on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_teacher()));

-- =====================================================================
--  стартовые данные: номера заданий и шкалы
-- =====================================================================
insert into public.topics (id, subject, num, title, max_points, auto) values
 ('inf-1','inf',1,'количественные параметры информационных объектов',1,true),
 ('inf-2','inf',2,'кодирование и декодирование информации',1,true),
 ('inf-3','inf',3,'значение логического выражения',1,true),
 ('inf-4','inf',4,'формальные описания реальных объектов',1,true),
 ('inf-5','inf',5,'простой линейный алгоритм для исполнителя',1,true),
 ('inf-6','inf',6,'программа с условным оператором',1,true),
 ('inf-7','inf',7,'адресация в интернете',1,true),
 ('inf-8','inf',8,'запросы для поисковых систем',1,true),
 ('inf-9','inf',9,'количество путей в графе',1,true),
 ('inf-10','inf',10,'системы счисления',1,true),
 ('inf-11','inf',11,'поиск информации в файлах',1,true),
 ('inf-12','inf',12,'файловая система',1,true),
 ('inf-13','inf',13,'презентация или текстовый документ',2,false),
 ('inf-14','inf',14,'электронные таблицы',3,false),
 ('inf-15','inf',15,'алгоритм для исполнителя робот',2,false),
 ('inf-16','inf',16,'программа на языке программирования',2,false)
on conflict (id) do nothing;

insert into public.topics (id, subject, num, title, max_points, auto)
select 'math-' || n, 'math', n, 'задание ' || n, case when n <= 19 then 1 else 2 end, n <= 19
from generate_series(1,25) n
on conflict (id) do nothing;

insert into public.settings (key, value) values
 ('scale_inf',  '[[0,4,2],[5,10,3],[11,16,4],[17,21,5]]'),
 ('scale_math', '[[0,7,2],[8,14,3],[15,21,4],[22,31,5]]')
on conflict (key) do nothing;

-- =====================================================================
--  после регистрации своего аккаунта выполните (подставьте свою почту):
--  update public.profiles set role = 'teacher'
--   where id = (select id from auth.users where email = 'ВАША_ПОЧТА');
-- =====================================================================
