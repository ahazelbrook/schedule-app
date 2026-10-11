process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the paranormal playbooks on the living sheet + printing. Run from this dir:
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node trackerpn.js */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
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

/* the sheet the creator would write for each playbook */
const SHEET = `(pb) => {
  const CT = B68Content, P = CT.byId[pb], S = B68.S;
  B68.choosePlaybook(pb);
  const sh = S.sheet;
  sh.name = { hound: 'Aldo Crane', ghost: 'Marlow Vance', vampire: 'Celeste Varga', timetraveler: 'Unit Kessel', timepast: 'Ser Odo' }[pb]; sh.alias = 'Smoke'; sh.heritage = 'Akoros'; sh.heritageDetail = 'Coalridge, union family'; sh.background = 'Underworld'; sh.backgroundDetail = 'Ran numbers for the Crows';
  sh.look = 'Lean, weathered, a cigarette always going.'; sh.wearing = ['Trench coat', 'Fedora'];
  const dots = Object.assign({}, P.printed || {});
  if (pb === 'hound') Object.assign(dots, { Hunt: 2, Survey: 1, Prowl: 1, Skirmish: 1, Consort: 2 });
  if (pb === 'ghost') Object.assign(dots, { Hunt: 2, Prowl: 2, Attune: 2, Sway: 1 });
  if (pb === 'vampire') Object.assign(dots, { Hunt: 2, Prowl: 1, Skirmish: 2, Attune: 1, Command: 2, Sway: 1 });
  if (pb === 'timetraveler' || pb === 'timepast') Object.assign(dots, { Hunt: 2, Tinker: 3, Finesse: 1, Skirmish: 2, Attune: 1 });
  sh.dots = dots;
  if (pb === 'hound') { sh.ability = P.abilities[0][0]; sh.keys = P.keys.slice(0, 3); sh.customKey = 'Hopeful (▼ Cynical ▲ Content)'; sh.contacts = {}; sh.contacts[P.contacts[0][0]] = 'friend'; sh.contacts[P.contacts[1][0]] = 'rival'; sh.vice = 'Gambling'; sh.purveyor = 'Bug’s five-card braggart game, the Docks'; sh.items = [P.items[0][0], 'A Blade or Two']; sh.cohortName = 'Biscuit'; sh.cohortType = 'hound dog'; }
  if (pb === 'ghost') { sh.ability = 'Possess'; sh.keys = CT.GENERIC_KEYS.slice(3, 5); sh.customKey = 'Vengeful (▼ Forgiving ▲ Murderous)'; sh.ghostItems = 'A wedding ring; the coat I died in; a half-smoked cigarette.'; sh.enemies = 'Inspector Dahl, who closed my case.\\nThe Lampblacks.'; sh.items = []; }
  if (pb === 'vampire') { sh.ability = 'Terrible Power'; sh.keys = CT.GENERIC_KEYS.slice(0, 3); sh.customKey = 'Regal (▼ Common ▲ Tyrannical)'; sh.keyLocks = {}; sh.keyLocks[sh.keys[0]] = 'up'; sh.keyLocks[sh.keys[1]] = 'down'; sh.keyLocks[sh.keys[2]] = 'up'; sh.keyLocks[sh.customKey] = 'down'; sh.stricture = 'Slumber'; sh.contacts = {}; sh.contacts[P.contacts[0][0]] = 'friend'; sh.contacts[P.contacts[1][0]] = 'friend'; sh.contacts[P.contacts[2][0]] = 'rival'; sh.feeding = 'A kiss at the throat, in a parked autopod'; sh.telltale = 'Two pale marks and a week of vivid dreams'; sh.echoAbilities = 'Manifest (from my years as an echo)'; sh.items = [P.items[0][0], P.items[1][0]]; }
  if (pb === 'timetraveler' || pb === 'timepast') { sh.ability = P.abilities[1][0]; sh.keys = CT.GENERIC_KEYS.slice(8, 11); sh.customKey = ''; sh.mission = P.missions[0].name; sh.missionAnswers = ['A drowned Doskvol', 'The Ministry', 'They were in the records', '']; sh.items = [P.items[0][0], P.items[2][0]]; }
  if (B68.syncNameToSpec) B68.syncNameToSpec(); B68.changed();
  B68.fileCharacter();
}`;

