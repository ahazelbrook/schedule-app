// The demo night (the night rebuild, N0): a local Worker holding one complete INVENTED night, the harness every design check uses.
//
//   npm run demo:night                          boot on http://127.0.0.1:8890 with a fresh temp state, seed the night, print the URLs, and wait (Ctrl+C stops it)
//   npm run demo:night -- --port 8901           another port (the inspector takes port + 20000)
//   npm run demo:night -- --state <dir>         keep the state in <dir> between runs: seeded once, then reused (--reseed seeds it again)
//   npm run demo:night -- --shots <dir>         seed, take every scenario's screenshot (scripts/demo-night-shots.mjs) into <dir>, and exit
//   npm run demo:night -- --shots <dir> --only gm-plan,phone-nell     only the scenarios whose names start with one of these
//   npm run demo:night -- --shots <dir> --fingerprint   also write each scenario's layout fingerprint (<name>-<width>.json) and the requests-<screen>.json files (scripts/kit-fingerprint.mjs)
//   npm run demo:night -- --shots <dir> --kit desk,stage,phone,who,pitches   turn those of the kit's five settings on first (--kit none writes all five off; omitted, nothing is written)
//   npm run demo:night -- --shots <dir> --theme paper|night   the look the pages open in (the theme key a device would hold; omitted, the page follows the device as it does today)
//   Screenshots need Playwright: PW_MODULE=<path to playwright or playwright-core> and, on Windows, PW_CHANNEL=msedge.
//
// It runs the Worker exactly as the e2e checks do: `wrangler d1 migrations apply --local` into the state folder, then `wrangler dev` on loopback with
// DEV_USER and GM_EMAILS gm@example.test (the dev Worker honours an X-Dev-User header on loopback, functions/_lib/auth.js, so one browser can be any member).
// No model, no network beyond loopback, nothing deployed. The Anthropic keys are taken out of the environment the Worker starts with.
//
// THE NIGHT (everything invented; anything the players must not see carries a GM-ONLY- marker):
//   the pack       console, campaign (PCs, NPC cards, world clocks), prep, location (the Pelican Rooms, an authored v2 site drawn with map kit 1), score,
//                  scenes, npc, downtime (invented Benefits and Mishaps), trouble (invented tables), screen; the fixture rules in the rules table
//   the table      the Dovetail Crew: Nell Arbuthnot (player1), Ray Okonjo (player2), Tam Petrakis (player3), with Stress, harm and keys (Nell's KEY-1 at
//                  three hits); a visible table clock and the site's hidden alarm clock
//   the cast       Mabel Quist, Dov Kessler, Ada Vell, Lotte Brand revealed (Tell:, Signature:, Relation: in their GM notes; tags major / recurring),
//                  two hidden people with GM-ONLY- names (the prep note's cue 6 reveals one of them: after it, a secrecy scan of the iPad or a phone finds GM-ONLY- text by design)
//   the prep note  start 19:30, curfew 22:40, a run order through the four phases, the sections the places open at (Before the night, Tonight, Titles,
//                  Open, Downtime, Briefing, Gather information, Score, Rooms with a ### per room, Cues, Close) and a security line
//   the GM state   the Pelican Rooms on the Location card, the Run view's night started at 21:45 with the crew placed
//   the docs       a front page, two players' opportunity posts, a debrief, a quiet-line message and an absent packet
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPrep } from './lib/prep-export.mjs';
import { buildScreen } from './lib/screen-export.mjs';
import { basenames } from './lib/vault.mjs';
import { kitIds, setKit } from './kit-fingerprint.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- arguments ---------- */
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes('--' + name);
if (flag('help') || flag('h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0); }
const PORT = Number(opt('port', 8890));
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 45000) { console.error('--port must be a port number (1024 to 45000)'); process.exit(2); }
const STATE = opt('state', '');
const SHOTS = opt('shots', '');
const KIT = opt('kit', '');
const THEME = opt('theme', '');
const FINGERPRINT = flag('fingerprint');
if (THEME && !/^(paper|night)$/.test(THEME)) { console.error('--theme must be paper or night'); process.exit(2); }
const ONLY = opt('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const BASE = 'http://127.0.0.1:' + PORT;

const USERS = { GM: 'gm@example.test', IPAD: 'table.ipad@example.test', P1: 'player1@example.test', P2: 'player2@example.test', P3: 'player3@example.test' };
const { GM, IPAD, P1, P2, P3 } = USERS;

/* ---------- the invented night ---------- */
const SITE = 'The Pelican Rooms';
const NOW = new Date().toISOString();
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const conFix = fx('console-pack.json'), locFix = fx('location-pack.json'), npcFix = fx('npc-pack.json'), scoreFix = fx('score-pack.json'), scenesFix = fx('scenes-pack.json');
const KIT1 = fx('pelican-kit1.json').patch;
const BASE_FIGURE = (() => { const src = readFileSync(path.join(ROOT, 'app', 'core.js'), 'utf8'); const m = /var BASE_FIGURE = (\{[\s\S]*?props: \[\] \});/.exec(src); return m ? Function('return ' + m[1])() : {}; })();
const figure = (o) => { const s = JSON.parse(JSON.stringify(BASE_FIGURE)); for (const [k, v] of Object.entries(o)) s[k] = v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object' ? { ...s[k], ...v } : v; return s; };

/* the PCs: the Dovetail Crew */
const PCS = [
  { id: 'pc-nell', owner: P1, name: 'Nell Arbuthnot', alias: 'Nettle', playbook: 'hound', playbookName: 'Hound', stress: 4, harm: { l1: ['Bruised ribs', ''], l2: ['', ''], l3: '' },
    keys: [{ name: 'KEY-1', down: 'Takes the long way round', up: 'Never lets go of a scent', hits: 3 }, { name: 'KEY-2', down: 'Trusts the wrong voice', up: 'Hears the lie first', hits: 1 }],
    dots: { Hunt: 2, Survey: 1, Consort: 2, Prowl: 1 }, vice: 'Gambling', purveyor: 'The late table at the Pelican Rooms', background: 'Trade',
    spec: { figure: 'fem', skin: 'olive', heightIn: 65, age: 31, hair: { style: 'bun', color: 'cloth-chocolate' }, outfit: { base: { type: 'turtleneck', color: 'cloth-cream' }, outer: { type: 'trench', color: 'cloth-tan' } } } },
  { id: 'pc-ray', owner: P2, name: 'Ray Okonjo', alias: '', playbook: 'operative', playbookName: 'Operative', stress: 2, harm: { l1: ['', ''], l2: ['Cut hand', ''], l3: '' },
    keys: [{ name: 'KEY-1', down: 'Keeps the old debt', up: 'Pays it forward', hits: 2 }],
    dots: { Finesse: 2, Prowl: 2, Study: 1, Sway: 1 }, vice: 'Luxury', purveyor: 'A dressmaker on the quay', background: 'Military',
    spec: { skin: 'deep', heightIn: 72, age: 38, hair: { style: 'crew', color: 'cloth-black' }, outfit: { outer: { type: 'leather-jacket', color: 'cloth-black' } } } },
  { id: 'pc-tam', owner: P3, name: 'Tam Petrakis', alias: 'Tink', playbook: 'swinger', playbookName: 'Swinger', stress: 6, harm: { l1: ['', ''], l2: ['', ''], l3: '' },
    keys: [{ name: 'KEY-1', down: 'Sings the wrong song', up: 'Sings the right one', hits: 1 }, { name: 'KEY-2', down: 'Forgets a face', up: 'Remembers every face', hits: 0 }],
    dots: { Consort: 2, Sway: 2, Finesse: 1, Attune: 1 }, vice: 'Pleasure', purveyor: 'The bandstand at the Pelican Rooms', background: 'Performer',
    spec: { skin: 'fair', heightIn: 69, age: 26, hair: { style: 'mod-mop', color: 'cloth-tan' }, outfit: { base: { type: 'knit', color: 'cloth-ochre' }, outer: { type: 'blazer', color: 'cloth-sea' } } } }
];

/* the cast: four revealed, two hidden */
const notes = (tell, sig, rel, more) => 'GM-ONLY-NOTE ' + more + '\nTell: ' + tell + '\nSignature: ' + sig + '\nRelation: ' + rel + '\n';
const NPCS = [
  { id: 'npc-mabel', name: 'Mabel Quist', alias: 'Mab', role: 'The house', faction: 'The Pelican Rooms', tags: ['major', 'recurring'], revealed: true, firstSeen: '2030-01-04T20:10:00.000Z',
    description: 'Runs the Pelican Rooms and every table in it.', gmNotes: notes('smirk', 'lapel', 'society', 'she owes the house more than she lets on'),
    spec: { figure: 'fem', skin: 'porcelain', heightIn: 66, age: 47, hair: { style: 'beehive', color: 'cloth-chocolate' }, outfit: { base: { type: 'shirt', color: 'cloth-white' }, outer: { type: 'double-breasted', color: 'cloth-oxblood' } } } },
  { id: 'npc-dov', name: 'Dov Kessler', alias: '', role: 'House security', faction: 'The Pelican Rooms', tags: ['recurring'], revealed: true, firstSeen: '2030-01-04T20:25:00.000Z',
    description: 'Watches the doors and the people near them.', gmNotes: notes('tired', 'cross', 'staff', 'takes a bribe once, never twice'),
    spec: { skin: 'tan', heightIn: 74, age: 44, hair: { style: 'buzz', color: 'cloth-graphite' }, outfit: { outer: { type: 'peacoat', color: 'cloth-charcoal' } } } },
  { id: 'npc-ada', name: 'Ada Vell', alias: '', role: 'Croupier', faction: 'The Pelican Rooms', tags: ['recurring'], revealed: true, firstSeen: '2030-01-11T21:05:00.000Z',
    description: 'Deals the high table and hears everything said over it.', gmNotes: notes('wary', 'hip', 'suspect', 'deals seconds when the house tells her to'),
    spec: { figure: 'fem', skin: 'brown', heightIn: 63, age: 29, hair: { style: 'bowl-bob', color: 'cloth-black' }, outfit: { base: { type: 'shirt', color: 'cloth-cream' }, outer: { type: 'blazer', color: 'cloth-charcoal' } } } },
  { id: 'npc-lotte', name: 'Lotte Brand', alias: '', role: 'Doorwoman', faction: 'The Pelican Rooms', tags: ['major'], revealed: true, firstSeen: '2030-01-11T20:40:00.000Z',
    description: 'Decides who comes in, and remembers them.', gmNotes: notes('flat', 'lean', 'resident', 'keeps a list of every face'),
    spec: { figure: 'fem', skin: 'fair', heightIn: 70, age: 52, hair: { style: 'short', color: 'cloth-brown' }, outfit: { outer: { type: 'cape-coat', color: 'cloth-black' } } } },
  { id: 'npc-hidden-partner', name: 'GM-ONLY-Silent Partner', alias: '', role: 'GM-ONLY-ROLE', faction: 'GM-ONLY-FACTION', tags: ['major'], revealed: false,
    description: 'GM-ONLY-DESCRIPTION', gmNotes: 'GM-ONLY-NOTE the money behind the house\nTell: still\nSignature: cross\nRelation: foreign\n', spec: { heightIn: 71, age: 60, hair: { style: 'slick-back', color: 'ink-300' } } },
  { id: 'npc-hidden-clerk', name: 'GM-ONLY-Night Clerk', alias: '', role: 'GM-ONLY-ROLE-2', faction: '', tags: [], revealed: false,
    description: 'GM-ONLY-DESCRIPTION-2', gmNotes: 'GM-ONLY-NOTE keeps the second ledger\nTell: blink\n', spec: { heightIn: 67, age: 35 } }
];

/* the site: the Pelican Rooms, map kit 1 (the kit's fixture patch) with a v2 play block of our own people */
const ROOMS = KIT1.rooms.map((r) => r.name);
const ALARM = 'House alarm';
const PLAY = {
  v: 2,
  clock: { start: '21:00', end: '01:00', beat: 15, label: 'Gala night', starts: { 6: '21:30', crit: '21:00', '4/5': '21:45', '1-3': '22:00' }, countdown: { at: '00:30', label: 'Last ferry' } },
  floors: { 0: 'Ground', 1: 'Upper', 2: 'Loft', '-1': 'Under' },
  zones: [
    { id: 'floor', label: 'The floor', rooms: ['Showroom', 'Cocktail lounge'], pub: 'Where the guests are' },
    { id: 'back', label: 'Back of house', rooms: ['Underground counting room', 'Security control room'], pub: 'Staff only' },
    { id: 'cards', label: 'The card rooms', rooms: ['Private card rooms'], pub: 'High stakes' },
    { id: 'loft', label: 'The loft', rooms: ['Luxury penthouse'], pub: 'Private rooms upstairs' }
  ],
  routes: [
    { id: 'lift', from: 'Cocktail lounge', to: 'Luxury penthouse', via: 'GM-ONLY-VIA-LIFT', dir: 'up', needs: 'GM-ONLY-NEEDS-KEY', watched: true },
    { id: 'trap', from: 'Underground counting room', to: 'Showroom', via: 'GM-ONLY-VIA-TRAP', pub: 'A trapdoor from the counting room into the showroom', dir: 'both', open: [{ from: '23:00', to: '00:00' }] }
  ],
  people: [
    { id: 'mq', label: 'Mabel Quist', kind: 'target', stops: [{ at: '21:00', room: 'Showroom', note: 'GM-ONLY-STOP-1' }, { at: '23:30', room: 'Private card rooms', note: 'GM-ONLY-STOP-2' }, { at: '00:15', room: 'Luxury penthouse', note: 'GM-ONLY-STOP-3', private: true }] },
    { id: 'dk', label: 'Dov Kessler', kind: 'guard', look: 'A broad man in a charcoal peacoat', wary: 'GM-ONLY-WARY-1', note: 'GM-ONLY-NOTE-DK', stops: [{ at: '21:00', with: 'mq' }, { at: '23:00', room: 'Security control room' }, { at: '23:30', with: 'mq' }] },
    { id: 'av', label: 'Ada Vell', kind: 'staff', look: 'A croupier in a charcoal blazer', wary: 'GM-ONLY-WARY-2', stops: [{ at: '21:00', room: 'Private card rooms' }, { at: '00:00', room: 'Underground counting room' }] },
    { id: 'lb', label: 'Lotte Brand', kind: 'staff', look: 'A tall woman in a black cape coat at the door', stops: [{ at: '21:00', room: 'Cocktail lounge' }] },
    { id: 'gx', label: 'GM-ONLY-PERSON-1', kind: 'rival', stops: [{ at: '21:00', room: 'Security control room' }, { at: '00:30', gone: true }] }
  ],
  disguises: [
    { id: 'guest', label: 'Guest', icon: 'mask', home: ['floor'], risky: ['cards'], sees: [], get: 'GM-ONLY-GET-1' },
    { id: 'staff', label: 'Staff', icon: 'tray', home: ['back'], risky: ['floor'], sees: ['av'], get: 'GM-ONLY-GET-2' },
    { id: 'guard', label: 'Guard', icon: 'jacket', home: ['floor', 'back'], risky: ['cards', 'loft'], sees: ['dk'], get: 'GM-ONLY-GET-3' }
  ],
  items: [{ id: 'key', label: 'A brass key', pub: 'Opens the service lift', lift: [{ zone: 'loft', to: 'risky' }] }],
  events: [
    { at: '22:00', id: 'sp', label: 'GM-ONLY-EVENT-1', room: 'Showroom', vis: 'public', pub: 'The speeches', say: 'GM-ONLY-SAY-1' },
    { at: '23:30', id: 'cr', label: 'GM-ONLY-EVENT-2', room: 'Private card rooms', vis: 'hidden', pub: 'Mabel at the card tables' },
    { at: '00:00', id: 'fw', label: 'GM-ONLY-EVENT-3', room: 'Showroom', vis: 'public', fx: 'dawn', pub: 'The fireworks' },
    { at: '00:30', id: 'sh', label: 'GM-ONLY-EVENT-4', room: 'Private card rooms', vis: 'hidden', rival: true, pub: 'A shout in the card rooms' }
  ],
  ways: [
    { id: 'A', name: 'GM-ONLY-WAY-1', pubName: 'The Last Hand', kind: 'quiet', window: { at: '23:30', until: '00:15', room: 'Private card rooms', pub: 'Late, at the cards', told: 'cr' },
      lead: { line: 'She never leaves a table while she is winning.', who: 'GM-ONLY-WHO-1', room: 'Cocktail lounge', from: '21:00', to: '23:00' }, steps: ['A seat at her table', 'Make her lose'], cost: 'GM-ONLY-COST-1', note: 'GM-ONLY-NOTE-W1' },
    { id: 'B', name: 'GM-ONLY-WAY-2', pubName: 'Going Up', kind: 'loud', window: { at: '00:15', room: 'Luxury penthouse', pub: 'After midnight, upstairs' },
      lead: { line: 'The lift key hangs on a hook in the counting room.', who: 'GM-ONLY-WHO-2', room: 'Underground counting room', from: '21:00', to: '00:00' }, steps: ['The key', 'The lift'], needs: ['key'], cost: 'GM-ONLY-COST-2', note: 'GM-ONLY-NOTE-W2' }
  ],
  intel: [
    { id: 'I1', text: 'The programme: speeches at ten, fireworks at midnight', from: 'GM-ONLY-FROM-1', reveals: { events: ['sp', 'fw'] } },
    { id: 'I2', text: 'Mabel plays cards at half past eleven', from: 'GM-ONLY-FROM-2', reveals: { events: ['cr'], ways: ['A'] } },
    { id: 'I3', text: 'A trapdoor opens between the counting room and the showroom at eleven', from: 'GM-ONLY-FROM-3', reveals: { routes: ['trap'] } },
    { id: 'I4', text: 'Someone else moves at half past twelve', from: 'GM-ONLY-FROM-4', reveals: { events: ['sh'] } }
  ],
  alarm: { clock: ALARM, beats: ['GM-ONLY-BEAT-1', 'GM-ONLY-BEAT-2', 'GM-ONLY-BEAT-3', 'GM-ONLY-BEAT-4', 'GM-ONLY-BEAT-5', 'GM-ONLY-BEAT-6'],
    pub: ['A door slams', 'Someone is looking', 'The lift is guarded', 'Staff are being checked', 'Mabel looks nervous', 'Lockdown'], ticks: [{ why: 'GM-ONLY-WHY-1', by: 1 }],
    at: { 5: 'skip-private', 6: 'lockdown' }, lockdown: { room: 'Security control room' } },
  entries: [{ id: 'front', label: 'GM-ONLY-ENTRY-1', room: 'Cocktail lounge', disguise: 'guest', know: 'free', note: 'GM-ONLY-NOTE-ENTRY' }],
  exits: [{ id: 'lift', label: 'GM-ONLY-EXIT-1', from: 'Luxury penthouse', note: 'GM-ONLY-NOTE-EXIT' }],
  secret: ['GM-ONLY-SECRET-1']
};

/* the campaign part (GM-only pack data): the PCs, NPC cards, world clocks, standing */
const CAMPAIGN_PART = {
  pcs: PCS.map((p) => ({ name: p.name, first: p.name.split(' ')[0], playbook: p.playbookName, insight: 1, prowess: 1, resolve: 1, wont: ['leave a friend behind'], vice: [p.vice.toLowerCase()], friend: ['Lotte Brand'], rival: ['Dov Kessler'], extra: [], keyPressure: [] })),
  callbacks: [{ text: 'Lotte Brand still has the crew\'s names on her list', src: 'the last night at the Pelican Rooms' }, { text: 'Ray owes a dressmaker on the quay', src: '' }],
  cast: [{ text: 'The Pelican Rooms', src: 'the house' }],
  standing: [{ faction: 'The Pelican Rooms', status: -1 }, { faction: 'The Quay Porters', status: 1 }],
  owed: [{ text: 'A favour to Ada Vell', src: 'Tam, last session' }],
  npcs: NPCS.filter((n) => n.revealed).map((n) => ({ name: n.name, role: n.role, faction: n.faction, district: 'Nowhere Ward', glance: n.description, say: ['"The house always pays, eventually."'], playedBy: '', mannerism: 'taps the table twice' })),
  names: { first: ['Ines', 'Rolf', 'Bea', 'Otto'], family: ['Marlow', 'Pike', 'Venn'] },
  clocks: [
    { name: 'The house calls in its debts', goal: 'every marker paid by spring', faction: 'The Pelican Rooms', tier: 2, district: 'Nowhere Ward', segments: 8, filled: 3, beats: ['GM-ONLY-B1', 'GM-ONLY-B2', 'GM-ONLY-B3', 'GM-ONLY-B4', 'GM-ONLY-B5', 'GM-ONLY-B6', 'GM-ONLY-B7', 'GM-ONLY-B8'], status: 'active' },
    { name: 'The porters\' strike', goal: 'the quay stops for a week', faction: 'The Quay Porters', tier: 1, district: 'Nowhere Ward', segments: 6, filled: 2, beats: ['a', 'b', 'c', 'd', 'e', 'f'], status: 'active' }
  ]
};

/* the downtime part: invented Benefits and Mishaps */
const dt = (lo, hi, band, title, md, play) => ({ lo, hi, band, title, md, play });
const DOWNTIME_PART = { v: 2, T: {
  benefit: [dt(1, 40, '01–40 · Small', 'A round on the house', 'The barman pours one more. *"You look like you need it."* **A friendly face at the bar.**', 'who sent it over?'),
    dt(41, 80, '41–80 · Good', 'A name worth knowing', 'A porter writes a name on a matchbook. *"Ask for him."* **A new contact on the quay.**', 'what does he want back?'),
    dt(81, 100, '81–00 · Big', 'The marker forgiven', 'A clerk tears up a marker in front of you. *"Paid in full."* **Clear one debt.**', 'who paid it?')],
  mishap: [dt(1, 50, '01–50 · Bad', 'Seen at the door', 'Lotte Brand writes something down. *"Evening."* **+1 Heat.**', 'what did she write?'),
    dt(51, 85, '51–85 · Worse', 'A marker called in', 'A note under the door. *"The house would like a word."* **Attract trouble: the house.**', 'go, or not?'),
    dt(86, 100, '86–00 · Silly', 'The wrong coat', '{Host} hands you someone else\'s coat. *"Yours, I think."* **Tapped.**', 'whose coat is it?')],
  vice: { Gambling: { hook: ['A marker comes due at {place}. || The marker at {place} (4)'] } }
} };

/* the trouble part: invented tables */
const TROUBLE_PART = { checks: [
  { id: 'heat', label: 'Heat check', prompt: 'Roll the crew\'s heat die.', die: 'd6', entries: [{ lo: 1, hi: 3, title: 'Quiet', md: 'Nothing follows the crew home.' }, { lo: 4, hi: 5, title: 'Questions', md: 'Someone at the Pelican Rooms is asking about the crew.' }, { lo: 6, hi: 6, title: 'A visitor', md: 'Dov Kessler calls at the lair, hat in hand.' }] },
  { id: 'rep', label: 'Reputation', prompt: 'Roll for what the street says.', die: 'd6', entries: [{ lo: 1, hi: 3, title: 'Talk', md: 'The quay talks about the gala.' }, { lo: 4, hi: 6, title: 'A song', md: 'A busker sings about the night the lights went out.' }] },
  { id: 'entangle', label: 'Entanglement', prompt: 'Roll on the crew\'s heat.', die: 'd6', entries: [{ lo: 1, hi: 2, title: 'Gang trouble', md: 'The porters want a cut.' }, { lo: 3, hi: 4, title: 'Rivals', md: 'A rival crew claims the job.' }, { lo: 5, hi: 6, title: 'Flipped', md: 'A contact starts asking for more.' }] }
] };

/* the prep note: start, curfew, the run order through the four phases, every section a place opens at, the rooms, the cues and the security line */
const ROOM_NOTES = {
  'Showroom': { costume: 'Evening dress, a guest\'s mask', who: 'Mabel Quist, Dov Kessler', wrong: 'Dov Kessler turns and looks straight at you', say: 'Ladies and gentlemen, the house thanks you. Do enjoy the tables.' },
  'Cocktail lounge': { costume: 'A guest\'s mask, or a waiter\'s white jacket', who: 'Lotte Brand', wrong: 'Lotte Brand checks her list and finds a name missing', say: 'Names, please. Everybody is somebody here.' },
  'Security control room': { costume: 'A guard\'s peacoat', who: 'Dov Kessler', wrong: 'The door locks behind you', say: 'Shift change is at eleven. Nobody comes in before then.' },
  'Private card rooms': { costume: 'Evening dress and a marker from the house', who: 'Ada Vell, Mabel Quist', wrong: 'Ada Vell raises her hand and the table goes quiet', say: 'The house deals. The house always deals.' },
  'Underground counting room': { costume: 'Staff overalls', who: 'Ada Vell', wrong: 'An alarm bell starts to ring upstairs', say: 'Count it twice. Then count it again.' },
  'Luxury penthouse': { costume: 'Nothing works up here: you are expected or you are not', who: 'Mabel Quist', wrong: 'Harm: a fall from the lift shaft', say: 'You found your way up. How very clever of you.' }
};
const PREP_NOTE = [
  '---', 'session: 4', 'date: 07/01/2030', 'status: prep', 'gm_prep: true', '---', '',
  '# Session 4: the Pelican Rooms', '',
  'start: 19:30', 'curfew: 22:40', '',
  '## Before the night', '',
  '- [ ] Charge the iPad and the practical speaker', '- [ ] Print the calling cards for the cast', '- [ ] Open this note on the laptop', '- [ ] Test the cue stack: GO, Bypass, Esc', '',
  '## Tonight', '',
  'The Dovetail Crew go back to [[Mabel Quist]]\'s gala at the Pelican Rooms to win back a marker. Three players; Ray\'s player may be late.', '',
  '## Run order', '',
  '| # | Beat | About |', '|---|---|---|',
  '| 1 | **Doors and the titles** | 10 min |',
  '| 2 | **Personal business** (downtime) | 30 min |',
  '| 3 | **Planning**: the briefing and gather information | 25 min |',
  '| 4 | **The score**: the gala | 90 min |',
  '| 5 | **Aftermath**: payout and heat | 20 min |', '',
  '## Titles', '',
  '> [!quote] SAY', '> Previously: the crew walked out of the Pelican Rooms with a marker they did not win. Tonight the house wants it back.', '',
  '## Open', '',
  'Cold open on the quay: rain, a ferry horn, and [[Lotte Brand]] at the door of the Pelican Rooms with her list.', '',
  '## Downtime', '',
  '- Nell: KEY-1 is at three hits. If she leans on it tonight, offer the turn.', '- Ray: the dressmaker on the quay wants paying.', '- Tam: the bandstand needs a singer for the gala.', '',
  /* a ### per PC with #### scenes under it: the Prep index's second and third levels (T13) */
  '### Nell', '', '#### The late table', '', 'A marker comes due at the late table.', '', '#### The long way round', '', 'She walks the quay before the gala.', '',
  '### Ray', '', '#### The dressmaker', '', 'A fitting, and the bill on the quay.', '',
  '### Tam', '', 'The bandstand wants a singer by nine.', '',
  '## Briefing', '',
  'The marker is in the strongbox in the penthouse. [[Mabel Quist]] carries the lift key until midnight.', '',
  '## Gather information', '',
  '- Ask [[Ada Vell]] about the card rooms: she deals the high table at half past eleven.', '- Ask a porter about the trapdoor under the showroom.', '',
  '## Score', '',
  'The gala runs from nine to one. The house is watching the doors, not the floor.', '',
  'security: Quiet > Watchful > Alert > Hunting > Lockdown', '',
  '## Rooms', '',
  ...ROOMS.flatMap((r) => { const n = ROOM_NOTES[r]; return ['### ' + r, '', '- **Costume:** ' + n.costume, '- **Who:** ' + n.who, '- If it goes wrong: ' + n.wrong, '', '> [!quote] SAY', '> ' + n.say, '']; }),
  '## Cues', '',
  'safe: testcard', '',
  '1. scene: tram', '2. show: title: The Pelican Rooms | A night at the tables', '3. light: House lights down to amber', '4. phase: pb', '5. phase: plan',
  '6. reveal: GM-ONLY-Night Clerk', '7. phase: score', '8. practical: The telephone rings in the lounge', '',
  '## Close', '',
  '- Payout: the marker, and whatever the crew carried out.', '- Heat: the house saw faces tonight.', '- Ask each player for one thing their character noticed.', ''
].join('\n');
const SCREEN_NOTE = ['---', 'gm_screen: true', '---', '', '# The GM screen (demo)', '', '## Position and effect', '', 'Set the position before the dice: controlled, risky or desperate. Set the effect: limited, standard or great.', '',
  '## Consequences', '', 'A 4/5 costs something; a 1–3 costs more. Say what the consequence is before the dice.', '', '## Heat', '', 'Loud work, high-profile targets and bodies add heat. The crew sees it at the Aftermath.', ''].join('\n');
const FRONT_PAGE = ['---', 'masthead: The Quay Courier', 'issue: No. 4', 'date: 8 January', '---', '', '# Lights Out at the Pelican Rooms', '', '> A gala, a blackout and a marker that walked out of the door.', '',
  '## Account', '', 'The lights went out at the Pelican Rooms just after midnight. Guests report a shout from the card rooms and a lift that ran on its own.', '',
  '## Name', '', 'Mabel Quist, who runs the house, says nothing was taken.', '', '## Hook', '', 'Who was in the lift?', '', '## GM notes', '', 'GM-ONLY-FRONTPAGE-NOTE', ''].join('\n');

/* ---------- the Worker ---------- */
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.B68_ANTHROPIC_KEY; delete env.ANTHROPIC_API_KEY;
let server = null, stateDir = '', ownState = false;
function stop() {
  if (server) {
    if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
    server = null;
  }
  if (ownState && stateDir) { try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} }
}
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('\nstopping the demo night'); process.exit(0); });

