process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the schedule (SCHEDULE.md): the schedule box on the table page and the next-session card in every
   mode. Four people share ONE stubbed db held here in Node (each page talks to it through an exposed binding, and every
   write is pushed to every open page as a snapshot): the GM (gail), two players (alex, pat) and a read-only viewer
   (vic). Ids are emails, as on Cloudflare. The clock is fixed (Mon 12 Oct 2026, 09:00 in London) so dates, the
   cadence across the end of summer time and the countdown are exact. Screenshots go to out/schedule-*.png.
   Run from this dir: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node schedule.js */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, 'out');

const GM = 'gail@table.test', ALEX = 'alex@table.test', PAT = 'pat@table.test', VIC = 'vic@table.test';
const NAMES = { [GM]: 'Gail', [ALEX]: 'Alex', [PAT]: 'Pat' };   /* vic has no profile name: "Someone" */
const T0 = new Date('2026-10-12T08:00:00Z');                      /* Mon 12 Oct 2026, 09:00 BST */

/* ---------- the shared store ---------- */
const store = {}, writes = [], pages = [];
const copy = (o) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(t, s) { for (const k in s) { const v = s[k]; if (v === null) delete t[k]; else if (isObj(v) && isObj(t[k])) merge(t[k], v); else t[k] = copy(v); } return t; }   /* PATCH: null deletes */
function colDocs(c) { return Object.keys(store).filter(p => p.indexOf(c + '/') === 0).map(p => [p.slice(c.length + 1), store[p]]).sort((a, b) => String(b[1].updatedAt || '').localeCompare(String(a[1].updatedAt || ''))); }
function broadcast(p) {
  const c = p.split('/')[0], data = copy(store[p]), cd = copy(colDocs(c));
  setTimeout(() => pages.forEach(pg => { if (!pg.isClosed()) pg.evaluate(([p, d, cd]) => window.__push && window.__push(p, d, cd), [p, data, cd]).catch(() => {}); }), 0);
}
async function handle(who, r) {
  if (r.op === 'get') return store[r.p] === undefined ? null : copy(store[r.p]);
  if (r.op === 'query') return copy(colDocs(r.c));
  if (r.op === 'set') { store[r.p] = copy(r.d); writes.push({ who, op: 'set', p: r.p, body: copy(r.d) }); broadcast(r.p); return { ok: true }; }
  if (r.op === 'update') { if (!(r.p in store)) return { error: 'No document to update: ' + r.p }; merge(store[r.p], copy(r.u)); writes.push({ who, op: 'update', p: r.p, body: copy(r.u) }); broadcast(r.p); return { ok: true }; }
  if (r.op === 'delete') { delete store[r.p]; writes.push({ who, op: 'delete', p: r.p }); broadcast(r.p); return { ok: true }; }
  return { error: 'bad op' };
}
/* the page side: window.claude backed by the binding; snapshots arrive through window.__push */
const STUB = `(() => {
  const who = window.__who; const subs = {}; const colSubs = {};
  const copy = (o) => o === undefined || o === null ? o : JSON.parse(JSON.stringify(o));
  const snap = (p, d) => ({ id: p.split('/')[1], exists: d !== null && d !== undefined, data: () => d === null || d === undefined ? undefined : copy(d), metadata: {} });
  const qsnap = (c, list) => { const docs = list.map(([id, d]) => snap(c + '/' + id, d)); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
  window.__push = (p, d, cd) => { (subs[p] || []).forEach(fn => fn(snap(p, d))); const c = p.split('/')[0]; (colSubs[c] || []).forEach(fn => fn(qsnap(c, cd))); };
  const call = async (r) => { const out = await window.__db(r); if (out && out.error) throw new Error(out.error); return out; };
  const docRef = (c, id) => { const p = c + '/' + id; return { id,
    get: async () => snap(p, await call({ op: 'get', p })),
    set: (d) => call({ op: 'set', p, d: copy(d) }).then(() => {}),
    update: (u) => call({ op: 'update', p, u: copy(u) }).then(() => {}),
    delete: () => call({ op: 'delete', p }).then(() => {}),
    onSnapshot: (fn) => { (subs[p] = subs[p] || []).push(fn); call({ op: 'get', p }).then(d => fn(snap(p, d))); window.__subCount = (window.__subCount || 0) + 1; return () => { subs[p] = (subs[p] || []).filter(f => f !== fn); }; } }; };
  const col = (c) => { const q = () => ({ orderBy: q, limit: q, where: q, get: async () => qsnap(c, await call({ op: 'query', c })), onSnapshot: (fn) => { (colSubs[c] = colSubs[c] || []).push(fn); call({ op: 'query', c }).then(l => fn(qsnap(c, l))); return () => {}; } }); return Object.assign(q(), { doc: (id) => docRef(c, id), path: c }); };
  window.__saved = [];
  const user = { id: async () => who.id, can: async (n) => n === 'data.write' ? !who.ro : true, isOwner: async () => !!who.gm, canEdit: async () => !!who.gm,
    me: async () => ({ id: who.id, name: who.name || '', email: who.id }), profiles: async (list) => { const o = {}; list.forEach(id => { o[id] = { id, name: (who.names || {})[id] || '' }; }); return o; } };
  window.claude = { use: async (name) => ({ db: { collection: col, doc: (p) => docRef(p.split('/')[0], p.split('/')[1]) }, user, downloads: { save: async (o) => { window.__saved.push({ filename: o.filename, data: typeof o.data === 'string' ? o.data : String(o.data) }); } } })[name] || null };
})();`;

