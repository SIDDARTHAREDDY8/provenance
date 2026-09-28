-- Provenance — Postgres schema.
--
-- Used when DATABASE_URL is set; the app runs on files otherwise. Applied by
-- docker compose on first boot.
--
-- Shape note: an assessment is stored as jsonb. It is an immutable record of
-- what one run concluded, always read whole, and shredding it across a dozen
-- tables would buy nothing but migrations. The things that ARE queried
-- independently — overrides, the audit log, evidence — are real columns with
-- real indexes.

create table if not exists candidate (
  id                 text primary key,
  name               text not null,
  headline           text not null default '',
  location           text not null default '',
  -- Skills the candidate has excluded from aggregate reporting. Honoured by
  -- excluding them from counts entirely, not by hiding them at render time.
  private_skill_ids  text[] not null default '{}'
);

create table if not exists skill (
  id         text primary key,
  label      text not null,
  dimension  text not null,
  aliases    text[] not null default '{}'
);

create table if not exists role (
  id            text primary key,
  title         text not null,
  team          text not null default '',
  level         int  not null default 0,
  requirements  jsonb not null
);

create table if not exists resume (
  candidate_id  text primary key references candidate(id) on delete cascade,
  body          text not null,
  received_at   timestamptz not null default now()
);

create table if not exists evidence_doc (
  id            text primary key,
  candidate_id  text not null references candidate(id) on delete cascade,
  kind          text not null,
  source        text not null,
  title         text not null,
  body          text not null,
  occurred_at   date not null,
  url           text,
  -- Third-party attested (reference, certificate) vs candidate-supplied. The
  -- confidence model weights these differently, so it is a column not a guess.
  attested      boolean not null default false
);

create index if not exists evidence_by_candidate on evidence_doc (candidate_id, occurred_at);
-- Retrieval in the demo is in-process. At corpus scale this is where pgvector
-- would go: alter table evidence_chunk add column embedding vector(1536).
create index if not exists evidence_body_fts on evidence_doc using gin (to_tsvector('english', title || ' ' || body));

create table if not exists application (
  id            text primary key,
  candidate_id  text not null references candidate(id) on delete cascade,
  role_id       text not null references role(id),
  submitted_at  timestamptz not null default now()
);

create table if not exists assessment (
  id              bigserial primary key,
  application_id  text not null references application(id) on delete cascade,
  run_id          text not null,
  payload         jsonb not null,
  created_at      timestamptz not null default now()
);

-- Assessments are append-only: a re-run inserts a new row rather than updating,
-- so "what did the system conclude on the day we rejected them" stays answerable.
create index if not exists assessment_latest on assessment (application_id, created_at desc);

create table if not exists override (
  id               text primary key,
  at               timestamptz not null,
  reviewer         text not null,
  application_id   text not null references application(id) on delete cascade,
  target_type      text not null,
  target_id        text not null,
  before_value     text not null,
  after_value      text not null,
  rationale        text not null,
  promoted_to_eval boolean not null default true
);

create index if not exists override_by_application on override (application_id, at desc);

create table if not exists audit_entry (
  id          text primary key,
  at          timestamptz not null,
  kind        text not null,
  actor       text not null,
  subject_id  text,
  summary     text not null,
  detail      jsonb
);

create index if not exists audit_recent on audit_entry (at desc);
create index if not exists audit_by_subject on audit_entry (subject_id, at desc);
