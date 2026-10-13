process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the table page (CAMPAIGN.md): the shared campaign document campaign/main, GM / player / read-only.
   Run from this dir: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node campaign.js */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, 'out');

/* The stubbed window.claude. The store survives reloads (localStorage) so the same table can be reopened as another
   role; the role is localStorage.__role: gm | player | ro | owner (no canEdit, isOwner true) | nodb. Doc paths are
   "collection/id"; update() deep merges (objects merge, arrays and scalars replace) and refuses a missing doc. */
const STUB = `(() => {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('__stub') || '{}'); } catch (e) {}
  const store = saved; const colSubs = {}; const docSubs = {};
  const role = (() => { try { return localStorage.getItem('__role') || 'gm'; } catch (e) { return 'gm'; } })();
  const persist = () => { try { localStorage.setItem('__stub', JSON.stringify(store)); } catch (e) {} };
  const copy = (o) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  const dm = (t, s) => { for (const k in s) { const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) dm(t[k], v); else t[k] = v; } return t; };
  const snapOf = (p) => ({ id: p.split('/')[1], exists: p in store, data: () => copy(store[p]), metadata: {} });
  const query = (c) => { const docs = Object.keys(store).filter(p => p.indexOf(c + '/') === 0).map(snapOf).sort((a, b) => (store[c + '/' + b.id].updatedAt || '').localeCompare(store[c + '/' + a.id].updatedAt || '')); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
  const fire = (p) => { (docSubs[p] || []).forEach(fn => fn(snapOf(p))); const c = p.split('/')[0]; (colSubs[c] || []).forEach(fn => fn(query(c))); };
  const docRef = (c, id) => { const p = c + '/' + id; return { id,
    get: async () => snapOf(p),
    set: async (d) => { store[p] = copy(d); window.__writes.push(['set', p]); window.__patches.push(['set', p, copy(d)]); persist(); fire(p); },
    update: async (u) => { if (!(p in store)) throw new Error('No document to update: ' + p); dm(store[p], copy(u)); window.__writes.push(['update', p]); window.__patches.push(['update', p, copy(u)]); persist(); fire(p); },
    delete: async () => { delete store[p]; window.__writes.push(['delete', p]); persist(); fire(p); },
    onSnapshot: (fn) => { (docSubs[p] = docSubs[p] || []).push(fn); setTimeout(() => fn(snapOf(p)), 0); return () => { docSubs[p] = (docSubs[p] || []).filter(f => f !== fn); window.__unsubs.push(p); }; } }; };
  const col = (c) => { const q = () => ({ orderBy: q, limit: q, where: q, get: async () => query(c), onSnapshot: (fn) => { (colSubs[c] = colSubs[c] || []).push(fn); setTimeout(() => fn(query(c)), 0); return () => {}; } }); return Object.assign(q(), { doc: (id) => docRef(c, id), path: c }); };
  window.__writes = []; window.__patches = []; window.__unsubs = []; window.__store = store; window.__role = role;
  /* another viewer changes the campaign: not counted as this page's write */
  window.__remote = (patch) => { const p = 'campaign/main'; store[p] = dm(store[p] || {}, copy(patch)); persist(); fire(p); };
  const ids = { gm: 'u_gm', owner: 'u_gm', player: 'u_player', ro: 'u_viewer', nodb: 'u_gm' };
  const user = { id: async () => ids[role], can: async (n) => n === 'data.write' ? role !== 'ro' : true, isOwner: async () => role === 'gm' || role === 'owner',
    me: async () => ({ id: ids[role], name: '', email: null }), profiles: async (list) => { const names = { u_gm: 'Gail the GM', u_player: 'Pat' }; const o = {}; list.forEach(id => { o[id] = { id, name: names[id] || '' }; }); return o; } };
  if (role !== 'owner') user.canEdit = async () => role === 'gm';
  window.claude = { use: async (name) => ({ db: role === 'nodb' ? null : { collection: col, doc: (p) => docRef(p.split('/')[0], p.split('/')[1]) }, user, downloads: { save: async () => {} } })[name] || null };
})();`;

