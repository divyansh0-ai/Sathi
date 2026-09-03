-- Handoff — Supabase schema.
--
-- Run this in the Supabase SQL editor, then set NEXT_PUBLIC_SUPABASE_URL and a
-- key in .env.local. The app switches from the local JSON file to Postgres on
-- its own once both are present (see BACKEND in lib/store.ts).
--
-- Column names are snake_case here and camelCase in the app; lib/store.ts maps
-- between the two, so keep these names as they are.

create table if not exists projects (
  id          text primary key,
  name        text        not null,
  description text        not null default '',
  status      text        not null default 'active',
  created_at  timestamptz not null default now()
);

create table if not exists tasks (
  id         text primary key,
  project_id text        not null references projects (id) on delete cascade,
  title      text        not null,
  notes      text        not null default '',
  status     text        not null default 'backlog',
  priority   text        not null default 'p2',
  "position" integer     not null default 0,
  assignee   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_project_idx on tasks (project_id, status, "position");

-- Append-only feed of everything both sides did.
create table if not exists activity (
  id          text primary key,
  ts          timestamptz not null default now(),
  actor       text        not null,
  tool        text,
  summary     text        not null,
  detail      text,
  kind        text        not null,
  status      text        not null default 'ok',
  approval_id text
);

create index if not exists activity_ts_idx on activity (ts);

-- The human-in-the-loop queue. `args` holds the exact tool call that will run
-- if and only if a person approves it.
create table if not exists approvals (
  id         text primary key,
  ts         timestamptz not null default now(),
  title      text        not null,
  reason     text        not null default '',
  risk       text        not null default 'medium',
  tool       text,
  args       jsonb       not null default '{}'::jsonb,
  status     text        not null default 'pending',
  decided_at timestamptz,
  note       text,
  result     jsonb
);

create index if not exists approvals_status_idx on approvals (status, ts);

-- Demo-grade access control: every table is world-readable and world-writable
-- through the anon key. Before this is anything but a demo, replace these with
-- policies scoped to an authenticated owner, and keep the service-role key on
-- the server only.
alter table projects  enable row level security;
alter table tasks     enable row level security;
alter table activity  enable row level security;
alter table approvals enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['projects', 'tasks', 'activity', 'approvals'] loop
    execute format('drop policy if exists %I on %I', t || '_demo_all', t);
    execute format(
      'create policy %I on %I for all to anon, authenticated using (true) with check (true)',
      t || '_demo_all', t
    );
  end loop;
end $$;
