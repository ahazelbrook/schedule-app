process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
// E2E_URL=http://127.0.0.1:8788 runs against a live server (the hosted runtime adapter) with no window.claude stub
const E2E_URL = process.env.E2E_URL;
const URL = E2E_URL || 'file://' + require('path').resolve(__dirname, '..', 'index.html');
// a tiny in-memory db stub with the contract's shape
const STUB = `(() => {
  const store = {}; const colSubs = []; const docSubs = {};
  const snapOf = (id) => ({ id, exists: id in store, data: () => store[id] ? JSON.parse(JSON.stringify(store[id])) : undefined, metadata: {} });
  const fire = (id) => { (docSubs[id] || []).forEach(fn => fn(snapOf(id))); colSubs.forEach(fn => fn(query())); };
  const query = () => { const docs = Object.keys(store).map(snapOf).sort((a, b) => (store[b.id].updatedAt || '').localeCompare(store[a.id].updatedAt || '')); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
  const docRef = (id) => ({ id, get: async () => snapOf(id), set: async (d) => { store[id] = JSON.parse(JSON.stringify(d)); window.__writes.push(['set', id]); fire(id); }, update: async (p) => { (function dm(t, s) { for (var k in s) { var v = s[k]; if (v && typeof v === "object" && !Array.isArray(v) && t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) dm(t[k], v); else t[k] = v; } })(store[id], JSON.parse(JSON.stringify(p))); window.__writes.push(['update', id]); fire(id); }, delete: async () => { delete store[id]; window.__writes.push(['delete', id]); fire(id); }, onSnapshot: (fn) => { (docSubs[id] = docSubs[id] || []).push(fn); setTimeout(() => fn(snapOf(id)), 0); return () => {}; } });
  const q = () => ({ orderBy: q, limit: q, where: q, get: async () => query(), onSnapshot: (fn) => { colSubs.push(fn); setTimeout(() => fn(query()), 0); return () => {}; } });
  const col = () => Object.assign(q(), { doc: docRef, path: 'characters' });
  window.__writes = []; window.__store = store;
  window.claude = { use: async (name) => ({ db: { collection: col, doc: (p) => docRef(p.split('/')[1]) }, user: { id: async () => 'u_test', can: async () => true, isOwner: async () => true, canEdit: async () => true, me: async () => ({ id: 'u_test', name: '', avatarUrl: '', color: '#000', email: null, isOwner: true, canEdit: true }), profiles: async () => ({}) }, downloads: { save: async () => {} } })[name] || null };
})();`;
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  if (!E2E_URL) await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('console.' + m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(1200);
  console.log('whoami:', await p.$eval('#whoami', e => e.textContent));
  // no hash: Home; this viewer is the GM (canEdit) and no table is stored yet, so it is the set-up page
  if (!E2E_URL) {
    const h = await p.evaluate(() => ({ mode: document.body.dataset.mode, title: (document.getElementById('homeTitle') || {}).textContent, steps: document.querySelectorAll('#home .hm-step').length, view: document.getElementById('viewName').textContent, doc: document.title }));
    console.log('home:', JSON.stringify(h));
    if (h.mode !== 'home' || h.title !== 'Set up the table' || h.steps !== 3 || h.view !== 'Home') errs.push('landing is not the GM set-up Home: ' + JSON.stringify(h));
  }
  await p.click('#home [data-hm="new"]'); await p.waitForTimeout(400);
  if (await p.evaluate(() => document.body.dataset.mode + ' ' + location.hash) !== 'create #create') errs.push('Make a character did not open the creator: ' + await p.evaluate(() => document.body.dataset.mode + ' ' + location.hash));
  await p.click('.pb[data-id="hound"]'); await p.waitForTimeout(500);
  // fill a complete sheet quickly
  await p.evaluate(() => { const S = B68.S, CT = B68.CT, pb = CT.byId.hound; S.sheet.name = 'Aldo Crane'; S.sheet.alias = 'Dusty'; S.sheet.heritage = 'Akoros'; S.sheet.background = 'Underworld'; S.sheet.dots = { Survey: 1, Consort: 2, Hunt: 2, Prowl: 1, Skirmish: 1 }; S.sheet.ability = pb.abilities[0][0]; S.sheet.keys = pb.keys.slice(0, 2); S.sheet.contacts = {}; S.sheet.contacts[pb.contacts[0][0] + ', ' + pb.contacts[0][1]] = 'friend'; S.sheet.contacts[pb.contacts[1][0] + ', ' + pb.contacts[1][1]] = 'friend'; S.sheet.contacts[pb.contacts[2][0] + ', ' + pb.contacts[2][1]] = 'rival'; S.sheet.vice = 'Gambling'; S.sheet.purveyor = 'The Silver Stag'; S.sheet.items = [pb.items[0][0], 'Binoculars']; S.sheet.cohortType = 'hound dog'; S.sheet.cohortName = 'Biscuit'; B68.syncNameToSpec(); B68.changed(); });
  await p.click('#rail button:nth-child(15)'); await p.waitForTimeout(500);
  console.log('wearing:', await p.evaluate(() => B68.S.sheet.wearing));
  await p.click('#rail button:nth-child(16)'); await p.waitForTimeout(500);
  console.log('checks:', await p.evaluate(() => B68.validate().filter(c => !c.ok).map(c => c.text)));
  await p.screenshot({ path: 'out/e2e-file.png' });
  await p.click('#fileRoster'); await p.waitForTimeout(1200);
  const mode = await p.evaluate(() => document.body.dataset.mode); console.log('mode after filing:', mode, 'hash:', await p.evaluate(() => location.hash), 'writes:', await p.evaluate(() => window.__writes ? JSON.stringify(window.__writes) : 'n/a (live server)'));
  await p.screenshot({ path: 'out/e2e-sheet-top.png' });
  await p.screenshot({ path: 'out/e2e-sheet-full.png', fullPage: true });
  // interact: stress box 3, playbook xp 5, a clock tick
  const click = async (sel) => { const h = await p.$(sel); if (!h) { errs.push('missing ' + sel); return; } await h.click(); await p.waitForTimeout(250); };
  const sels = await p.evaluate(() => ({ stress: !!document.querySelector('#dossier [data-stress], #dossier .ds-stress button'), buttons: document.querySelectorAll('#dossier button').length }));
  console.log('dossier controls:', JSON.stringify(sels));
  await p.evaluate(() => { const bs = document.querySelectorAll('#dossier .ds-stress button, #dossier [data-stress]'); if (bs[2]) bs[2].click(); });
  await p.waitForTimeout(700);
  const play = await p.evaluate(async () => {
    let id, d;
    if (window.__store) { id = Object.keys(window.__store)[0]; d = window.__store[id]; }
    else { id = decodeURIComponent((location.hash.match(/^#c\/(.+)$/) || [])[1] || ''); const r = await fetch('/api/characters/' + encodeURIComponent(id), { credentials: 'same-origin', cache: 'no-store' }); d = (await r.json()).doc; }
    return { id, stress: d.play.stress, keys: d.play.keys.length, abilities: d.play.abilities, owner: d.owner, contacts: d.play.contacts.length, items: d.play.items, wearing: d.sheet.wearing };
  });
  console.log('stored:', JSON.stringify(play));
  // Back returns to the view before the sheet (the creator), Home shows the files; a card opens the sheet again
  await click('#dossier [data-act="back"]');
  await p.waitForTimeout(600); console.log('mode after back:', await p.evaluate(() => document.body.dataset.mode + ' ' + location.hash));
  if (await p.evaluate(() => document.body.dataset.mode) !== 'create') errs.push('Back from the sheet did not return to the creator');
  await p.click('#homeBtn'); await p.waitForTimeout(600);
  console.log('mode after Home:', await p.evaluate(() => document.body.dataset.mode), 'cards:', await p.$$eval('#cards .card', c => c.length));
  if (!E2E_URL && await p.$$eval('#cards .card', c => c.length) !== 1) errs.push('Home: the filed card is missing');
  await p.screenshot({ path: 'out/e2e-roster.png', fullPage: true });
  await p.click('#cards .card'); await p.waitForTimeout(800); console.log('mode after card:', await p.evaluate(() => document.body.dataset.mode));
  // browser Back from that sheet is Home again, and Back from Home steps back through the views
  await p.goBack(); await p.waitForTimeout(500);
  if (await p.evaluate(() => document.body.dataset.mode) !== 'home') errs.push('browser Back from the sheet: ' + await p.evaluate(() => document.body.dataset.mode));
  // Edit figure opens the creator at Build under the editing banner; Back to the sheet returns to it
  await p.click('#cards .card'); await p.waitForTimeout(800);
  await click('#dossier [data-act="edit"]'); await p.waitForTimeout(500);
  const ed = await p.evaluate(() => ({ mode: document.body.dataset.mode, step: B68.S.step, bar: !document.getElementById('editBar').hidden && document.getElementById('editBar').textContent, view: document.getElementById('viewName').textContent }));
  console.log('edit figure:', JSON.stringify(ed));
  if (ed.mode !== 'create' || ed.step !== 1 || !/Editing Aldo Crane/.test(ed.bar || '') || ed.view !== 'Editing Aldo Crane') errs.push('Edit figure: ' + JSON.stringify(ed));
  await p.click('#editBack'); await p.waitForTimeout(600);
  if (await p.evaluate(() => document.body.dataset.mode + ' ' + /^#c\//.test(location.hash)) !== 'sheet true') errs.push('Back to the sheet did not reopen it');
  // phone
  const ctx2 = await b.newContext({ viewport: { width: 400, height: 800 }, colorScheme: 'dark' }); if (!E2E_URL) await ctx2.addInitScript(STUB);
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push('phone pageerror: ' + e.message));
  await p2.goto(URL); await p2.waitForTimeout(1200);
  const sw = await p2.evaluate(() => document.documentElement.scrollWidth), cw = await p2.evaluate(() => document.documentElement.clientWidth); if (sw > cw) errs.push('phone overflow ' + sw + '>' + cw);
  if (!E2E_URL) await homeStates(b, errs);
  if (!E2E_URL) await themeStates(b, errs);
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });

/* ---------- Home, state by state (stubbed runtime with real collections; role gm | player | ro) ---------- */
async function homeStates(b, errs) {
  const day = 86400000, T = (n) => new Date(Date.now() + n * day).toISOString();
  const fig = await (async () => { const c = await b.newContext(); await c.addInitScript(STUB); const pg = await c.newPage(); await pg.goto(URL); await pg.waitForTimeout(600); const s = await pg.evaluate(() => B68.lookFor('hound')); await c.close(); return s; })();
  const char = (id, name, owner, session) => ({ v: 2, name, alias: '', code: 'HND-968-' + (1000 + name.length), playbook: 'hound', playbookName: 'Hound', spec: Object.assign({}, fig, { name }), sheet: { playbook: 'hound', name }, play: { stress: 2, session: session || 0, xp: { playbook: 1 } }, owner, createdAt: T(-9), updatedAt: T(-1) });
  const camp = (extra) => Object.assign({ v: 1, session: { number: 3, startedAt: T(-1), endedAt: null }, crew: { name: 'The Night Shift', tier: 1 }, clocks: [], log: [],
    schedule: { options: { o_a: { at: T(3), minutes: 240 }, o_b: { at: T(10), minutes: 240 } }, avail: {}, next: null, rsvp: {}, cadence: null, quorum: 0, attendance: {} }, updatedAt: T(-1) }, extra || {});
  const stub = (role, seed) => `(() => {
    const store = ${JSON.stringify(seed)}; const colSubs = {}; const docSubs = {};
    const copy = (o) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
    const snapOf = (p) => ({ id: p.split('/')[1], exists: p in store, data: () => copy(store[p]), metadata: {} });
    const query = (c) => { const docs = Object.keys(store).filter(p => p.indexOf(c + '/') === 0).map(snapOf); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
    const fire = (p) => { (docSubs[p] || []).forEach(fn => fn(snapOf(p))); const c = p.split('/')[0]; (colSubs[c] || []).forEach(fn => fn(query(c))); };
    const docRef = (c, id) => { const p = c + '/' + id; return { id, get: async () => snapOf(p), set: async (d) => { store[p] = copy(d); fire(p); }, update: async (u) => { if (!(p in store)) throw new Error('No document to update'); Object.assign(store[p], copy(u)); fire(p); }, delete: async () => { delete store[p]; fire(p); }, onSnapshot: (fn) => { (docSubs[p] = docSubs[p] || []).push(fn); setTimeout(() => fn(snapOf(p)), 0); return () => {}; } }; };
    const col = (c) => { const q = () => ({ orderBy: q, limit: q, where: q, get: async () => query(c), onSnapshot: (fn) => { (colSubs[c] = colSubs[c] || []).push(fn); setTimeout(() => fn(query(c)), 0); return () => {}; } }); return Object.assign(q(), { doc: (id) => docRef(c, id), path: c }); };
    const id = ${JSON.stringify(role === 'gm' ? 'u_gm' : 'u_pat')};
    const user = { id: async () => id, can: async () => ${role !== 'ro'}, isOwner: async () => ${role === 'gm'}, canEdit: async () => ${role === 'gm'}, me: async () => ({ id, name: ${JSON.stringify(role === 'gm' ? 'Gail' : 'Pat')} }), profiles: async () => ({}) };
    window.claude = { use: async (name) => ({ db: { collection: col, doc: (p) => docRef(p.split('/')[0], p.split('/')[1]) }, user, downloads: { save: async () => {} } })[name] || null };
  })();`;
  async function open(role, seed, hash, vp) {
    const c = await b.newContext({ viewport: vp || { width: 1280, height: 900 } });
    if (seed) await c.addInitScript(stub(role, seed));
    const pg = await c.newPage(); pg.on('pageerror', e => errs.push('home ' + role + ' pageerror: ' + e.message)); pg.on('dialog', d => d.accept());
    pg.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('home ' + role + ' console.error: ' + m.text()); });
    await pg.goto(URL + (hash || '')); await pg.waitForTimeout(1000);
    return { c, pg };
  }
  const facts = (pg) => pg.evaluate(() => ({ mode: document.body.dataset.mode, kick: (document.querySelector('#home .hm-kick') || {}).textContent, title: (document.getElementById('homeTitle') || {}).textContent, text: document.getElementById('homeMain').textContent, files: !document.getElementById('files').hidden,
    mine: !document.getElementById('mineBtn').hidden, chars: document.querySelectorAll('#home .hm-char').length, primary: Array.from(document.querySelectorAll('#homeMain .btn.primary')).map(n => n.textContent),
    edits: Array.from(document.querySelectorAll('#cards .card')).map(c => c.querySelector('.nm').textContent + ':' + !!c.querySelector('.ed') + ':' + !!c.querySelector('.rm')) }));
  const want = (ok, msg, f) => { if (!ok) errs.push('Home ' + msg + (f ? ': ' + JSON.stringify(f) : '')); };
  const where = (pg) => pg.evaluate(() => document.body.dataset.mode + ' ' + location.hash);

  /* "Opening your sheets…" until the files settle */
  { const c = await b.newContext(); await c.addInitScript(`window.claude = { use: (n) => n === 'db' ? new Promise(() => {}) : Promise.resolve(n === 'user' ? { id: async () => 'u_pat', can: async () => true, isOwner: async () => false, canEdit: async () => false } : null) };`);
    const pg = await c.newPage(); await pg.goto(URL); await pg.waitForTimeout(600);
    want(/Opening your sheets/.test(await pg.$eval('#homeMain', n => n.textContent)) && !/files/i.test(await pg.$eval('#homeMain', n => n.textContent)) && await pg.$eval('#files', n => n.hidden), 'waits for the sheets, in plain words'); await c.close(); }

  /* C. a player with no character: the crew as kicker, Make your character, Mark your dates (two open dates) */
  { const { c, pg } = await open('player', { 'campaign/main': camp(), 'characters/sam-1': char('sam-1', 'Vera Lux', 'u_sam') });
    const f = await facts(pg);
    want(f.mode === 'home' && f.kick === 'The Night Shift' && f.title === 'Welcome to the table' && f.primary.join() === 'Make your character' && /2 dates need your answer/.test(f.text) && !f.mine && f.files, 'C (player, no character)', f);
    want(/then mark the dates you can play/.test(f.text) && /Saving it opens your sheet/.test(f.text) && !/living sheet|Filing/.test(f.text), 'C: with dates the lead mentions them; plain words about saving', f.text.slice(0, 200));
    const plain = await pg.evaluate(() => ({ title: document.getElementById('filesTitle').textContent, note: document.getElementById('rosterNote').textContent, whose: document.getElementById('rosterFilter').getAttribute('aria-label'), who: document.getElementById('whoami').textContent }));
    want(plain.title === 'Characters' && /^Yours are saved to your account\. Everyone at the table can see all characters\.$/.test(plain.note) && plain.whose === 'Whose characters' && !/files|filing/i.test(plain.who + plain.note + plain.title), 'C: the roster section and the header speak of characters, not files', plain);
    want(f.edits.join() === 'Vera Lux:false:false', 'C: another player’s card has no Edit figure and no remove', f.edits);
    await pg.evaluate(() => B68.toast('Hello from Home')); await pg.waitForTimeout(100);
    const t = await pg.$eval('#toast', n => { const r = n.getBoundingClientRect(); return { text: n.textContent, pos: getComputedStyle(n).position, inView: r.bottom <= innerHeight && r.top >= 0 && r.height > 0, role: document.getElementById('toastMsg').getAttribute('role') }; });
    want(t.text === 'Hello from Home' && t.pos === 'fixed' && t.inView && t.role === 'status', 'the toast shows on Home', t);
    await pg.click('#homeMain [data-hm="schedule"]'); await pg.waitForTimeout(700);
    want(await where(pg) === 'table #t/schedule', 'C: Mark your dates opens #t/schedule', await where(pg));
    want(await pg.evaluate(() => document.title) === 'The table · Blades ’68' && await pg.$eval('#viewName', n => n.textContent) === 'The table', 'C: title on the table');
    await pg.goBack(); await pg.waitForTimeout(400);
    want(await pg.evaluate(() => document.body.dataset.mode) === 'home', 'C: browser Back returns Home');
    await pg.screenshot({ path: 'out/e2e-home-player-new.png', fullPage: true });
    /* a draft survives a reload without claude.hot, Home offers it, Discard clears it */
    await pg.click('#homeMain [data-hm="new"]'); await pg.waitForTimeout(300);
    await pg.click('.pb[data-id="veteran"]'); await pg.waitForTimeout(200); await pg.evaluate(() => B68.showStep(8)); await pg.waitForTimeout(700);
    want(!!(await pg.evaluate(() => localStorage.getItem('b68.draft'))), 'draft written to localStorage');
    await pg.goto(URL); await pg.waitForTimeout(1000);
    const dr = await pg.$eval('#homeMain', n => (n.querySelector('.hm-draft') || {}).textContent || '');
    want(/Continue your draft/.test(dr) && /Veteran, step 9 of 16/.test(dr), 'draft offered after a reload', dr);
    await pg.click('#homeMain [data-hm="create"]'); await pg.waitForTimeout(300);
    want(await pg.evaluate(() => document.body.dataset.mode + ' ' + B68.S.sheet.playbook + ' ' + B68.S.step) === 'create veteran 8', 'Continue opens the draft where it was');
    await pg.click('#homeBtn'); await pg.waitForTimeout(300);
    await pg.click('#homeMain [data-hm="discard"]'); await pg.waitForTimeout(600);
    want(!(await pg.$('#homeMain .hm-draft')) && (await pg.evaluate(() => localStorage.getItem('b68.draft'))) === null, 'Discard clears the draft');
    await c.close(); }

  /* C2. a player with no character and nothing planned: the lead does not mention dates */
  { const { c, pg } = await open('player', { 'campaign/main': camp({ schedule: { options: {}, avail: {}, next: null, rsvp: {}, cadence: null, quorum: 0, attendance: {} } }) });
    const f = await facts(pg);
    want(f.title === 'Welcome to the table' && /Make your character to join the table/.test(f.text) && !/mark the dates|dates need/i.test(f.text), 'C2 (player, no character, no dates): the lead leaves dates out', f.text.slice(0, 200));
    await c.close(); }

  /* D. a player with one character: Welcome back, the big card, Your sheet, the session nudge */
  { const { c, pg } = await open('player', { 'campaign/main': camp(), 'characters/sam-1': char('sam-1', 'Vera Lux', 'u_sam'), 'characters/pat-1': char('pat-1', 'Aldo Crane', 'u_pat', 2) }, '', { width: 390, height: 844 });
    const f = await facts(pg);
    want(f.title === 'Welcome back, Pat' && f.chars === 1 && f.primary.join() === 'Open sheet' && /Session 3 has started at the table/.test(f.text) && f.mine, 'D (player with a character)', f);
    want(f.edits.join() === 'Aldo Crane:true:false', 'D: the files show Mine first', f.edits);
    const nud = await pg.$$eval('#homeMain .hm-nudges [data-hm]', ns => ns.map(n => n.dataset.hm + ':' + n.textContent));
    want(nud.filter(x => /^join:/.test(x)).join() === 'join:Join session 3' && !nud.some(x => /^open:/.test(x)) && !/Open the sheet/.test(f.text) && /Everyone’s characters/.test(f.text) && !/Everyone’s files/.test(f.text), 'D: the nudge says Join session 3 (not a second Open sheet); the link says Everyone’s characters', nud.concat(f.primary));
    const st = await pg.$eval('#homeMain .hm-char .st', n => parseFloat(getComputedStyle(n).fontSize));
    want(st >= 13, 'D: the returning player\'s status line is at least 13px: ' + st);
    await pg.click('#homeMain [data-hm="join"]'); await pg.waitForTimeout(1300);
    const jn = await pg.evaluate(() => { const b = document.querySelector('#dossier [data-act="sessjoin"]'), r = b && b.getBoundingClientRect(); return { mode: document.body.dataset.mode, focus: !!b && document.activeElement === b, inView: !!r && r.top >= 0 && r.bottom <= innerHeight, text: b && b.textContent }; });
    want(jn.mode === 'sheet' && jn.inView && jn.focus && jn.text === 'Join session 3', 'D: Join session 3 opens the sheet with its Join button in view and focused', jn);
    await pg.goBack(); await pg.waitForTimeout(600);
    await pg.click('#homeMain [data-hm="files"]'); await pg.waitForTimeout(300);
    want(await pg.$eval('#rosterFilter [data-f="all"]', n => n.getAttribute('aria-pressed')) === 'true' && (await facts(pg)).edits.length === 2, 'D: the Everyone’s characters link shows everyone’s characters', (await facts(pg)).edits);
    await pg.click('#rosterFilter [data-f="all"]'); await pg.waitForTimeout(200);
    const ed = (await facts(pg)).edits.sort();
    want(ed.join() === 'Aldo Crane:true:false,Vera Lux:false:false', 'D: Edit figure only on your own card, no remove chips', ed);
    const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); want(sw[0] <= sw[1], 'D: phone overflow ' + sw);
    await pg.screenshot({ path: 'out/e2e-home-player-back.png', fullPage: true });
    await pg.click('#mineBtn'); await pg.waitForTimeout(700);
    const s1 = await pg.evaluate(() => document.body.dataset.mode + ' ' + location.hash + ' ' + document.getElementById('mineBtn').getAttribute('aria-current') + ' ' + document.title);
    want(s1 === 'sheet #c/pat-1 page Aldo Crane · Blades ’68', 'D: Your sheet opens it', s1);
    want(await pg.evaluate(() => document.activeElement && document.activeElement.id) === 'viewName', 'D: focus on the view title after the switch');
    await pg.click('#dossier [data-act="back"]'); await pg.waitForTimeout(500);
    want(await where(pg) === 'home ', 'D: the sheet’s Back returns Home', await where(pg));
    /* a sheet opened from a link (nothing before it in this tab): Back goes Home in place */
    await pg.goto(URL + '#c/pat-1'); await pg.waitForTimeout(1000);
    const len = await pg.evaluate(() => history.length);
    await pg.click('#dossier [data-act="back"]'); await pg.waitForTimeout(500);
    want(await where(pg) === 'home ' && await pg.evaluate(() => history.length) === len, 'D: Back from a cold sheet replaces it with Home', await where(pg));
    await c.close(); }

  /* B. the GM with a started table: the crew name, the players table, the nudges that are true */
  { const seed = { 'campaign/main': camp({ schedule: { options: {}, avail: {}, next: { at: T(4), minutes: 240, place: '', note: '', confirmedAt: null }, rsvp: {}, cadence: null, quorum: 0, attendance: {} } }), 'characters/sam-1': char('sam-1', 'Vera Lux', 'u_sam'), 'characters/pat-1': char('pat-1', 'Aldo Crane', 'u_pat') };
    const { c, pg } = await open('gm', seed);
    const f = await facts(pg);
    want(f.title === 'The Night Shift' && f.primary.join() === 'Open the table' && /2 players haven’t answered/.test(f.text) && !/No dates proposed/.test(f.text) && !/Nobody has filed/.test(f.text) && !/Plan dates/.test(f.text), 'B (GM, table started)', f);
    want(await pg.$$eval('#homePlayers .tbl tbody tr', n => n.length) === 2, 'B: the players table');
    want(f.edits.length === 2 && f.edits.every(e => /:true:false$/.test(e)), 'B: the GM gets Edit figure on every card', f.edits);
    await pg.screenshot({ path: 'out/e2e-home-gm.png', fullPage: true });
    await c.close(); }
  /* B2. the GM, table started, nothing planned (the dates live in the group's calendar): no Plan dates, no No dates proposed; an empty table says No characters yet */
  { const { c, pg } = await open('gm', { 'campaign/main': camp({ schedule: { options: {}, avail: {}, next: null, rsvp: {}, cadence: null, quorum: 0, attendance: {} } }) });
    const f = await facts(pg);
    want(f.title === 'The Night Shift' && !/Plan dates|No dates|dates proposed/.test(f.text) && /No characters yet\./.test(f.text) && !/Nobody has filed|filed/.test(f.text), 'B2 (GM, table started, no dates, no characters): no schedule nag, plain words', f.text.slice(0, 220));
    await c.close(); }

  /* A. the GM before the table: the set-up page; step 1 opens the table with the crew name focused */
  { const { c, pg } = await open('gm', {});
    const f = await facts(pg);
    want(f.title === 'Set up the table' && /One table lives at this address/.test(f.text) && /a second copy of the app/.test(f.text), 'A (GM, no table)', f);
    want(!/Plan dates|Plan the first session/.test(f.text) && /Start the table/.test(f.text) && /Invite the players/.test(f.text), 'A: the set-up steps leave out planning dates', f.text.slice(0, 200));
    await pg.click('#homeMain [data-hm="table-setup"]'); await pg.waitForTimeout(900);
    const a1 = await pg.evaluate(() => document.body.dataset.mode + ' ' + (document.activeElement && document.activeElement.dataset.path));
    want(a1 === 'table crew.name', 'A: Open the table focuses the crew name', a1);
    await c.close(); }

  /* read only, and no runtime at all */
  { const { c, pg } = await open('ro', { 'campaign/main': camp() });
    const f = await facts(pg); want(/You can look around but not change anything/.test(f.text) && !/Restore your characters/.test(f.text), 'read-only player', f); await c.close(); }
  { const { c, pg } = await open('none', null);
    const f = await facts(pg); want(f.title === 'Welcome' && f.primary.join() === 'Make a character' && !f.files, 'no runtime: only Make a character', f);
    want(/Saving is not available in this view/.test(f.text) && !/files|filed/i.test(f.text), 'no runtime: plain words about saving', f.text.slice(0, 200)); await c.close(); }
}

/* ---------- the theme: Auto / Paper / Night in the footer, remembered, applied before the first paint, with readable text ---------- */
async function themeStates(b, errs) {
  const fs = require('fs'), want = (ok, msg, f) => { if (!ok) errs.push('Theme ' + msg + (f ? ': ' + JSON.stringify(f) : '')); };
  const html = fs.readFileSync(require('path').resolve(__dirname, '..', 'index.html'), 'utf8');
  /* the inline script that applies the choice sits ahead of every stylesheet, and reads localStorage in a try */
  const i = html.indexOf('localStorage.getItem(KEY)'), firstCss = Math.min(html.indexOf('<link'), html.indexOf('<style'));
  want(html.indexOf('<script>') >= 0 && html.indexOf('<script>') < firstCss && i > html.indexOf('<script>') && i < firstCss && /try \{ var t = localStorage\.getItem\(KEY\)/.test(html), 'the inline script that applies the theme is in the head, before the first stylesheet, and guards storage');
  const probe = `(() => { window.__themeAtWrap = 'none'; try { const mo = new MutationObserver(() => { if (document.querySelector('.wrap')) { window.__themeAtWrap = document.documentElement.getAttribute('data-theme'); mo.disconnect(); } }); mo.observe(document, { childList: true, subtree: true }); } catch (e) {} })();`;
  const state = (pg) => pg.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { attr: document.documentElement.getAttribute('data-theme'), stored: (() => { try { return localStorage.getItem('b68.theme'); } catch (e) { return 'blocked'; } })(), bg: getComputedStyle(document.body).backgroundColor, pressed: [...document.querySelectorAll('footer [data-theme-set]')].filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.textContent), tok: { faint: cs.getPropertyValue('--ink-faint').trim(), accent: cs.getPropertyValue('--accent').trim(), ok: cs.getPropertyValue('--ok').trim(), card: cs.getPropertyValue('--card').trim(), paper: cs.getPropertyValue('--paper').trim(), inset: cs.getPropertyValue('--inset').trim(), soft: cs.getPropertyValue('--ink-soft').trim() } }; });
  const PAPER = 'rgb(242, 237, 225)', NIGHT = 'rgb(26, 26, 28)';
  const lum = (h) => { const c = [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b2) => { const x = lum(a), y = lum(b2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  async function ctxFor(scheme, init) { const c = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme }); await c.addInitScript(probe); if (init) await c.addInitScript(init); const pg = await c.newPage(); pg.on('pageerror', e => errs.push('theme (' + scheme + ') pageerror: ' + e.message)); return { c, pg }; }

  /* a light device: Paper by default, nothing stored; Night on a tap, remembered, there before the first paint on the next visit */
  { const { c, pg } = await ctxFor('light'); await pg.goto(URL); await pg.waitForTimeout(700);
    let st = await state(pg);
    want(st.attr === null && st.stored === null && st.bg === PAPER && st.pressed.join() === 'Auto', 'light device, no choice: Paper, Auto pressed', st);
    want(ratio(st.tok.faint, st.tok.card) >= 4.5 && ratio(st.tok.faint, st.tok.paper) >= 4.5 && ratio(st.tok.faint, st.tok.inset) >= 4.5 && ratio(st.tok.accent, st.tok.card) >= 4.5, 'Paper: faint text is at least 4.5:1 on the card, the paper and the inset; accent text on the card too', st.tok);
    await pg.click('footer [data-theme-set="dark"]'); await pg.waitForTimeout(150);
    st = await state(pg);
    want(st.attr === 'dark' && st.stored === 'dark' && st.bg === NIGHT && st.pressed.join() === 'Night', 'Night on a tap, stored, pressed', st);
    want(ratio(st.tok.accent, st.tok.card) >= 4.5 && ratio(st.tok.accent, st.tok.paper) >= 4.5 && ratio(st.tok.faint, st.tok.card) >= 4.5 && ratio(st.tok.ok, st.tok.card) >= 4.5 && ratio(st.tok.soft, st.tok.card) >= 4.5, 'Night: accent, faint, ok and soft text are at least 4.5:1 on the card (accent on the paper too)', st.tok);
    await pg.reload(); await pg.waitForTimeout(700);
    st = await state(pg);
    want(st.attr === 'dark' && st.bg === NIGHT && st.pressed.join() === 'Night' && await pg.evaluate(() => window.__themeAtWrap) === 'dark', 'the choice is remembered and applied before the page body is even parsed (no flash)', { st, atWrap: await pg.evaluate(() => window.__themeAtWrap) });
    await pg.click('footer [data-theme-set="light"]'); await pg.waitForTimeout(150);
    st = await state(pg); want(st.attr === 'light' && st.stored === 'light' && st.bg === PAPER && st.pressed.join() === 'Paper', 'Paper on a tap', st);
    await pg.click('footer [data-theme-set="auto"]'); await pg.waitForTimeout(150);
    st = await state(pg); want(st.attr === null && st.stored === null && st.bg === PAPER && st.pressed.join() === 'Auto', 'Auto forgets the choice and follows the device again', st);
    await c.close(); }

  /* a dark device: Night by default; Paper on a tap overrides it, and survives a reload */
  { const { c, pg } = await ctxFor('dark'); await pg.goto(URL); await pg.waitForTimeout(700);
    let st = await state(pg);
    want(st.attr === null && st.bg === NIGHT && st.pressed.join() === 'Auto', 'dark device, no choice: Night, Auto pressed', st);
    await pg.click('footer [data-theme-set="light"]'); await pg.waitForTimeout(150);
    await pg.reload(); await pg.waitForTimeout(700);
    st = await state(pg);
    want(st.attr === 'light' && st.bg === PAPER && st.pressed.join() === 'Paper' && await pg.evaluate(() => window.__themeAtWrap) === 'light', 'Paper on a dark device is remembered and applied before the body is parsed', { st, atWrap: await pg.evaluate(() => window.__themeAtWrap) });
    await c.close(); }

  /* storage blocked (a private window, a sandboxed frame): the switch still works for the visit and nothing throws */
  { const { c, pg } = await ctxFor('light', `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('storage blocked'); } });`); await pg.goto(URL); await pg.waitForTimeout(700);
    await pg.click('footer [data-theme-set="dark"]'); await pg.waitForTimeout(150);
    const st = await state(pg);
    want(st.attr === 'dark' && st.bg === NIGHT && st.pressed.join() === 'Night', 'storage blocked: Night still applies for the visit', st);
    await c.close(); }
}