(async () => {
  const b = await chromium.launch();
  const errs = [], fails = [], notes = [];
  function assert(ok, msg) { if (!ok) fails.push(msg); }
  async function open(w, h, name, pb, extra) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(STUB); if (extra) await ctx.addInitScript(extra);
    const p = await ctx.newPage(); p.__answers = []; p.__dialogs = [];
    p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/ERR_FILE_NOT_FOUND/.test(t)) errs.push(name + ' console.error: ' + t); } });
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('dialog', d => { p.__dialogs.push(d.type() + ': ' + d.message().slice(0, 90)); const a = p.__answers.length ? p.__answers.shift() : undefined; if (a === null) d.dismiss(); else d.accept(a == null ? undefined : a); });
    await p.goto(URL); await p.waitForTimeout(1200);
    const r = await p.evaluate(`(${SHEET})(${JSON.stringify(pb)}); true`).catch(e => { errs.push(name + ' sheet setup failed: ' + e.message); return false; });
    await p.waitForTimeout(1200);
    const mode = await p.evaluate(() => document.body.dataset.mode);
    assert(mode === 'sheet', name + ': mode after filing is ' + mode);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth), cw = await p.evaluate(() => document.documentElement.clientWidth);
    if (sw > cw) errs.push(name + ' horizontal overflow ' + sw + '>' + cw);
    const clipped = await p.evaluate(() => { const root = document.getElementById('dossier'); const R = root.getBoundingClientRect(); const out = []; root.querySelectorAll('.ds-box, .ds-head, button, input, select, textarea').forEach(n => { const r = n.getBoundingClientRect(); if (r.width && (r.right > R.right + 1 || r.left < R.left - 1)) out.push(n.className + ' ' + Math.round(r.left) + '-' + Math.round(r.right) + ' vs ' + Math.round(R.right)); }); return out.slice(0, 5); });
    if (clipped.length) errs.push(name + ' elements outside the dossier: ' + clipped.join(' | '));
    return p;
  }
  const play = (p) => p.evaluate(() => B68Tracker.play());
  const stored = (p) => p.evaluate(() => { const id = Object.keys(window.__store)[0]; return window.__store[id].play; });
  const has = (p, sel) => p.$(sel).then(x => !!x);
  const click = async (p, sel) => { const h = await p.$(sel); if (!h) { fails.push('missing ' + sel); return false; } await h.click(); await p.waitForTimeout(150); return true; };

  /* ---------- Hound: nothing new ---------- */
  {
    const p = await open(1360, 900, 'hound', 'hound');
    assert(await has(p, '#dossier [data-act="print"]'), 'hound: print button');
    assert(!(await has(p, '#dossier .ds-alluv')) && !(await has(p, '#dossier .ds-strics')) && !(await has(p, '#dossier .ds-mq')), 'hound: no paranormal boxes');
    assert(await has(p, '#dossier .ds-vice'), 'hound: vice box');
    const bands = await p.$$eval('#dossier .ds-band > h3', ns => ns.map(n => n.textContent));
    notes.push('hound boxes: ' + bands.join(', '));
    await click(p, '#dossier .ds-sbox[data-n="4"]');
    let s = await stored(p); assert(s.stress === 4, 'hound: stress saved ' + s.stress);
    assert(s.alluvium === 0 && Array.isArray(s.strictures) && s.darkMajesty === null && s.mission === null, 'hound: new fields default quietly ' + JSON.stringify({ a: s.alluvium, st: s.strictures, dm: s.darkMajesty, m: s.mission }));
    const pips = await p.$$eval('#dossier .ds-pip[data-a="Hunt"]', ns => ns.length); assert(pips === 4, 'hound: 4 pips per action, got ' + pips);
    await p.screenshot({ path: 'out/tracker-pn-hound-desk.png', fullPage: true });
    /* an old v:2 play without the new fields still opens */
    const old = await p.evaluate(() => { const id = Object.keys(window.__store)[0]; const d = JSON.parse(JSON.stringify(window.__store[id])); ['alluvium', 'strictures', 'darkMajesty', 'mission', 'ghostItems', 'enemies', 'feeding', 'telltale', 'echoAbilities'].forEach(k => delete d.play[k]); d.play.keys.forEach(k => delete k.glitch); try { B68Tracker.open(Object.assign({ id }, d), { save: () => Promise.resolve(), canWrite: true }); return B68Tracker.play(); } catch (e) { return { err: e.message }; } });
    assert(!old.err && old.keys[0].glitch === null && old.alluvium === 0, 'hound: old play opens ' + JSON.stringify(old.err || old.keys[0]));
    /* print */
    await p.pdf({ path: 'out/print-hound.pdf', format: 'A4', printBackground: true });
    await p.pdf({ path: 'out/print-hound-letter.pdf', format: 'Letter', printBackground: true });
    notes.push('hound dialogs: ' + p.__dialogs.join(' / '));
    await p.context().close();
  }

  /* ---------- Ghost ---------- */
  {
    const p = await open(1360, 900, 'ghost', 'ghost');
    let s = await play(p);
    assert(s.stress === 0 && s.abilities.indexOf('Resonance Echo') >= 0 && s.abilities.indexOf('Possess') >= 0, 'ghost: abilities ' + JSON.stringify(s.abilities));
    assert(s.keys.length === 3 && s.keys.every(k => k.glitch === null && k.deadlock === null), 'ghost: keys ' + JSON.stringify(s.keys));
    assert(s.ghostItems.indexOf('wedding ring') >= 0 && s.enemies.indexOf('Dahl') >= 0 && s.items.length === 0 && !s.vice && s.contacts.length === 0, 'ghost: seeded strings ' + JSON.stringify([s.ghostItems, s.enemies, s.items, s.vice, s.contacts]));
    const band = await p.$eval('#dossier .ds-c1 .ds-box:nth-child(2) .ds-band > h3', n => n.textContent); assert(band === 'Drain', 'ghost: stress label ' + band);
    const n = await p.$$eval('#dossier .ds-sbox', ns => ns.length); assert(n === 10, 'ghost: 10 drain boxes, got ' + n);
    assert(await has(p, '#dossier textarea[data-path="ghostItems"]') && await has(p, '#dossier textarea[data-path="enemies"]'), 'ghost: items / enemies textareas');
    assert(!(await has(p, '#dossier .ds-vice')) && !(await has(p, '#dossier .ds-loadhead')) && !(await has(p, '#dossier .ds-contacts')), 'ghost: no vice, load, contacts');
    assert(!(await has(p, '#dossier [data-act="stressd"][data-d="-1"]')), 'ghost: no indulge');
    const trig = await p.$$eval('#dossier .ds-trig li', ns => ns.map(n => n.textContent)); assert(trig.some(t => /vengeance/.test(t)), 'ghost: xp triggers ' + trig.join(' | '));
    await click(p, '#dossier .ds-sbox[data-n="7"]');
    await click(p, '#dossier [data-act="consume"]');
    s = await stored(p); assert(s.stress === 4, 'ghost: consume cleared half, stress ' + s.stress);
    /* strike a key with an irregularity */
    assert(await has(p, '#dossier .ds-burst[data-act="glitchpick"]') && !(await has(p, '#dossier [data-act="deadlock"]')), 'ghost: irregularity burst, no deadlock burst');
    await click(p, '#dossier .ds-burst[data-act="glitchpick"][data-i="0"]');
    const chips = await p.$$eval('#dossier .ds-glpick [data-act="glitch"]', ns => ns.map(n => n.textContent)); assert(chips.length === 6 && chips[0] === 'Chaotic', 'ghost: picker chips ' + chips.join(','));
    await click(p, '#dossier .ds-glpick [data-act="glitch"][data-v="Furious"]');
    s = await stored(p); assert(s.keys[0].glitch === 'Furious' && s.keys[0].deadlock === null, 'ghost: key struck ' + JSON.stringify(s.keys[0]));
    assert(await has(p, '#dossier .ds-key.glitched .ds-burst.on') && await has(p, '#dossier [data-act="unglitch"]'), 'ghost: struck key rendered permanent with GM undo');
    const dl = await p.$eval('#dossier .ds-dlhead', n => n.textContent); assert(dl === 'Echo irregularities', 'ghost: band ' + dl);
    /* typing into the enemies textarea is debounced */
    await p.fill('#dossier textarea[data-path="enemies"]', 'Nobody now.'); await p.waitForTimeout(700);
    s = await stored(p); assert(s.enemies === 'Nobody now.', 'ghost: enemies typed and saved: ' + s.enemies);
    await p.screenshot({ path: 'out/tracker-pn-ghost-desk.png', fullPage: true });
    notes.push('ghost dialogs: ' + p.__dialogs.join(' / '));
    await p.context().close();
    const q = await open(390, 800, 'ghost-phone', 'ghost'); await q.screenshot({ path: 'out/tracker-pn-ghost-phone.png', fullPage: true }); await q.context().close();
  }

  /* ---------- Vampire ---------- */
  {
    const p = await open(1360, 900, 'vampire', 'vampire');
    let s = await play(p);
    assert(s.keys.length === 4 && s.keys.map(k => k.deadlock).join() === 'up,down,up,down', 'vampire: keys locked ' + JSON.stringify(s.keys.map(k => k.deadlock)));
    assert(s.strictures.join() === 'Dayfire,Slumber' && s.darkMajesty === null, 'vampire: strictures ' + JSON.stringify(s.strictures));
    assert(s.feeding.indexOf('kiss') >= 0 && s.telltale && s.echoAbilities && !s.vice, 'vampire: strings seeded');
    assert(s.contacts.length === 5 && s.contacts.filter(c => c.kind === 'friend').length === 2, 'vampire: dark servants ' + JSON.stringify(s.contacts.map(c => c.kind)));
    const n = await p.$$eval('#dossier .ds-sbox', ns => ns.length); assert(n === 12, 'vampire: 12 stress boxes, got ' + n);
    const locked = await p.$$eval('#dossier .ds-key.locked', ns => ns.length); assert(locked === 4, 'vampire: 4 keys render locked, got ' + locked);
    assert(await has(p, '#dossier [data-act="feed"]') && await has(p, '#dossier [data-act="stressd"][data-d="1"]') && !(await has(p, '#dossier [data-act="stressd"][data-d="-1"]')), 'vampire: feed + mark, no indulge');
    assert(await has(p, '#dossier .ds-strics') && await has(p, '#dossier input[data-change="stricture"][data-n="Dayfire"]:disabled:checked'), 'vampire: strictures box with Dayfire fixed');
    assert(await has(p, '#dossier textarea[data-path="echoAbilities"]') && await has(p, '#dossier input[data-path="feeding"]') && await has(p, '#dossier input[data-path="telltale"]'), 'vampire: echo / feeding / telltale');
    const title = await p.$$eval('#dossier .ds-band > h3', ns => ns.map(n => n.textContent)); assert(title.indexOf('Dark servants') >= 0, 'vampire: contacts titled Dark servants: ' + title.join(','));
    /* feed: stress 6 → highest die 5 → 1; healing 4 */
    await click(p, '#dossier .ds-sbox[data-n="6"]');
    p.__answers.push('5'); await click(p, '#dossier [data-act="feed"]');
    s = await stored(p); assert(s.stress === 1 && s.healing === 4, 'vampire: fed ' + s.stress + ' heal ' + s.healing);
    /* stricture toggle */
    await click(p, '#dossier input[data-change="stricture"][data-n="Forbidden"]');
    s = await stored(p); assert(s.strictures.join() === 'Dayfire,Slumber,Forbidden', 'vampire: stricture toggled ' + s.strictures.join());
    /* Dark Majesty with 8 xp: attribute prompt, spend confirm, stricture prompt */
    await click(p, '#dossier .ds-tools .ds-xbox[data-k="playbook"][data-n="8"]');
    p.__answers.push('Prowess', undefined, 'Repelled');
    await click(p, '#dossier .ds-circ[data-n="Dark Majesty"][data-i="1"]');
    s = await stored(p);
    assert(s.darkMajesty === 'Prowess' && s.abilities.indexOf('Dark Majesty') >= 0 && s.xp.playbook === 0, 'vampire: dark majesty ' + JSON.stringify([s.darkMajesty, s.abilities, s.xp.playbook]));
    assert(s.strictures.indexOf('Repelled') >= 0, 'vampire: stricture after new trait ' + s.strictures.join());
    const fifth = await p.$eval('#dossier .ds-pip[data-a="Skirmish"][data-n="5"]', n => n.disabled), fifthI = await p.$eval('#dossier .ds-pip[data-a="Hunt"][data-n="5"]', n => n.disabled);
    assert(fifth === false && fifthI === true, 'vampire: 5th pip enabled only under Prowess (' + fifth + ',' + fifthI + ')');
    await click(p, '#dossier .ds-pip[data-a="Skirmish"][data-n="5"]'); s = await stored(p); assert(s.dots.Skirmish === 5, 'vampire: Skirmish to 5: ' + s.dots.Skirmish);
    /* a non-majesty purchase with low xp (GM confirm) that is Versatile asks no stricture */
    await p.screenshot({ path: 'out/tracker-pn-vampire-desk.png', fullPage: true });
    await p.pdf({ path: 'out/print-vampire.pdf', format: 'A4', printBackground: true });
    notes.push('vampire dialogs: ' + p.__dialogs.join(' / '));
    await p.context().close();
    const q = await open(390, 800, 'vampire-phone', 'vampire'); await q.screenshot({ path: 'out/tracker-pn-vampire-phone.png', fullPage: true }); await q.context().close();
  }

  /* ---------- Time traveler (future) ---------- */
  {
    const p = await open(1360, 900, 'timetraveler', 'timetraveler');
    let s = await play(p);
    assert(s.alluvium === 4 && s.bank === 0 && s.mission && s.mission.name === 'Prevent a terrible future' && s.mission.answers.length === 4 && s.mission.answers[0] === 'A drowned Doskvol' && s.mission.details.length === 0, 'tt: seeded ' + JSON.stringify([s.alluvium, s.mission]));
    assert(s.abilities.indexOf('Future Shock') >= 0 && s.abilities.indexOf('Psionics') >= 0 && !s.vice && s.contacts.length === 0, 'tt: abilities ' + JSON.stringify(s.abilities));
    const n = await p.$$eval('#dossier .ds-sbox', ns => ns.length); assert(n === 9, 'tt: 9 instability boxes, got ' + n);
    const vials = await p.$$eval('#dossier .ds-vial', ns => ns.map(x => x.classList.contains('on'))); assert(vials.length === 9 && vials.filter(Boolean).length === 4, 'tt: alluvium row ' + vials.join(','));
    const band = await p.$eval('#dossier .ds-c1 .ds-box:nth-child(2) .ds-band > h3', x => x.textContent); assert(band === 'Instability', 'tt: label ' + band);
    assert(!(await has(p, '#dossier .ds-bank')) && !(await has(p, '#dossier [data-act="tobank"]')), 'tt: bank hidden');
    assert(await has(p, '#dossier .ds-mq') && (await p.$$eval('#dossier .ds-mq input', ns => ns.length)) === 4, 'tt: mission questions');
    const pips = await p.$$eval('#dossier .ds-pip[data-a="Tinker"]', ns => ns.map(x => x.disabled)); assert(pips.join() === 'false,false,false,false', 'tt: dots max 4 in play ' + pips.join());
    const rb = await p.$eval('#dossier [data-act="restabilize"]', x => x.textContent); assert(/uses one canister/.test(rb), 'tt: restabilize label ' + rb);
    await click(p, '#dossier .ds-sbox[data-n="7"]'); await click(p, '#dossier [data-act="restabilize"]');
    s = await stored(p); assert(s.stress === 2 && s.alluvium === 3, 'tt: restabilized ' + s.stress + ' / ' + s.alluvium);
    await click(p, '#dossier .ds-vial[data-n="6"]'); s = await stored(p); assert(s.alluvium === 6, 'tt: alluvium set by click ' + s.alluvium);
    /* a glitch adds a detail and counts */
    await click(p, '#dossier .ds-burst[data-act="glitchpick"][data-i="1"]');
    await click(p, '#dossier .ds-glpick [data-act="glitch"][data-v="Lagging"]');
    s = await stored(p); assert(s.keys[1].glitch === 'Lagging' && s.mission.details.length === 1, 'tt: glitch + detail ' + JSON.stringify([s.keys[1], s.mission.details]));
    let cnt = await p.$eval('#dossier .ds-glcount b', x => x.textContent); assert(cnt === 'Temporal glitches: 1 / 4', 'tt: count ' + cnt);
    await p.fill('#dossier input[data-path="mission.details.0"]', 'The flood starts at the Gaddoc sluice.'); await p.waitForTimeout(700);
    s = await stored(p); assert(s.mission.details[0] === 'The flood starts at the Gaddoc sluice.', 'tt: detail typed ' + s.mission.details[0]);
    await click(p, '#dossier [data-act="adddetail"]'); s = await stored(p); assert(s.mission.details.length === 2, 'tt: add detail ' + s.mission.details.length);
    /* gain clarity: cancel at step 2 changes nothing */
    await click(p, '#dossier .ds-tools .ds-xbox[data-k="playbook"][data-n="8"]');
    const before = JSON.stringify(await stored(p));
    p.__answers.push(undefined, '1', null); await click(p, '#dossier [data-act="clarity"]');
    s = await stored(p); assert(JSON.stringify(s) === before, 'tt: cancelled clarity changed nothing');
    /* gain clarity for real */
    p.__answers.push(undefined, '1', 'Ghost Mind: you are always aware of supernatural entities', '1', 'Headaches', 'The Ministry built the sluice on purpose.');
    await click(p, '#dossier [data-act="clarity"]');
    s = await stored(p);
    assert(s.xp.playbook === 0 && s.abilities.indexOf('Advanced Combat Reflexes') >= 0 && s.abilities.some(a => /Ghost Mind/.test(a)), 'tt: clarity abilities ' + JSON.stringify(s.abilities) + ' xp ' + s.xp.playbook);
    assert(s.keys[0].glitch === 'Headaches' && s.mission.details.length === 3 && /sluice on purpose/.test(s.mission.details[2]), 'tt: clarity glitch + detail ' + JSON.stringify([s.keys.map(k => k.glitch), s.mission.details]));
    cnt = await p.$eval('#dossier .ds-glcount b', x => x.textContent); assert(cnt === 'Temporal glitches: 2 / 4', 'tt: count ' + cnt);
    /* two more glitches: the warning */
    await click(p, '#dossier .ds-burst[data-act="glitchpick"][data-i="2"]'); await click(p, '#dossier .ds-glpick [data-act="glitch"][data-v="Flashbacks"]');
    await p.selectOption('#dossier select[data-change="addkey"]', { index: 1 }); await p.waitForTimeout(200);
    await click(p, '#dossier .ds-burst[data-act="glitchpick"][data-i="3"]'); await click(p, '#dossier .ds-glpick [data-act="glitch"][data-v="Time skips"]');
    s = await stored(p); assert(s.keys.filter(k => k.glitch).length === 4, 'tt: four glitches');
    assert(await has(p, '#dossier .ds-gone'), 'tt: disappearance warning shown');
    const gone = await p.$eval('#dossier .ds-gone', x => x.textContent); assert(/disappear from this time period after the next score/.test(gone), 'tt: warning text ' + gone);
    await p.screenshot({ path: 'out/tracker-pn-timetraveler-desk.png', fullPage: true });
    notes.push('tt dialogs: ' + p.__dialogs.join(' / '));
    await p.context().close();
    const q = await open(390, 800, 'timetraveler-phone', 'timetraveler'); await q.screenshot({ path: 'out/tracker-pn-timetraveler-phone.png', fullPage: true }); await q.context().close();
  }

  /* ---------- Time traveler (past) ---------- */
  {
    const p = await open(1360, 900, 'timepast', 'timepast');
    const s = await play(p);
    assert(s.alluvium === 4 && s.abilities.indexOf('Haunted by the Past') >= 0 && s.mission.name === 'Find a solution and take it back', 'timepast: seeded ' + JSON.stringify([s.alluvium, s.abilities, s.mission.name]));
    const rb = await p.$eval('#dossier [data-act="restabilize"]', x => x.textContent); assert(/uses one vial/.test(rb), 'timepast: restabilize label ' + rb);
    const desc = await p.$eval('#dossier .ds-desc', x => x.textContent); assert(/From the past/.test(desc), 'timepast: subtitle ' + desc);
    await p.screenshot({ path: 'out/tracker-pn-timepast-desk.png', fullPage: true });
    await p.context().close();
    const q = await open(390, 800, 'timepast-phone', 'timepast'); await q.screenshot({ path: 'out/tracker-pn-timepast-phone.png', fullPage: true }); await q.context().close();
  }

  /* ---------- whose sheet: boot passes a per-document canWrite (a player writes only their own; the GM any) ---------- */
  {
    const PLAYER = `(() => { const use = window.claude.use; window.claude.use = async (n) => { const r = await use(n); return n === 'user' ? Object.assign({}, r, { canEdit: async () => false, isOwner: async () => false, profiles: async () => ({ u_sam: 'Sam' }) }) : r; }; })()`;
    const SAMS = `(id) => { const own = window.__store[Object.keys(window.__store)[0]]; window.__store[id] = Object.assign(JSON.parse(JSON.stringify(own)), { name: 'Vera Lux', owner: 'u_sam' }); B68.openCharacter(id); }`;
    const look = (p) => p.evaluate(() => ({ status: document.getElementById('ds-status').textContent, ro: document.getElementById('dossier').classList.contains('ds-ro'), sbox: document.querySelector('#dossier .ds-sbox').disabled, edit: document.querySelector('#dossier [data-act="edit"]').disabled, name: document.querySelector('#dossier .ds-name').textContent }));
    for (const who of ['player', 'gm']) {
      const p = await open(1360, 900, 'owner-' + who, 'hound', who === 'player' ? PLAYER : null);
      const mine = await look(p);
      assert(!mine.ro && !mine.sbox && mine.status === 'Saved' && mine.name === 'Aldo Crane', who + ': own sheet writable: ' + JSON.stringify(mine));
      await p.evaluate(`(${SAMS})('vera-lux-x'); true`); await p.waitForTimeout(400);
      const sams = await look(p), w0 = await p.evaluate(() => window.__writes.length);
      if (who === 'player') assert(sams.ro && sams.sbox && sams.edit && sams.status === 'Read only · Sam’s character' && sams.name === 'Vera Lux', 'player: Sam’s sheet read only: ' + JSON.stringify(sams));
      else assert(!sams.ro && !sams.sbox && sams.status === 'Saved', 'gm: Sam’s sheet writable: ' + JSON.stringify(sams));
      await p.click('#dossier .ds-sbox[data-n="3"]', { force: true }).catch(() => {}); await p.waitForTimeout(200);
      const w1 = await p.evaluate(() => window.__writes.length);
      assert(who === 'player' ? w1 === w0 : w1 === w0 + 1, who + ': a click on Sam’s stress writes ' + (w1 - w0));
      await p.context().close();
    }
  }

  /* ---------- Hound phone ---------- */
  { const q = await open(390, 800, 'hound-phone', 'hound'); await q.screenshot({ path: 'out/tracker-pn-hound-phone.png', fullPage: true }); await q.context().close(); }

  console.log('NOTES:\n' + notes.join('\n'));
  console.log('FAILS:', fails.length ? '\n' + fails.join('\n') : 'none');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await b.close();
  process.exit(fails.length || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
