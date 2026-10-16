// The cast in the artifact's runtime: no cf.js, no server, just a window.claude whose db is an in-memory stand-in with the
// artifact's contract (collections, docs, onSnapshot). The GM adds the seven starting NPCs from the page (the artifact has no
// migrations), puts Grunt on stage, and a player in another page over the same store sees the banner and only revealed NPCs
// (hiding is presentation only here); a runtime without the collection degrades to a note, with no errors.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/cast.artifact.e2e.mjs      (part of npm run check:cast)
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const URL = 'file://' + path.join(ROOT, 'app', 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }

// Each page has its own store; the test copies the GM's store into the player's page (window.__sync) to model the shared db.
const STUB = (canEdit, withNpcs) => `(() => {
  const stores = { characters: {}, campaign: {}, npcs: {} }, subs = [];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const snapOf = (name, id) => ({ id, exists: id in stores[name], data: () => stores[name][id] ? clone(stores[name][id]) : undefined, metadata: {} });
  const fire = (name, id) => subs.slice().forEach((s) => { if (s.name !== name) return; if (s.id === undefined) s.fn(query(name)); else if (s.id === id) s.fn(snapOf(name, id)); });
  const query = (name) => { const docs = Object.keys(stores[name]).map((id) => snapOf(name, id)); return { docs, size: docs.length, empty: !docs.length }; };
  const merge = (t, s) => { for (const k in s) { const v = s[k]; if (v === null) delete t[k]; else if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object') merge(t[k], v); else t[k] = clone(v); } return t; };
  const docRef = (name, id) => ({ id,
    get: async () => snapOf(name, id),
    set: async (d) => { stores[name][id] = clone(d); window.__writes.push([name, 'set', id]); fire(name, id); },
    update: async (p) => { if (!(id in stores[name])) throw new Error('no document to update'); merge(stores[name][id], p); window.__writes.push([name, 'update', id]); fire(name, id); },
    delete: async () => { delete stores[name][id]; window.__writes.push([name, 'delete', id]); fire(name, id); },
    onSnapshot: (fn) => { const s = { name, id, fn }; subs.push(s); setTimeout(() => fn(snapOf(name, id)), 0); return () => subs.splice(subs.indexOf(s), 1); } });
  const col = (name) => {
    if (!stores[name]) throw new Error('unknown collection: ' + name);
    const q = { orderBy: () => q, limit: () => q, where: () => q, get: async () => query(name), doc: (id) => docRef(name, id), path: name,
      onSnapshot: (fn) => { const s = { name, fn }; subs.push(s); setTimeout(() => fn(query(name)), 0); return () => subs.splice(subs.indexOf(s), 1); } };
    return q;
  };
  ${withNpcs ? '' : 'delete stores.npcs;'}
  window.__writes = []; window.__stores = stores;
  window.__sync = (other) => { Object.keys(stores).forEach((n) => { stores[n] = clone(other[n] || {}); }); Object.keys(stores).forEach((n) => { fire(n); Object.keys(stores[n]).forEach((id) => fire(n, id)); }); };
  window.claude = { use: async (name) => ({
    db: { collection: col, doc: (p) => docRef(p.split('/')[0], p.split('/')[1]) },
    user: { id: async () => '${canEdit ? 'u_gm' : 'u_pl'}', can: async () => true, isOwner: async () => ${canEdit}, canEdit: async () => ${canEdit}, me: async () => ({ id: '${canEdit ? 'u_gm' : 'u_pl'}', name: '' }), profiles: async () => ({}) },
    downloads: { save: async () => {} } })[name] || null };
})();`;

const b = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const errs = [];
async function open(canEdit, withNpcs = true) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(STUB(canEdit, withNpcs));
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(URL + '#cast'); await sleep(800);
  return { ctx, p };
}
const cards = (p) => p.$$eval('#cast-page .cp-card .cp-name a', (as) => as.map((a) => a.textContent.trim()));
const stores = (p) => p.evaluate(() => window.__stores);

