process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the crew sheet on the table page (crewsheet.js + crews.js): choosing each of the six crew
   playbooks, the pre-filled state, abilities, contacts, upgrades, claims (adjacency, GM override), turf on the rep
   track, the Dealers' product, Racers' stunts and edges, the Utopians' circles, crew xp at the end of a session, the
   crew advance paying Tier+2 into every filed character's bank, migration from the generic panel, player and
   read-only gating, and exactly one write per action. Screenshots go to out/crewsheet-*.png.
   Run from this dir: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node crewsheet.js */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, 'out');

/* The stubbed window.claude, as in campaign.js. The store survives reloads (localStorage) so the same table can be
   reopened as another role; the role is localStorage.__role: gm | player | ro. update() deep merges (objects merge,
   arrays and scalars replace) and refuses a missing doc. */
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
  window.__remote = (patch) => { const p = 'campaign/main'; store[p] = dm(store[p] || {}, copy(patch)); persist(); fire(p); };
  const ids = { gm: 'u_gm', owner: 'u_gm', player: 'u_player', ro: 'u_viewer', nodb: 'u_gm' };
  const user = { id: async () => ids[role], can: async (n) => n === 'data.write' ? role !== 'ro' : true, isOwner: async () => role === 'gm' || role === 'owner',
    me: async () => ({ id: ids[role], name: '', email: null }), profiles: async (list) => { const names = { u_gm: 'Gail the GM', u_player: 'Pat' }; const o = {}; list.forEach(id => { o[id] = { id, name: names[id] || '' }; }); return o; } };
  if (role !== 'owner') user.canEdit = async () => role === 'gm';
  window.claude = { use: async (name) => ({ db: role === 'nodb' ? null : { collection: col, doc: (p) => docRef(p.split('/')[0], p.split('/')[1]) }, user, downloads: { save: async () => {} } })[name] || null };
})();`;

const CREWS = ['dealers', 'hit-squad', 'militants', 'racers', 'shadows', 'utopians'];

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

  const camp = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__store['campaign/main'] || null)));
  const crew = async () => ((await camp()) || {}).crew || {};
  const cw = () => p.evaluate(() => window.__writes.filter(w => w[1] === 'campaign/main').length);
  const lastPatch = () => p.evaluate(() => { const l = window.__patches.filter(w => w[1] === 'campaign/main'); return l.length ? l[l.length - 1] : null; });
  const dis = (sel) => p.$eval(sel, n => !!n.disabled).catch(() => 'missing');
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
    if (sw > w) errs.push(name + ': horizontal page overflow ' + sw + '>' + w);
    /* anything outside the page box, except inside a scroll box of its own (the claims map may scroll sideways) */
    const out = await p.evaluate(() => { const R = document.getElementById('table-page').getBoundingClientRect(); const o = []; document.querySelectorAll('#table-page *').forEach(n => { if (n.closest('.cs-scroll')) return; const r = n.getBoundingClientRect(); if (r.width && (r.right > R.right + 1 || r.left < R.left - 1)) o.push((n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) + ' ' + Math.round(r.left) + '-' + Math.round(r.right)); }); return o.slice(0, 5); });
    if (out.length) errs.push(name + ': elements outside the page: ' + out.join(' | '));
  }
  async function as(role, docs) {
    await p.evaluate(([role, docs]) => { if (docs !== undefined) localStorage.setItem('__stub', JSON.stringify(docs)); localStorage.setItem('__role', role); }, [role, docs]);
    await p.goto(URL + '#t'); await p.reload(); await p.waitForTimeout(1100);
  }
  async function fresh(role) { await p.goto(URL); await as(role || 'gm', {}); }
  async function choose(id, role) {
    await fresh(role);
    assert(!!(await p.$('.cs-pickbox')) && (await p.$$eval('.cs-cover', n => n.length)) === 6, id + ': picker with six covers');
    const w0 = await cw(); assert(w0 === 0 && (await camp()) === null, id + ': opening wrote nothing');
    await one(id + ': choose', () => p.click(`[data-act="crew.cschoose"][data-id="${id}"]`));
    assert(dialogs.length && /Make the crew/.test(dialogs[dialogs.length - 1]), id + ': choose confirms');
    assert(!!(await p.$(`.cs-sheet[data-playbook="${id}"]`)), id + ': the sheet renders');
    return crew();
  }
  const charDoc = (name, playbook, owner, bank) => ({ v: 2, name, alias: '', code: 'X-968-0001', playbook, playbookName: playbook, spec: null, sheet: { name, playbook }, play: { v: 1, stress: 1, bank, stacks: 0, abilities: [], items: [] }, owner, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' });

  /* ---------- each crew playbook on a fresh doc: the pre-filled state ---------- */
  await p.goto(URL); await p.waitForTimeout(600);
  for (const id of CREWS) {
    const c = await choose(id);
    const R = await p.evaluate((id) => { const r = B68Crews.byId[id]; return { name: r.name, cohort: r.cohortStart, pre: [].concat(...Object.values(r.upgrades)).filter(u => u.pre).map(u => [u.name, u.pre]) }; }, id);
    assert(c.playbook === id && c.type === R.name, id + ': playbook and type stored: ' + c.playbook + ' / ' + c.type);
    for (const [n, v] of R.pre) assert(c.upgrades && c.upgrades[n] === v, id + ': pre upgrade ' + n + ' = ' + v + ', got ' + (c.upgrades && c.upgrades[n]));
    if (R.cohort) assert(c.cohorts.length === 1 && c.cohorts[0].type === R.cohort.replace(/ cohort$/, ''), id + ': starting cohort ' + JSON.stringify(c.cohorts));
    else assert(c.cohorts.length === 0, id + ': no starting cohort');
    if (id === 'dealers') {
      assert(c.claims.turf === true && c.turf === 1, 'dealers: starting turf held, turf 1: ' + JSON.stringify(c.claims));
      assert((await p.$$eval('.cs-repbar .cs-pill.turfp', n => n.map(x => x.dataset.n))).join() === '12', 'dealers: the 12th rep pip is turf');
      assert(!!(await p.$('.cs-product .cs-units')) && (await p.$$eval('.cs-arr', n => n.length)) === 13, 'dealers: product with 13 arrows');
    } else {
      assert(c.claims.base === true, id + ': BASE held');
      assert((await p.$$eval('.cs-repbar .cs-pill.turfp', n => n.length)) === 0, id + ': no turf pips');
    }
    if (id === 'racers') assert(c.abilities['Stunt Riders'] === 1 && !!(await p.$('.cs-stuntbox')) && !!(await p.$('.cs-vehbox')), 'racers: Stunt Riders marked, stunts and vehicle boxes');
    if (id === 'utopians') assert(c.special.circles.first.marked === true && c.special.circles.second.marked === false && c.claims.base === true, 'utopians: first circle marked');
    if (id === 'militants') assert(!!(await p.$('[data-path="crew.cause"]')) && !(await p.$('[data-path="crew.reputation"]')) && (await p.$$eval('.cs-wis .tp-in', n => n.length)) === 2, 'militants: the cause and two enemies');
    if (id === 'hit-squad' || id === 'shadows') assert((await p.$$eval('.cs-wis .tp-in', n => n.length)) === 1, id + ': one hunting grounds write-in');
    assert(c.preferred && c.preferred.length >= 2 && Array.isArray(c.versatile) && c.special && typeof c.special === 'object', id + ': shape seeded');
    const vl = await p.$$eval('.cs-vaults .cs-cube', n => n.map(x => x.disabled));
    assert(vl.length === 12 && vl.every(Boolean), id + ': 12 vault cubes, all locked before the Vault upgrade');
    await p.locator('.cs-sheet').screenshot({ path: path.join(OUT, 'crewsheet-' + id + '.png') });
    await overflow(id + ' desktop');
  }

  /* ---------- Hit Squad: abilities, contacts, upgrades, claims, turf ---------- */
  let c = await choose('hit-squad');
  await one('ability circle', () => p.click('[data-act="crew.ability"][data-k="Take the Shot"][data-n="1"]'));
  assert((await crew()).abilities['Take the Shot'] === 1 && JSON.stringify(Object.keys((await lastPatch())[2].crew)) === '["abilities"]', 'ability stored, patch carries only abilities: ' + JSON.stringify((await lastPatch())[2].crew));
  await one('versatile', () => p.click('[data-act="crew.ability"][data-k="Versatile"][data-n="1"]'));
  await one('versatile write-in', async () => { await p.click('[data-path="crew.versatile.0"]'); await p.keyboard.type('Sympathizers (Militants)', { delay: 8 }); }, 800);
  assert((await crew()).versatile[0] === 'Sympathizers (Militants)', 'versatile write-in saved');
  await one('contact friend', () => p.click('[data-act="crew.contact"][data-k="Hush"]'));
  await one('contact rival', () => p.click('[data-act="crew.contact"][data-k="Hush"]'));
  assert((await crew()).contacts.Hush === 'rival' && (await p.$eval('[data-act="crew.contact"][data-k="Hush"]', n => n.textContent)) === '▼', 'contact cycles friend ▲ → rival ▼');
  await one('upgrade box', () => p.click('[data-act="crew.upgrade"][data-k="Elite Muscle"][data-n="1"]'));
  await one('linked upgrade box 2', () => p.click('[data-act="crew.upgrade"][data-k="Deep (+1 key/deadlock)"][data-n="2"]'));
  c = await crew(); assert(c.upgrades['Elite Muscle'] === 1 && c.upgrades['Deep (+1 key/deadlock)'] === 2 && c.upgrades['Prowess'] === 1, 'upgrades stored: ' + JSON.stringify(c.upgrades));
  await one('vault upgrade 1', () => p.click('[data-act="crew.upgrade"][data-k="Vault"][data-n="1"]'));
  assert((await p.$$eval('.cs-vaults .cs-cube', n => n.filter(x => !x.disabled).length)) === 4, 'Vault upgrade 1 unlocks the first group of 4');
  await one('vault 3', () => p.click('.cs-vaults [data-act="crew.vault"][data-n="3"]'));
  await one('stacks 2', () => p.click('[data-act="crew.stacks"][data-n="2"]'));
  await one('anger 1', () => p.click('.cs-anger [data-act="crew.anger"][data-n="1"]'));
  c = await crew(); assert(c.vault === 3 && c.stacks === 2 && c.anger === 1, 'vault, stacks, anger: ' + JSON.stringify([c.vault, c.stacks, c.anger]));
  await one('vault upgrade off', () => p.click('[data-act="crew.upgrade"][data-k="Vault"][data-n="1"]'));
  assert((await crew()).vault === 0, 'removing the Vault upgrade empties the locked vault in the same write');
  await one('rep 4', () => p.click('.cs-repbar [data-act="crew.rep"][data-n="4"]'));
  await one('heat 5', () => p.click('[data-act="crew.heat"][data-n="5"]'));
  await one('wanted 2', () => p.click('[data-act="crew.wanted"][data-n="2"]'));
  await one('tier 2', () => p.click('[data-act="crew.tier"][data-n="2"]'));
  await one('hold strong', () => p.click('[data-act="crew.hold"][data-v="strong"]'));
  /* claims: turf next to BASE is open; a far cell is not */
  assert((await dis('[data-act="crew.claim"][data-id="turf"]')) === false && !(await p.$eval('[data-act="crew.claim"][data-id="turf"]', n => n.classList.contains('far'))), 'turf beside BASE is claimable');
  assert(await p.$eval('[data-act="crew.claim"][data-id="friendly-ink-rake"]', n => n.classList.contains('far')), 'far claim shown dimmed');
  await one('claim beside BASE', () => p.click('[data-act="crew.claim"][data-id="turf"]'));
  c = await crew();
  assert(c.claims.turf === true && c.turf === 1, 'turf claimed, crew.turf 1');
  assert((await p.$$eval('.cs-repbar .cs-pill.turfp', n => n.map(x => x.dataset.n))).join() === '12', 'turf marks the 12th rep pip from the right');
  assert(/1 less rep to develop/.test(await p.$eval('.cs-turfhint', n => n.textContent)), 'turf hint shown');
  assert(!/until confirmed/.test(await p.$eval('.cs-turfhint', n => n.textContent)), 'rep rule no longer flagged as unconfirmed');
  assert(!(await p.$('.cs-repfull')), 'rep 4 of 11: not full');
  await one('rep full (11 with one turf)', () => p.click('.cs-repbar [data-act="crew.rep"][data-n="11"]'));
  assert((await crew()).rep === 11 && /Rep is full/.test(await p.$eval('.cs-develop', n => n.textContent)), 'full rep shows the develop box');
  assert(/Go up to Tier 3 \(24 stacks\)/.test(await p.$eval('.cs-develop', n => n.textContent)) && (await dis('[data-act="crew.develop"]')), 'strong hold at Tier 2: Tier 3 costs 24 stacks, refused without them');
  const preDev = await crew();
  await one('hold weak', () => p.click('[data-act="crew.hold"][data-v="weak"]'));
  await one('strengthen the hold', () => p.click('[data-act="crew.develop"]'));
  c = await crew(); assert(c.hold === 'strong' && c.rep === 0 && c.turf === 1 && c.tier === 2, 'weak hold + full rep: hold strong, rep 0, turf kept: ' + JSON.stringify([c.hold, c.rep, c.turf, c.tier]));
  await p.evaluate(() => window.__remote({ crew: { tier: 0, stacks: 4, rep: 11, abilities: { Benefactor: 1 } } })); await p.waitForTimeout(200);
  assert(/Go up to Tier 1 \(4 stacks\)/.test(await p.$eval('.cs-develop', n => n.textContent)) && !(await dis('[data-act="crew.develop"]')), 'Benefactor halves Tier 1 to 4 stacks');
  await one('go up a tier', () => p.click('[data-act="crew.develop"]'));
  c = await crew(); assert(c.tier === 1 && c.stacks === 0 && c.hold === 'weak' && c.rep === 0 && c.turf === 1, 'tier up: Tier 1, 4 stacks paid, hold weak, rep 0, turf kept: ' + JSON.stringify([c.tier, c.stacks, c.hold, c.rep, c.turf]));
  await p.evaluate((b) => window.__remote({ crew: { tier: b.tier, stacks: b.stacks || 0, hold: 'strong', rep: 11, abilities: { Benefactor: 0 } } }), preDev); await p.waitForTimeout(200);
  await one('rep back to 4', () => p.click('.cs-repbar [data-act="crew.rep"][data-n="4"]'));
  assert((await crew()).rep === 4 && !(await p.$('.cs-develop')), 'rep back to 4');
  await one('claim next to the turf', () => p.click('[data-act="crew.claim"][data-id="dive-bar"]'));
  await one('give up dive bar', () => p.click('[data-act="crew.claim"][data-id="dive-bar"]'));
  assert((await crew()).claims['dive-bar'] === false, 'released claim stored as false (a merge never drops a key)');
  await shots('hit-squad-played', false);

  /* the player: a far claim is refused; the whole crew is editable */
  await as('player');
  assert((await dis('[data-act="crew.claim"][data-id="friendly-ink-rake"]')) === true, 'player: far claim disabled');
  await none('player far claim', () => p.click('[data-act="crew.claim"][data-id="friendly-ink-rake"]', { force: true }).catch(() => {}));
  await none('player far claim through the act', () => p.evaluate(() => { const b = document.querySelector('[data-act="crew.claim"][data-id="friendly-ink-rake"]'); b.disabled = false; b.click(); }));
  assert((await crew()).claims['friendly-ink-rake'] !== true, 'player: far claim refused');
  assert(!(await p.$('.cs-chg')), 'player: no Change playbook button');
  await one('player names the crew', async () => { await p.click('[data-path="crew.name"]'); await p.keyboard.type('The Quiet Ones', { delay: 8 }); }, 800);
  assert(JSON.stringify((await lastPatch())[2].crew) === '{"name":"The Quiet Ones"}', 'player name patch only: ' + JSON.stringify((await lastPatch())[2].crew));
  await one('player hunting grounds', async () => { await p.click('[data-path="crew.preferred.0"]'); await p.keyboard.type('Silkshore', { delay: 8 }); }, 800);
  await one('player ward boss', async () => { await p.click('[data-path="crew.wardBoss"]'); await p.keyboard.type('Bazso', { delay: 8 }); }, 800);
  await one('player ability', () => p.click('[data-act="crew.ability"][data-k="Chameleons"][data-n="1"]'));
  await one('player upgrade', () => p.click('[data-act="crew.upgrade"][data-k="Gear"][data-n="1"]'));
  await one('player claim beside a held one', () => p.click('[data-act="crew.claim"][data-id="vip-lounge"]'));
  c = await crew(); assert(c.name === 'The Quiet Ones' && c.preferred[0] === 'Silkshore' && c.wardBoss === 'Bazso' && c.abilities.Chameleons === 1 && c.upgrades.Gear === 1 && c.claims['vip-lounge'] === true, 'player edits stored');
  /* the GM overrides */
  await as('gm');
  const d0 = dialogs.length;
  await one('GM far claim (override)', () => p.click('[data-act="crew.claim"][data-id="friendly-ink-rake"]'));
  assert((await crew()).claims['friendly-ink-rake'] === true && /GM override/.test(dialogs.slice(d0).join(' ')), 'GM override claims the far cell after a confirm');

  /* ---------- Dealers: product, units, kind ---------- */
  await choose('dealers');
  await one('units 5', () => p.click('[data-act="crew.units"][data-n="5"]'));
  await one('product kind', () => p.click('[data-act="crew.kind"][data-v="Narcotics"]'));
  c = await crew(); assert(c.special.units === 5 && c.special.productKind === 'Narcotics', 'dealers: units 5, Narcotics: ' + JSON.stringify(c.special));
  assert((await dis('[data-act="crew.claim"][data-id="smuggler"]')) === false && await p.$eval('[data-act="crew.claim"][data-id="smuggler"]', n => n.classList.contains('far')), 'dealers: smuggler waits for its arrow source');
  await one('dealers local supplier', () => p.click('[data-act="crew.claim"][data-id="local-supplier"]'));
  await one('dealers local supplier 2', () => p.click('[data-act="crew.claim"][data-id="local-supplier-2"]'));
  assert(!(await p.$eval('[data-act="crew.claim"][data-id="smuggler"]', n => n.classList.contains('far'))) && !(await p.$eval('[data-act="crew.claim"][data-id="city-wide"]', n => n.classList.contains('far'))), 'dealers: arrows open smuggler and city-wide');
  await one('dealers second turf', () => p.click('[data-act="crew.claim"][data-id="turf-2"]'));
  assert((await crew()).turf === 2 && (await p.$$eval('.cs-repbar .cs-pill.turfp', n => n.map(x => x.dataset.n))).join() === '11,12', 'dealers: two turf pips from the right');
  await shots('dealers', true);

  /* ---------- Racers: a stunt and an edge ---------- */
  await choose('racers');
  await one('stunt', () => p.click('[data-act="crew.stunt"][data-k="Big Air"]'));
  await one('edge', () => p.click('[data-act="crew.edge"][data-k="Nimble"]'));
  await one('flaw', () => p.click('[data-act="crew.flaw"][data-k="Guzzler"]'));
  c = await crew(); assert(c.special.stunts['Big Air'] === true && JSON.stringify(c.special.edges) === '["Nimble"]' && JSON.stringify(c.special.flaws) === '["Guzzler"]', 'racers: stunt, edge, flaw: ' + JSON.stringify(c.special));
  await p.locator('.cs-sheet').screenshot({ path: path.join(OUT, 'crewsheet-racers-played.png') });

  /* ---------- Utopians: truths, circles, locked abilities ---------- */
  await choose('utopians');
  await one('truth Free', () => p.click('[data-act="crew.truth"][data-c="first"][data-v="Free"]'));
  await one('truth Serene', () => p.click('[data-act="crew.truth"][data-c="first"][data-v="Serene"]'));
  assert((await dis('[data-act="crew.truth"][data-c="first"][data-v="Radiant"]')) === true, 'utopians: two truths chosen, the rest disabled');
  assert(JSON.stringify((await crew()).special.circles.first.truths) === '["Free","Serene"]', 'utopians: truths stored');
  assert((await dis('[data-act="crew.ability"][data-k="True Believers"][data-n="1"]')) === true, 'utopians: second-circle ability locked');
  assert((await dis('[data-act="crew.circle"][data-id="third"]')) === true, 'utopians: third circle needs the second');
  await one('tally', async () => { await p.click('[data-path="crew.special.circles.second.tally"]'); await p.keyboard.type('14', { delay: 8 }); }, 800);
  await one('reach the second circle', () => p.click('[data-act="crew.circle"][data-id="second"]'));
  c = await crew(); assert(c.special.circles.second.marked === true && c.special.circles.second.tally === '14', 'utopians: second circle marked, tally kept: ' + JSON.stringify(c.special.circles.second));
  assert((await dis('[data-act="crew.ability"][data-k="True Believers"][data-n="1"]')) === false, 'utopians: the second circle unlocks its abilities');
  await one('second-circle ability', () => p.click('[data-act="crew.ability"][data-k="True Believers"][data-n="1"]'));
  await one('second-circle claim', () => p.click('[data-act="crew.claim"][data-id="temple"]'));
  await one('second-circle turf', () => p.click('[data-act="crew.claim"][data-id="turf-3"]'));
  c = await crew(); assert(c.abilities['True Believers'] === 1 && c.claims.temple === true && c.turf === 1, 'utopians: ability, temple and turf');
  await one('truth in the second circle', () => p.click('[data-act="crew.truth"][data-c="second"][data-v="Alien"]'));
  await shots('utopians', true);

  /* ---------- crew xp: the end-of-session panel; the crew advance and the bank payout ---------- */
  const store = await p.evaluate(() => JSON.parse(localStorage.getItem('__stub')));
  store['characters/aldo'] = charDoc('Aldo Crane', 'hound', 'u_gm', 3);
  store['characters/iris'] = charDoc('Iris Vey', 'intellectual', 'u_player', 39);
  store['characters/kess'] = charDoc('Unit Kessel', 'timetraveler', null, 0);
  store['characters/nell'] = charDoc('Nell', 'swinger', 'u_player', 0);
  await as('gm', store);
  const specOk = await p.evaluate(() => !!B68.BASE_FIGURE);
  if (specOk) { await p.evaluate(async () => { const db = await window.claude.use('db'); for (const id of ['aldo', 'iris', 'kess', 'nell']) { const d = JSON.parse(JSON.stringify(window.__store['characters/' + id])); d.spec = JSON.parse(JSON.stringify(B68.BASE_FIGURE)); await db.collection('characters').doc(id).set(d); } }); await p.waitForTimeout(400); }
  assert((await p.$$eval('.tp-char', n => n.length)) === 4, 'four filed characters on the table');
  await none('open the end-of-session panel', () => p.click('[data-act="crew.csend"]'));
  assert(!!(await p.$('.cs-endp')), 'end-of-session panel open');
  await none('set trigger values', async () => { await p.click('[data-act="crew.csendval"][data-i="0"][data-v="2"]'); await p.click('[data-act="crew.csendval"][data-i="2"][data-v="1"]'); });
  const xp0 = (await crew()).xp || 0;
  await one('mark crew xp', () => p.click('[data-act="crew.csendmark"]'));
  assert((await crew()).xp === xp0 + 3 && JSON.stringify((await lastPatch())[2].crew) === JSON.stringify({ xp: xp0 + 3 }), 'crew xp +3 in one patch: ' + JSON.stringify((await lastPatch())[2].crew));
  await one('crew xp full', () => p.click('[data-act="crew.xp"][data-n="10"]'));
  assert(!!(await p.$('.cs-adv')) && /Upon crew xp advance, each PC marks bank = Tier\+2/.test(await p.$eval('.cs-adv', n => n.textContent)), 'crew advance with the footer rule');
  /* the player: pays only their own characters */
  await as('player');
  assert((await dis('[data-act="crew.cspayall"]')) === 'missing', 'player: no pay-everyone button');
  const ch0 = await p.evaluate(() => window.__writes.filter(w => /^characters\//.test(w[1])).length);
  await one('player pays their own', () => p.click('[data-act="crew.cspaymine"]'), 500);
  const chW = await p.evaluate(() => window.__writes.filter(w => /^characters\//.test(w[1])).map(w => w[1]));
  const banksP = await p.evaluate(() => ['aldo', 'iris', 'kess', 'nell'].map(id => window.__store['characters/' + id].play.bank));
  /* tier is 0 here: Tier+2 = 2 */
  assert(JSON.stringify(banksP) === JSON.stringify([3, 40, 0, 2]), 'player paid Iris (cap 40) and Nell only: ' + JSON.stringify(banksP));
  assert(chW.length - ch0 === 2, 'player: two character writes: ' + chW.slice(ch0).join(','));
  c = await crew(); assert(c.advancePaid && c.advancePaid.iris === true && c.advancePaid.nell === true && c.xp === 10, 'player payment recorded; crew xp stays full');
  assert((await dis('[data-act="crew.cspaymine"]')) === true, 'player: nothing left to pay');
  /* the GM: pays the rest, resets xp */
  await as('gm');
  await one('tier 2', () => p.click('[data-act="crew.tier"][data-n="2"]'));
  const charPatches0 = await p.evaluate(() => window.__patches.filter(w => /^characters\//.test(w[1])).length);
  await one('GM pays each PC Tier+2', () => p.click('[data-act="crew.cspayall"]'), 600);
  const banksG = await p.evaluate(() => ['aldo', 'iris', 'kess', 'nell'].map(id => window.__store['characters/' + id].play.bank));
  assert(JSON.stringify(banksG) === JSON.stringify([7, 40, 0, 2]), 'GM paid Aldo 3 + 4 = 7; the paid ones and the time traveler untouched: ' + JSON.stringify(banksG));
  const cp = await p.evaluate((n) => window.__patches.filter(w => /^characters\//.test(w[1])).slice(n), charPatches0);
  assert(cp.length === 1 && cp[0][0] === 'update' && JSON.stringify(cp[0][2].play) === '{"bank":7}', 'character payout is a delta update of play.bank: ' + JSON.stringify(cp));
  c = await crew(); assert(c.xp === 0 && Object.values(c.advancePaid).every(v => v === false), 'crew xp reset, paid list cleared');
  /* a fresh advance: the GM pays every bankable character */
  await one('crew xp full again', () => p.click('[data-act="crew.xp"][data-n="10"]'));
  await one('GM pays everyone', () => p.click('[data-act="crew.cspayall"]'), 600);
  const banksG2 = await p.evaluate(() => ['aldo', 'iris', 'kess', 'nell'].map(id => window.__store['characters/' + id].play.bank));
  assert(JSON.stringify(banksG2) === JSON.stringify([11, 40, 0, 6]), 'second advance: every filed character +4 (cap 40; the time traveler keeps no bank): ' + JSON.stringify(banksG2));

  /* ---------- the GM changes the playbook: common tracks kept ---------- */
  const before = await crew();
  await none('open the change picker', () => p.click('.cs-chg'));
  assert(!!(await p.$('.cs-pickbox')) && /clears its abilities/.test(await p.$eval('.cs-pickbox', n => n.textContent)), 'change picker with a warning');
  await one('change to racers', () => p.click('[data-act="crew.cschoose"][data-id="racers"]'));
  c = await crew();
  assert(c.playbook === 'racers' && c.tier === before.tier && c.heat === before.heat && c.name === before.name && c.cohorts.length === before.cohorts.length, 'change keeps the common tracks');
  assert(c.abilities['True Believers'] === 0 && c.claims.temple === false && c.claims.base === true && c.abilities['Stunt Riders'] === 1 && c.upgrades.Vehicles === 1 && c.upgrades.Resolve === 0, 'change clears the old playbook and seeds the new one');
  assert(!(await p.$('.cs-pickbox')), 'picker closes after the change');

  /* ---------- migration from the generic panel ---------- */
  await fresh('gm');
  await one('generic crew (old panel)', async () => {
    await p.click('[data-path="crew.name"]'); await p.keyboard.type('Old Crew', { delay: 5 });
  }, 800);
  await p.evaluate(() => window.__remote({ crew: { type: 'Shadows', lair: 'The gasworks', tier: 2, heat: 3, wanted: 1, rep: 5, notes: 'Owe the Lampblacks', claims: [{ name: 'Gambling den', held: true }, { name: 'Informants', held: false }], cohorts: [{ name: 'The Twins', type: 'Thugs', edges: 'Fearless', flaws: '', harm: 'weak', armor: true }], factions: [{ name: 'Bluecoats', status: -2 }] } }));
  await p.waitForTimeout(250);
  assert((await p.$$eval('.tp-claim', n => n.length)) === 2 && !!(await p.$('.cs-pickbox')), 'generic panel under the picker shows the old claims');
  await one('choose shadows over a generic crew', () => p.click('[data-act="crew.cschoose"][data-id="shadows"]'));
  c = await crew();
  assert(c.name === 'Old Crew' && c.tier === 2 && c.heat === 3 && c.wanted === 1 && c.rep === 5 && c.notes === 'Owe the Lampblacks' && c.base === 'The gasworks', 'migration keeps name, tier, heat, wanted, rep, notes; lair → base: ' + JSON.stringify({ n: c.name, t: c.tier, h: c.heat, b: c.base }));
  assert(c.cohorts.length === 2 && c.cohorts[0].name === 'The Twins' && c.cohorts[0].harm === 'weak' && c.cohorts[1].type === 'Infiltrators', 'migration keeps cohorts and adds the starting one: ' + JSON.stringify(c.cohorts.map(x => x.type)));
  assert(c.factions.length === 1 && c.factions[0].status === -2, 'migration keeps factions');
  assert(Array.isArray(c.legacyClaims) && c.legacyClaims.length === 2 && c.legacyClaims[0].name === 'Gambling den' && c.legacyClaims[0].held === true && !Array.isArray(c.claims) && c.claims.base === true, 'old claims kept under legacyClaims; claims is a map: ' + JSON.stringify(c.legacyClaims));
  assert(/Gambling den/.test(await p.$eval('.cs-legacy', n => n.textContent)), 'legacy claims listed');
  await one('cohort harm (generic logic)', () => p.click('[data-act="crew.cohortharm"][data-i="0"][data-v="broken"]'));
  await one('faction status (generic logic)', () => p.click('[data-act="crew.factionstatus"][data-i="0"][data-v="1"]'));
  c = await crew(); assert(c.cohorts[0].harm === 'broken' && c.factions[0].status === 1, 'cohorts and factions still work');
  await p.reload(); await p.waitForTimeout(1000);
  assert((await crew()).claims.base === true && !!(await p.$('.cs-sheet[data-playbook="shadows"]')) && (await p.$eval('.cs-cell.base', n => n.classList.contains('held'))), 'the claims map survives a reload (normalize keeps maps)');

  /* ---------- read only ---------- */
  await as('ro');
  const enabled = await p.$$eval('#table-page button, #table-page input, #table-page textarea, #table-page select', ns => ns.filter(n => !n.disabled).map(n => n.dataset.act || n.dataset.path || n.dataset.ui || n.tagName));
  /* what a read-only viewer can still press writes nothing: Open, The cast, Print the season, and the folds of the page (the crew summary row on a phone, the log's All) */
  assert(enabled.length && enabled.every(a => a === 'open' || a === 'print' || a === 'cast' || a === 'viewcrew' || a === 'viewlog'), 'read only: everything disabled but Open, The cast, Print the season and the folds: ' + enabled.join(','));
  assert(!(await p.$('.cs-chg')) && !(await p.$('#table-page [data-gm]:not(input):not(textarea)')), 'read only: no GM-only controls shown');
  await none('read only clicks', async () => {
    for (const sel of ['[data-act="crew.ability"][data-k="Sleepy Time"][data-n="1"]', '[data-act="crew.claim"][data-id="turf"]', '[data-act="crew.upgrade"][data-k="Gear"][data-n="1"]', '[data-act="crew.contact"][data-k="Bloom"]', '[data-act="crew.heat"][data-n="7"]'])
      await p.click(sel, { force: true }).catch(() => {});
    await p.evaluate(() => { const n = document.querySelector('[data-path="crew.wardBoss"]'); n.value = 'Hacked'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  }, 800);

  /* ---------- print: the sheet without buttons ---------- */
  await as('gm');
  await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(200);
  const shownBtns = await p.$$eval('#table-page .cs-sheet .btn, #table-page .cs-sheet .tp-x', ns => ns.filter(n => n.getClientRects().length && getComputedStyle(n).display !== 'none').map(n => n.textContent.trim()));
  assert(shownBtns.length === 0, 'print hides the sheet buttons: ' + shownBtns.join(','));
  await p.locator('.cs-sheet').screenshot({ path: path.join(OUT, 'crewsheet-print.png') });
  await p.emulateMedia({ media: 'screen' });

  /* ---------- layout: clocks, log and players above the full sheet on a wide screen, the schedule below it; on a phone the crew
     sits behind its summary row (Tier, Hold, Rep, Heat, Wanted, Stacks) between the players and the schedule ---------- */
  const tops = (sels) => p.evaluate((sels) => sels.map(s => Math.round(document.querySelector('#table-page ' + s).getBoundingClientRect().top + scrollY)), sels);
  let tp = await tops(['.tp-playbox', '.cs-sheet', '#tp-schedule']);
  assert(tp[0] < tp[1] && tp[1] < tp[2], 'desk: the players above the crew sheet, the schedule below it: ' + tp.join(','));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  tp = await tops(['.tp-playbox', '#tp-crew', '#tp-schedule']);
  assert(tp[0] < tp[1] && tp[1] < tp[2], 'phone: players, then the crew (its summary row), then the schedule: ' + tp.join(','));
  assert(await p.$eval('.tp-crewbody', n => getComputedStyle(n).display === 'none') && await p.$eval('.cs-sheet', n => n.getClientRects().length === 0), 'phone: the crew sheet is folded away until the summary is tapped');
  const crShadows = await crew();
  const turfN = await p.evaluate((c) => B68Campaign.crewSheet.turfCount(c, B68Crews.byId[c.playbook]), crShadows);
  const sumCells = () => p.$$eval('.tp-cst', ns => ns.map(n => n.querySelector('.tp-lab').textContent + ' ' + n.querySelector('b').textContent));
  const wantCells = ['Tier ' + crShadows.tier, 'Hold ' + (crShadows.hold === 'strong' ? 'Strong' : 'Weak'), 'Rep ' + Math.min(crShadows.rep, 12 - turfN) + '/' + (12 - turfN), 'Heat ' + crShadows.heat + '/9', 'Wanted ' + crShadows.wanted + '/4', 'Stacks ' + (crShadows.stacks || 0)];
  assert(JSON.stringify(await sumCells()) === JSON.stringify(wantCells), 'phone: the summary row shows the crew sheet\'s own numbers: ' + JSON.stringify(await sumCells()) + ' vs ' + JSON.stringify(wantCells));
  await p.evaluate(() => window.__remote({ crew: { upgrades: { Vault: 2 } } })); await p.waitForTimeout(250);   /* the Vault upgrade opens the vault cubes (locked without it) */
  await none('phone: the summary unfolds the sheet', () => p.click('.tp-crewsum'));
  assert(await p.$eval('.cs-sheet', n => n.getClientRects().length > 0), 'phone: the crew sheet opens');
  /* touch: the tracks a player taps in play are at least 40px tall (the mark's own box or its ::before area) and each owns its whole area */
  const ttrack = await p.evaluate(() => {
    const out = { n: 0, small: [], owns: [], kinds: {} }, at = (x, y) => document.elementFromPoint(x, y);
    document.querySelectorAll('#table-page .cs-pill, #table-page .cs-tier, #table-page .cs-cube, #table-page .cs-sheet .btn, #table-page .cs-sheet .chip, #table-page .cs-sheet .tp-in').forEach(n => {
      if (n.disabled || !n.getClientRects().length) return;
      n.scrollIntoView({ block: 'center' });
      const r = n.getBoundingClientRect(), cs = getComputedStyle(n, '::before'), has = !!cs.content && cs.content !== 'none';
      const pw = has ? parseFloat(cs.width) || 0 : 0, ph = has ? parseFloat(cs.height) || 0 : 0, w = Math.max(r.width, pw), h = Math.max(r.height, ph), k = (n.getAttribute('data-act') || n.className) + '';
      out.n++; out.kinds[k] = Math.min(out.kinds[k] || 1e9, Math.round(h));
      if (h < 39.5) out.small.push(k + ' ' + Math.round(w) + 'x' + Math.round(h));
      if (has) { const cx = r.left + r.width / 2, cy = r.top + r.height / 2; [[cx - pw / 2 + 2, cy], [cx + pw / 2 - 2, cy], [cx, cy - ph / 2 + 2], [cx, cy + ph / 2 - 2]].forEach(pt => { const e = at(pt[0], pt[1]); if (!(e === n || n.contains(e))) out.owns.push(k + ' ' + (n.getAttribute('data-n') || '') + ' @' + pt.map(Math.round) + ' → ' + (e && (e.getAttribute('data-act') || e.className || e.tagName))); }); }
    });
    out.small = out.small.slice(0, 12); out.owns = out.owns.slice(0, 12); return out;
  });
  notes.push('crew sheet touch audit: ' + ttrack.n + ' controls; smallest heights ' + JSON.stringify(ttrack.kinds));
  assert(['crew.heat', 'crew.wanted', 'crew.rep', 'crew.tier', 'crew.stacks', 'crew.vault'].every(k => ttrack.kinds[k] >= 40) && !ttrack.small.length, 'phone touch: heat, wanted, rep, tier, stacks and vault marks and the sheet\'s buttons are at least 40px tall: ' + ttrack.small.join(' | '));
  assert(!ttrack.owns.length, 'phone touch: each mark owns its whole hit area: ' + ttrack.owns.join(' | '));
  await overflow('crew sheet phone, open');
  await p.evaluate(() => scrollTo(0, 0));
  await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(200);

  /* ---------- a player can choose the playbook on a fresh table ---------- */
  /* on a phone the six covers fold behind one button (page state, no write); a wide screen shows them, no button */
  await fresh('player');
  const fold = () => p.evaluate(() => { const t = document.querySelector('.cs-pickt'), c = document.querySelector('.cs-covers'); return { btn: !!t && getComputedStyle(t).display !== 'none', exp: t && t.getAttribute('aria-expanded'), covers: !!c && getComputedStyle(c).display !== 'none', label: t && t.textContent }; });
  assert(/No characters yet/.test(await p.$eval('.tp-playbox', n => n.textContent)) && !/filed|files/.test(await p.$eval('.tp-playbox', n => n.textContent)), 'an empty table: the players box says "No characters yet"');
  let fd = await fold();
  assert(!fd.btn && fd.covers, 'desk: the covers shown, no fold button: ' + JSON.stringify(fd));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  fd = await fold();
  assert(fd.btn && !fd.covers && fd.exp === 'false' && /Show the six crew playbooks/.test(fd.label), 'phone: the covers folded behind one button: ' + JSON.stringify(fd));
  const pickTop = await p.evaluate(() => document.querySelector('.cs-pickbox').getBoundingClientRect().height);
  assert(pickTop < 400, 'phone: the folded picker is short: ' + pickTop);
  await none('phone: show the covers', () => p.click('[data-act="crew.cspick"]'));
  fd = await fold();
  assert(fd.btn && fd.covers && fd.exp === 'true' && await p.evaluate(() => document.activeElement && document.activeElement.dataset.act === 'crew.cspick'), 'phone: the covers unfold, focus stays on the button: ' + JSON.stringify(fd));
  await overflow('picker phone open');
  await none('phone: fold them again', () => p.click('[data-act="crew.cspick"]'));
  assert(!(await fold()).covers, 'phone: folded again');
  await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(200);
  await choose('militants', 'player');
  assert((await crew()).playbook === 'militants', 'player chose the playbook');
  /* a read-only viewer may unfold the covers too (it only shows them) */
  await as('ro', {});
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  await none('read only: show the covers', () => p.click('[data-act="crew.cspick"]'));
  fd = await fold();
  assert(fd.covers && (await dis('[data-act="crew.cschoose"]')) === true, 'read only: covers shown, Choose disabled: ' + JSON.stringify(fd));
  await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(200);

  async function shots(prefix, phoneDark) {
    await p.locator('.cs-sheet').screenshot({ path: path.join(OUT, 'crewsheet-' + prefix + '.png') });
    if (!phoneDark) return;
    await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await p.waitForTimeout(350);
    await p.locator('.cs-sheet').screenshot({ path: path.join(OUT, 'crewsheet-' + prefix + '-dark.png') });
    await p.evaluate(() => { delete document.documentElement.dataset.theme; });
    await p.setViewportSize({ width: 390, height: 900 }); await p.waitForTimeout(300);
    const sum = await p.$('.tp-crewsum'); if (sum && (await sum.getAttribute('aria-expanded')) === 'false') { await sum.click(); await p.waitForTimeout(200); }   /* the sheet is folded behind its summary row on a phone */
    await overflow(prefix + ' phone');
    await p.locator('.cs-sheet').screenshot({ path: path.join(OUT, 'crewsheet-' + prefix + '-phone.png') });
    await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await p.waitForTimeout(350);
    await overflow(prefix + ' phone dark');
    await p.locator('.cs-sheet').screenshot({ path: path.join(OUT, 'crewsheet-' + prefix + '-phone-dark.png') });
    await p.evaluate(() => { delete document.documentElement.dataset.theme; });
    await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(200);
  }

  console.log('NOTES:\n' + notes.join('\n'));
  console.log('FAILS:', fails.length ? '\n' + fails.join('\n') : 'none');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await b.close();
  process.exit(fails.length || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
