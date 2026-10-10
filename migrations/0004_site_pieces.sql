-- The pieces of a site's village that its owner set apart from its kit (the Sites panel): its
-- spire, its wall, its roofs, its shade, its motes. Site configuration, nothing about a visitor.

ALTER TABLE sites ADD COLUMN pieces TEXT;   -- JSON { spire?, wall?, roofs?, shade?, motes? } (PIECES in src/icon.js); NULL: the kit's own
