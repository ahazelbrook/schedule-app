-- D1 schema for the hosted build (see HOSTING.md, "Database"): the whole schema as it stands.
-- Applied through migrations/ (migrations/0001_init.sql holds these same statements; later changes
-- go in new numbered files there, and here):
--   production: npx wrangler d1 migrations apply DB --remote   (scripts/deploy.sh does this)
--   local:      npm run db:local
-- The API also runs these CREATE ... IF NOT EXISTS statements lazily (once per isolate), so a
-- fresh database works, and applying the migration to a database made from this file is harmless.

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL DEFAULT 'default',
  owner TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS characters_campaign_updated ON characters (campaign, updated_at);

-- Everyone who has called /api/me, so the GM table can show names.
CREATE TABLE IF NOT EXISTS members (
  email TEXT PRIMARY KEY,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'player',
  last_seen TEXT NOT NULL
);

-- One shared campaign document per campaign (id = the CAMPAIGN binding), see CAMPAIGN.md.
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);

-- The rules wiki (RULES.md; migrations/0002_rules.sql). Imported by the GM, never in git, never in /api/export.
-- book: 'b68' | 'bitd' | 'house'. trail: the heading path, "Folder > File > H1". keys: extra search words, one per line.
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
-- The cast (migrations/0003_npcs.sql): NPCs the GM writes. A player is sent only the revealed ones, without gmNotes (CAST.md).
CREATE TABLE IF NOT EXISTS npcs (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS npcs_campaign_updated ON npcs (campaign, updated_at);

-- Seed: the first seven NPCs (each doc: name, alias, role, faction, description, spec = a figure kit
-- spec, revealed, firstSeen, tags, gmNotes).

INSERT OR IGNORE INTO npcs (id, campaign, created_at, updated_at, deleted, doc)
VALUES ('npc_brackley', 'default', '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0,
  '{"name":"Brackley","alias":"","role":"Barge man","faction":"","description":"Big walrus moustache, an army coat with the patches cut off, and a barge that smells of the city''s rubbish. Writes everything down in duplicate.","spec":{"id":"brackley","name":"Brackley","plate":"Brackley","code":"NPC-968-0101","halo":"file-500","heightIn":70,"shape":"rect","heads":7.3,"build":1.12,"skin":"flushed","age":58,"pose":{"stance":"easy","weight":"L","arms":{"R":"hold","L":"pocket"},"head":{"tilt":-3}},"head":{"shape":"square","jaw":1.1},"face":{"eyes":"hooded","brows":"bushy","nose":"broad","mouth":"neutral","expression":"wary","ageStyle":"weathered","facialHair":{"type":"moustache","color":"cloth-ash","grey":"cloth-white"}},"hair":{"style":"short","color":"cloth-ash","grey":"cloth-white","hat":{"type":"flat-cap","color":"cloth-olive"}},"outfit":{"base":{"type":"shirt","color":"cloth-khaki","collar":"open"},"outer":{"type":"field-jacket","color":"cloth-olive","epaulettes":false,"open":true},"bottom":{"type":"trousers","color":"cloth-brown"},"feet":{"type":"combat-boots","color":"cloth-black"}},"props":[{"type":"book","side":"R","color":"cloth-brown"},{"type":"flies","count":3}]},"revealed":false,"firstSeen":null,"tags":[],"gmNotes":""}');

INSERT OR IGNORE INTO npcs (id, campaign, created_at, updated_at, deleted, doc)
VALUES ('npc_grunt', 'default', '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0,
  '{"name":"Grunt","alias":"","role":"","faction":"","description":"A man in a rubber apron, sleeves rolled to the elbow. His forearms are a map of old bites.","spec":{"id":"grunt","name":"Grunt","plate":"Grunt","code":"NPC-968-0102","halo":"alarm-500","heightIn":73,"shape":"invtri","heads":7.4,"build":1.15,"skin":"tan","age":40,"body":{"type":"muscular"},"pose":{"stance":"square","arms":{"R":"down","L":"down"}},"head":{"shape":"wedge"},"face":{"eyes":"deepset","brows":"heavy","nose":"broken","mouth":"grim","expression":"stern","facialHair":{"type":"five-oclock","color":"cloth-charcoal"}},"hair":{"style":"buzz","color":"cloth-charcoal"},"outfit":{"base":{"type":"tee","color":"cloth-ash","sleeves":"rolled"},"mid":{"type":"apron","color":"cloth-petrol","length":"calf"},"bottom":{"type":"trousers","color":"cloth-charcoal"},"feet":{"type":"combat-boots","color":"cloth-black"}},"props":[]},"revealed":false,"firstSeen":null,"tags":[],"gmNotes":""}');

INSERT OR IGNORE INTO npcs (id, campaign, created_at, updated_at, deleted, doc)
VALUES ('npc_karla', 'default', '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0,
  '{"name":"Karla","alias":"","role":"","faction":"","description":"Cardigan, reading glasses pushed up into her hair, a biro behind one ear. Her desk is buried in folders, every stack squared off. She looks delighted to see you, Booker, and a little underslept.","spec":{"id":"karla","name":"Karla","plate":"Karla","code":"NPC-968-0103","halo":"caution-500","heightIn":65,"figure":"fem","shape":"pear","heads":7.4,"build":1,"skin":"fair","age":38,"pose":{"stance":"easy","weight":"R","arms":{"R":"hold","L":"hip"},"head":{"tilt":5,"yaw":8}},"head":{"shape":"round"},"face":{"eyes":"round","brows":"arched","nose":"button","mouth":"full","expression":"smile","marks":[{"type":"freckles"}]},"hair":{"style":"bun","color":"cloth-brown"},"outfit":{"base":{"type":"blouse","color":"cloth-cream"},"mid":{"type":"cardigan","color":"cloth-sage"},"bottom":{"type":"a-line-skirt","color":"cloth-charcoal"},"legs":{"type":"tights","color":"cloth-charcoal"},"feet":{"type":"mary-janes","color":"cloth-black"}},"props":[{"type":"book","side":"R","color":"cloth-tan"}]},"revealed":false,"firstSeen":null,"tags":[],"gmNotes":""}');

INSERT OR IGNORE INTO npcs (id, campaign, created_at, updated_at, deleted, doc)
VALUES ('npc_fellows', 'default', '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0,
  '{"name":"Major Fellows","alias":"","role":"Army officer","faction":"","description":"An officer in a uniform pressed sharp enough to cut, every button done up, with a closed folder in front of him and a fountain pen beside it. He stands when you come in, and waits until you''ve sat.","spec":{"id":"fellows","name":"Major Fellows","plate":"Fellows · M.","code":"NPC-968-0104","halo":"covert-500","heightIn":72,"shape":"lanky","heads":7.6,"build":0.95,"skin":"fair","age":45,"pose":{"stance":"square","arms":{"R":"hold","L":"down"}},"head":{"shape":"long"},"face":{"eyes":"narrow","brows":"straight","nose":"straight","mouth":"thin","expression":"stern","facialHair":{"type":"pencil","color":"cloth-chocolate"}},"hair":{"style":"crew","color":"cloth-chocolate","grey":"cloth-ash"},"outfit":{"base":{"type":"shirt","color":"cloth-white"},"neck":{"type":"tie","color":"cloth-black"},"outer":{"type":"watch-tunic","color":"cloth-khaki","badge":false,"open":false},"bottom":{"type":"trousers","color":"cloth-khaki"},"feet":{"type":"oxfords","color":"cloth-black"}},"props":[{"type":"book","side":"R","color":"cloth-ochre"}]},"revealed":false,"firstSeen":null,"tags":[],"gmNotes":""}');

INSERT OR IGNORE INTO npcs (id, campaign, created_at, updated_at, deleted, doc)
VALUES ('npc_mira', 'default', '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0,
  '{"name":"Mira","alias":"","role":"Owner","faction":"The Undertow","description":"Runs the Undertow, a club in a drained swimming baths, the tiles sweating, the band playing down in the deep end. Mira''s behind the bar at the shallow end, in a dress cut for business, keys at her belt. She saw you before you saw her.","spec":{"id":"mira","name":"Mira","plate":"Mira","code":"NPC-968-0105","halo":"swing-500","heightIn":67,"figure":"fem","shape":"hourglass","heads":7.8,"build":1,"skin":"olive","age":36,"pose":{"stance":"easy","weight":"L","arms":{"R":"hip","L":"down"},"head":{"tilt":-4,"yaw":-10}},"head":{"shape":"heart"},"face":{"eyes":"upturned","brows":"arched","nose":"straight","mouth":"pout","expression":"cool","makeup":{"type":"classic","lips":"cloth-oxblood"}},"hair":{"style":"beehive","color":"cloth-black"},"outfit":{"dress":{"type":"shift-dress","color":"cloth-petrol"},"waist":{"type":"chain-belt","color":"metal-brass","at":"hip"},"legs":{"type":"tights","color":"cloth-charcoal"},"feet":{"type":"heels","color":"cloth-black"}},"props":[]},"revealed":false,"firstSeen":null,"tags":[],"gmNotes":""}');

INSERT OR IGNORE INTO npcs (id, campaign, created_at, updated_at, deleted, doc)
VALUES ('npc_skinner', 'default', '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0,
  '{"name":"Skinner","alias":"","role":"","faction":"","description":"Under the skull, on a crate, sits a slight man in a fisherman''s jumper with a knife across his knees. It''s black, and it doesn''t shine.","spec":{"id":"skinner","name":"Skinner","plate":"Skinner","code":"NPC-968-0106","halo":"ink-700","heightIn":64,"shape":"column","heads":7.2,"build":0.88,"skin":"pale","age":44,"body":{"type":"bony"},"pose":{"stance":"square","arms":{"R":"hold","L":"hold"},"head":{"tilt":4}},"head":{"shape":"long"},"face":{"eyes":"heavy","brows":"straight","nose":"hooked","mouth":"thin","expression":"wary","ageStyle":"lines"},"hair":{"style":"balding","color":"cloth-graphite"},"outfit":{"base":{"type":"knit","color":"cloth-cream","cable":true},"bottom":{"type":"trousers","color":"cloth-navy"},"feet":{"type":"combat-boots","color":"cloth-black"}},"props":[]},"revealed":false,"firstSeen":null,"tags":[],"gmNotes":""}');

INSERT OR IGNORE INTO npcs (id, campaign, created_at, updated_at, deleted, doc)
VALUES ('npc_zam', 'default', '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0,
  '{"name":"Zam","alias":"","role":"","faction":"","description":"A kid in a man''s jacket with the sleeves rolled four times, sitting on the bonnet of a car that isn''t his. Odd shoes. A bunch of other people''s keys clipped to his belt.","spec":{"id":"zam","name":"Zam","plate":"Zam","code":"NPC-968-0107","halo":"signal-500","heightIn":56,"shape":"column","heads":6.6,"build":0.85,"skin":"brown","age":13,"pose":{"stance":"wide","arms":{"R":"pocket","L":"hip"},"head":{"tilt":-6,"yaw":8}},"head":{"shape":"round"},"face":{"eyes":"round","brows":"arched","nose":"button","mouth":"wide","expression":"smirk"},"hair":{"style":"afro","color":"cloth-black"},"outfit":{"base":{"type":"tee","color":"cloth-mustard"},"outer":{"type":"suit-jacket","color":"cloth-warm-grey","open":true,"ease":0.12},"bottom":{"type":"trousers","color":"cloth-brown"},"waist":{"type":"chain-belt","color":"metal-steel","at":"hip"},"feet":{"type":"sneakers","color":"cloth-red"}},"props":[]},"revealed":false,"firstSeen":null,"tags":[],"gmNotes":""}');

-- The GM tools (migrations/0004_gm.sql, GM.md): GM only, never in git, never in /api/export. The GM state document is the
-- `campaigns` row '<CAMPAIGN>#gm'. gm_pack: the generators' tables, one row per part (version = a short hash of body,
-- updated_at in ms). gm_display: what the table's display shows (seq goes up on every write).
CREATE TABLE IF NOT EXISTS gm_pack (
  campaign TEXT NOT NULL,
  part TEXT NOT NULL,
  version TEXT NOT NULL,
  src TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (campaign, part)
);
CREATE TABLE IF NOT EXISTS gm_display (
  campaign TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);