const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, text: t }; });
async function must(what, p) { const r = await p; if (r.status !== 200) throw new Error(what + ': ' + r.status + ' ' + (r.text || '').slice(0, 300)); return r; }

async function boot() {
  if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or pass --port');
  if (STATE) { stateDir = path.resolve(STATE); mkdirSync(stateDir, { recursive: true }); } else { stateDir = mkdtempSync(path.join(tmpdir(), 'b68-demo-night-')); ownState = true; }
  const persist = path.join(stateDir, 'state');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  let log = '';
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD],
  { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) throw new Error('wrangler exited:\n' + log.slice(-2000));
    try { if ((await fetch(BASE + '/index.html', { signal: AbortSignal.timeout(2000) })).status > 0) return persist; } catch (_) {}
    await sleep(500);
  }
  throw new Error('the Worker did not start on ' + PORT + ':\n' + log.slice(-2000));
}

/* the fixture rules (placeholder prose) as rules rows */
function rulesEntries(book) {
  const dir = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'rules', book), out = [];
  (function walk(d, trail) {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith('.')) continue;
      const f = path.join(d, name);
      if (statSync(f).isDirectory()) { walk(f, trail.concat(name)); continue; }
      if (!name.endsWith('.md')) continue;
      const body = readFileSync(f, 'utf8'), title = (/^# +(.+)$/m.exec(body) || [null, name.replace(/\.md$/, '')])[1].trim();
      const rel = trail.concat(name).join('/');
      out.push({ slug: rel.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80), title, trail: trail.join(' > '), body, ord: out.length, src: rel });
    }
  })(dir, []);
  return out;
}

