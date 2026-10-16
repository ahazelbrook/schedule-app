process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the GM table view and the JSON backups. Run from this dir:
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node table.js */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const SHOTS = __dirname;
const STUB = `(() => {
  const store = {}; const colSubs = []; const docSubs = {};
  const snapOf = (id) => ({ id, exists: id in store, data: () => store[id] ? JSON.parse(JSON.stringify(store[id])) : undefined, metadata: {} });
  const fire = (id) => { (docSubs[id] || []).forEach(fn => fn(snapOf(id))); colSubs.forEach(fn => fn(query())); };
  const query = () => { const docs = Object.keys(store).map(snapOf).sort((a, b) => (store[b.id].updatedAt || '').localeCompare(store[a.id].updatedAt || '')); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
  const docRef = (id) => ({ id, get: async () => snapOf(id), set: async (d) => { store[id] = JSON.parse(JSON.stringify(d)); window.__writes.push(['set', id]); fire(id); }, update: async (p) => { (function dm(t, s) { for (var k in s) { var v = s[k]; if (v && typeof v === "object" && !Array.isArray(v) && t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) dm(t[k], v); else t[k] = v; } })(store[id], JSON.parse(JSON.stringify(p))); window.__writes.push(['update', id]); fire(id); }, delete: async () => { delete store[id]; window.__writes.push(['delete', id]); fire(id); }, onSnapshot: (fn) => { (docSubs[id] = docSubs[id] || []).push(fn); setTimeout(() => fn(snapOf(id)), 0); return () => {}; } });
  const q = () => ({ orderBy: q, limit: q, where: q, get: async () => query(), onSnapshot: (fn) => { colSubs.push(fn); setTimeout(() => fn(query()), 0); return () => {}; } });
  const col = () => Object.assign(q(), { doc: docRef, path: 'characters' });
  window.__writes = []; window.__store = store; window.__saved = [];
  window.claude = { use: async (name) => ({ db: { collection: col, doc: (p) => docRef(p.split('/')[1]) }, user: { id: async () => 'u_test', can: async () => true, isOwner: async () => true, canEdit: async () => true, me: async () => ({ id: 'u_test', name: '', avatarUrl: '', color: '#000', email: null, isOwner: true, canEdit: true }), profiles: async () => ({}) }, downloads: { save: async (o) => { window.__saved.push({ filename: o.filename, data: typeof o.data === 'string' ? o.data : String(o.data) }); } } })[name] || null };
})();`;