/* the creator's sheet for a hound, filed (as in campaign.js) */
const SHEET = `(() => {
  const CT = B68Content, P = CT.byId.hound, S = B68.S;
  B68.choosePlaybook('hound');
  const sh = S.sheet; sh.name = 'Aldo Crane'; sh.alias = 'Dusty'; sh.heritage = 'Akoros'; sh.background = 'Underworld'; sh.look = 'Lean.'; sh.wearing = ['Trench coat'];
  sh.dots = Object.assign({}, P.printed || {}, { Hunt: 2, Survey: 1, Prowl: 1, Skirmish: 1, Consort: 2 });
  sh.ability = P.abilities[0][0]; sh.keys = P.keys.slice(0, 3); sh.contacts = {}; sh.contacts[P.contacts[0][0]] = 'friend'; sh.contacts[P.contacts[1][0]] = 'rival'; sh.vice = 'Gambling'; sh.purveyor = 'The Docks'; sh.items = [P.items[0][0]];
  if (B68.syncNameToSpec) B68.syncNameToSpec(); B68.changed(); B68.fileCharacter();
})()`;

(async () => {
  const b = await chromium.launch();
  const errs = [], fails = [], notes = [];
  const assert = (ok, msg) => { if (!ok) fails.push(msg); };
  async function person(id, opts) {
    const ctx = await b.newContext({ viewport: opts.viewport || { width: 1360, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/London' });
    await ctx.clock.setFixedTime(T0);
    await ctx.exposeBinding('__db', (src, r) => handle(id, r));
    await ctx.addInitScript(`window.__who = ${JSON.stringify({ id, gm: !!opts.gm, ro: !!opts.ro, names: NAMES })};`);
    await ctx.addInitScript(STUB);
    const p = await ctx.newPage(); pages.push(p);
    p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/ERR_FILE_NOT_FOUND/.test(t)) errs.push(id + ' console.error: ' + t); } });
    p.on('pageerror', e => errs.push(id + ' pageerror: ' + e.message));
    p.on('dialog', d => { p.dialogs.push(d.message()); d.accept(); }); p.dialogs = [];
    p.ctx = ctx;
    return p;
  }
  const camp = () => copy(store['campaign/main'] || null);
  const sched = () => (camp() || {}).schedule || {};
  const cw = (who) => writes.filter(w => w.p === 'campaign/main' && (!who || w.who === who)).length;
  const lastW = (who) => { const l = writes.filter(w => w.p === 'campaign/main' && (!who || w.who === who)); return l[l.length - 1] || null; };
  const settle = (p, ms = 250) => p.waitForTimeout(ms);
  async function one(p, who, label, fn, wait = 350) {
    const n0 = cw(who); await fn(); await settle(p, wait);
    const n = cw(who) - n0; assert(n === 1, label + ': expected 1 write, got ' + n); return lastW(who);
  }
  async function none(p, label, fn, wait = 400) { const n0 = cw(); await fn(); await settle(p, wait); const n = cw() - n0; assert(n === 0, label + ': expected no write, got ' + n); }
  const keysOf = (o) => JSON.stringify(Object.keys(o || {}).sort());
  async function setNow(p, iso) { await p.ctx.clock.setFixedTime(new Date(iso)); await p.evaluate(() => { if (window.B68Schedule) B68Schedule.card.refresh(); }); }
  async function overflow(p, name) {
    const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
    if (r.sw > r.w) errs.push(name + ': horizontal overflow ' + r.sw + '>' + r.w);
  }
  const cellSel = (o) => `.sc-cell[data-o="${o}"]`;
  const optIdAt = (iso) => { const s = sched(); return Object.keys(s.options || {}).find(k => s.options[k].at === iso); };

  /* ---------- the GM ---------- */
  const g = await person(GM, { gm: true });
  await g.goto(URL); await settle(g, 1200);
  /* a filed character owned by alex: he is known to the schedule before he answers */
  await g.evaluate(SHEET); await settle(g, 900);
  const charId = await g.evaluate(() => B68.S.sheet.docId);
  store['characters/' + charId].owner = ALEX; store['characters/' + charId].updatedAt = new Date(T0.getTime() + 1000).toISOString(); broadcast('characters/' + charId);
  await settle(g, 300);
  await g.click('#railBack'); await settle(g, 300);
  assert(await g.$eval('#nextSession', n => n.hidden), 'card hidden with no next session');
  const w0 = cw();
  await g.click('#tableBtn'); await settle(g, 600);
  assert(cw() === w0 && camp() === null, 'opening the table writes nothing');
  assert(!!(await g.$('.tp-schedbox')), 'schedule box on the table page');
  const order = await g.$$eval('.tp-colB > .tp-box', ns => ns.map(n => n.className));
  assert(/tp-schedbox/.test(order[0]) && /tp-clockbox/.test(order[1]), 'schedule box above the clocks: ' + order.join(' | '));
  const rows0 = await g.$$eval('.sc-grid tbody .sc-who b', ns => ns.map(n => n.textContent)).catch(() => []);
  notes.push('GM grid rows before any date: ' + JSON.stringify(rows0));

  /* GM adds an option: Sat 17 Oct 19:00 local (BST) = 18:00Z */
  await g.fill('[data-ui="sched.odate"]', '2026-10-17'); await g.fill('[data-ui="sched.otime"]', '19:00');
  await one(g, GM, 'GM adds a date', () => g.click('[data-act="sched.optadd"]'));
  let s = sched(); const o17 = optIdAt('2026-10-17T18:00:00.000Z');
  assert(o17 && /^o_[a-z0-9]+$/.test(o17) && s.options[o17].minutes === 240 && s.options[o17].note === '', 'option stored as a UTC instant from local time: ' + JSON.stringify(s.options));
  assert(camp().v === 1 && Array.isArray(camp().clocks), 'first write creates the whole document');
  const rows1 = await g.$$eval('.sc-grid tbody .sc-who b', ns => ns.map(n => n.textContent));
  assert(rows1.length === 2 && rows1[0] === 'Gail' && rows1[1] === 'Alex', 'grid rows: me first, then the owner of a filed character: ' + JSON.stringify(rows1));
  assert(/Sat/.test(await g.$eval(`.sc-opt[data-o="${o17}"]`, n => n.textContent)) && /19:00/.test(await g.$eval(`.sc-opt[data-o="${o17}"]`, n => n.textContent)), 'column shows Sat … 19:00 local');
  await none(g, 'adding the same date again', async () => { await g.fill('[data-ui="sched.odate"]', '2026-10-17'); await g.click('[data-act="sched.optadd"]'); });

  /* cadence: Saturdays every two weeks at 19:00 */
  await one(g, GM, 'cadence weekday', () => g.click('[data-act="sched.cadday"][data-n="6"]'));
  assert(JSON.stringify(sched().cadence) === JSON.stringify({ weeks: 1, weekday: 6, time: '19:00', minutes: 240 }), 'cadence set: ' + JSON.stringify(sched().cadence));
  let wp = await one(g, GM, 'cadence fortnightly', () => g.click('[data-act="sched.cadweeks"][data-n="2"]'));
  assert(wp && JSON.stringify(wp.body.schedule) === '{"cadence":{"weeks":2}}', 'cadence patch is the changed leaf: ' + JSON.stringify(wp && wp.body));
  const preview = await g.$eval('.sc-tools .sc-row .tp-dim', n => n.textContent).catch(() => '');
  notes.push('cadence preview: ' + preview);
  wp = await one(g, GM, 'add the next three', () => g.click('[data-act="sched.cad3"]'));
  s = sched();
  const ats = Object.keys(s.options).map(k => s.options[k].at).sort();
  /* anchored on the 17th, every other Saturday: 31 Oct (after the clocks go back: 19:00 GMT), 14 Nov, 28 Nov */
  assert(JSON.stringify(ats) === JSON.stringify(['2026-10-17T18:00:00.000Z', '2026-10-31T19:00:00.000Z', '2026-11-14T19:00:00.000Z', '2026-11-28T19:00:00.000Z']), 'cadence adds the next three, fortnightly from the anchor, 19:00 local across DST: ' + JSON.stringify(ats));
  assert(wp && keysOf(wp.body.schedule) === '["options"]' && Object.keys(wp.body.schedule.options).length === 3, 'cadence write carries only the three new options: ' + JSON.stringify(wp && wp.body));
  const o31 = optIdAt('2026-10-31T19:00:00.000Z'), o14 = optIdAt('2026-11-14T19:00:00.000Z'), o28 = optIdAt('2026-11-28T19:00:00.000Z');
  /* a second press goes on from the last open date */
  await one(g, GM, 'add three more', () => g.click('[data-act="sched.cad3"]'));
  const more = Object.keys(sched().options).map(k => sched().options[k].at).sort().slice(4);
  assert(JSON.stringify(more) === JSON.stringify(['2026-12-12T19:00:00.000Z', '2026-12-26T19:00:00.000Z', '2027-01-09T19:00:00.000Z']), 'second press continues the rhythm: ' + JSON.stringify(more));
  /* remove one of them (nobody answered: no confirm) */
  const o0109 = optIdAt('2027-01-09T19:00:00.000Z');
  wp = await one(g, GM, 'remove a date', () => g.click(`[data-act="sched.optrm"][data-o="${o0109}"]`));
  assert(wp && JSON.stringify(wp.body.schedule) === JSON.stringify({ options: { [o0109]: null } }), 'removal is written as null: ' + JSON.stringify(wp && wp.body));
  await one(g, GM, 'crew name', async () => { await g.click('[data-path="crew.name"]'); await g.keyboard.type('Lamplighters, Ltd', { delay: 5 }); }, 900);

  /* ---------- two players answer from their own pages ---------- */
  const a = await person(ALEX, {}), pt = await person(PAT, {});
  await a.goto(URL + '#t'); await pt.goto(URL + '#t'); await settle(a, 1400);
  assert(await a.$eval('.tp-role', n => n.textContent) === 'Player', 'alex is a player');
  assert(!(await a.$('[data-act="sched.optadd"]')) && !(await a.$('[data-act="sched.confirm"]')) && !(await a.$('[data-act="sched.cad3"]')), 'player: no GM schedule tools');
  wp = await one(a, ALEX, 'alex: 17 Oct yes', () => a.click(cellSel(o17)));
  assert(wp && JSON.stringify(wp.body) === JSON.stringify({ schedule: { avail: { [ALEX]: { [o17]: 'yes' } } }, updatedAt: wp.body.updatedAt }), 'alex sends only his own leaf: ' + JSON.stringify(wp && wp.body));
  await one(pt, PAT, 'pat: 17 Oct yes', () => pt.click(cellSel(o17)));
  await one(a, ALEX, 'alex: 31 Oct yes', () => a.click(cellSel(o31)));
  await one(a, ALEX, 'alex: 31 Oct maybe', () => a.click(cellSel(o31)));
  await one(pt, PAT, 'pat: 31 Oct yes', () => pt.click(cellSel(o31)));
  await one(a, ALEX, 'alex: 14 Nov yes', () => a.click(cellSel(o14)));
  await one(pt, PAT, 'pat: 14 Nov yes', () => pt.click(cellSel(o14)));
  await one(pt, PAT, 'pat: 14 Nov maybe', () => pt.click(cellSel(o14)));
  await one(pt, PAT, 'pat: 14 Nov no', () => pt.click(cellSel(o14)));
  /* four taps go round: yes, maybe, no, blank, one write each */
  const n28 = cw(PAT);
  for (let i = 0; i < 4; i++) { await pt.click(cellSel(o28)); await settle(pt, 250); }
  assert(cw(PAT) - n28 === 4, 'pat: four taps on 28 Nov, four writes: ' + (cw(PAT) - n28));
  assert(await pt.evaluate(() => document.activeElement && document.activeElement.classList.contains('sc-cell')), 'the tapped cell keeps the keyboard focus after the redraw');
  const pl = lastW(PAT);
  assert(pl && JSON.stringify(pl.body.schedule) === JSON.stringify({ avail: { [PAT]: { [o28]: null } } }), 'blank again is written as null: ' + JSON.stringify(pl && pl.body));
  await one(a, ALEX, 'alex note (Enter)', async () => { await a.fill('[data-ui="sched.note"]', 'Away the week of the 20th'); await a.press('[data-ui="sched.note"]', 'Enter'); });
  const pw = writes.filter(w => w.p === 'campaign/main' && (w.who === ALEX || w.who === PAT));
  const bad = pw.filter(w => { const sc = w.body.schedule; const ks = Object.keys(w.body).filter(k => k !== 'updatedAt'); if (JSON.stringify(ks) !== '["schedule"]') return true; return Object.keys(sc).some(k => (k !== 'avail' && k !== 'rsvp') || keysOf(sc[k]) !== JSON.stringify([w.who])); });
  assert(pw.length >= 10 && !bad.length, 'every player write touches only schedule.avail/rsvp.<self>: ' + JSON.stringify(bad.slice(0, 2)));
  s = sched();
  assert(JSON.stringify(s.avail[ALEX]) === JSON.stringify({ [o17]: 'yes', [o31]: 'maybe', [o14]: 'yes', note: 'Away the week of the 20th' }), 'alex answers stored: ' + JSON.stringify(s.avail[ALEX]));
  assert(s.avail[PAT][o17] === 'yes' && s.avail[PAT][o31] === 'yes' && s.avail[PAT][o14] === 'no' && !(o28 in s.avail[PAT]), 'pat answers stored (both answering at once merged): ' + JSON.stringify(s.avail[PAT]));
  /* a player cannot touch another row; the page also strips anything else from a player's delta */
  assert((await a.$eval(`tbody tr:not(.me) ${cellSel(o17)}`, n => n.disabled).catch(() => 'missing')) === true, 'alex: other rows are not his to tap');
  const lbl = await a.$eval(`tr.me ${cellSel(o17)}`, n => n.getAttribute('aria-label'));
  assert(lbl === 'Alex: Sat 17 Oct, yes', 'cell label: ' + lbl);
  const strip = await a.evaluate(([me]) => JSON.stringify(B68Schedule.restrict({ options: { o_x: null }, next: null, avail: { [me]: { o_1: 'yes' }, 'x@y': { o_1: 'no' } }, rsvp: { 'x@y': null } }, me)), [ALEX]);
  assert(strip === JSON.stringify({ avail: { [ALEX]: { o_1: 'yes' } } }), 'restrict keeps only own keys: ' + strip);
  await none(a, 'player force-clicks a GM tool', () => a.evaluate(() => { const b = document.querySelector('[data-act="sched.quorum"]'); if (b) b.click(); }));

  /* ---------- best option and quorum, as the GM sees them ---------- */
  await settle(g, 300);
  const marks = async () => g.$$eval('.sc-grid thead .sc-opt', ns => ns.map(n => ({ o: n.dataset.o, best: n.classList.contains('best'), q: n.classList.contains('quorum') })));
  let mk = await marks();
  assert(mk.filter(m => m.best).length === 1 && mk.find(m => m.best).o === o17, 'best = most yes (17 Oct): ' + JSON.stringify(mk));
  assert(!mk.some(m => m.q), 'quorum 0 = everyone known (3), nobody has 3 yes');
  const foot = await g.$eval(`.sc-grid tfoot td:nth-child(3)`, n => n.textContent);
  assert(/^1\+1/.test(foot.replace(/\s/g, '')), '31 Oct footer counts 1 yes + 1 maybe: ' + foot);
  assert(/Away the week of the 20th/.test(await g.$eval('.sc-grid tbody', n => n.textContent)), 'the note shows under the name');
  await one(g, GM, 'quorum +1', () => g.click('[data-act="sched.quorum"][data-n="1"]'));
  await one(g, GM, 'quorum +1', () => g.click('[data-act="sched.quorum"][data-n="1"]'));
  assert(sched().quorum === 2, 'quorum 2');
  mk = await marks();
  assert(mk.filter(m => m.q).map(m => m.o).join() === o17, 'quorum 2 marks 17 Oct only: ' + JSON.stringify(mk));
  /* tie on yes: most maybe wins, then soonest */
  await one(pt, PAT, 'pat: 17 Oct maybe', () => pt.click(cellSel(o17)));
  await settle(g, 300); mk = await marks();
  assert(mk.find(m => m.best).o === o17, 'tie 1 yes each, 17 Oct has the maybe: ' + JSON.stringify(mk));
  await one(pt, PAT, 'pat: 17 Oct no', () => pt.click(cellSel(o17)));
  await settle(g, 300); mk = await marks();
  assert(mk.find(m => m.best).o === o31, 'tie on yes, 31 Oct has a maybe: ' + JSON.stringify(mk));
  await shots(g, 'gm', '.tp-schedbox');
  await shots(a, 'player', '.tp-schedbox');

  /* ---------- confirm 31 Oct ---------- */
  wp = await one(g, GM, 'confirm 31 Oct', () => g.click(`[data-act="sched.confirm"][data-o="${o31}"]`));
  s = sched(); const c = camp();
  assert(s.next && s.next.at === '2026-10-31T19:00:00.000Z' && s.next.minutes === 240 && s.next.confirmedAt, 'next set from the option: ' + JSON.stringify(s.next));
  assert(!s.options[o17] && !s.options[o31] && s.options[o14] && s.options[o28], 'options at or before it removed: ' + JSON.stringify(Object.keys(s.options)));
  assert(c.log[0] && c.log[0].text === 'Next session: Sat 31 Oct, 19:00' && c.log[0].by === GM, 'log line: ' + JSON.stringify(c.log[0]));
  assert(wp.body.schedule.options[o17] === null && wp.body.schedule.options[o31] === null && wp.body.schedule.avail[ALEX][o17] === null, 'removals written as null');
  assert(g.dialogs.some(d => /Confirm Sat 31 Oct, 19:00 as the next session\?/.test(d)), 'confirm asks first');
  await settle(g, 300);
  await shots(g, 'gm-next', '.tp-schedbox');

  /* ---------- the card, every mode ---------- */
  await settle(a, 400);
  assert(!(await a.$eval('#nextSession', n => n.hidden)), 'alex: card shown in table mode');
  const line = await a.$eval('#nextSession .nx-line', n => n.textContent);
  assert(/Sat 31 Oct/.test(line) && /19:00/.test(line) && /in 19 days/.test(line), 'card line: day, time, countdown: ' + line);
  if (!(await a.$eval('#nextSession .nx-line', n => n.getAttribute('aria-expanded') === 'true'))) await a.click('#nextSession .nx-line');
  wp = await one(a, ALEX, 'alex: I’m in (card)', () => a.click('#nextSession [data-nx="in"]'));
  assert(wp && JSON.stringify(wp.body.schedule) === JSON.stringify({ rsvp: { [ALEX]: { at: '2026-10-31T19:00:00.000Z', v: 'in' } } }), 'rsvp patch: ' + JSON.stringify(wp && wp.body));
  assert(await a.$eval('#nextSession [data-nx="in"]', n => n.getAttribute('aria-pressed')) === 'true', 'In pressed');
  /* pat answers from the creator, never opening the table again */
  await pt.click('#railBack'); await settle(pt, 300);
  assert(await pt.evaluate(() => document.body.dataset.mode) === 'create' && !(await pt.$eval('#nextSession', n => n.hidden)), 'pat: card shown in create mode');
  if (!(await pt.$eval('#nextSession .nx-line', n => n.getAttribute('aria-expanded') === 'true'))) await pt.click('#nextSession .nx-line');
  await one(pt, PAT, 'pat: can’t make it (create mode)', () => pt.click('#nextSession [data-nx="out"]'));
  await settle(a, 300);
  const who = await a.$eval('#nextSession .nx-who', n => n.textContent);
  /* gail is the GM: she owns no character and has not answered, so alex's page does not know her */
  assert(/In Alex/.test(who) && /Can’t Pat/.test(who) && !/No answer/.test(who), 'tally with names: ' + who);
  await settle(g, 200);
  const gwho = await g.$eval('.tp-schedbox .sc-rsvp', n => n.textContent);
  assert(/1 inAlex/.test(gwho) && /1 outPat/.test(gwho) && /1 no answerGail/.test(gwho), 'GM box tally: ' + gwho);
  assert(/1 in · 1 out/.test(await a.$eval('#nextSession .nx-tally', n => n.textContent)), 'tally on the line');
  /* sheet mode */
  await a.evaluate((id) => B68.openCharacter(id), charId); await settle(a, 900);
  assert(await a.evaluate(() => document.body.dataset.mode) === 'sheet' && !(await a.$eval('#nextSession', n => n.hidden)), 'alex: card shown in sheet mode');
  const subs = await a.evaluate(() => window.__subCount);
  notes.push('alex onSnapshot subscriptions after table → create → sheet: ' + subs);
  await shotCard(a, 'sheet');
  await a.click('#railBack'); await settle(a, 400);
  /* table, sheet and create share the one campaign subscription (plus the open character's) */
  await a.click('#tableBtn'); await settle(a, 500); await a.click('#railBack'); await settle(a, 300);
  assert(await a.evaluate(() => window.__subCount) === subs, 'no new campaign subscription when re-entering the table: ' + subs + ' -> ' + await a.evaluate(() => window.__subCount));

  /* ---------- ics and the Google link ---------- */
  await g.fill('[data-ui="newlog"]', '').catch(() => {});
  await one(g, GM, 'GM sets the place', async () => {
    await g.click('[data-act="sched.nextedit"]'); await settle(g, 150);
    await g.fill('[data-ui="sched.nplace"]', "Gail's flat; top floor"); await g.fill('[data-ui="sched.nnote"]', 'Bring dice, snacks'); await g.click('[data-act="sched.nextset"]');
  });
  assert(sched().next.at === '2026-10-31T19:00:00.000Z' && sched().next.place === "Gail's flat; top floor", 'place saved, date unchanged');
  assert(camp().log[0].text === 'Next session: Sat 31 Oct, 19:00', 'changing only the place logs nothing');
  await settle(a, 300);
  await a.click('#nextSession [data-nx="ics"]'); await settle(a, 300);
  const saved = await a.evaluate(() => window.__saved.slice(-1)[0]);
  assert(saved && saved.filename === 'blades68-session-2026-10-31.ics', 'ics filename: ' + (saved && saved.filename));
  const icsTxt = saved ? saved.data : '';
  const unfolded = icsTxt.replace(/\r\n /g, '');
  const L = unfolded.split('\r\n');
  assert(/\r\n/.test(icsTxt) && !/[^\r]\n/.test(icsTxt), 'ics uses CRLF');
  assert(L[0] === 'BEGIN:VCALENDAR' && L.includes('VERSION:2.0') && L.includes('BEGIN:VEVENT') && L.includes('END:VEVENT') && L[L.length - 2] === 'END:VCALENDAR', 'ics structure: ' + JSON.stringify(L));
  assert(L.includes('UID:b68-2026-10-31T19:00:00.000Z@blades68'), 'ics UID');
  assert(L.includes('DTSTART:20261031T190000Z') && L.includes('DTEND:20261031T230000Z'), 'ics DTSTART/DTEND in UTC');
  assert(L.includes("SUMMARY:Blades '68 · Lamplighters\\, Ltd"), 'ics summary with the crew name, comma escaped: ' + L.find(l => /^SUMMARY/.test(l)));
  assert(L.includes("LOCATION:Gail's flat\\; top floor") && L.includes('DESCRIPTION:Bring dice\\, snacks'), 'ics location / description escaped');
  assert(icsTxt.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75), 'ics lines folded at 75 octets');
  const gl = await a.$eval('#nextSession [data-nx="gcal"]', n => ({ href: n.href, target: n.target, rel: n.rel }));
  const gu = new (require("url").URL)(gl.href);
  assert(gu.origin + gu.pathname === 'https://calendar.google.com/calendar/render' && gu.searchParams.get('action') === 'TEMPLATE' && gu.searchParams.get('dates') === '20261031T190000Z/20261031T230000Z' && gu.searchParams.get('text') === "Blades '68 · Lamplighters, Ltd" && gu.searchParams.get('location') === "Gail's flat; top floor" && gu.searchParams.get('details') === 'Bring dice, snacks' && gl.target === '_blank' && /noopener/.test(gl.rel), 'Google Calendar link: ' + gl.href);

  /* ---------- the GM moves the session: alex's answer goes stale ---------- */
  await one(g, GM, 'GM moves the session', async () => {
    await g.click('[data-act="sched.nextedit"]'); await settle(g, 150);
    await g.fill('[data-ui="sched.ndate"]', '2026-11-01'); await g.fill('[data-ui="sched.ntime"]', '18:00'); await g.click('[data-act="sched.nextset"]');
  });
  assert(sched().next.at === '2026-11-01T18:00:00.000Z' && camp().log[0].text === 'Next session moved to Sun 1 Nov, 18:00', 'moved + logged: ' + camp().log[0].text);
  await settle(a, 300);
  assert(await a.$eval('#nextSession [data-nx="in"]', n => n.getAttribute('aria-pressed')) === 'false' && /moved the session/.test(await a.$eval('#nextSession', n => n.textContent)), 'stale RSVP reads as no answer, with a hint');
  assert(/0 in/.test(await a.$eval('#nextSession .nx-tally', n => n.textContent)), 'stale answers are not counted');
  /* countdown */
  const cdAt = async (iso) => { await setNow(a, iso); return a.$eval('#nextSession', n => n.hidden ? '(hidden)' : n.querySelector('.nx-cd').textContent); };
  const cds = { tomorrow: await cdAt('2026-10-31T12:00:00Z'), tonight: await cdAt('2026-11-01T10:00:00Z'), min: await cdAt('2026-11-01T17:20:00Z'), now: await cdAt('2026-11-01T19:00:00Z'), gone: await cdAt('2026-11-01T22:30:00Z') };
  assert(cds.tomorrow === 'tomorrow' && cds.tonight === 'tonight' && cds.min === 'in 40 min' && cds.now === 'now' && cds.gone === '(hidden)', 'countdown: ' + JSON.stringify(cds));
  await setNow(a, T0.toISOString());

  /* ---------- read only ---------- */
  const v = await person(VIC, { ro: true });
  await v.goto(URL + '#t'); await settle(v, 1400);
  assert(await v.$eval('.tp-role', n => n.textContent) === 'Read only', 'vic is read only');
  const enabled = await v.$$eval('.tp-schedbox button, .tp-schedbox input, .tp-schedbox select', ns => ns.filter(n => !n.disabled).map(n => n.outerHTML.slice(0, 60)));
  assert(!enabled.length, 'read only: every schedule control disabled: ' + enabled.join(' | '));
  if (!(await v.$eval('#nextSession .nx-line', n => n.getAttribute('aria-expanded') === 'true'))) await v.click('#nextSession .nx-line');
  assert(await v.$eval('#nextSession [data-nx="in"]', n => n.disabled) && await v.$eval('#nextSession [data-nx="out"]', n => n.disabled) && !(await v.$eval('#nextSession [data-nx="ics"]', n => n.disabled)), 'read only: RSVP disabled, calendar allowed');
  assert(/Someone/.test(await v.$eval('.sc-grid tbody', n => n.textContent).catch(() => '')) || /You/.test(await v.$eval('.sc-grid tbody', n => n.textContent).catch(() => '')), 'a person without a profile name reads as Someone / You');
  await none(v, 'read only clicks', async () => { await v.click('#nextSession [data-nx="in"]', { force: true }).catch(() => {}); await v.click(`.sc-cell[data-o="${o14}"]`, { force: true }).catch(() => {}); });
  await shots(v, 'ro', '.tp-schedbox');

  /* ---------- phone: no sideways scroll, the grid scrolls in its own box, the name column sticks ---------- */
  await a.setViewportSize({ width: 390, height: 844 }); await a.click('#tableBtn'); await settle(a, 500);
  await overflow(a, 'alex phone table');
  const sc = await a.$eval('.sc-scroll', n => ({ sw: n.scrollWidth, cw: n.clientWidth }));
  notes.push('phone grid scroll ' + JSON.stringify(sc));
  assert(sc.sw > sc.cw, 'phone: the grid scrolls inside its box with five dates');
  assert(await a.$eval('.sc-grid tbody .sc-who', n => getComputedStyle(n).position) === 'sticky', 'name column sticky');
  const before = await a.$eval('.sc-grid tbody tr .sc-who', n => n.getBoundingClientRect().left);
  await a.$eval('.sc-scroll', n => { n.scrollLeft = 200; }); await settle(a, 100);
  const after = await a.$eval('.sc-grid tbody tr .sc-who', n => n.getBoundingClientRect().left);
  assert(Math.abs(before - after) < 1, 'name column stays put while the grid scrolls: ' + before + ' → ' + after);
  await a.$eval('.sc-scroll', n => { n.scrollLeft = 0; });
  /* the card is one line when collapsed, and the creator's figure starts just below it */
  await a.click('#railBack'); await settle(a, 400);
  if (await a.$eval('#nextSession .nx-line', n => n.getAttribute('aria-expanded') === 'true')) await a.click('#nextSession .nx-line');
  await settle(a, 100);
  const ch = await a.$eval('#nextSession', n => n.getBoundingClientRect().height);
  assert(ch <= 44, 'phone: collapsed card is one line: ' + ch + 'px');
  await overflow(a, 'alex phone create');
  await shotPage(a, 'create-phone');
  await a.click('#nextSession .nx-line'); await settle(a, 150);
  await overflow(a, 'alex phone create, card open');
  await shotPage(a, 'create-phone-open');
  await a.click('#nextSession .nx-line'); await settle(a, 100);
  await a.setViewportSize({ width: 1360, height: 900 });
  await a.click('#nextSession .nx-line'); await settle(a, 150);
  await shotPage(a, 'create-desk');

  /* ---------- dark mode ---------- */
  for (const pg of [g, a]) await pg.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const dk = await g.evaluate(() => { const c = document.querySelector('.sc-cell.v-yes'); const st = c && getComputedStyle(c); return st ? st.backgroundColor : ''; });
  assert(dk === 'rgb(224, 105, 30)', 'dark: yes cells in the dark accent: ' + dk);
  await shotPage(a, 'create-desk-dark');
  for (const pg of [g, a]) await pg.evaluate(() => { delete document.documentElement.dataset.theme; });

  /* ---------- print hides the buttons ---------- */
  await g.emulateMedia({ media: 'print' });
  const printBtns = await g.$$eval('.tp-schedbox .btn, .tp-schedbox .sc-tools, .tp-schedbox .sc-confirm, #nextSession', ns => ns.filter(n => getComputedStyle(n).display !== 'none').length);
  assert(printBtns === 0, 'print hides the schedule buttons and the card: ' + printBtns);
  await g.emulateMedia({ media: 'screen' });

  /* ---------- starting the session clears next and the dates around it, in the same write ---------- */
  await setNow(g, '2026-11-01T17:55:00Z');
  await g.reload(); await settle(g, 1200);
  wp = await one(g, GM, 'start session', () => g.click('[data-act="sessstart"]'));
  s = sched();
  assert(!s.next && s.options[o14] && s.options[o28] && camp().session.number === 1, 'session start cleared next, kept later dates: ' + JSON.stringify({ next: s.next, opts: Object.keys(s.options).length }));
  assert(wp && wp.body.session && wp.body.schedule && wp.body.schedule.next === null && wp.body.log, 'one write carries session, log and schedule: ' + keysOf(wp && wp.body));
  await settle(a, 300);
  assert(await a.$eval('#nextSession', n => n.hidden), 'card hidden once next is cleared');

  /* ---------- the rest of the page still behaves ---------- */
  await one(g, GM, 'GM log line', async () => { await g.fill('[data-ui="newlog"]', 'Scored'); await g.click('[data-act="logadd"]'); });
  assert(keysOf(lastW(GM).body) === '["log","updatedAt"]', 'a log append carries no schedule: ' + keysOf(lastW(GM).body));

  console.log('NOTES:\n' + notes.join('\n'));
  console.log('FAILS:', fails.length ? '\n' + fails.join('\n') : 'none');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await b.close();
  process.exit(fails.length || errs.length ? 1 : 0);

  async function shots(p, tag, sel) {
    const vp = p.viewportSize();
    for (const [w, wt] of [[1360, 'desk'], [390, 'phone']]) {
      await p.setViewportSize({ width: w, height: 900 }); await settle(p, 200);
      for (const theme of ['light', 'dark']) {
        await p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme); await settle(p, 100);
        await overflow(p, tag + ' ' + wt + ' ' + theme);
        await p.locator(sel).screenshot({ path: path.join(OUT, 'schedule-' + tag + '-' + wt + '-' + theme + '.png') });
      }
    }
    await p.evaluate(() => { delete document.documentElement.dataset.theme; });
    await p.setViewportSize(vp); await settle(p, 150);
  }
  async function shotCard(p, tag) { await p.screenshot({ path: path.join(OUT, 'schedule-card-' + tag + '.png'), clip: { x: 0, y: 0, width: p.viewportSize().width, height: Math.min(700, p.viewportSize().height) } }); }
  async function shotPage(p, tag) { await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: path.join(OUT, 'schedule-' + tag + '.png') }); }
})().catch(e => { console.error('FAILED', e); process.exit(1); });
