-- A hit's `day` is Madrid's, no longer UTC's (src/clock.js): the hits kept so far get theirs again,
-- from their own `ts`. Madrid is UTC+2 from the last Sunday of March to the last Sunday of
-- October (both at 01:00 UTC; 'weekday 0' from the 25th lands on that Sunday), UTC+1 the rest of
-- the year. Nothing new is stored; run again, it gives the same days.

UPDATE hits SET day = date(ts + CASE
    WHEN ts >= CAST(strftime('%s', date(strftime('%Y', ts, 'unixepoch') || '-03-25', 'weekday 0')) AS INTEGER) + 3600
     AND ts <  CAST(strftime('%s', date(strftime('%Y', ts, 'unixepoch') || '-10-25', 'weekday 0')) AS INTEGER) + 3600
    THEN 7200 ELSE 3600 END, 'unixepoch');
