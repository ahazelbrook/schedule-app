// The phones' table screen (MM1, design 2.4), in plain node on an in-memory D1 and a FAKE LiveHub namespace: no server.
//   - GET /api/table/screen: a copy of the stored display for a map (svg) and a handout, byte for byte, and { seq, kind: 'none' } for
//     every other kind, for the mirror switched off, and for nothing stored; the same answer for a player, the GM and the display role
//   - GET /api/characters?since= gains screenSeq (the display seq while the mirror is on and the kind qualifies, else 0) at no extra D1 call
//   - the mirror switch (GM state `mirror`, on unless an explicit false) rides in the GM state row the poll already reads
//   - the hidden-name scan over what the route returns, with positive controls (a hit REFUSES the screen: { seq, kind: 'none' })
//   - the 'screen' poke: when a map or handout is put up while the mirror is on, and when the switch flips; never otherwise
//   node checks/api/table-screen.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { worker } from '../../worker/app.js';
import { campaignStamp } from '../../functions/_lib/live.js';
import { hiddenNameHit, svgViews, loadTableScreen } from '../../functions/_lib/table-screen.js';
import { namesHit } from '../../functions/_lib/gm.js';
import { DISPLAY_ALLOWED } from '../../functions/_lib/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let passes = 0, failures = 0;
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (o) => Object.keys(o).sort().join(',');

const GM = 'gm@example.test', IPAD = 'ipad@example.test', ALEX = 'player.a@example.test', BEA = 'player.b@example.test';
const CAMP = 'screencheck';
const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
const DB = asD1(exec);

function fakeHub() {
  const hub = { pokes: [], attempts: 0 };
  hub.LIVE = { idFromName: (n) => ({ id: n }), get() { hub.attempts++; return { poke(...a) { hub.pokes.push(a); return Promise.resolve(1); }, closeAll() { return Promise.resolve(1); } }; } };
  return hub;
}
const kindsOf = (hub) => hub.pokes.map((a) => a[0]);
const HUB = fakeHub();