const SHEET = `(pb) => {
  const CT = B68Content, P = CT.byId[pb], S = B68.S;
  B68.choosePlaybook(pb);
  const sh = S.sheet;
  sh.name = { hound: 'Aldo Crane', hull: 'Unit Seven', timetraveler: 'Unit Kessel' }[pb]; sh.alias = { hound: 'Dusty', hull: '', timetraveler: 'The Visitor' }[pb];
  sh.heritage = 'Akoros'; sh.background = 'Underworld'; sh.look = 'Lean, weathered.'; sh.wearing = ['Trench coat'];
  const dots = Object.assign({}, P.printed || {});
  if (pb === 'hound') Object.assign(dots, { Hunt: 2, Survey: 1, Prowl: 1, Skirmish: 1, Consort: 2 });
  if (pb === 'hull') Object.assign(dots, { Skirmish: 2, Attune: 1, Wreck: 2, Tinker: 1 });
  if (pb === 'timetraveler') Object.assign(dots, { Hunt: 2, Tinker: 3, Finesse: 1, Skirmish: 2, Attune: 1 });
  sh.dots = dots;
  if (pb === 'hound') { sh.ability = P.abilities[0][0]; sh.keys = P.keys.slice(0, 3); sh.contacts = {}; sh.contacts[P.contacts[0][0]] = 'friend'; sh.contacts[P.contacts[1][0]] = 'rival'; sh.vice = 'Gambling'; sh.purveyor = 'The Docks'; sh.items = [P.items[0][0], 'Binoculars']; }
  if (pb === 'hull') { sh.ability = P.abilities[0][0]; sh.owning = P.owning[0]; sh.items = [P.items[0][0]]; }
  if (pb === 'timetraveler') { sh.ability = P.abilities[1][0]; sh.keys = CT.GENERIC_KEYS.slice(8, 11); sh.mission = P.missions[0].name; sh.missionAnswers = ['A drowned Doskvol', '', '', '']; sh.items = [P.items[0][0]]; }
  if (B68.syncNameToSpec) B68.syncNameToSpec(); B68.changed();
  B68.fileCharacter();
}`;

