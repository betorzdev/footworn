-- Footworn's schema. A hit carries no IP, no User-Agent, no hash and no id of any kind: everything
-- in it is one of the measures the AEPD's audience guide lists (docs/privacy.md).

CREATE TABLE IF NOT EXISTS sites (
  id      TEXT PRIMARY KEY,      -- the data-site the tracker sends ("hallownest")
  name    TEXT NOT NULL,         -- what the dashboard shows
  origins TEXT NOT NULL          -- space-separated Origins allowed to count ("https://a.example https://b.example")
);

CREATE TABLE IF NOT EXISTS hits (
  id      INTEGER PRIMARY KEY,
  site    TEXT    NOT NULL,
  ts      INTEGER NOT NULL,      -- unix seconds
  day     TEXT    NOT NULL,      -- "2026-10-01", UTC
  path    TEXT    NOT NULL,      -- pathname, no query, no hash
  event   TEXT,                  -- NULL for a pageview; the event's name otherwise
  props   TEXT,                  -- JSON object of the event's properties, or NULL
  ref     TEXT,                  -- referrer hostname, or NULL
  browser TEXT,
  os      TEXT,
  device  TEXT,                  -- phone | tablet | desktop
  width   INTEGER,
  country TEXT,                  -- ISO 3166-1 alpha-2, from the edge
  lang    TEXT,                  -- "es", "en"… (navigator.language's first tag)
  first   INTEGER NOT NULL DEFAULT 0  -- 1 on the visitor's first pageview of the day (a "visitor"); always 0 on an event
);
CREATE INDEX IF NOT EXISTS hits_site_day   ON hits (site, day);
CREATE INDEX IF NOT EXISTS hits_site_event ON hits (site, event, day);

-- Today's visitor hashes (salt + site + ip + ua, SHA-256). Wiped with the salt every night.
CREATE TABLE IF NOT EXISTS seen (
  site TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (site, hash)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
