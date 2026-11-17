-- The five dimensions of a report (packages/contracts/src/facets.ts): written by the structure step of
-- the analysis and by scripts/backfill-facets.ts for reports analysed before it. One row per article.
CREATE TABLE article_facets (
  article_id     text PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
  input_revision integer NOT NULL,
  topic          text,
  subject        text,
  form           text,
  content_type   text,
  companies      text[] NOT NULL DEFAULT '{}',
  origin         text NOT NULL CHECK (origin IN ('analysis', 'backfill')),
  model          text,
  prompt_version text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