(async () => {
  const b = await chromium.launch();
  const errs = [], fails = [], notes = [];
  const assert = (ok, msg) => { if (!ok) fails.push(msg); };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/ERR_FILE_NOT_FOUND/.test(t)) errs.push('console.error: ' + t); } });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

  const mode = () => p.evaluate(() => document.body.dataset.mode);
  const camp = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__store['campaign/main'] || null)));
  const cw = () => p.evaluate(() => window.__writes.filter(w => w[1] === 'campaign/main').length);
  const lastPatch = () => p.evaluate(() => { const l = window.__patches.filter(w => w[1] === 'campaign/main'); return l.length ? l[l.length - 1] : null; });
  const dis = (sel) => p.$eval(sel, n => !!n.disabled).catch(() => 'missing');
  /* one action -> exactly one write */
  async function one(label, fn, wait = 250) {
    const before = await cw(); await fn(); await p.waitForTimeout(wait);
    const n = (await cw()) - before; assert(n === 1, label + ': expected 1 write, got ' + n); return n;
  }
  async function none(label, fn, wait = 300) {
    const before = await cw(); await fn(); await p.waitForTimeout(wait);
    const n = (await cw()) - before; assert(n === 0, label + ': expected no write, got ' + n);
  }
  async function overflow(name) {
    const sw = await p.evaluate(() => document.documentElement.scrollWidth), w = await p.evaluate(() => document.documentElement.clientWidth);
    if (sw > w) errs.push(name + ': horizontal overflow ' + sw + '>' + w);
    const out = await p.evaluate(() => { const R = document.getElementById('table-page').getBoundingClientRect(); const o = []; document.querySelectorAll('#table-page *').forEach(n => { const r = n.getBoundingClientRect(); if (r.width && (r.right > R.right + 1 || r.left < R.left - 1)) o.push((n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) + ' ' + Math.round(r.left) + '-' + Math.round(r.right)); }); return o.slice(0, 5); });
    if (out.length) errs.push(name + ': elements outside the page: ' + out.join(' | '));
  }
  async function shots(prefix) {
    for (const [w, tag] of [[1360, 'desk'], [390, 'phone']]) {
      await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(250);
      for (const theme of ['light', 'dark']) {
        await p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme); await p.waitForTimeout(120);
        await overflow(prefix + ' ' + tag + ' ' + theme);
        await p.locator('#table-page').screenshot({ path: path.join(OUT, 'campaign-' + prefix + '-' + tag + '-' + theme + '.png') });
      }
    }
    await p.evaluate(() => { delete document.documentElement.dataset.theme; });
    await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(150);
  }

  /* ---------- GM ---------- */
  await p.goto(URL); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('__role', 'gm'); }); await p.reload(); await p.waitForTimeout(1200);
  assert(!!(await p.$('#tableBtn')), 'header has The table button');
  /* file three characters, then give them owners: the GM, a player, nobody */
  const ids = {};
  for (const pb of ['hound', 'hull', 'timetraveler']) {
    await p.evaluate(`(${SHEET})(${JSON.stringify(pb)}); true`); await p.waitForTimeout(900);
    ids[pb] = await p.evaluate(() => B68.S.sheet.docId);
    await p.click('#homeBtn'); await p.waitForTimeout(250); await p.evaluate(() => B68.newCharacter()); await p.waitForTimeout(30);
  }
  await p.evaluate(async (ids) => {
    const db = await window.claude.use('db'); const c = db.collection('characters');
    const put = async (id, f) => { const d = JSON.parse(JSON.stringify(window.__store['characters/' + id])); f(d); d.updatedAt = new Date().toISOString(); await c.doc(id).set(d); };
    await put(ids.hound, d => { d.play.stress = 4; });
    await put(ids.hull, d => { d.owner = 'u_player'; d.play.stress = 3; });
    await put(ids.timetraveler, d => { d.owner = null; });
  }, ids);
  await p.waitForTimeout(300);
  const writesBefore = await cw();
  await p.click('#tableBtn'); await p.waitForTimeout(500);
  assert((await mode()) === 'table', 'table mode after the button: ' + (await mode()));
  assert((await p.evaluate(() => location.hash)) === '#t', 'hash #t');
  assert(await p.$eval('#dossier', n => getComputedStyle(n).display === 'none') && await p.$eval('.studio', n => getComputedStyle(n).display === 'none') && await p.$eval('.roster', n => getComputedStyle(n).display === 'none'), 'studio, roster, dossier hidden in table mode');
  assert(await p.$eval('#homeBtn', n => getComputedStyle(n).display !== 'none') && (await p.$eval('#tableBtn', n => n.getAttribute('aria-current'))) === 'page' && (await p.$eval('#viewName', n => n.textContent)) === 'The table', 'nav: Home shown, The table marked current in table mode');
  assert((await cw()) === writesBefore && (await camp()) === null, 'opening writes nothing');
  /* defaults */
  assert((await p.$eval('#tp-crewname', n => n.textContent)) === 'An unnamed crew', 'default crew name heading');
  assert((await p.$eval('.tp-sessno b', n => n.textContent)) === '—', 'default session —');
  assert((await p.$eval('.tp-role', n => n.textContent)) === 'GM', 'role GM');
  assert((await p.$$eval('.tp-crewbox [data-act="crew.tier"].on', n => n.length)) === 0, 'tier 0');
  assert(!!(await p.$('[data-act="sessstart"]')) && !(await dis('[data-act="sessstart"]')) && (await dis('[data-act="sessend"]')) === true, 'GM: start enabled, end disabled with no session');
  assert((await p.$eval('[data-act="sessstart"]', n => n.textContent)) === 'Start session 1', 'Start session 1 label');
  assert(/Each player ends the session on their own sheet/.test(await p.$eval('.tp-sessbox', n => n.textContent)), 'session reminder line');
  assert(!/The GM starts sessions/.test(await p.$eval('.tp-sessbox', n => n.textContent)), 'GM: no "The GM starts sessions" line');
  assert((await p.$$eval('#tp-schedule', n => n.length)) === 1 && (await p.$eval('#tp-schedule', n => n.classList.contains('tp-schedbox'))), 'the schedule box is #tp-schedule, once on the page');
  /* layout: two columns on a wide screen (the crew on the left); on a phone session, schedule, clocks, players, crew, log */
  const BOXES = ['.tp-sessbox', '#tp-schedule', '.tp-clockbox', '.tp-playbox', '.tp-crewbox', '.tp-logbox'];
  const boxes = () => p.evaluate((sels) => sels.map(s => { const r = document.querySelector('#table-page ' + s).getBoundingClientRect(); return { s, top: Math.round(r.top + scrollY), left: Math.round(r.left), w: Math.round(r.width) }; }), BOXES);
  async function phoneOrder(who) {
    const cols = await p.evaluate(() => ['.tp-colA', '.tp-colB'].map(s => { const r = document.querySelector('#table-page ' + s).getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width) }; }));
    assert(cols[0].left < cols[1].left && cols[0].top === cols[1].top && cols[1].w < 700, who + ' desk: the crew column left of the schedule column, side by side: ' + JSON.stringify(cols));
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(250);
    const bx = await boxes();
    assert(bx.every((b, i) => !i || b.top > bx[i - 1].top), who + ' phone: session, schedule, clocks, players, crew, log top to bottom: ' + bx.map(b => b.s + '@' + b.top).join(' '));
    assert(bx[1].top < (await p.evaluate(() => document.querySelector('#table-page .cs-pickbox, #table-page .tp-crewbox').getBoundingClientRect().top + scrollY)), who + ' phone: the schedule above the crew sheet');
    await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(150);
  }
  await phoneOrder('GM');

  /* crew: name (typed, debounced: one write), tier, rep, heat */
  await one('crew name', async () => { await p.click('[data-path="crew.name"]'); await p.keyboard.type('The Lamplighters', { delay: 15 }); }, 800);
  let c = await camp();
  assert(c && c.crew.name === 'The Lamplighters' && c.v === 1 && Array.isArray(c.clocks) && c.session.number === 0, 'first write creates the whole document: ' + JSON.stringify(c && c.crew.name));
  assert((await p.$eval('#tp-crewname', n => n.textContent)) === 'The Lamplighters', 'heading follows the name');
  await one('tier 2', () => p.click('[data-act="crew.tier"][data-n="2"]'));
  await one('rep 3', () => p.click('[data-act="crew.rep"][data-n="3"]'));
  await one('heat 4', () => p.click('[data-act="crew.heat"][data-n="4"]'));
  await one('hold strong', () => p.click('[data-act="crew.hold"][data-v="strong"]'));
  const lp = await lastPatch(); assert(lp && lp[0] === 'update' && JSON.stringify(Object.keys(lp[2]).sort()) === '["crew","updatedAt"]' && JSON.stringify(lp[2].crew) === '{"hold":"strong"}', 'crew patch carries only the changed field: ' + JSON.stringify(lp && lp[2]));
  await one('vault 5', () => p.click('[data-act="crew.vault"][data-n="5"]'));
  await one('add claim', () => p.click('[data-act="crew.claimadd"]'));
  assert(await p.evaluate(() => document.activeElement && document.activeElement.dataset.path === 'crew.claims.0.name'), 'new claim input focused');
  await one('claim name', () => p.keyboard.type('Gambling den', { delay: 10 }), 800);
  await one('claim held', () => p.click('[data-act="crew.claimheld"][data-i="0"]'));
  await one('add cohort', () => p.click('[data-act="crew.cohortadd"]'));
  await one('cohort harm', () => p.click('[data-act="crew.cohortharm"][data-i="0"][data-v="impaired"]'));
  await one('add faction', () => p.click('[data-act="crew.factionadd"]'));
  await one('faction -2', () => p.click('[data-act="crew.factionstatus"][data-i="0"][data-v="-2"]'));
  c = await camp();
  assert(c.crew.tier === 2 && c.crew.rep === 3 && c.crew.heat === 4 && c.crew.hold === 'strong' && c.crew.vault === 5, 'crew tracks stored: ' + JSON.stringify(c.crew));
  assert(c.crew.claims.length === 1 && c.crew.claims[0].held && c.crew.claims[0].name === 'Gambling den' && c.crew.cohorts[0].harm === 'impaired' && c.crew.factions[0].status === -2, 'crew lists stored');

  /* clocks: add (size 8), fill 3, hide; a second, visible project clock for the player */
  await none('choose size 8 (no write)', async () => { await p.fill('[data-ui="newclock"]', 'The Bluecoats close in'); await p.click('[data-act="newsize"][data-n="8"]'); });
  assert((await p.$eval('[data-ui="newclock"]', n => n.value)) === 'The Bluecoats close in', 'draft name kept across a redraw');
  await one('add clock', () => p.click('[data-act="clockadd"]'));
  c = await camp(); const k1 = c.clocks[0];
  assert(c.clocks.length === 1 && /^c_[a-z0-9]+$/.test(k1.id) && k1.size === 8 && k1.filled === 0 && k1.kind === 'danger' && k1.hidden === false && k1.name === 'The Bluecoats close in', 'clock added: ' + JSON.stringify(k1));
  await one('fill 3', () => p.click(`.tp-seg[data-id="${k1.id}"][data-n="3"]`));
  await one('hide', () => p.click(`[data-act="clockhide"][data-id="${k1.id}"]`));
  c = await camp();
  assert(c.clocks[0].filled === 3 && c.clocks[0].hidden === true, 'clock filled 3, hidden');
  assert(/hidden from players/.test(await p.$eval(`.tp-clock[data-id="${k1.id}"]`, n => n.textContent)), 'GM sees the hidden tag');
  await p.fill('[data-ui="newclock"]', 'Heist the vault'); await p.click('[data-act="newsize"][data-n="6"]'); await p.click('[data-act="newkind"][data-v="project"]');
  await one('add second clock (Enter)', async () => { await p.focus('[data-ui="newclock"]'); await p.keyboard.press('Enter'); });
  c = await camp(); const k2 = c.clocks[1];
  assert(k2 && k2.size === 6 && k2.kind === 'project' && k2.id !== k1.id, 'second clock: ' + JSON.stringify(k2));
  await one('rename clock', async () => { await p.click(`.tp-clock[data-id="${k2.id}"] .tp-in`); await p.keyboard.press('End'); await p.keyboard.type(' (stage 1)', { delay: 10 }); }, 800);
  assert((await camp()).clocks[1].name === 'Heist the vault (stage 1)', 'clock renamed');
  await one('resize clock', () => p.click(`[data-act="clocksize"][data-id="${k2.id}"][data-n="8"]`));
  await one('third clock', async () => { await p.fill('[data-ui="newclock"]', 'Doomed'); await p.click('[data-act="clockadd"]'); });
  const k3 = (await camp()).clocks[2];
  await one('delete clock (confirm)', () => p.click(`[data-act="clockrm"][data-id="${k3.id}"]`));
  assert((await camp()).clocks.length === 2 && dialogs.some(d => /Delete the clock/.test(d)), 'clock deleted after confirm');

  /* session 1 */
  await one('start session', () => p.click('[data-act="sessstart"]'));
  c = await camp();
  assert(c.session.number === 1 && c.session.startedAt && c.session.endedAt === null, 'session 1 started: ' + JSON.stringify(c.session));
  assert(c.log[0] && c.log[0].text === 'Session 1 started' && c.log[0].by === 'u_gm' && c.log[0].at, 'session log line: ' + JSON.stringify(c.log[0]));
  assert((await p.$eval('.tp-sessno b', n => n.textContent)) === '1' && (await p.$eval('[data-act="sessstart"]', n => n.textContent)) === 'Start session 2' && !(await dis('[data-act="sessend"]')), 'session bar shows 1, end enabled');
  /* log */
  await one('GM log line', async () => { await p.fill('[data-ui="newlog"]', 'Scored the warehouse'); await p.click('[data-act="logadd"]'); });
  c = await camp(); assert(c.log[0].text === 'Scored the warehouse' && c.log.length === 2, 'log newest first');
  assert(/Gail the GM/.test(await p.$eval('.tp-log li', n => n.textContent)), 'log author named through profiles');

  /* players: grouped by owner, names through profiles, Unowned last */
  const groups = await p.$$eval('.tp-group', gs => gs.map(g => ({ head: g.querySelector('.tp-ghead b').textContent, you: !!g.querySelector('.tp-you'), chars: Array.from(g.querySelectorAll('.tp-char')).map(li => li.querySelector('.tp-cn b').textContent + ' | ' + li.querySelector('.tp-cs').textContent) })));
  notes.push('groups: ' + JSON.stringify(groups));
  assert(groups.length === 3 && groups[0].head === 'Gail the GM' && groups[0].you && groups[1].head === 'Pat' && groups[2].head === 'Unowned', 'groups in order you, Pat, Unowned: ' + groups.map(g => g.head).join(','));
  assert(groups[0] && /^Aldo Crane \| Stress4\/9/.test(groups[0].chars[0]), 'hound under the GM with Stress 4/9: ' + (groups[0] && groups[0].chars[0]));
  assert(groups[1] && /^Unit Seven \| Drain3\/10/.test(groups[1].chars[0]), 'hull under Pat with Drain 3/10: ' + (groups[1] && groups[1].chars[0]));
  assert(groups[2] && /^Unit Kessel/.test(groups[2].chars[0]), 'time traveler unowned');
  /* a roster change reaches the open page */
  await p.evaluate(async (id) => { const db = await window.claude.use('db'); const d = JSON.parse(JSON.stringify(window.__store['characters/' + id])); d.play.stress = 6; d.updatedAt = new Date().toISOString(); await db.collection('characters').doc(id).set(d); }, ids.hull);
  await p.waitForTimeout(250);
  assert(/Drain6\/10/.test(await p.$eval(`.tp-char[data-id="${ids.hull}"]`, n => n.textContent)), 'roster update re-renders the players');

  /* a remote change while the crew name is being typed: focus and text stay; only the name is sent */
  await p.click('[data-path="crew.name"]'); await p.keyboard.press('End'); await p.keyboard.type(' Gang', { delay: 10 });
  const wr0 = await cw();
  await p.evaluate(() => window.__remote({ crew: { heat: 7, lair: 'The old gasworks' } })); await p.waitForTimeout(60);
  const f = await p.evaluate(() => ({ path: document.activeElement && document.activeElement.dataset.path, value: document.activeElement && document.activeElement.value, s: document.activeElement && document.activeElement.selectionStart }));
  assert(f.path === 'crew.name' && f.value === 'The Lamplighters Gang' && f.s === f.value.length, 'focus and text kept through a remote update: ' + JSON.stringify(f));
  assert((await p.$$eval('[data-act="crew.heat"].on', n => n.length)) === 7 && (await p.$eval('[data-path="crew.lair"]', n => n.value)) === 'The old gasworks', 'remote heat and lair shown');
  await p.waitForTimeout(700);
  assert((await cw()) - wr0 === 1, 'typed name saved once after the remote update');
  c = await camp(); const np = await lastPatch();
  assert(c.crew.name === 'The Lamplighters Gang' && c.crew.heat === 7 && c.crew.lair === 'The old gasworks', 'remote fields survive the name save: ' + JSON.stringify({ n: c.crew.name, h: c.crew.heat, l: c.crew.lair }));
  assert(np && JSON.stringify(np[2].crew) === '{"name":"The Lamplighters Gang"}', 'name patch only: ' + JSON.stringify(np && np[2]));
  /* the GM removes a log line: a whole-document set */
  await one('GM removes a log line', () => p.click('[data-act="logrm"][data-i="0"]'));
  c = await camp(); const rp = await lastPatch();
  assert(rp && rp[0] === 'set' && c.log.length === 1 && c.log[0].text === 'Session 1 started', 'log line removed with a set: ' + (rp && rp[0]));
  await one('GM log again', async () => { await p.fill('[data-ui="newlog"]', 'Scored the warehouse'); await p.keyboard.press('Enter'); });

  /* open a character from the table, then #t brings the table back */
  await p.click(`.tp-char[data-id="${ids.hound}"] [data-act="open"]`); await p.waitForTimeout(500);
  assert((await mode()) === 'sheet' && (await p.evaluate(() => location.hash)) === '#c/' + ids.hound, 'Open goes to the sheet');
  /* the campaign subscription now lives for the whole page (the next-session card reads it in every mode, SCHEDULE.md) */
  assert((await p.evaluate(() => window.__unsubs.filter(x => x === 'campaign/main').length)) === 0, 'leaving the table keeps the one campaign subscription');
  await p.evaluate(() => { location.hash = '#t'; }); await p.waitForTimeout(500);
  assert((await mode()) === 'table' && (await p.$eval('#tp-crewname', n => n.textContent)) === 'The Lamplighters Gang', 'hash #t reopens the table');
  await p.evaluate(() => history.back()); await p.waitForTimeout(400);
  notes.push('after back: ' + (await mode()) + ' ' + (await p.evaluate(() => location.hash)));
  await p.evaluate(() => { location.hash = '#t'; }); await p.waitForTimeout(400);
  await shots('gm');

  /* ---------- player ---------- */
  await p.evaluate(() => localStorage.setItem('__role', 'player'));
  await p.goto(URL + '#t'); await p.reload(); await p.waitForTimeout(1300);
  assert((await mode()) === 'table', 'player: #t opens the table on load');
  assert((await p.$eval('.tp-role', n => n.textContent)) === 'Player', 'role Player');
  assert(!(await p.$(`.tp-clock[data-id="${k1.id}"]`)) && (await p.$$eval('.tp-clock', n => n.length)) === 1, 'player: hidden clock not rendered, one visible');
  assert(!/hidden/i.test(await p.$eval('.tp-clockbox .tp-band', n => n.textContent)), 'player: no hidden count');
  assert(!(await p.$('[data-act="sessstart"]')) && !(await p.$('[data-act="sessend"]')) && !(await p.$('#table-page [data-gm]:not(input):not(textarea)')), 'player: no GM-only session buttons (hidden, not disabled)');
  assert(/The GM starts sessions\. Each player ends the session on their own sheet/.test(await p.$eval('.tp-sessbox', n => n.textContent)), 'player: "The GM starts sessions." in the session box');
  await phoneOrder('player');
  assert((await dis(`.tp-clock[data-id="${k2.id}"] .tp-in`)) === true, 'player: clock name disabled');
  assert(!(await p.$('[data-act="clockadd"]')) && !(await p.$('[data-act="clocksize"]')) && !(await p.$('[data-act="logrm"]')), 'player: no clock structure tools, no log removal');
  assert((await dis('[data-act="crew.tier"]')) === false && (await dis('[data-path="crew.name"]')) === false, 'player: crew panel editable (shared crew sheet)');
  const storedClocks = (await camp()).clocks;
  await one('player fills a clock', () => p.click(`.tp-seg[data-id="${k2.id}"][data-n="2"]`));
  const fp = await lastPatch(); c = await camp();
  const expect = JSON.parse(JSON.stringify(storedClocks)); expect[1].filled = 2;
  assert(fp && JSON.stringify(Object.keys(fp[2]).sort()) === '["clocks","updatedAt"]' && JSON.stringify(fp[2].clocks) === JSON.stringify(expect), 'player clock patch = stored clocks with only filled changed: ' + JSON.stringify(fp && fp[2]));
  assert(c.clocks[0].hidden === true && c.clocks[0].filled === 3 && c.clocks[1].filled === 2, 'hidden clock kept');
  await one('player heat', () => p.click('[data-act="crew.heat"][data-n="8"]'));
  assert(JSON.stringify((await lastPatch())[2].crew) === '{"heat":8}', 'player heat patch');
  await one('player tier', () => p.click('[data-act="crew.tier"][data-n="3"]'));
  const logBefore = (await camp()).log;
  await one('player log', async () => { await p.fill('[data-ui="newlog"]', 'Pat owes the Lampblacks'); await p.click('[data-act="logadd"]'); });
  c = await camp(); const lg = await lastPatch();
  assert(c.log[0].text === 'Pat owes the Lampblacks' && c.log[0].by === 'u_player' && JSON.stringify(lg[2].log.slice(1)) === JSON.stringify(logBefore), 'player log append keeps the stored lines: ' + JSON.stringify(lg && lg[2].log));
  await none('player forces start session', () => p.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-act', 'sessstart'); document.querySelector('.tp-sessbox .tp-body').appendChild(b); b.click(); }));
  assert((await camp()).session.number === 1, 'player cannot start a session');
  /* Print the season (header, every role): opens the print view; Back returns to the table; never printed itself */
  assert((await dis('.tp-head [data-act="print"]')) === false, 'player: Print the season in the header, enabled');
  await p.emulateMedia({ media: 'print' });
  assert(await p.$eval('[data-act="print"]', n => getComputedStyle(n).display === 'none'), 'Print the season does not print');
  await p.emulateMedia({ media: null });
  for (const [w, tag] of [[1360, 'desk'], [390, 'phone']]) {
    await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(200);
    for (const theme of ['light', 'dark']) {
      await p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme); await p.waitForTimeout(100);
      await p.locator('#table-page .tp-head').screenshot({ path: path.join(OUT, 'campaign-head-' + tag + '-' + theme + '.png') });
    }
  }
  await p.evaluate(() => { delete document.documentElement.dataset.theme; }); await p.setViewportSize({ width: 1360, height: 900 });
  await none('player opens the season print and comes back', async () => {
    await p.click('[data-act="print"]');
    await p.waitForFunction(() => { const s = document.getElementById('season'); return s && s.dataset.state === 'ready'; }, null, { timeout: 15000 }).catch(() => {});
    assert((await mode()) === 'print' && await p.$eval('#season', n => !n.hidden && getComputedStyle(n).display !== 'none'), 'player: Print the season opens the print view: ' + (await mode()));
    assert(await p.$eval('#table-page', n => getComputedStyle(n).display === 'none'), 'player: the table is hidden under the print');
    await p.click('#season [data-sn="back"]'); await p.waitForTimeout(600);
    assert((await mode()) === 'table' && (await p.evaluate(() => location.hash)) === '#t', 'player: Back from the print returns to the table: ' + (await mode()));
    assert(!!(await p.$(`.tp-clock[data-id="${k2.id}"]`)), 'player: the table is drawn again after Back');
  });
  await shots('player');

  /* ---------- read only ---------- */
  await p.evaluate(() => localStorage.setItem('__role', 'ro'));
  await p.goto(URL + '#t'); await p.reload(); await p.waitForTimeout(1300);
  assert((await p.$eval('.tp-role', n => n.textContent)) === 'Read only', 'role Read only');
  const enabled = await p.$$eval('#table-page button, #table-page input, #table-page textarea, #table-page select', ns => ns.filter(n => !n.disabled).map(n => n.dataset.act || n.dataset.path || n.dataset.ui || n.tagName));
  assert(enabled.length && enabled.every(a => a === 'open' || a === 'print' || a === 'cast' || a === 'crew.cspick') && enabled.indexOf('print') >= 0, 'read only: only Open, The cast, Print the season and the crew covers toggle stay enabled: ' + enabled.join(','));
  assert(!(await p.$('[data-act="sessstart"]')) && /The GM starts sessions/.test(await p.$eval('.tp-sessbox', n => n.textContent)), 'read only: no session buttons, the GM line instead');
  await none('read only clicks', async () => {
    await p.click('[data-act="crew.tier"][data-n="5"]', { force: true }).catch(() => {});
    await p.click(`.tp-seg[data-id="${k2.id}"][data-n="4"]`, { force: true }).catch(() => {});
    await p.evaluate(() => { const n = document.querySelector('[data-path="crew.name"]'); n.value = 'Hacked'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  }, 800);
  assert((await camp()).crew.tier === 3 && (await camp()).clocks[1].filled === 2, 'read only changed nothing');

  /* ---------- artifact owner without canEdit: isOwner decides ---------- */
  await p.evaluate(() => localStorage.setItem('__role', 'owner'));
  await p.goto(URL + '#t'); await p.reload(); await p.waitForTimeout(1300);
  assert((await p.$eval('.tp-role', n => n.textContent)) === 'GM' && !!(await p.$(`.tp-clock[data-id="${k1.id}"]`)), 'owner (no canEdit) is the GM and sees the hidden clock');

  /* ---------- no db: a clear note ---------- */
  await p.evaluate(() => localStorage.setItem('__role', 'nodb'));
  await p.goto(URL + '#t'); await p.reload(); await p.waitForTimeout(1300);
  assert((await mode()) === 'table' && /The table needs the shared files/.test(await p.$eval('#table-page', n => n.textContent)), 'no db: shared-files note');
  await p.evaluate(() => localStorage.clear());

  /* ---------- no window.claude at all ---------- */
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errs.push('no-claude pageerror: ' + e.message)); p2.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('no-claude console.error: ' + m.text()); });
  await p2.goto(URL); await p2.waitForTimeout(900);
  await p2.click('#tableBtn'); await p2.waitForTimeout(300);
  assert(/The table needs the shared files/.test(await p2.$eval('#table-page', n => n.textContent)), 'no window.claude: shared-files note');
  await p2.click('#homeBtn'); await p2.waitForTimeout(200);
  assert((await p2.evaluate(() => document.body.dataset.mode)) === 'home', 'no window.claude: back Home');
  await ctx2.close();

  console.log('NOTES:\n' + notes.join('\n'));
  console.log('FAILS:', fails.length ? '\n' + fails.join('\n') : 'none');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await b.close();
  process.exit(fails.length || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