/* the sheet the creator would write for each playbook, then file it */
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
  function assert(ok, msg) { if (!ok) fails.push(msg); }
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/ERR_FILE_NOT_FOUND/.test(t)) errs.push('console.error: ' + t); } });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(1200);
  const mode = () => p.evaluate(() => document.body.dataset.mode);
  const store = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
  const toast = () => p.$eval('#toast', n => n.textContent);
  /* restore through the file input: the preview dialog opens first; tick the opt-ins, then Restore (or Cancel) */
  const preview = async (pg, file, o) => {
    o = o || {};
    await pg.setInputFiles('#restoreFile', file); await pg.waitForTimeout(400);
    const open = await pg.$eval('#restoreDlg', n => n.open);
    if (!open) return { open, msg: await pg.$eval('#toast', n => n.textContent) };
    for (const k of ['copies', 'others']) if (o[k]) await pg.check('#restoreDlg input[data-o="' + k + '"]');
    const items = await pg.$$eval('#restoreDlg li', ls => ls.map(l => l.textContent));
    const sum = await pg.$eval('#restoreSum', n => n.textContent), go = await pg.$eval('#restoreDlg [data-o="go"]', n => ({ text: n.textContent, disabled: n.disabled }));
    await pg.click('#restoreDlg [data-o="' + (o.cancel ? 'cancel' : 'go') + '"]'); await pg.waitForTimeout(700);
    return { open, items, sum, go, closed: !(await pg.$eval('#restoreDlg', n => n.open)), msg: await pg.$eval('#toast', n => n.textContent) };
  };

  /* the backups row is shown and the view toggle defaults to cards */
  assert(!(await p.$eval('#backups', n => n.hidden)) && !(await p.$eval('#dlAll', n => n.hidden)) && !(await p.$eval('#restoreBtn', n => n.hidden)), 'backups row visible with db + downloads');
  assert(!(await p.$eval('#cards', n => n.hidden)) && (await p.$eval('#table', n => n.hidden)), 'cards view by default');

  /* file three characters */
  const ids = {};
  for (const pb of ['hound', 'hull', 'timetraveler']) {
    await p.evaluate(`(${SHEET})(${JSON.stringify(pb)}); true`);
    await p.waitForTimeout(900);
    assert((await mode()) === 'sheet', pb + ': sheet opened after filing');
    ids[pb] = await p.evaluate(() => B68.S.sheet.docId);
    await p.click('#homeBtn'); await p.waitForTimeout(300);
    await p.evaluate(() => B68.newCharacter()); await p.waitForTimeout(200);
    await p.waitForTimeout(20); /* distinct Date.now() ids */
  }
  notes.push('ids: ' + JSON.stringify(ids));
  assert(Object.keys(await store()).length === 3, 'three docs filed');

  /* give the living sheets some state, through the db so the roster subscription re-renders */
  await p.evaluate(async (ids) => {
    const db = await window.claude.use('db'); const col = db.collection('characters');
    const put = async (id, fn) => { const d = JSON.parse(JSON.stringify(window.__store[id])); fn(d.play); d.updatedAt = new Date().toISOString(); await col.doc(id).set(d); };
    await put(ids.hound, pl => { pl.stress = 4; pl.harm.l2[0] = 'Twisted ankle'; pl.harm.l3 = 'Broken ribs'; pl.healing = 2; pl.xp.playbook = 5; pl.keys[0].deadlock = 'up'; pl.stacks = 1; });
    await put(ids.hull, pl => { pl.stress = 3; pl.harm.l1[0] = 'Scraped plating'; pl.healing = 1; pl.xp.playbook = 2; });
    await put(ids.timetraveler, pl => { pl.stress = 2; pl.keys[1].glitch = 'Lagging'; pl.loadLimit = 'loud'; });
  }, ids);
  await p.waitForTimeout(400);

  /* cards and table agree on the status line source */
  const cardStatus = await p.$$eval('#cards .card .st', ns => ns.map(n => n.textContent));
  notes.push('card status: ' + cardStatus.join(' | '));
  assert(cardStatus.some(s => /^Drain 3\/10/.test(s)) && cardStatus.some(s => /^Stress 4\/9 · 2 harm · xp 5\/8 · 1 stacks$/.test(s)) && cardStatus.some(s => /^Instability 2\/9 · alluvium 4\/9/.test(s)), 'card status lines: ' + cardStatus.join(' | '));
  assert((await p.$$eval('#cards .card', c => c.length)) === 3 && (await p.evaluate(() => B68.roster.length)) === 3, 'three cards, A.roster has three');

  /* switch to the table */
  await p.click('#rosterView [data-v="table"]'); await p.waitForTimeout(300);
  assert((await p.evaluate(() => { try { return localStorage.getItem('b68.rosterView'); } catch (e) { return null; } })) === 'table', 'view remembered in localStorage');
  assert((await p.$eval('#cards', n => n.hidden)) && !(await p.$eval('#table', n => n.hidden)), 'table shown, cards hidden');
  const rows = await p.$$eval('#table .tbl tbody tr', trs => trs.map(tr => ({ id: tr.dataset.id, cells: Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()), labels: Array.from(tr.querySelectorAll('td')).map(td => td.dataset.l) })));
  notes.push('rows: ' + JSON.stringify(rows));
  assert(rows.length === 3, 'three table rows, got ' + rows.length);
  const row = (pb) => rows.find(r => r.id === ids[pb]);
  const hound = row('hound'), hull = row('hull'), tt = row('timetraveler');
  assert(hound && hull && tt, 'every filed character has a row');
  if (hound) {
    assert(/^Aldo CraneDusty$/.test(hound.cells[0]), 'hound name + alias: ' + hound.cells[0]);
    assert(hound.cells[1] === 'Hound', 'hound playbook: ' + hound.cells[1]);
    assert(hound.cells[2] === 'Stress4/9' && hound.labels[2] === 'Stress', 'hound stress cell: ' + hound.cells[2]);
    assert(/^3: Broken ribs\s*\+1$/.test(hound.cells[3]), 'hound worst harm: ' + hound.cells[3]);
    assert(hound.cells[4] === '2/4' && hound.cells[5] === '5/8', 'hound healing / xp: ' + hound.cells[4] + ' ' + hound.cells[5]);
    assert(hound.cells[6] === '3/3', 'hound load (2 items + 1 stack): ' + hound.cells[6]);
    assert(hound.cells[7] === '1', 'hound struck keys: ' + hound.cells[7]);
    assert(hound.cells[8] === 'just now', 'hound updated: ' + hound.cells[8]);
  }
  if (hull) {
    assert(hull.cells[2] === 'Drain3/10' && hull.labels[2] === 'Drain', 'hull drain cell: ' + hull.cells[2]);
    assert(hull.cells[3] === '1: Scraped plating', 'hull worst harm: ' + hull.cells[3]);
    assert(hull.cells[7] === '0', 'hull struck keys: ' + hull.cells[7]);
    assert(hull.cells[1] === 'Hull', 'hull playbook: ' + hull.cells[1]);
  }
  if (tt) {
    assert(tt.cells[2] === 'Instability2/9' && tt.labels[2] === 'Instability', 'tt instability cell: ' + tt.cells[2]);
    assert(tt.cells[3] === '—', 'tt no harm: ' + tt.cells[3]);
    assert(tt.cells[6] === '1/6', 'tt load loud: ' + tt.cells[6]);
    assert(tt.cells[7] === '1', 'tt struck (glitched) keys: ' + tt.cells[7]);
    assert(/Time Traveler/.test(tt.cells[1]), 'tt playbook: ' + tt.cells[1]);
  }
  /* the table and the cards' status line share the helper */
  const same = await p.evaluate((ids) => { const d = Object.assign({ id: ids.hound }, window.__store[ids.hound]); const f = B68.playFacts(d); return [B68.playStatus(d), f.stressName + ' ' + f.stress + '/' + f.stressMax]; }, ids);
  assert(same[0].indexOf(same[1]) === 0, 'playStatus starts with the same stress text the table shows: ' + same.join(' | '));

  /* screenshots: desktop light + dark */
  const roster = p.locator('.roster');
  await roster.screenshot({ path: path.join(SHOTS, 'table-desk.png') });
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await p.waitForTimeout(150);
  await roster.screenshot({ path: path.join(SHOTS, 'table-desk-dark.png') });
  await p.evaluate(() => { delete document.documentElement.dataset.theme; });

  /* a live update reaches the table */
  await p.evaluate(async (ids) => { const db = await window.claude.use('db'); const d = JSON.parse(JSON.stringify(window.__store[ids.hull])); d.play.stress = 7; d.updatedAt = new Date().toISOString(); await db.collection('characters').doc(ids.hull).set(d); }, ids);
  await p.waitForTimeout(300);
  const hullNow = await p.$eval('#table .tbl tbody tr[data-id="' + ids.hull + '"] td.st', n => n.textContent.trim());
  assert(hullNow === 'Drain7/10', 'live update reached the table: ' + hullNow);

  /* click a row -> the sheet; the sheet's Back -> Home, the table is still the view */
  await p.click('#table .tbl tbody tr[data-id="' + ids.hound + '"]'); await p.waitForTimeout(600);
  assert((await mode()) === 'sheet', 'row click opens the sheet');
  assert((await p.evaluate(() => location.hash)) === '#c/' + ids.hound, 'hash set to the row\'s character');
  await p.click('#dossier [data-act="back"]'); await p.waitForTimeout(400);
  assert((await mode()) === 'home' && !(await p.$eval('#table', n => n.hidden)), 'back to the table');
  /* the backup row names what a download holds */
  assert(/every character on file and the whole table/.test(await p.$eval('#backupHint', n => n.textContent)) && (await p.$eval('#dlAll', n => n.textContent)) === 'Download a backup' && (await p.$eval('#restoreBtn', n => n.textContent)) === 'Restore from a backup…', 'backup buttons and hint: ' + await p.$eval('#backups', n => n.textContent));

  /* download all */
  await p.click('#dlAll'); await p.waitForTimeout(400);
  const saved = await p.evaluate(() => window.__saved);
  assert(saved.length === 1, 'one download, got ' + saved.length);
  let backup = null;
  if (saved.length) {
    assert(/^blades68-backup-\d{4}-\d{2}-\d{2}\.json$/.test(saved[0].filename), 'download filename: ' + saved[0].filename);
    try { backup = JSON.parse(saved[0].data); } catch (e) { fails.push('download is not JSON'); }
    if (backup) assert(backup.v === 1 && typeof backup.exportedAt === 'string' && Array.isArray(backup.characters) && backup.characters.length === 3, 'download shape: v=' + backup.v + ' n=' + (backup.characters || []).length);
    if (backup) assert(backup.characters.every(c => c.play && c.sheet && c.spec && c.playbook), 'download carries play, sheet, spec, playbook');
    if (backup) assert(!('campaign' in backup), 'no table stored yet: the download has no campaign key');
    notes.push('download: ' + saved[0].filename + ' ' + saved[0].data.length + ' bytes');
  }

  /* restore that same JSON through the file input: six files, three new ids, owner me, play kept */
  const tmp = path.join(SHOTS, 'tmp-backup.json');
  fs.writeFileSync(tmp, saved.length ? saved[0].data : '{}');
  const before = Object.keys(await store());
  let pv = await preview(p, tmp, { cancel: true });
  assert(pv.open && pv.items.length === 3 && pv.items.every(t => /already on file · skipped$/.test(t)) && pv.go.disabled && /Nothing new to add/.test(pv.sum), 'preview: the same file again is three matches, skipped: ' + JSON.stringify(pv));
  assert(pv.closed && /^Restore cancelled\. Nothing was changed\.$/.test(pv.msg) && Object.keys(await store()).length === 3, 'preview cancelled: nothing written: ' + pv.msg);
  pv = await preview(p, tmp, { copies: true });
  assert(/^Restore 3$/.test(pv.go.text) && /Adds 3 characters as new copies owned by you/.test(pv.sum) && pv.items.every(t => /added as a new copy$/.test(t)), 'preview with copies: ' + JSON.stringify(pv));
  const after = await store();
  const newIds = Object.keys(after).filter(id => before.indexOf(id) < 0);
  assert(Object.keys(after).length === 6, 'six docs after restore, got ' + Object.keys(after).length);
  assert(newIds.length === 3 && newIds.every(id => /^[a-z0-9-]+-[a-z0-9]+$/.test(id)), 'three new ids: ' + newIds.join(','));
  assert(newIds.every(id => after[id].owner === 'u_test' && after[id].createdAt && after[id].updatedAt && after[id].v === 2), 'restored docs owned by me with fresh timestamps');
  const restoredHull = newIds.map(id => after[id]).find(d => d.playbook === 'hull');
  assert(restoredHull && restoredHull.play && restoredHull.play.stress === 7 && restoredHull.name === 'Unit Seven' && restoredHull.playbookName === 'Hull', 'restored hull keeps its play: ' + JSON.stringify(restoredHull && { stress: restoredHull.play.stress, name: restoredHull.name }));
  assert(newIds.every(id => after[id].createdAt !== backup.characters.find(c => c.name === after[id].name).createdAt), 'createdAt is now, not the backup\'s');
  assert(/^Restored 3 characters\.$/.test(pv.msg), 'toast: ' + pv.msg);
  await p.click('#rosterView [data-v="cards"]'); await p.waitForTimeout(400);
  const cards = await p.$$eval('#cards .card', c => c.length);
  assert(cards === 6, 'six cards after restore, got ' + cards);
  assert((await p.$$eval('#cards .card.mine', c => c.length)) === 6, 'all six are mine');
  await p.click('#rosterView [data-v="table"]'); await p.waitForTimeout(300);
  assert((await p.$$eval('#table .tbl tbody tr', t => t.length)) === 6, 'six table rows after restore');

  /* an invalid entry is skipped and counted; a play-less entry gets initialPlay */
  const mixed = { v: 1, exportedAt: new Date().toISOString(), characters: [
    { name: 'Nobody', playbook: 'nope', sheet: {} },
    { name: 'No sheet', playbook: 'hound' },
    { name: 'Fresh Hound', alias: 'New', playbook: 'hound', sheet: { name: 'Fresh Hound', keys: ['Sardonic (▼ Grim ▲ Witty)'], items: ['Binoculars'], dots: { Hunt: 2 } } }
  ] };
  fs.writeFileSync(tmp, JSON.stringify(mixed));
  pv = await preview(p, tmp);
  assert(pv.items.length === 1 && /^Fresh Hound/.test(pv.items[0]), 'mixed preview lists the one valid entry: ' + JSON.stringify(pv.items));
  assert(/^Restored 1 character · skipped 2 invalid\.$/.test(pv.msg), 'mixed toast: ' + pv.msg);
  const s7 = await store(); const fresh = Object.keys(s7).map(k => s7[k]).find(d => d.name === 'Fresh Hound');
  assert(Object.keys(s7).length === 7 && fresh && fresh.play && fresh.play.keys && fresh.play.keys.length === 1 && fresh.play.items[0] === 'Binoculars' && fresh.spec && fresh.spec.props, 'play-less entry filed with initialPlay + base figure: ' + JSON.stringify(fresh && { keys: fresh.play.keys, items: fresh.play.items }));
  /* garbage is refused without throwing */
  fs.writeFileSync(tmp, 'not json');
  await p.setInputFiles('#restoreFile', tmp); await p.waitForTimeout(400);
  assert(/not JSON/.test(await toast()) && await p.$eval('#toastErr', n => n.getAttribute('role') === 'alert' && n.textContent.length > 0), 'non-JSON toast (an alert): ' + (await toast()));
  fs.writeFileSync(tmp, JSON.stringify({ v: 2, characters: [] }));
  await p.setInputFiles('#restoreFile', tmp); await p.waitForTimeout(400);
  assert(/Unknown backup version 2/.test(await toast()) && !(await p.$eval('#restoreDlg', n => n.open)), 'wrong version toast, no preview: ' + (await toast()));
  assert(Object.keys(await store()).length === 7, 'nothing filed from bad input');
  try { fs.unlinkSync(tmp); } catch (e) {}

  /* the remembered view survives a reload (the store does not, so the empty state shows in the table box) */
  await p.reload(); await p.waitForTimeout(1200);
  assert((await p.$eval('#rosterView [data-v="table"]', n => n.getAttribute('aria-pressed'))) === 'true' && !(await p.$eval('#table', n => n.hidden)), 'table view remembered after reload');
  assert((await p.$eval('#table', n => n.textContent)).indexOf('No characters yet') >= 0 && !/on file|filed/.test(await p.$eval('#table', n => n.textContent)), 'empty state in the table box, in plain words');

  /* phone: 390px, light and dark, no horizontal scroll */
  await p.evaluate(`(${SHEET})('hound'); true`); await p.waitForTimeout(900);
  await p.click('#homeBtn'); await p.waitForTimeout(200); await p.evaluate(() => B68.newCharacter());
  await p.evaluate(`(${SHEET})('hull'); true`); await p.waitForTimeout(900);
  await p.click('#homeBtn'); await p.waitForTimeout(200); await p.evaluate(() => B68.newCharacter());
  await p.evaluate(`(${SHEET})('timetraveler'); true`); await p.waitForTimeout(900);
  await p.click('#homeBtn'); await p.waitForTimeout(300);
  await p.evaluate(async () => { const db = await window.claude.use('db'); const col = db.collection('characters'); for (const id of Object.keys(window.__store)) { const d = JSON.parse(JSON.stringify(window.__store[id])); if (d.playbook === 'hound') { d.play.stress = 4; d.play.harm.l3 = 'Broken ribs'; d.play.healing = 2; d.play.xp.playbook = 5; d.play.keys[0].deadlock = 'up'; } if (d.playbook === 'hull') { d.play.stress = 8; d.play.harm.l1[0] = 'Scraped plating'; } if (d.playbook === 'timetraveler') { d.play.keys[1].glitch = 'Lagging'; } await col.doc(id).set(d); } });
  await p.waitForTimeout(400);
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(400);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth), cw = await p.evaluate(() => document.documentElement.clientWidth);
  if (sw > cw) errs.push('phone overflow ' + sw + '>' + cw);
  const tw = await p.$eval('#table .tbl', n => n.scrollWidth), tcw = await p.$eval('#table', n => n.clientWidth);
  if (tw > tcw + 1) errs.push('table wider than its box on the phone ' + tw + '>' + tcw);
  const stacked = await p.$eval('#table .tbl thead', n => getComputedStyle(n).display); assert(stacked === 'none', 'phone: header band hidden, rows stacked (' + stacked + ')');
  await roster.screenshot({ path: path.join(SHOTS, 'table-phone.png') });
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await p.waitForTimeout(150);
  await roster.screenshot({ path: path.join(SHOTS, 'table-phone-dark.png') });
  await p.evaluate(() => { delete document.documentElement.dataset.theme; });

  /* the Keys step: a hovered (orange) and a selected key chip keep their deadlock sub-labels legible, both themes */
  await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(200);
  await p.evaluate(() => { B68.setMode('create'); B68.newCharacter(); B68.choosePlaybook('vampire'); B68.S.sheet.keys = B68Content.GENERIC_KEYS.slice(0, 3); B68.changed(); B68.showStep(10); });
  await p.waitForTimeout(300);
  for (const theme of ['light', 'dark']) {
    await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme); await p.waitForTimeout(100);
    await p.hover('.keys .key[aria-pressed="false"]'); await p.waitForTimeout(250);
    const c = await p.evaluate(() => { const hov = document.querySelector('.keys .key:hover'), sel = document.querySelector('.keys .key[aria-pressed="true"]'); const g = (n) => getComputedStyle(n); const r = (n) => ({ bg: g(n).backgroundColor, fg: g(n).color, small: g(n.querySelector('small')).color, op: g(n.querySelector('small')).opacity }); return { hover: hov && r(hov), sel: sel && r(sel) }; });
    notes.push(theme + ' key chips: ' + JSON.stringify(c));
    assert(c.hover && c.hover.small === c.hover.fg, theme + ': hovered key sub-label uses the chip text colour (' + JSON.stringify(c.hover) + ')');
    assert(c.sel && c.sel.small === c.sel.fg, theme + ': selected key sub-label uses the chip text colour (' + JSON.stringify(c.sel) + ')');
    await p.locator('.keys').screenshot({ path: path.join(SHOTS, 'table-keys-' + theme + '.png') });
  }
  await p.evaluate(() => { delete document.documentElement.dataset.theme; });

  /* ---------- backups with the table (campaign/main): GM and player views, the three restore formats, the hosted export ---------- */
  const seedChar = backup && backup.characters[0];
  const T0 = '2026-09-01T18:00:00.000Z';
  const camp0 = { v: 1, session: { number: 3, startedAt: T0, endedAt: null }, crew: { name: 'The Night Shift', tier: 1, heat: 2 },
    clocks: [{ id: 'c_open', name: 'Heat rising', size: 6, filled: 2, kind: 'danger', hidden: false }, { id: 'c_secret', name: 'Secret plot', size: 8, filled: 5, kind: 'faction', hidden: true }],
    log: [{ at: T0, by: 'u_gm', text: 'Session 3 started' }], schedule: { options: {}, avail: {}, next: null, rsvp: {}, cadence: null, quorum: 0, attendance: {} }, updatedAt: T0 };
  const apiExport = { exportedAt: '2026-09-02T10:00:00.000Z',
    campaign: { id: 'default', doc: Object.assign({}, camp0, { crew: { name: 'Exported Crew', tier: 2 }, updatedAt: '2026-09-02T09:00:00.000Z' }), updatedAt: '2026-09-02T09:00:00.000Z' },
    characters: seedChar ? [{ id: 'x-1', doc: Object.assign({}, seedChar, { name: 'Exported One', id: undefined }), updatedAt: '2026-09-02T09:00:00.000Z' }] : [],
    members: [{ id: 'gm@example.test', name: 'Gail', role: 'gm' }] };
  /* role: gm | player; hosted: a stand-in for runtime/cf.js's B68Runtime with exportAll (the API's /api/export answer) */
  const roleStub = (role, seed, hosted) => `(() => {
    const store = ${JSON.stringify(seed)}; const colSubs = {}; const docSubs = {};
    const copy = (o) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
    const snapOf = (p) => ({ id: p.split('/')[1], exists: p in store, data: () => copy(store[p]), metadata: {} });
    const query = (c) => { const docs = Object.keys(store).filter(p => p.indexOf(c + '/') === 0).map(snapOf).sort((a, b) => (store[c + '/' + b.id].updatedAt || '').localeCompare(store[c + '/' + a.id].updatedAt || '')); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
    const fire = (p) => { (docSubs[p] || []).forEach(fn => fn(snapOf(p))); const c = p.split('/')[0]; (colSubs[c] || []).forEach(fn => fn(query(c))); };
    const docRef = (c, id) => { const p = c + '/' + id; return { id, get: async () => snapOf(p),
      set: async (d) => { store[p] = copy(d); window.__writes.push(['set', p]); fire(p); },
      update: async (u) => { if (!(p in store)) throw new Error('No document to update: ' + p); Object.assign(store[p], copy(u)); window.__writes.push(['update', p]); fire(p); },
      delete: async () => { delete store[p]; window.__writes.push(['delete', p]); fire(p); },
      onSnapshot: (fn) => { (docSubs[p] = docSubs[p] || []).push(fn); setTimeout(() => fn(snapOf(p)), 0); return () => {}; } }; };
    const col = (c) => { const q = () => ({ orderBy: q, limit: q, where: q, get: async () => query(c), onSnapshot: (fn) => { (colSubs[c] = colSubs[c] || []).push(fn); setTimeout(() => fn(query(c)), 0); return () => {}; } }); return Object.assign(q(), { doc: (id) => docRef(c, id), path: c }); };
    window.__writes = []; window.__store = store; window.__saved = [];
    const id = ${JSON.stringify(role === 'gm' ? 'u_gm' : 'u_player')};
    const user = { id: async () => id, can: async () => true, isOwner: async () => ${role === 'gm'}, canEdit: async () => ${role === 'gm'}, me: async () => ({ id, name: '', email: null }), profiles: async () => ({}) };
    ${hosted ? `window.B68Runtime = { kind: 'cloudflare', me: { id, email: id, name: id, role: ${JSON.stringify(role)} }, status: { online: true, pending: 0, lastSync: null }, exportAll: async () => { window.__exports = (window.__exports || 0) + 1; return ${JSON.stringify(apiExport)}; } };` : ''}
    window.claude = { use: async (name) => ({ db: { collection: col, doc: (p) => docRef(p.split('/')[0], p.split('/')[1]) }, user, downloads: { save: async (o) => { window.__saved.push({ filename: o.filename, data: typeof o.data === 'string' ? o.data : String(o.data) }); } } })[name] || null };
  })();`;
  const seed = { 'campaign/main': camp0 }; if (seedChar) seed['characters/seed-1'] = Object.assign({}, seedChar, { id: undefined });
  async function rolePage(role, hosted) {
    const c = await b.newContext({ viewport: { width: 1360, height: 900 } });
    await c.addInitScript(roleStub(role, seed, hosted));
    const pg = await c.newPage(); pg.__dialogs = []; pg.__answer = 'accept';
    pg.on('pageerror', e => errs.push(role + ' pageerror: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push(role + ' console.error: ' + m.text()); });
    pg.on('dialog', d => { pg.__dialogs.push(d.message()); return pg.__answer === 'dismiss' ? d.dismiss() : d.accept(); });
    await pg.goto(URL); await pg.waitForTimeout(1000);
    return { c, pg };
  }
  let lastPreview = null;
  const restoreFile = async (pg, obj, o) => { const f = path.join(SHOTS, 'tmp-backup2.json'); fs.writeFileSync(f, JSON.stringify(obj)); lastPreview = await preview(pg, f, o); try { fs.unlinkSync(f); } catch (e) {} return lastPreview.msg; };
  const stored = (pg) => pg.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
  const charCount = (st) => Object.keys(st).filter(k => k.indexOf('characters/') === 0).length;
  const download = async (pg) => { await pg.click('#dlAll'); await pg.waitForTimeout(400); const sv = await pg.evaluate(() => window.__saved); return sv.length ? { filename: sv[sv.length - 1].filename, text: sv[sv.length - 1].data, json: JSON.parse(sv[sv.length - 1].data) } : null; };

  /* the GM's download carries the whole table, hidden clocks included */
  const G = await rolePage('gm', false);
  assert(await G.pg.$eval('#dlEverything', n => n.hidden), 'artifact runtime: no Download everything');
  const gmFile = await download(G.pg);
  assert(gmFile && gmFile.json.v === 1 && Array.isArray(gmFile.json.characters) && gmFile.json.characters.length === 1, 'GM download: v 1 with the characters list');
  assert(gmFile && gmFile.json.campaign && gmFile.json.campaign.id === 'main' && gmFile.json.campaign.view === 'gm' && gmFile.json.campaign.doc.crew.name === 'The Night Shift' && gmFile.json.campaign.doc.session.number === 3, 'GM download includes the campaign: ' + JSON.stringify(gmFile && gmFile.json.campaign && { id: gmFile.json.campaign.id, view: gmFile.json.campaign.view }));
  assert(gmFile && gmFile.json.campaign.doc.clocks.map(c => c.name).join() === 'Heat rising,Secret plot', 'GM download keeps the hidden clock');
  notes.push('GM download with the table: ' + (gmFile && gmFile.filename) + ' ' + (gmFile && gmFile.text.length) + ' bytes');

  /* a player's download leaves out the clocks hidden from players, as the page does */
  const P = await rolePage('player', false);
  const plFile = await download(P.pg);
  assert(plFile && plFile.json.campaign && plFile.json.campaign.view === 'player' && plFile.json.campaign.doc.clocks.map(c => c.name).join() === 'Heat rising', 'player download: only the visible clock: ' + JSON.stringify(plFile && plFile.json.campaign && plFile.json.campaign.doc.clocks));
  assert(plFile && plFile.text.indexOf('Secret plot') < 0 && plFile.text.indexOf('c_secret') < 0, 'player download does not mention the hidden clock');

  /* a player restores the new format: the characters land, the table is refused without asking and left unwritten */
  const restored = JSON.parse(JSON.stringify(gmFile ? gmFile.json : {})); if (restored.campaign) restored.campaign.doc.crew.name = 'Restored Crew';
  let msg = await restoreFile(P.pg, restored, { cancel: true }), st = await stored(P.pg);
  assert(lastPreview.open && lastPreview.items.length === 1 && /already on file · another player’s · skipped$/.test(lastPreview.items[0]) && lastPreview.go.disabled && /only the GM can restore the table/.test(await P.pg.$eval('#restoreDlg', n => n.textContent)), 'player preview: another player’s character, already on file, skipped by default: ' + JSON.stringify(lastPreview));
  assert(charCount(st) === 1 && !(await P.pg.evaluate(() => window.__writes)).length, 'player preview cancelled: nothing written');
  msg = await restoreFile(P.pg, restored, { copies: true, others: true }); st = await stored(P.pg);
  assert(charCount(st) === 2 && st['campaign/main'].crew.name === 'The Night Shift', 'player restore: one more character, table unchanged (' + charCount(st) + ', ' + st['campaign/main'].crew.name + ')');
  assert(!(await P.pg.evaluate(() => window.__writes)).some(w => w[1] === 'campaign/main') && !P.pg.__dialogs.length, 'player restore: no campaign write, no confirm');
  assert(/^Restored 1 character · only the GM can restore the table\.$/.test(msg), 'player restore toast: ' + msg);
  msg = await restoreFile(P.pg, { v: 1, exportedAt: restored.exportedAt, characters: [], campaign: restored.campaign });
  assert(/^Only the GM can restore the table\.$/.test(msg) && charCount(await stored(P.pg)) === 2, 'player restore of a table-only file: ' + msg);
  await P.c.close();

  /* the GM: the old character-only file restores characters and never touches the table */
  msg = await restoreFile(G.pg, { v: 1, exportedAt: T0, characters: gmFile ? gmFile.json.characters : [] }, { copies: true });
  st = await stored(G.pg);
  assert(lastPreview.items.length === 1 && /already on file · added as a new copy$/.test(lastPreview.items[0]) && !/another player/.test(lastPreview.items[0]), 'GM preview: no opt-in needed for others’ characters: ' + JSON.stringify(lastPreview.items));
  assert(/^Restored 1 character\.$/.test(msg) && charCount(st) === 2 && !G.pg.__dialogs.length && st['campaign/main'].crew.name === 'The Night Shift', 'GM old-format restore: ' + msg);
  /* the new format, confirm dismissed: characters only */
  G.pg.__answer = 'dismiss';
  msg = await restoreFile(G.pg, restored, { copies: true }); st = await stored(G.pg);
  assert(G.pg.__dialogs.length === 1 && /Replace the table/.test(G.pg.__dialogs[0]) && /Cancel restores the characters only/.test(G.pg.__dialogs[0]), 'GM restore asks first: ' + G.pg.__dialogs[0]);
  assert(/^Restored 1 character · the table was left as it is\.$/.test(msg) && charCount(st) === 3 && st['campaign/main'].crew.name === 'The Night Shift', 'GM restore, confirm dismissed: ' + msg);
  /* the new format, confirmed: the table is replaced through the db, hidden clock and all */
  G.pg.__answer = 'accept'; await G.pg.evaluate(() => { window.__writes.length = 0; });
  msg = await restoreFile(G.pg, restored, { copies: true }); st = await stored(G.pg);
  assert(/^Restored 1 character and the table\.$/.test(msg) && charCount(st) === 4, 'GM restore with the table: ' + msg);
  assert(st['campaign/main'].crew.name === 'Restored Crew' && st['campaign/main'].clocks.length === 2 && st['campaign/main'].session.number === 3 && st['campaign/main'].log.length === 1 && st['campaign/main'].updatedAt > T0, 'GM restore wrote the table: ' + JSON.stringify(st['campaign/main'].crew));
  assert((await G.pg.evaluate(() => window.__writes)).some(w => w[0] === 'set' && w[1] === 'campaign/main'), 'GM restore: one set on campaign/main');
  /* a player's copy warns that it has no hidden clocks */
  G.pg.__answer = 'dismiss';
  msg = await restoreFile(G.pg, plFile ? plFile.json : {});
  assert(lastPreview.go.text === 'Restore the table' && /^Restored nothing · skipped 1 already on file · the table was left as it is\.$/.test(msg), 'player copy, matches skipped, table refused: ' + msg);
  assert(/no hidden clocks/.test(G.pg.__dialogs[G.pg.__dialogs.length - 1] || ''), 'player copy: the confirm says so');
  /* the hosted /api/export format: wrapped characters, the campaign with its server id, members ignored */
  G.pg.__answer = 'accept';
  msg = await restoreFile(G.pg, apiExport); st = await stored(G.pg);
  const exported = Object.keys(st).map(k => st[k]).find(d => d.name === 'Exported One');
  assert(/^Restored 1 character and the table\.$/.test(msg) && exported && exported.owner === 'u_gm' && st['campaign/main'].crew.name === 'Exported Crew', '/api/export restore: ' + msg);
  /* an /api/export taken before anything was stored (the default campaign, updatedAt null): characters only, no confirm */
  const nd = G.pg.__dialogs.length;
  msg = await restoreFile(G.pg, Object.assign({}, apiExport, { campaign: { id: 'default', doc: Object.assign({}, camp0, { updatedAt: null }), updatedAt: null } }), { copies: true });
  assert(/^Restored 1 character\.$/.test(msg) && G.pg.__dialogs.length === nd, 'export with the default campaign: ' + msg);
  await G.c.close();

  /* hosted runtime: the GM gets Download everything (the server's export as it came); a player does not */
  const H = await rolePage('gm', true);
  assert(!(await H.pg.$eval('#dlEverything', n => n.hidden)), 'hosted GM: Download everything shown');
  await H.pg.click('#dlEverything'); await H.pg.waitForTimeout(400);
  const hs = await H.pg.evaluate(() => ({ saved: window.__saved, calls: window.__exports }));
  const last = hs.saved[hs.saved.length - 1];
  assert(hs.calls === 1 && last && /^blades68-default-2026-09-02\.json$/.test(last.filename) && JSON.stringify(JSON.parse(last.data)) === JSON.stringify(apiExport), 'Download everything saved the export: ' + (last && last.filename));
  await H.c.close();
  const HP = await rolePage('player', true);
  assert(await HP.pg.$eval('#dlEverything', n => n.hidden), 'hosted player: no Download everything');
  await HP.c.close();

  /* no db / no downloads: the backups row hides, nothing throws */
  const ctx2 = await b.newContext({ viewport: { width: 1360, height: 900 } });
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push('no-claude pageerror: ' + e.message)); p2.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('no-claude console.error: ' + m.text()); });
  await p2.goto(URL); await p2.waitForTimeout(1000);
  assert(await p2.$eval('#backups', n => n.hidden), 'no window.claude: backups row hidden');
  assert(await p2.$eval('#files', n => n.hidden), 'no window.claude: Home leaves out the files it cannot read');
  await p2.evaluate(() => B68.setRosterView('cards')); await p2.waitForTimeout(200);
  assert(!(await p2.$eval('#cards', n => n.hidden)), 'no window.claude: toggle still works');
  await ctx2.close();

  console.log('NOTES:\n' + notes.join('\n'));
  console.log('FAILS:', fails.length ? '\n' + fails.join('\n') : 'none');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await b.close();
  process.exit(fails.length || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
