-- A site's look in the village: the kit its village is built in, and its own icon. Both are the
-- site's configuration, set by its owner (`site:add --style`, `site:icon`); nothing about a visitor.

ALTER TABLE sites ADD COLUMN style TEXT;       -- "alpine" | "stone" | "citadel" | "umbra"; NULL is alpine
ALTER TABLE sites ADD COLUMN icon BLOB;        -- the site's public icon (PNG, ICO, JPEG), at most 40 KB
ALTER TABLE sites ADD COLUMN icon_type TEXT;   -- its media type
