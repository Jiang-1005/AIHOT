CREATE TABLE site_blobs (
  key        text PRIMARY KEY,
  payload    jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
