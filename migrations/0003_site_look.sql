-- The rest of a site's look, set by its owner from the dashboard's Sites panel: its colour (the
-- pennant, the sign, the banner's band) and how its kit's palette is turned. Site configuration,
-- nothing about a visitor.

ALTER TABLE sites ADD COLUMN tint  INTEGER;  -- which --village-site-N of tokens.css (1..8); NULL: by its place in the list, as before
ALTER TABLE sites ADD COLUMN hue   INTEGER;  -- degrees the kit's palette is turned (0..359); NULL or 0: the kit as it is
ALTER TABLE sites ADD COLUMN shade INTEGER;  -- the palette lightened (+) or darkened (-), -40..40; NULL or 0: as it is
