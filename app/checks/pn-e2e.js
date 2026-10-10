process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const STUB = `(() => {
  const store = {}; const colSubs = []; const docSubs = {};
  const snapOf = (id) => ({ id, exists: id in store, data: () => store[id] ? JSON.parse(JSON.stringify(store[id])) : undefined, metadata: {} });
  const fire = (id) => { (docSubs[id] || []).forEach(fn => fn(snapOf(id))); colSubs.forEach(fn => fn(query())); };
  const query = () => { const docs = Object.keys(store).map(snapOf).sort((a, b) => (store[b.id].updatedAt || '').localeCompare(store[a.id].updatedAt || '')); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
  const docRef = (id) => ({ id, get: async () => snapOf(id), set: async (d) => { store[id] = JSON.parse(JSON.stringify(d)); window.__writes.push(['set', id]); fire(id); }, update: async (p) => { Object.assign(store[id], JSON.parse(JSON.stringify(p))); fire(id); }, delete: async () => { delete store[id]; fire(id); }, onSnapshot: (fn) => { (docSubs[id] = docSubs[id] || []).push(fn); setTimeout(() => fn(snapOf(id)), 0); return () => {}; } });
  const q = () => ({ orderBy: q, limit: q, where: q, get: async () => query(), onSnapshot: (fn) => { colSubs.push(fn); setTimeout(() => fn(query()), 0); return () => {}; } });
  const col = () => Object.assign(q(), { doc: docRef, path: 'characters' });
  window.__writes = []; window.__store = store;
  window.claude = { use: async (name) => ({ db: { collection: col, doc: (p) => docRef(p.split('/')[1]) }, user: { id: async () => 'u_test', can: async () => true }, downloads: { save: async () => {} } })[name] || null };
})();`;
const SHOTS = require('path').join(__dirname, 'out') + '/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('console.' + m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(1200);
  await p.screenshot({ path: SHOTS + 'pn-playbook.png', fullPage: false });
  // look warnings for the four new looks
  console.log('look warnings:', await p.evaluate(() => ['ghost','vampire','timetraveler','timepast'].map(id => id + ':' + JSON.stringify(B68.K.render(B68.lookFor(id), { height: 300 }).warnings))));
  const covers = await p.$$eval('.pb', bs => bs.map(b => b.dataset.id + '|' + b.querySelector('.foot').textContent.trim() + '|' + !!b.querySelector('svg') + '|' + b.disabled));
  console.log('covers:', covers.join('\n  '));
  const walk = async (id, fill) => {
    await p.evaluate(() => B68.newCharacter());
    await p.click('.pb[data-id="' + id + '"]'); await p.waitForTimeout(400);
    console.log('\n=== ' + id + ' === cover meta:', await p.$eval('#coverMeta', e => e.textContent), '| art ghostly:', await p.$eval('#art', e => e.classList.contains('ghostly')));
    console.log('pbinfo:', (await p.$eval('.pbinfo', e => e.textContent)).slice(0, 220).replace(/\s+/g, ' ') + '…');
    // walk every step, note visible controls
    for (let i = 7; i <= 15; i++) { await p.click('#rail button:nth-child(' + (i + 1) + ')'); await p.waitForTimeout(120); const t = await p.$eval('#panel-' + i, e => Array.from(e.querySelectorAll('h3, .label > span:first-child, .hint')).filter(n => !n.closest('[hidden]') && n.offsetParent !== null).map(n => n.textContent.trim().slice(0, 50)).slice(0, 10).join(' | ')); console.log(' step ' + (i + 1) + ': ' + t); }
    console.log(' hidden-but-laid-out in panels:', await p.evaluate(() => Array.from(document.querySelectorAll('#panels [hidden]')).filter(e => e.offsetParent !== null).length));
    console.log(' incomplete before fill:', await p.evaluate(() => B68.validate().filter(c => !c.ok).map(c => c.text)));
    await p.evaluate(fill); await p.waitForTimeout(300);
    await p.click('#rail button:nth-child(15)'); await p.waitForTimeout(300);
    await p.click('#rail button:nth-child(16)'); await p.waitForTimeout(300);
    const v = await p.evaluate(() => B68.validate()); console.log(' checks:', v.map(c => (c.ok ? '✓ ' : '✗ ') + c.text).join('; '));
    console.log(' done rail:', await p.$$eval('#rail button', bs => bs.map((b, i) => (b.classList.contains('done') || b.getAttribute('aria-current')) ? '' : (i + 1)).filter(Boolean).join(',')) || 'all');
    console.log(' summary:', (await p.$eval('.summary', e => e.textContent)).replace(/\s+/g, ' ').slice(0, 600));
    const md = await p.evaluate(() => B68.sheetMarkdown()); console.log(' markdown lines:', md.split('\n').filter(l => /^(#|- )/.test(l) && !/Figure spec/.test(l)).slice(0, 40).join(' / '));
    // share link round-trip
    const rt = await p.evaluate(() => { const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); const h = '#s' + b64(JSON.stringify({ spec: B68.S.spec, sheet: Object.assign({}, B68.S.sheet, { docId: undefined }) })); const un = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }; const back = JSON.parse(un(h.slice(2))); return JSON.stringify(back.sheet) === JSON.stringify(Object.assign({}, B68.S.sheet, { docId: undefined })) ? 'ok (' + h.length + ' chars)' : 'MISMATCH'; });
    console.log(' share link round-trip:', rt);
    await p.click('#fileRoster'); await p.waitForTimeout(1200);
    const st = await p.evaluate(() => { const ids = Object.keys(window.__store); const id = ids[ids.length - 1]; const d = window.__store[id]; return { mode: document.body.dataset.mode, id, playbookName: d.playbookName, playKeys: Object.keys(d.play || {}).length, stress: d.play && d.play.stress, keys: d.play && d.play.keys && d.play.keys.map(k => k.name + ':' + (k.deadlock || '-') + ':' + (k.glitch || '-')).join(','), abilities: d.play && d.play.abilities, sheetKeys: Object.keys(d.sheet).length, dossierText: (document.getElementById('dossier').textContent || '').replace(/\s+/g, ' ').slice(0, 160) }; });
    console.log(' filed:', JSON.stringify(st));
    await p.evaluate(() => B68.setMode('create')); await p.waitForTimeout(500);
    console.log(' roster card:', await p.$$eval('#cards .card', cs => cs.map(c => c.querySelector('.cd').textContent + ' // ' + c.querySelector('.st').textContent + ' // ghostly=' + c.querySelector('.pic').classList.contains('ghostly')).join(' ; ')));
    console.log(' lineup ghostly groups:', await p.$$eval('#lineup .b68-figure.ghostly', g => g.map(x => x.dataset.id).join(',')) || 'none');
  };
  await walk('ghost', () => { const S = B68.S, CT = B68.CT, pb = CT.byId.ghost; S.sheet.name = 'Edda Fane'; S.sheet.alias = 'Specter'; S.sheet.heritage = 'Akoros'; S.sheet.heritageDetail = 'Clergy'; S.sheet.background = 'Performer'; S.sheet.dots = { Hunt: 1, Prowl: 2, Attune: 2, Sway: 1, Study: 1 }; S.sheet.ability = 'Versatile'; S.sheet.customAbility = 'Hound’s Instincts'; S.sheet.keys = CT.GENERIC_KEYS.slice(0, 2); S.sheet.customKey = 'Vengeful (▼ Forgiving ▲ Consumed)'; S.sheet.enemies = 'Marlow, who killed me\nThe Bluecoat who looked away'; S.sheet.ghostItems = 'The dress I died in\nA locket'; B68.syncNameToSpec(); B68.changed(); });
  await p.evaluate(() => B68.showStep(10)); await p.waitForTimeout(200);
  await walk('vampire', () => { const S = B68.S, CT = B68.CT, pb = CT.byId.vampire; S.sheet.name = 'Lorna Vass'; S.sheet.alias = 'Midnight'; S.sheet.heritage = 'Iruvia'; S.sheet.background = 'Aristocrat'; S.sheet.dots = { Hunt: 1, Prowl: 1, Skirmish: 1, Attune: 1, Command: 2, Sway: 2, Consort: 1 }; S.sheet.ability = 'Telepathy'; S.sheet.stricture = 'Slumber'; S.sheet.keys = CT.GENERIC_KEYS.slice(1, 5); S.sheet.keyLocks = {}; S.sheet.keys.forEach((k, i) => S.sheet.keyLocks[k] = i % 2 ? 'up' : 'down'); S.sheet.contacts = {}; S.sheet.contacts[pb.contacts[0][0] + ', ' + pb.contacts[0][1]] = 'friend'; S.sheet.contacts[pb.contacts[1][0] + ', ' + pb.contacts[1][1]] = 'friend'; S.sheet.contacts[pb.contacts[2][0] + ', ' + pb.contacts[2][1]] = 'rival'; S.sheet.feeding = 'A kiss at the end of the evening'; S.sheet.telltale = 'A week of grey in the hair'; S.sheet.echoAbilities = 'Dissipate'; S.sheet.items = [pb.items[0][0], 'Spiritbane charm']; B68.syncNameToSpec(); B68.changed(); });
  // vampire keys step screenshot
  await p.evaluate(() => B68.showStep(10)); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + 'pn-vampire-keys.png', fullPage: true });
  await walk('timetraveler', () => { const S = B68.S, CT = B68.CT, pb = CT.byId.timetraveler; S.sheet.name = 'Kace Zorin'; S.sheet.alias = 'Recursion'; S.sheet.heritage = 'Severos'; S.sheet.background = 'Military'; S.sheet.dots = { Hunt: 3, Tinker: 2, Prowl: 1, Skirmish: 1, Attune: 1, Command: 1 }; S.sheet.ability = 'Psionics'; S.sheet.keys = CT.GENERIC_KEYS.slice(4, 7); S.sheet.mission = pb.missions[0].name; S.sheet.missionAnswers = ['The grey sky', 'Project Daisy', 'They were in the records', 'The night of the broadcast']; S.sheet.items = [pb.items[2][0], 'Documents']; B68.syncNameToSpec(); B68.changed(); });
  await p.evaluate(() => B68.showStep(12)); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + 'pn-tt-mission.png', fullPage: true });
  await walk('timepast', () => { const S = B68.S, CT = B68.CT, pb = CT.byId.timepast; S.sheet.name = 'Grigor Nox'; S.sheet.alias = 'Sage'; S.sheet.heritage = 'Tycheros'; S.sheet.background = 'Learned'; S.sheet.dots = { Attune: 3, Study: 2, Hunt: 1, Finesse: 1, Sway: 1, Consort: 1 }; S.sheet.ability = 'Versatile'; S.sheet.customAbility = 'Echo Fighter'; S.sheet.keys = CT.GENERIC_KEYS.slice(8, 10); S.sheet.mission = pb.missions[1].name; S.sheet.missionAnswers = ['A plague', '', '', '']; S.sheet.items = [pb.items[0][0]]; B68.syncNameToSpec(); B68.changed(); });
  // the share link really loads back: reload with the hash
  const link = await p.evaluate(() => { const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return '#s' + b64(JSON.stringify({ spec: B68.S.spec, sheet: Object.assign({}, B68.S.sheet, { docId: undefined }) })); });
  await p.goto(URL + link); await p.waitForTimeout(1000);
  console.log('\nreloaded from link:', await p.evaluate(() => [B68.S.sheet.playbook, B68.S.sheet.name, B68.S.sheet.mission, JSON.stringify(B68.S.sheet.missionAnswers), B68.S.sheet.customAbility, document.querySelector('#coverMeta').textContent]));
  // the existing core playbooks still validate (regression): hound quick fill
  await p.evaluate(() => B68.newCharacter()); await p.click('.pb[data-id="hound"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const S = B68.S, CT = B68.CT, pb = CT.byId.hound; S.sheet.name = 'Aldo Crane'; S.sheet.heritage = 'Akoros'; S.sheet.background = 'Underworld'; S.sheet.dots = { Survey: 1, Consort: 2, Hunt: 2, Prowl: 1, Skirmish: 1 }; S.sheet.ability = pb.abilities[0][0]; S.sheet.keys = pb.keys.slice(0, 2); S.sheet.contacts = {}; S.sheet.contacts[pb.contacts[0][0] + ', ' + pb.contacts[0][1]] = 'friend'; S.sheet.contacts[pb.contacts[1][0] + ', ' + pb.contacts[1][1]] = 'friend'; S.sheet.contacts[pb.contacts[2][0] + ', ' + pb.contacts[2][1]] = 'rival'; S.sheet.vice = 'Gambling'; S.sheet.purveyor = 'The Silver Stag'; S.sheet.items = [pb.items[0][0]]; S.sheet.cohortType = 'hound dog'; B68.syncNameToSpec(); B68.changed(); });
  console.log('hound regression incomplete:', await p.evaluate(() => B68.validate().filter(c => !c.ok).map(c => c.text)));
  // phone width, dark: no overflow on the playbook, keys (vampire) and vice (TT) steps
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'dark' }); await ctx2.addInitScript(STUB);
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push('phone pageerror: ' + e.message));
  await p2.goto(URL); await p2.waitForTimeout(1000);
  const ov = async (tag) => { const sw = await p2.evaluate(() => document.documentElement.scrollWidth), cw = await p2.evaluate(() => document.documentElement.clientWidth); if (sw > cw) errs.push('phone overflow at ' + tag + ' ' + sw + '>' + cw); };
  await ov('playbook'); await p2.screenshot({ path: SHOTS + 'pn-phone-playbook.png', fullPage: true });
  await p2.click('.pb[data-id="vampire"]'); await p2.waitForTimeout(300); await p2.evaluate(() => { const S = B68.S, CT = B68.CT; S.sheet.keys = CT.GENERIC_KEYS.slice(0, 4); S.sheet.ability = 'Terrible Power'; B68.changed(); B68.showStep(10); }); await p2.waitForTimeout(300); await ov('vampire keys'); await p2.screenshot({ path: SHOTS + 'pn-phone-vampire-keys.png', fullPage: true });
  await p2.evaluate(() => B68.showStep(9)); await p2.waitForTimeout(200); await ov('vampire abilities');
  await p2.evaluate(() => { B68.newCharacter(); }); await p2.click('.pb[data-id="timetraveler"]'); await p2.waitForTimeout(300); await p2.evaluate(() => { B68.S.sheet.mission = B68.CT.byId.timetraveler.missions[0].name; B68.S.sheet.ability = 'Versatile'; B68.changed(); B68.showStep(12); }); await p2.waitForTimeout(300); await ov('tt mission'); await p2.screenshot({ path: SHOTS + 'pn-phone-tt-mission.png', fullPage: true });
  await p2.evaluate(() => B68.showStep(9)); await p2.waitForTimeout(200); await ov('tt abilities versatile');
  await p2.evaluate(() => { B68.newCharacter(); }); await p2.click('.pb[data-id="ghost"]'); await p2.waitForTimeout(300); for (const i of [11, 12, 13, 15]) { await p2.evaluate((i) => B68.showStep(i), i); await p2.waitForTimeout(150); await ov('ghost step ' + (i + 1)); }
  console.log('\nERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