try {
  const G = await open(true);
  check(await G.p.waitForSelector('[data-cp="seed"]', { timeout: 10000 }).then(() => true, () => false), 'GM: an empty cast offers the seven starting NPCs');
  await G.p.click('[data-cp="seed"]');
  await G.p.waitForFunction(() => document.querySelectorAll('#cast-page .cp-card').length === 7, null, { timeout: 15000 });
  check((await cards(G.p)).length === 7, 'GM: the seven are in the artifact db');
  const st = await stores(G.p);
  check(st.npcs.npc_grunt && st.npcs.npc_grunt.revealed === false && /rubber apron/.test(st.npcs.npc_grunt.description), 'GM: Grunt is stored hidden with his description');
  // the first write to a table that does not exist yet: the scene is created whole
  await G.p.click('#cast-page .cp-card[data-id="npc_grunt"] [data-cp="stage"]');
  await G.p.waitForSelector('#stageBanner:not([hidden]) .cp-st-name', { timeout: 10000 });
  const s2 = await stores(G.p);
  check(s2.campaign.main && s2.campaign.main.scene.npcs.npc_grunt === true && s2.npcs.npc_grunt.revealed === true && !!s2.npcs.npc_grunt.firstSeen, 'GM: Grunt on stage: scene saved on campaign/main, NPC revealed with firstSeen');
  check(/Grunt/.test(await G.p.textContent('#stageBanner')), 'GM: the banner names Grunt');
  // a player over the same data
  const P = await open(false);
  await P.p.evaluate((s) => window.__sync(s), s2); await sleep(600);
  check(await P.p.waitForSelector('#stageBanner:not([hidden]) .cp-st-name', { timeout: 10000 }).then(() => true, () => false) && /rubber apron/.test(await P.p.textContent('#stageBanner')), 'player: the banner shows Grunt');
  await P.p.evaluate(() => { location.hash = '#cast'; }); await sleep(500);
  check((await cards(P.p)).join() === 'Grunt', 'player: the cast holds Grunt only (the rest are hidden, though the db holds them): ' + (await cards(P.p)).join());
  // a player who hides the banner still reads, on the cast page, who is on stage, and can bring the banner back
  await P.p.click('#stageBanner [data-cp="dismiss"]'); await sleep(300);
  check(await P.p.$eval('#stageBanner', (e) => e.hidden) && /On stage\s*Grunt/.test((await P.p.textContent('#cast-page .cp-onstage')) || ''), 'player: after Hide the cast page still says Grunt is on stage');
  await P.p.click('#cast-page [data-cp="show"]'); await sleep(300);
  check(!(await P.p.$eval('#stageBanner', (e) => e.hidden)) && !(await P.p.$('#cast-page [data-cp="show"]')), 'player: "Show the banner" brings it back');
  check(!/Brackley|Skinner/.test(await P.p.textContent('body')) && !(await P.p.$('#cast-page [data-cp="stage"], #cast-page a[href$="/edit"]')), 'player: no hidden NPC in the page and no GM controls');
  // a hidden NPC is not shown by a direct link either, and gmNotes never render for a player
  await P.p.evaluate(() => window.__stores.npcs.npc_grunt.gmNotes = 'SECRET'); await P.p.evaluate(() => { location.hash = '#cast/npc_grunt'; }); await sleep(500);
  check(!/SECRET/.test(await P.p.content()), 'player: gmNotes in the shared doc are not drawn');
  await P.p.evaluate(() => { location.hash = '#cast/npc_mira'; }); await sleep(500);
  check(/not in the cast/.test(await P.p.textContent('#cast-page')), 'player: a hidden NPC by link reads like a missing one');
  // the GM clears the stage
  await G.p.click('#stageBanner [data-cp="clear"]'); await sleep(500);
  const s3 = await stores(G.p);
  check(Object.values(s3.campaign.main.scene.npcs).every((v) => v === false), 'GM: Clear stage writes false for each NPC');
  await P.p.evaluate((s) => window.__sync(s), s3); await sleep(600);
  check(await P.p.$eval('#stageBanner', (e) => e.hidden), 'player: the banner goes');
  await P.ctx.close(); await G.ctx.close();

  // a runtime with no `npcs` collection: the cast says so, nothing throws
  const N = await open(true, false);
  check(await N.p.waitForSelector('#cast-page .cp-note', { timeout: 10000 }).then(() => true, () => false), 'no npcs collection: the cast shows a note, not an error');
  await N.p.evaluate(() => { location.hash = ''; }); await sleep(400);
  check(await N.p.$eval('#home', (h) => !h.hidden), 'no npcs collection: the rest of the app still works');
  await N.ctx.close();
  check(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