async function call(method, p, { user = GM, body, hub = HUB } = {}) {
  const pending = [];
  const env = { DEV_USER: GM, GM_EMAILS: GM, DISPLAY_EMAILS: IPAD, DB, CAMPAIGN: CAMP };
  if (hub) env.LIVE = hub.LIVE;
  const init = { method, headers: { 'X-Dev-User': user } };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const res = await worker.fetch(new Request('http://127.0.0.1:8788' + p, init), env, { waitUntil: (pr) => pending.push(pr) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text, pending };
}
const settle = (r) => Promise.race([Promise.allSettled(r.pending), new Promise((ok) => setTimeout(ok, 50))]);
const put = async (display) => { const r = await call('PUT', '/api/gm/display', { body: display }); expect(r.status === 200, 'PUT display ' + r.status + ' ' + r.text.slice(0, 160)); return r.json; };
const screen = async (user) => { const r = await call('GET', '/api/table/screen', { user }); return r; };
const mirror = async (v) => { const r = await call('PATCH', '/api/gm/state', { body: { mirror: v } }); expect(r.status === 200, 'state PATCH ' + r.status); };
const poll = async (user = ALEX) => (await call('GET', '/api/characters?since=2000-01-01T00:00:00.000Z', { user })).json;
const dq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// a display stored by hand, as a document the API would not produce (extra keys, a bad file name...)
const rawDisplay = (doc, seq = 900) => exec.batch(`INSERT OR REPLACE INTO gm_display (campaign, seq, updated_at, doc) VALUES (${dq(CAMP)}, ${seq}, '2030-01-01T00:00:00.000Z', ${dq(JSON.stringify(doc))});`);

const MAP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#222"/><path d="M5 5L95 95" stroke="#fff"/><text x="10" y="20">Mossgate Jetty</text></svg>';
const ROLES = [['player', ALEX], ['second player', BEA], ['gm', GM], ['display role', IPAD]];

await step('nothing stored: every role gets { seq: 0, kind: none }; anonymous is 401; POST is 405; the route takes no parameters', async () => {
  for (const [who, u] of ROLES) {
    const r = await screen(u);
    expect(r.status === 200 && r.text === JSON.stringify({ seq: 0, kind: 'none' }), who + ': ' + r.status + ' ' + r.text);
  }
  const anon = await worker.fetch(new Request('http://127.0.0.1:8788/api/table/screen'), { GM_EMAILS: GM, DB, CAMPAIGN: CAMP }, { waitUntil() {} });
  expect(anon.status === 401, 'anonymous: ' + anon.status);
  const post = await call('POST', '/api/table/screen', { user: ALEX, body: {} });
  expect(post.status === 405, 'POST: ' + post.status);
  expect(DISPLAY_ALLOWED.some((a) => a.method === 'GET' && a.re.test('/api/table/screen')) && !DISPLAY_ALLOWED.some((a) => a.method !== 'GET' && a.re.test('/api/table/screen')), 'the display role may GET it and nothing else');
  const nope = await call('PUT', '/api/table/screen', { user: IPAD, body: {} });
  expect(nope.status === 403, 'the display role cannot PUT it: ' + nope.status);
});

await step('every display kind: only svg and handout come back; blank, dark, npc, text, rule and cards are { seq, kind: none }, for every role', async () => {
  const kinds = [
    ['blank', { kind: 'blank' }],
    ['dark (lights out)', { kind: 'dark', title: 'Invented dark title' }],
    ['npc', { kind: 'npc', npcId: 'invented-npc-1', title: 'Invented Visitor' }],
    ['text', { kind: 'text', text: 'Invented line of text', title: 'T' }],
    ['rule', { kind: 'rule', md: '# Invented rule\nbody', title: 'R', caption: 'C' }],
    ['cards', { kind: 'cards', cards: [{ from: 'Invented', client: 'x', target: 'y', type: 'z', note: 'n', payout: '1' }] }],
  ];
  for (const [label, d] of kinds) {
    const out = await put(d);
    for (const [who, u] of ROLES) {
      const r = await screen(u);
      expect(r.status === 200 && r.text === JSON.stringify({ seq: out.seq, kind: 'none' }), label + ' / ' + who + ': ' + r.text.slice(0, 200));
    }
    const p = await poll();
    expect(p.screenSeq === 0, label + ': the poll says screenSeq 0, got ' + p.screenSeq);
  }
});

await step('a map: byte-identical to the stored svg, with the title and caption the iPad shows, and no other key; the same for every role', async () => {
  const sent = ' \n' + MAP;   // the server stores it trimmed at the start
  const out = await put({ kind: 'svg', title: 'Invented harbour', caption: 'Lantern deck · twelve minutes', svg: sent, secretKey: 'dropped', npcId: 'x' });
  const ipad = (await call('GET', '/api/gm/display', { user: IPAD })).json;
  expect(ipad.display.svg === MAP && ipad.seq === out.seq, 'the iPad holds the trimmed map');
  for (const [who, u] of ROLES) {
    const r = await screen(u);
    expect(r.status === 200, who + ' ' + r.status);
    expect(keysOf(r.json) === 'caption,kind,seq,svg,title', who + ': exactly these keys: ' + keysOf(r.json));
    expect(r.json.kind === 'svg' && r.json.seq === out.seq && r.json.title === 'Invented harbour' && r.json.caption === 'Lantern deck · twelve minutes', who + ': fields');
    expect(r.json.svg === MAP && r.json.svg === ipad.display.svg, who + ': byte-identical to the stored svg');
    expect(r.text.includes(JSON.stringify(MAP)), who + ': the very serialisation of the stored string');
  }
  const p = await poll(BEA);
  expect(p.screenSeq === out.seq, 'screenSeq is the display seq: ' + p.screenSeq + ' vs ' + out.seq);
  // no title, no caption: those keys are absent, not empty
  const bare = await put({ kind: 'svg', svg: MAP });
  const r = await screen(ALEX);
  expect(keysOf(r.json) === 'kind,seq,svg' && r.json.seq === bare.seq, 'no title/caption keys when none: ' + keysOf(r.json));
});

await step('a handout: the plain file name and a title only when the iPad shows it; no other key', async () => {
  const a = await put({ kind: 'handout', file: 'invented-note.png', title: 'An invented note', showTitle: true, caption: 'not shown for handouts' });
  for (const [who, u] of ROLES) {
    const r = await screen(u);
    expect(r.status === 200 && r.text === JSON.stringify({ seq: a.seq, kind: 'handout', file: 'invented-note.png', title: 'An invented note' }), who + ': ' + r.text);
  }
  const b = await put({ kind: 'handout', file: 'invented-note.png', title: 'An invented note' });
  expect((await screen(ALEX)).text === JSON.stringify({ seq: b.seq, kind: 'handout', file: 'invented-note.png' }), 'showTitle off: no title');
  expect((await poll()).screenSeq === b.seq, 'screenSeq for a handout');
});

await step('whatever else a stored display holds cannot ride along, and a file name that is not a plain image name is refused', async () => {
  await rawDisplay({ kind: 'svg', title: 'T', svg: MAP, gmNotes: 'private', npcId: 'n1', md: 'private md', text: 'private text', cards: [{ from: 'x' }], extra: { deep: 1 } }, 901);
  const r = await screen(ALEX);
  expect(keysOf(r.json) === 'kind,seq,svg,title' && r.json.seq === 901 && !r.text.includes('private'), 'only the copied fields: ' + r.text.slice(0, 160));
  for (const file of ['../secret.png', '..%2Fsecret.png', 'a/b.png', 'a\\b.png', '/etc/passwd.png', 'note.html', 'note.png.html', 'note.svg?x=1', '.hidden.png', '', 5, null, 'x'.repeat(90) + '.png']) {
    await rawDisplay({ kind: 'handout', file, title: 'T', showTitle: true }, 902);
    const h = await screen(ALEX);
    expect(h.text === JSON.stringify({ seq: 902, kind: 'none' }), 'file ' + JSON.stringify(file) + ' -> ' + h.text);
  }
  for (const svg of ['not an svg', '<div>x</div>', 5, null, '']) {
    await rawDisplay({ kind: 'svg', svg }, 903);
    expect((await screen(ALEX)).text === JSON.stringify({ seq: 903, kind: 'none' }), 'bad svg ' + JSON.stringify(svg));
  }
  await exec.batch(`INSERT OR REPLACE INTO gm_display (campaign, seq, updated_at, doc) VALUES (${dq(CAMP)}, 904, '2030-01-01T00:00:00.000Z', 'not json at all');`);
  expect((await screen(ALEX)).text === JSON.stringify({ seq: 904, kind: 'none' }), 'a malformed document');
  expect((await poll()).screenSeq === 0, 'and the poll says 0 for it');
  await exec.batch(`DELETE FROM gm_display WHERE campaign = ${dq(CAMP)};`);
});

await step('the mirror switch: on by default; an explicit false turns the screen off for every role and screenSeq to 0; only false is off; the GM state `mirror` key', async () => {
  const out = await put({ kind: 'svg', title: 'M', svg: MAP });
  expect((await poll()).screenSeq === out.seq, 'on by default');
  await mirror(false);
  for (const [who, u] of ROLES) {
    const r = await screen(u);
    expect(r.text === JSON.stringify({ seq: out.seq, kind: 'none' }), who + ' with the mirror off: ' + r.text.slice(0, 120));
  }
  const off = await poll();
  expect(off.screenSeq === 0 && off.live === true, 'the poll: screenSeq 0, live untouched: ' + off.screenSeq);
  // a handout too
  const h = await put({ kind: 'handout', file: 'invented-note.png' });
  expect((await screen(ALEX)).text === JSON.stringify({ seq: h.seq, kind: 'none' }) && (await poll()).screenSeq === 0, 'a handout with the mirror off');
  for (const [stored, wantOn] of [[true, true], [null, true], ['no', true], [0, true], [false, false]]) {
    await mirror(stored);
    const r = await screen(ALEX), p = await poll();
    expect((r.json.kind === 'handout') === wantOn && (p.screenSeq === h.seq) === wantOn, 'stored ' + JSON.stringify(stored) + ' -> kind ' + r.json.kind + ', screenSeq ' + p.screenSeq);
  }
  await mirror(null);
  expect((await call('GET', '/api/gm/state')).json.doc.mirror === undefined, 'null deletes the key (back to on)');
  // a player cannot flip it
  const bad = await call('PATCH', '/api/gm/state', { user: ALEX, body: { mirror: false } });
  expect(bad.status === 403 && (await poll()).screenSeq === h.seq, 'a player cannot turn it off: ' + bad.status);
});

await step('lights out and a cleared display give nothing, and the map comes back when it is put up again', async () => {
  const m = await put({ kind: 'svg', title: 'Back again', svg: MAP });
  expect((await screen(ALEX)).json.kind === 'svg', 'up');
  const dark = await put({ kind: 'dark' });
  expect((await screen(ALEX)).text === JSON.stringify({ seq: dark.seq, kind: 'none' }) && (await poll()).screenSeq === 0, 'lights out: none, screenSeq 0');
  const blank = await put({ kind: 'blank' });
  expect((await screen(ALEX)).text === JSON.stringify({ seq: blank.seq, kind: 'none' }) && (await poll()).screenSeq === 0, 'cleared: none, screenSeq 0');
  const again = await put({ kind: 'svg', svg: MAP });
  expect(again.seq > m.seq && (await poll()).screenSeq === again.seq, 'the map comes back with a new seq');
  expect(((await call('GET', '/api/characters', { user: ALEX })).json.screenSeq) === again.seq, 'the first (no since) poll carries it too');
});

await step('screenSeq costs the poll no extra D1 call, and a GM state write that leaves the switches alone changes nothing a phone sees', async () => {
  await put({ kind: 'svg', svg: MAP });
  const before = exec.calls, mark = exec.log.length;
  const first = await call('GET', '/api/characters?since=2000-01-01T00:00:00.000Z', { user: ALEX });
  expect(exec.calls - before === 3, 'the poll makes 3 D1 calls, as it did before MM1: ' + (exec.calls - before));
  const stamp = exec.log.slice(mark).filter((s) => /AS mirror/.test(s));
  expect(stamp.length === 1 && /json_type\(doc, '\$\.mirror'\)/.test(stamp[0]) && /FROM campaigns WHERE id = '[^']*#gm'/.test(stamp[0]), 'the switch is read in the stamp statement, from the GM state row: ' + stamp.length);
  expect(!/json_extract\(doc, '\$\.svg'\)/.test(stamp[0]), 'the poll never extracts the svg');
  const a = first.json;
  expect(a.screenSeq > 0 && a.live === true && a.campaignUpdatedAt !== undefined, 'fields');
  for (let i = 0; i < 3; i++) await call('PATCH', '/api/gm/state', { body: { ui: { tab: 'mm1-' + i }, capture: { ['m' + i]: 'x' } } });
  const b = (await call('GET', '/api/characters?since=2000-01-01T00:00:00.000Z', { user: ALEX })).json;
  expect(b.screenSeq === a.screenSeq && b.campaignUpdatedAt === a.campaignUpdatedAt && b.npcsUpdatedAt === a.npcsUpdatedAt && b.live === a.live, 'state writes that do not touch mirror move nothing');
  const s0 = await campaignStamp(DB, CAMP);
  await mirror(false);
  const s1 = await campaignStamp(DB, CAMP);
  expect(s0.mirror === true && s1.mirror === false && s0.at === s1.at && s0.screenSeq > 0 && s1.screenSeq === 0, 'only the flip changes the answer, and campaignUpdatedAt does not move');
  // with the mirror off the statement does not even look at the display's kind: the wanted rows for a poll are the same count
  const before2 = exec.calls;
  await call('GET', '/api/characters', { user: ALEX });
  expect(exec.calls - before2 === 3, 'still 3 calls with the mirror off');
  await mirror(null);
});

await step('the hidden-name scan: a hidden NPC or clock name in the title, caption, svg text, a split tspan, an entity, a full-width spelling or an attribute REFUSES the screen; positive controls; revealed names and near misses pass', async () => {
  const npc = await call('POST', '/api/npcs', { body: { name: 'Zephyrine Pemberthy', alias: 'The Glasswing Clerk', revealed: false } });
  expect(npc.status === 200, 'npc ' + npc.status);
  const seen = await call('POST', '/api/npcs', { body: { name: 'Wystan Orlop', revealed: true } });
  const camp = await call('PUT', '/api/campaign', { body: { crew: { name: 'Invented Scan Crew' }, clocks: [{ id: 'c1', name: 'Ox Ledger', size: 6, filled: 1, hidden: true }, { id: 'c2', name: 'Brindle Account', size: 4, filled: 0, hidden: false }] } });
  expect(camp.status === 200, 'campaign ' + camp.status + ' ' + camp.text.slice(0, 100));
  const svgWith = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + inner + '</svg>';
  const cases = [
    ['name in svg text', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9">Zephyrine Pemberthy waits here</text>') }, true],
    ['alias in svg text', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9">the glasswing clerk</text>') }, true],
    ['name in the title', { kind: 'svg', title: 'Zephyrine Pemberthy', svg: svgWith('<rect width="1" height="1"/>') }, true],
    ['name in the caption', { kind: 'svg', title: 'Map', caption: 'Seen: ZEPHYRINE  PEMBERTHY', svg: svgWith('<rect width="1" height="1"/>') }, true],
    ['name split over tspans', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9"><tspan>Zephy</tspan><tspan>rine Pemberthy</tspan></text>') }, true],
    ['name as numeric entities', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9">Z&#101;phyrine P&#x65;mberthy</text>') }, true],
    ['name in an attribute', { kind: 'svg', title: 'Map', svg: svgWith('<g aria-label="Zephyrine Pemberthy"><rect width="1" height="1"/></g>') }, true],
    ['name in a <title> element', { kind: 'svg', title: 'Map', svg: svgWith('<title>Zephyrine Pemberthy</title><rect width="1" height="1"/>') }, true],
    ['name in full-width letters', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9">Ｚｅｐｈｙｒｉｎｅ Pemberthy</text>') }, true],
    ['a hidden clock name', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9">Ox Ledger</text>') }, true],
    ['name in a handout title that the iPad shows', { kind: 'handout', file: 'invented-note.png', title: 'Zephyrine Pemberthy', showTitle: true }, true],
    ['name in the handout file name', { kind: 'handout', file: 'zephyrine-pemberthy.png', title: 'Note' }, true],
    ['a revealed NPC name', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9">Wystan Orlop</text>') }, false],
    ['a visible clock name', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9">Brindle Account</text>') }, false],
    ['a near miss (Pemberthy alone, Zephyrinian)', { kind: 'svg', title: 'Map', svg: svgWith('<text x="1" y="9">Pemberthy Street, the Zephyrinian quarter</text>') }, false],
    ['a hidden name only in a handout title the iPad does NOT show', { kind: 'handout', file: 'invented-note.png', title: 'Zephyrine Pemberthy' }, false],
    ['an ordinary map', { kind: 'svg', title: 'Mossgate Jetty', caption: 'Floor 1', svg: MAP }, false],
  ];
  for (const [label, d, refused] of cases) {
    const out = await put(d);
    for (const [who, u] of [['player', ALEX], ['display role', IPAD]]) {
      const r = await screen(u);
      const got = r.json.kind === 'none';
      expect(got === refused, label + ' / ' + who + ': ' + (refused ? 'should be refused' : 'should be shown') + ', got ' + r.text.slice(0, 140));
      if (refused) expect(r.text === JSON.stringify({ seq: out.seq, kind: 'none' }) && !/Zephyrine|Ox|Pemberthy|glasswing/i.test(r.text), label + ': nothing of the map leaks in the refusal');
    }
  }
  // positive control for the scanner itself: the same texts hit namesHit directly, so a pass above is not an empty scan
  expect(namesHit('Zephyrine Pemberthy waits', ['Zephyrine Pemberthy']) && !namesHit('Pemberthy Street', ['Zephyrine Pemberthy']), 'namesHit control');
  // reveal the NPC: the same map is now shown
  await put(cases[0][1]);
  expect((await screen(ALEX)).json.kind === 'none', 'still refused before the reveal');
  const id = npc.json.id;
  const rev = await call('PATCH', '/api/npcs/' + id, { body: { revealed: true } });
  expect(rev.status === 200, 'reveal ' + rev.status);
  expect((await screen(ALEX)).json.kind === 'svg', 'after the reveal the name is not hidden any more, and the map shows');
  // a refused screen also gives the poll nothing different: screenSeq still announces the display (the phone then learns it is none)
  await call('PATCH', '/api/npcs/' + id, { body: { revealed: false } });
});

await step('the scan helpers: views, the prefilter agrees with namesHit on a shared list, and a max-size svg with 40 names stays cheap', async () => {
  const names = ['Zephyrine Pemberthy', 'The Glasswing Clerk', 'Ox Ledger', 'Ximena-Rae Tolliver', 'Zéphire Lanthorn', 'Ｚｅ'];
  const texts = ['Zephyrine Pemberthy here', 'the GLASSWING CLERK', 'Ox   Ledger', 'ximena-rae tolliver.', 'Zéphire Lanthorn!', 'Ze', 'nothing at all', 'Pemberthy', 'Ledgers', 'xZephyrine Pemberthy', 'Zephyrine Pemberthyx', 'Ｚｅｐｈｙｒｉｎｅ Pemberthy', 'zᴇphyrine'];
  for (const t of texts) expect(hiddenNameHit([t], names) === namesHit(t, names), 'the prefilter agrees with namesHit on ' + JSON.stringify(t));
  expect(svgViews('<text>A&#66;C</text>').some((v) => v.includes('ABC')) && svgViews('<a>Ve</a><b>x</b>').includes('Vex'), 'views decode entities and glue split text');
  // a max-size map (about 590 KiB of path data and text) against 40 names
  const many = []; for (let i = 0; i < 40; i++) many.push('Invented Person ' + String.fromCharCode(65 + (i % 26)) + 'zorblin' + i);
  let body = ''; while (body.length < 590 * 1024) body += '<path d="M' + (body.length % 997) + ' 3L40 41.5C1 2 3 4 5 6" fill="none" stroke="#123"/><text x="3" y="4">Jetty ' + (body.length % 89) + ' Stairs</text>';
  const big = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + body.slice(0, 590 * 1024) + '</svg>';
  const t0 = performance.now(); let hit; for (let i = 0; i < 5; i++) hit = hiddenNameHit(svgViews(big), many); const ms = (performance.now() - t0) / 5;
  expect(hit === false, 'no false hit on a big map');
  const planted = big.replace('Stairs', 'Stairs Invented Person Azorblin0'); expect(planted !== big, 'the control edit applied');
  expect(hiddenNameHit(svgViews(planted), many) === true, 'a planted name in a big map is found');
  const curly = planted.replace('<svg', '<svg data-note="Gil’s ·"');
  expect(curly !== planted && hiddenNameHit(svgViews(curly), many) === true, 'and still found in a map that holds a curly quote and a dot (the view is not folded for those)');
  const wide = big.replace('Stairs', 'Stairs Invented Person Ａzorblin0'); // a full-width A
  expect(wide !== big && hiddenNameHit(svgViews(wide), many) === true, 'and a full-width spelling is still folded and found');
  console.log('     (scan of a ' + Math.round(big.length / 1024) + ' KiB map against 40 names: ' + ms.toFixed(1) + ' ms per scan in node)');
  expect(ms < 30, 'the scan is cheap enough for 10 ms of Worker CPU after the prefilter: ' + ms.toFixed(1) + ' ms here');
  // end to end through the route with a stored big map
  await exec.batch(`DELETE FROM npcs WHERE campaign = ${dq(CAMP)};`);
  for (const n of many) await call('POST', '/api/npcs', { body: { name: n, revealed: false } });
  // the in-memory D1 caps one command at 28000 characters, so the route is run on a map that fits; the 590 KiB scan above is the size test
  const mid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + body.slice(0, 12 * 1024) + '</svg>';
  await put({ kind: 'svg', title: 'Big', svg: mid });
  const r = await screen(ALEX);
  expect(r.json.kind === 'svg' && r.json.svg === mid, 'the map comes back whole with 40 hidden NPCs on file (' + Math.round(r.text.length / 1024) + ' KiB)');
  await put({ kind: 'svg', title: 'Big', svg: mid.replace('Stairs', 'Stairs Invented Person Azorblin0') });
  expect((await screen(ALEX)).json.kind === 'none', 'and a planted hidden NPC name in it is refused');
  await exec.batch(`DELETE FROM npcs WHERE campaign = ${dq(CAMP)};`);
});

await step('the screen poke: any display change while the mirror is on (a map or handout, and lights out etc. so an open viewer clears at once); the switch flipping; never for a refused write, the mirror off, or a read', async () => {
  const hub = fakeHub();
  const run = async (label, kinds, method, p, opts) => {
    hub.pokes.length = 0;
    const r = await call(method, p, { ...opts, hub });
    await settle(r);
    expect(same(kindsOf(hub), kinds), label + ': poked ' + JSON.stringify(kindsOf(hub)) + ', wanted ' + JSON.stringify(kinds) + ' (status ' + r.status + ')');
    expect(hub.pokes.every((a) => a.length === 1 && typeof a[0] === 'string'), label + ': a bare kind');
    return r;
  };
  await mirror(null);
  await run('map', ['display', 'screen'], 'PUT', '/api/gm/display', { body: { kind: 'svg', svg: MAP } });
  await run('handout', ['display', 'screen'], 'PUT', '/api/gm/display', { body: { kind: 'handout', file: 'invented-note.png' } });
  for (const d of [{ kind: 'blank' }, { kind: 'dark' }, { kind: 'text', text: 'x' }, { kind: 'rule', md: 'x' }, { kind: 'npc', npcId: 'n9' }]) await run(d.kind + ' (a change away from a map reaches an open viewer at once)', ['display', 'screen'], 'PUT', '/api/gm/display', { body: d });
  const stale = await run('map with a stale ifSeq (409)', [], 'PUT', '/api/gm/display', { body: { kind: 'svg', svg: MAP, ifSeq: 999999 } });
  expect(stale.status === 409, 'stale: ' + stale.status);
  const player = await run('a player cannot push', [], 'PUT', '/api/gm/display', { user: ALEX, body: { kind: 'svg', svg: MAP } });
  expect(player.status === 403, 'player: ' + player.status);
  await run('a read', [], 'GET', '/api/table/screen', { user: ALEX });
  await run('the poll', [], 'GET', '/api/characters', { user: ALEX });
  // the switch
  await run('mirror off', ['screen'], 'PATCH', '/api/gm/state', { body: { mirror: false } });
  await run('a map with the mirror off', ['display'], 'PUT', '/api/gm/display', { body: { kind: 'svg', svg: MAP } });
  await run('mirror off again', [], 'PATCH', '/api/gm/state', { body: { mirror: false } });
  await run('an unrelated state write', [], 'PATCH', '/api/gm/state', { body: { ui: { tab: 'z' } } });
  await run('mirror on', ['screen'], 'PATCH', '/api/gm/state', { body: { mirror: true } });
  await run('mirror deleted (already on)', [], 'PATCH', '/api/gm/state', { body: { mirror: null } });
  await run('a map, mirror on again', ['display', 'screen'], 'PUT', '/api/gm/display', { body: { kind: 'svg', svg: MAP } });
  await run('absent to false', ['screen'], 'PATCH', '/api/gm/state', { body: { mirror: false } });
  await run('false to absent', ['screen'], 'PATCH', '/api/gm/state', { body: { mirror: null } });
  // the kinds table already sends screen to phones only
  const { KINDS } = await import('../../functions/_lib/live.js');
  expect(same(KINDS.screen, ['player']), 'screen is heard by phones only');
});

await step('the object down: a map still goes up and answers when the screen poke fails', async () => {
  const down = { pokes: [], LIVE: { idFromName() { throw new Error('down'); }, get() { throw new Error('down'); } } };
  const r = await call('PUT', '/api/gm/display', { body: { kind: 'svg', svg: MAP }, hub: down });
  expect(r.status === 200 && r.json.display.svg === MAP, 'the write answers: ' + r.status);
  const flip = await call('PATCH', '/api/gm/state', { body: { mirror: false }, hub: down });
  expect(flip.status === 200, 'the flip answers: ' + flip.status);
  await call('PATCH', '/api/gm/state', { body: { mirror: null }, hub: down });
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