-- A display name a member chose for themselves (migrations/0005_member_name.sql). Not IF NOT EXISTS: SQLite has none for
-- ADD COLUMN, so run schema.sql once on a database that does not have the column yet.
ALTER TABLE members ADD COLUMN name_override TEXT;

-- The ambient scenes' document (migrations/0006_gm_ambient.sql): what plays on the table display when nothing is
-- spotlit (seq goes up on every write). GM only, never in /api/export.
CREATE TABLE IF NOT EXISTS gm_ambient (
  campaign TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);

-- 0007: the table iPad's transcriber (GM.md "Listening")
-- The lines the iPad heard, in order. seq is per campaign; id is the iPad's own, so a resend is skipped.
CREATE TABLE IF NOT EXISTS gm_transcript (
  campaign TEXT NOT NULL,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  session TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  conn TEXT NOT NULL DEFAULT '',
  speaker INTEGER,
  kind TEXT NOT NULL DEFAULT 'line',
  text TEXT NOT NULL,
  PRIMARY KEY (campaign, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS gm_transcript_id ON gm_transcript (campaign, id);

-- The control document, one row per campaign: { want, session, speakers, status }.
CREATE TABLE IF NOT EXISTS gm_stt (
  campaign TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);

-- 0008: Claude at the table (the assist build plan)
CREATE TABLE IF NOT EXISTS gm_assist_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign TEXT NOT NULL DEFAULT 'default',
  at TEXT NOT NULL,
  session TEXT NOT NULL DEFAULT '',
  seat TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cents REAL NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '',
  card TEXT
);
CREATE INDEX IF NOT EXISTS gm_assist_log_at ON gm_assist_log (campaign, at);