/* a temp vault for the repo's own exporters (prep and screen), with a page for each cast member so the prep note's links resolve */
function vaultParts() {
  const vault = path.join(stateDir, 'vault'), R = 'Wiki/Games/Blades in the Dark';
  rmSync(vault, { recursive: true, force: true });
  const w = (rel, text) => { const f = path.join(vault, ...rel.split('/')); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
  w(R + '/Campaigns/Demo/Sessions/demo-s04.md', PREP_NOTE);
  w(R + '/demo-gm-screen.md', SCREEN_NOTE);
  for (const n of NPCS.filter((x) => x.revealed)) w(R + '/NPCs/' + n.name + '.md', '# ' + n.name + '\n\n' + n.description + '\n');
  const prep = buildPrep({ vault, repo: ROOT, exportedAt: NOW, basenames: basenames(vault) });
  const screen = buildScreen({ vault, repo: ROOT, exportedAt: NOW });
  if (!prep || !JSON.stringify(prep).includes('## Cues')) throw new Error('the prep exporter did not carry the note');
  if (!screen || !screen.sections || !screen.sections.length) throw new Error('the screen exporter found no sections');
  return { prep, screen };
}

async function seed() {
  const BALL = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
  const checked = BALL.checkPlay(PLAY, ROOMS);
  if (checked.warnings.length) throw new Error('the play block has warnings: ' + checked.warnings.join(' | '));
  const { prep, screen } = vaultParts();
  const src = (file) => ({ file: 'demo/' + file, blockSha: '0', exportedAt: NOW });
  const PARTS = {
    console: { ...conFix.parts.console, src: src('console') },
    campaign: { src: src('campaign'), ...CAMPAIGN_PART },
    prep,
    location: { src: src('location'), T: locFix.T, extra: locFix.extra,
      authored: { v: 1, sites: { [SITE]: { name: SITE, rel: 'demo/' + SITE, map: { view: 'iso', theme: 'rulebook' }, patch: { ...KIT1, name: SITE, district: 'Nowhere Ward' }, play: checked.play } }, bind: {} } },
    score: { ...scoreFix.parts.score, src: src('score') },
    scenes: { ...scenesFix.parts.scenes, src: src('scenes') },
    npc: { ...npcFix.parts.npc, src: src('npc') },
    downtime: { src: src('downtime'), ...DOWNTIME_PART },
    trouble: { src: src('trouble'), ...TROUBLE_PART },
    screen
  };
  for (const [part, p] of Object.entries(PARTS)) {
    const { src: s, ...body } = p;
    await must('pack ' + part, api('POST', '/gm/pack', { part, src: s || {}, body }));
  }
  for (const book of ['b68', 'bitd']) { const entries = rulesEntries(book); if (entries.length) await must('rules ' + book, api('POST', '/rules/import', { book, entries, replace: true })); }

  /* the table: the crew, a table clock the players see and the site's alarm clock, hidden */
  await must('campaign', api('PUT', '/campaign', {
    v: 1, session: { number: 4, startedAt: NOW, endedAt: null },
    crew: { name: 'The Dovetail Crew', type: 'shadows', lair: 'A loft over the ferry office', notes: '', tier: 1, hold: 'strong', rep: 5, turf: 2, heat: 3, wanted: 1, vault: 6, claims: [], cohorts: [],
      factions: [{ name: 'The Pelican Rooms', status: -1 }, { name: 'The Quay Porters', status: 1 }] },
    clocks: [{ id: 'c-alarm', name: ALARM, size: 6, filled: 2, kind: 'danger', hidden: true }, { id: 'c-marker', name: 'Win back the marker', size: 8, filled: 3, kind: 'progress' }],
    log: []
  }));
  /* the PCs, each filed by their own player */
  for (const p of PCS) {
    const doc = { v: 2, name: p.name, alias: p.alias, code: '', playbook: p.playbook, playbookName: p.playbookName,
      spec: figure({ ...p.spec, id: p.id, name: p.name }),
      sheet: { name: p.name, alias: p.alias, playbook: p.playbook, background: p.background, backgroundDetail: '', dots: p.dots, vice: p.vice, purveyor: p.purveyor, keys: p.keys.map((k) => k.name) },
      play: { session: 4, stress: p.stress, harm: p.harm, keys: p.keys, vice: p.vice, purveyor: p.purveyor, contacts: [], clocks: [] } };      /* joined the table's session 4 */
    await must('character ' + p.id, api('PUT', '/characters/' + p.id, doc, p.owner));
  }
  /* the players sign in once, as their phones would: GET /api/me files each as a member (the Absent packet and the Debrief desk list members) */
  for (const u of [P1, P2, P3]) await must('member ' + u, api('GET', '/me', undefined, u));
  /* the cast */
  for (const n of NPCS) {
    const { id, spec, ...rest } = n;
    await must('npc ' + id, api('PUT', '/npcs/' + id, { ...rest, spec: figure({ ...spec, id, name: n.name }) }));
  }
  /* the GM state: the site on the Location card, the Run view's night started at 21:45 with the crew placed; the night has no phase yet */
  await must('gm state', api('PATCH', '/gm/state', {
    cards: { location: { hid: 'h_demo_pelican', auth: SITE, label: SITE + ' · Nowhere Ward', at: NOW } },
    loc: { map: { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: { public: true, working: false, controlled: false, secure: false } } },
    ball: { site: SITE, v: 2, start: 45, t: 45, crew: { 'pc-nell': { room: 'Cocktail lounge', disguise: 'guest' }, 'pc-ray': { room: 'Showroom', disguise: 'guest' }, 'pc-tam': { room: 'Showroom', disguise: 'guest' } } },
    /* the GM's opportunity cards for the planning meeting (the Cards tab) */
    opps: { list: {
      'opp-gm1': { order: 1, from: 'GM', client: 'A porter on the quay', target: 'The house ledger', type: 'Deception', note: 'He wants the house to lose, and will pay to see it', payout: '4 coin' },
      'opp-gm2': { order: 2, from: 'Nell', client: '', target: 'The strongbox in the penthouse', type: 'Burglary', note: 'The marker is inside', payout: '6 coin' }
    } },
    night: null
  }));
  /* the docs: a front page, two opportunity posts, a debrief, a quiet-line message, an absent packet */
  const FP = require(path.join(ROOT, 'app', 'gm', 'frontpage.js')), DB = require(path.join(ROOT, 'app', 'gm', 'debrief.js')), AB = require(path.join(ROOT, 'app', 'gm', 'absent.js'));
  const t = Date.now();
  await must('front page', api('PUT', '/docs', { kind: 'frontpage', owner: '_', scope: 'gm', json: { v: 1, text: FRONT_PAGE, at: t } }));
  await must('opportunity 1', api('PUT', '/docs', { kind: 'opportunity', scope: 'player', json: { v: 1, items: [{ id: 'o1', k: 'target', text: 'The strongbox in the penthouse at the Pelican Rooms', at: t - 86400000 }, { id: 'o2', k: 'client', text: 'A porter who wants the house to lose', at: t - 80000000 }] } }, P1));
  await must('opportunity 2', api('PUT', '/docs', { kind: 'opportunity', scope: 'player', json: { v: 1, items: [{ id: 'o1', k: 'operation', text: 'Swap the house\'s ledger for a forged one', at: t - 70000000 }] } }, P2));
  const debrief = DB.buildRow({ steps: ['unwind', 'xp'], nightAt: t - 20 * 3600000, sentAt: t - 19 * 3600000 });      /* last night's: its card is up this morning */
  await must('debrief', api('PUT', '/docs', { kind: 'debrief', owner: P3, scope: 'player', json: debrief }));
  await must('quiet', api('PUT', '/docs', { kind: 'quiet', scope: 'player', json: { v: 1, items: [{ k: 'note', at: t - 600000, text: 'Can Tam sing at the gala? I have an idea.' }] } }, P2));
  const pcTam = (await api('GET', '/characters/pc-tam', undefined, GM)).json;
  const packet = AB.packet({ recap: 'The crew walked out of the Pelican Rooms with a marker.\nThe house wants it back before the gala ends.\nLotte Brand has your name on her list.',
    fp: FP.parseNote(FRONT_PAGE), npcs: NPCS.map((n) => ({ ...n, spec: undefined })), doc: pcTam && (pcTam.doc || pcTam), before: null, notes: 'Stress is at 6.', now: t });
  if (!packet) throw new Error('the absent packet did not build');
  await must('absent packet', api('PUT', '/docs', { kind: 'packet', owner: P3, scope: 'player', json: packet }));
}

/* ---------- main ---------- */
async function main() {
  const persist = await boot();
  const marker = path.join(stateDir, 'demo-night-seeded.json');
  if (!existsSync(marker) || flag('reseed')) { await seed(); writeFileSync(marker, JSON.stringify({ at: NOW, port: PORT })); console.log('seeded the demo night'); }
  else console.log('reusing the seeded state in ' + stateDir + ' (pass --reseed to seed it again)');
  console.log([
    '',
    'The demo night is up on ' + BASE + ' (state: ' + persist + (ownState ? ', removed on exit' : '') + ')',
    '  GM page        ' + BASE + '/#gm            (you are ' + GM + ')',
    '  display page   ' + BASE + '/#display       (as the GM; the iPad itself signs in as ' + IPAD + ')',
    '  look book      ' + BASE + '/lookbook.html',
    '  cast page      ' + BASE + '/#cast',
    '  a phone        ' + BASE + '/#c/pc-nell at 390x844 with the header X-Dev-User: ' + P1 + '   (Ray: #c/pc-ray as ' + P2 + ', Tam: #c/pc-tam as ' + P3 + ')',
    '                 the dev Worker honours X-Dev-User on loopback only: Playwright extraHTTPHeaders, or a header extension in a browser',
    ''
  ].join('\n'));
  if (SHOTS) {
    const { shoot } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'demo-night-shots.mjs')).href);
    if (opt('kit', null) !== null) await setKit(api, kitIds(KIT));       /* the five settings, written to the GM state and the campaign document before the first page opens */
    const n = await shoot({ base: BASE, dir: path.resolve(SHOTS), only: ONLY, api, users: USERS, site: SITE, theme: THEME, fingerprint: FINGERPRINT });
    console.log('wrote ' + n + ' screenshots to ' + path.resolve(SHOTS));
    process.exit(0);
  }
  console.log('Ctrl+C stops it.');
  await new Promise(() => {});
}

main().catch((e) => { console.error('demo night: ' + (e && e.stack || e)); process.exit(1); });
