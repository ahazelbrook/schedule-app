-- Migration 0002: the rules wiki (RULES.md). The text of the rulebooks is imported by the GM from their own PC
-- into this table; it is never committed to git and never part of the /api/export backup.
-- Every statement is IF NOT EXISTS, as in 0001.

-- One row per entry (a section of a rulebook file, or a house rule written in the app), per campaign.
-- book: 'b68' (Blades '68), 'bitd' (Blades in the Dark) or 'house'. trail: the heading path, "Folder > File > H1".
-- keys: extra search words (the note's frontmatter title and aliases), one per line. src: the source file path.
CREATE TABLE IF NOT EXISTS rules (
  campaign TEXT NOT NULL DEFAULT 'default',
  book TEXT NOT NULL CHECK (book IN ('b68', 'bitd', 'house')),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  trail TEXT NOT NULL DEFAULT '',
  keys TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0,
  src TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign, book, slug)
);
CREATE INDEX IF NOT EXISTS rules_campaign_book_ord ON rules (campaign, book, ord);
