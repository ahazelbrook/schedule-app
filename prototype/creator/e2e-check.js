const { chromium } = require('/opt/node-tools/node_modules/playwright');
const URL = 'file:///tmp/claude-0/-home-user-schedule-app/129e0dec-ffd1-5d8e-bbdf-0627b22952a4/scratchpad/creator/index.html';
// a tiny in-memory db stub with the contract's shape
const STUB = `(() => {
  const store = {}; const colSubs = []; const docSubs = {};
  const snapOf = (id) => ({ id, exists: id in store, data: () => store[id] ? JSON.parse(JSON.stringify(store[id])) : undefined, metadata: {} });
  const fire = (id) => { (docSubs[id] || []).forEach(fn => fn(snapOf(id))); colSubs.forEach(fn => fn(query())); };
  const query = () => { const docs = Object.keys(store).map(snapOf).sort((a, b) => (store[b.id].updatedAt || '').localeCompare(store[a.id].updatedAt || '')); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
  const docRef = (id) => ({ id, get: async () => snapOf(id), set: async (d) => { store[id] = JSON.parse(JSON.stringify(d)); window.__writes.push(['set', id]); fire(id); }, update: async (p) => { Object.assign(store[id], JSON.parse(JSON.stringify(p))); window.__writes.push(['update', id]); fire(id); }, delete: async () => { delete store[id]; window.__writes.push(['delete', id]); fire(id); }, onSnapshot: (fn) => { (docSubs[id] = docSubs[id] || []).push(fn); setTimeout(() => fn(snapOf(id)), 0); return () => {}; } });
  const q = () => ({ orderBy: q, limit: q, where: q, get: async () => query(), onSnapshot: (fn) => { colSubs.push(fn); setTimeout(() => fn(query()), 0); return () => {}; } });
  const col = () => Object.assign(q(), { doc: docRef, path: 'characters' });
  window.__writes = []; window.__store = store;
  window.claude = { use: async (name) => ({ db: { collection: col, doc: (p) => docRef(p.split('/')[1]) }, user: { id: async () => 'u_test', can: async () => true, isOwner: async () => true, canEdit: async () => true, me: async () => ({ id: 'u_test', name: '', avatarUrl: '', color: '#000', email: null, isOwner: true, canEdit: true }), profiles: async () => ({}) }, downloads: { save: async () => {} } })[name] || null };
})();`;
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('console.' + m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(1200);
  console.log('whoami:', await p.$eval('#whoami', e => e.textContent));
  await p.click('.pb[data-id="hound"]'); await p.waitForTimeout(500);
  // fill a complete sheet quickly
  await p.evaluate(() => { const S = B68.S, CT = B68.CT, pb = CT.byId.hound; S.sheet.name = 'Aldo Crane'; S.sheet.alias = 'Dusty'; S.sheet.heritage = 'Akoros'; S.sheet.background = 'Underworld'; S.sheet.dots = { Survey: 1, Consort: 2, Hunt: 2, Prowl: 1, Skirmish: 1 }; S.sheet.ability = pb.abilities[0][0]; S.sheet.keys = pb.keys.slice(0, 2); S.sheet.contacts = {}; S.sheet.contacts[pb.contacts[0][0] + ', ' + pb.contacts[0][1]] = 'friend'; S.sheet.contacts[pb.contacts[1][0] + ', ' + pb.contacts[1][1]] = 'friend'; S.sheet.contacts[pb.contacts[2][0] + ', ' + pb.contacts[2][1]] = 'rival'; S.sheet.vice = 'Gambling'; S.sheet.purveyor = 'The Silver Stag'; S.sheet.items = [pb.items[0][0], 'Binoculars']; S.sheet.cohortType = 'hound dog'; S.sheet.cohortName = 'Biscuit'; B68.syncNameToSpec(); B68.changed(); });
  await p.click('#rail button:nth-child(15)'); await p.waitForTimeout(500);
  console.log('wearing:', await p.evaluate(() => B68.S.sheet.wearing));
  await p.click('#rail button:nth-child(16)'); await p.waitForTimeout(500);
  console.log('checks:', await p.evaluate(() => B68.validate().filter(c => !c.ok).map(c => c.text)));
  await p.screenshot({ path: 'shots/e2e-file.png' });
  await p.click('#fileRoster'); await p.waitForTimeout(1200);
  const mode = await p.evaluate(() => document.body.dataset.mode); console.log('mode after filing:', mode, 'hash:', await p.evaluate(() => location.hash), 'writes:', await p.evaluate(() => JSON.stringify(window.__writes)));
  await p.screenshot({ path: 'shots/e2e-sheet-top.png' });
  await p.screenshot({ path: 'shots/e2e-sheet-full.png', fullPage: true });
  // interact: stress box 3, playbook xp 5, a clock tick
  const click = async (sel) => { const h = await p.$(sel); if (!h) { errs.push('missing ' + sel); return; } await h.click(); await p.waitForTimeout(250); };
  const sels = await p.evaluate(() => ({ stress: !!document.querySelector('#dossier [data-stress], #dossier .ds-stress button'), buttons: document.querySelectorAll('#dossier button').length }));
  console.log('dossier controls:', JSON.stringify(sels));
  await p.evaluate(() => { const bs = document.querySelectorAll('#dossier .ds-stress button, #dossier [data-stress]'); if (bs[2]) bs[2].click(); });
  await p.waitForTimeout(700);
  const play = await p.evaluate(() => { const id = Object.keys(window.__store)[0]; return { id, stress: window.__store[id].play.stress, keys: window.__store[id].play.keys.length, abilities: window.__store[id].play.abilities, owner: window.__store[id].owner, contacts: window.__store[id].play.contacts.length, items: window.__store[id].play.items, wearing: window.__store[id].sheet.wearing }; });
  console.log('stored:', JSON.stringify(play));
  // back to roster, card appears, click → sheet again
  await click('#dossier button.ds-back, #railBack');
  await p.waitForTimeout(600); console.log('mode after back:', await p.evaluate(() => document.body.dataset.mode), 'cards:', await p.$$eval('#cards .card', c => c.length));
  await p.screenshot({ path: 'shots/e2e-roster.png', fullPage: true });
  await p.click('#cards .card'); await p.waitForTimeout(800); console.log('mode after card:', await p.evaluate(() => document.body.dataset.mode));
  // phone
  const ctx2 = await b.newContext({ viewport: { width: 400, height: 800 }, colorScheme: 'dark' }); await ctx2.addInitScript(STUB);
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push('phone pageerror: ' + e.message));
  await p2.goto(URL); await p2.waitForTimeout(1200);
  const sw = await p2.evaluate(() => document.documentElement.scrollWidth), cw = await p2.evaluate(() => document.documentElement.clientWidth); if (sw > cw) errs.push('phone overflow ' + sw + '>' + cw);
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
