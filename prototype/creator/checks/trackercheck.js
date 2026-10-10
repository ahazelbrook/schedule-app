process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the living character sheet (tracker.js). Run from the scratchpad dir:
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node shots/trackercheck.js */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch();
  const errs = [], fails = [];
  function assert(ok, msg) { if (!ok) fails.push(msg); }
  async function open(w, h, name, pb, dark) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' });
    p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/ERR_FILE_NOT_FOUND/.test(t)) errs.push(name + ' console.error: ' + t); } });
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('dialog', d => d.accept());
    await p.goto(URL); await p.waitForTimeout(900);
    const r = await p.evaluate((pb) => {
      try {
        B68.choosePlaybook(pb);
        const sh = B68.S.sheet; sh.name = 'Test ' + pb; sh.alias = 'Smoke'; sh.heritage = 'Akoros'; sh.background = 'Underworld'; sh.look = 'Lean, weathered, a cigarette always going.'; sh.wearing = ['Trench coat', 'Fedora'];
        const P = B68Content.byId[pb];
        sh.ability = P.abilities[pb === 'hull' ? 1 : 0][0]; sh.keys = P.keys.slice(0, 3); sh.customKey = pb === 'hull' ? '' : 'Hopeful (▼ Cynical ▲ Content)';
        if (pb === 'veteran') { sh.deadlockKey = sh.keys[0]; sh.deadlockMode = '▲'; sh.alt = ['Unity War III (twenty years ago)']; sh.damage = 'Shrapnel in the left knee'; }
        if (pb === 'hull') { sh.frame = ['Jet Propulsion', 'Hidden Compartment']; sh.owning = P.owning[0]; }
        if (P.contacts[0]) sh.contacts[P.contacts[0][0]] = 'friend'; if (P.contacts[1]) sh.contacts[P.contacts[1][0]] = 'rival';
        sh.vice = 'Gambling'; sh.purveyor = 'Bug’s five-card braggart game, the Docks'; sh.items = [P.items[0][0], 'A Blade or Two'];
        sh.cohortName = 'Biscuit'; sh.cohortType = 'hound dog'; sh.cohortEdges = 'Loyal'; sh.cohortFlaws = 'Greedy';
        const play = B68Tracker.initialPlay(sh, pb);
        window.saved = null;
        B68Tracker.open({ id: 't1', name: sh.name, alias: sh.alias, playbook: pb, playbookName: P.name, code: P.prefix + '-968-1234', spec: B68.S.spec, sheet: sh, play },
          { save: p => (window.saved = p, Promise.resolve()), edit() {}, back() {}, remove() { return Promise.resolve(); }, me: null, canWrite: true });
        document.body.dataset.mode = 'sheet'; document.getElementById('dossier').hidden = false;
        const st = document.querySelector('.studio'); if (st) st.hidden = true; const cr = document.querySelector('.crew'); if (cr) cr.hidden = true;
        return { ok: true, play, open: B68Tracker.isOpen(), html: document.getElementById('dossier').innerHTML.length };
      } catch (e) { return { ok: false, err: e.message + '\n' + e.stack }; }
    }, pb);
    if (!r.ok) errs.push(name + ' open failed: ' + r.err);
    await p.waitForTimeout(300);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth), cw = await p.evaluate(() => document.documentElement.clientWidth);
    if (sw > cw) errs.push(name + ' horizontal overflow ' + sw + '>' + cw);
    return { p, r };
  }

  /* desktop light, Hound: interactions */
  const { p: d, r } = await open(1360, 900, 'hound-desk', 'hound', false);
  assert(r.ok && r.open, 'tracker opened');
  if (r.ok) {
    const pl = r.play;
    assert(pl.dots.Survey === 1 && pl.dots.Consort === 2, 'dots seeded from printed');
    assert(pl.abilities.indexOf('Hound’s Instincts') >= 0, 'ability seeded');
    assert(pl.keys.length === 4 && pl.keys[0].name === 'Sardonic' && pl.keys[0].down === 'Grim' && pl.keys[0].up === 'Witty', 'keys parsed: ' + JSON.stringify(pl.keys[0]));
    assert(pl.contacts.filter(c => c.kind === 'friend').length === 1 && pl.contacts.filter(c => c.kind === 'rival').length === 1, 'contacts seeded');
    assert(pl.cohort.name === 'Biscuit' && pl.cohort.abilities === 'Expert: Hunter', 'cohort seeded: ' + JSON.stringify(pl.cohort));
    assert(pl.vice === 'Gambling', 'vice seeded');
    assert(pl.items.length === 2, 'items seeded');
    assert(pl.stacks === 0 && pl.stress === 0 && pl.healing === 0, 'zeros');
  }
  await d.screenshot({ path: 'out/tracker-desk.png', fullPage: true });
  // stress box 4
  await d.click('#dossier .ds-sbox[data-n="4"]'); await d.waitForTimeout(100);
  let s = await d.evaluate(() => window.saved && window.saved.play);
  assert(s && s.stress === 4, 'stress click saved: ' + (s && s.stress));
  await d.click('#dossier .ds-sbox[data-n="4"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.stress === 3, 'clicking the last box clears it: ' + s.stress);
  // xp box: playbook 3 (the one in the XP box body)
  await d.click('#dossier .ds-c2 .ds-tools .ds-xbox[data-k="playbook"][data-n="3"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.xp.playbook === 3, 'xp click saved: ' + s.xp.playbook);
  // attribute xp to 6 then advance
  await d.click('#dossier .ds-xbox[data-k="insight"][data-n="6"]'); await d.waitForTimeout(100);
  await d.click('#dossier [data-act="advance"][data-k="insight"]'); await d.waitForTimeout(100);
  await d.click('#dossier [data-act="advdot"][data-a="Hunt"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.dots.Hunt === 1 && s.xp.insight === 0, 'advance gave a Hunt dot and reset: ' + JSON.stringify([s.dots.Hunt, s.xp.insight]));
  // add a clock and tick it
  await d.fill('#dossier .ds-newclock', 'Find the courier'); await d.click('#dossier [data-act="addclock"][data-n="6"]'); await d.waitForTimeout(100);
  await d.click('#dossier .ds-seg[data-act="clock"][data-i="0"][data-n="2"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.clocks.length === 1 && s.clocks[0].size === 6 && s.clocks[0].filled === 2 && s.clocks[0].name === 'Find the courier', 'clock ticked: ' + JSON.stringify(s.clocks));
  // healing clock
  await d.click('#dossier .ds-seg[data-act="heal"][data-n="3"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.healing === 3, 'healing: ' + s.healing);
  // key hit marks xp; deadlock
  await d.click('#dossier .ds-pip[data-act="keyhit"][data-i="0"][data-n="1"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.keys[0].hits === 1 && s.xp.playbook === 4, 'key hit +1 xp: ' + JSON.stringify([s.keys[0].hits, s.xp.playbook]));
  await d.click('#dossier [data-act="deadlock"][data-i="1"][data-dir="up"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.keys[1].deadlock === 'up', 'deadlock set');
  assert(await d.evaluate(() => /Permanent/.test(document.querySelector('#dossier .ds-key.locked').textContent)), 'permanent shown');
  // ability purchase with 8 xp
  await d.click('#dossier .ds-c2 .ds-tools .ds-xbox[data-k="playbook"][data-n="8"]'); await d.waitForTimeout(100);
  await d.click('#dossier .ds-circ[data-n="Fixer"][data-i="1"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.abilities.indexOf('Fixer') >= 0 && s.xp.playbook === 0, 'ability bought for 8 xp: ' + JSON.stringify([s.abilities, s.xp.playbook]));
  // echo pet two circles
  await d.click('#dossier .ds-circ[data-n="Echo Pet"][data-i="1"]'); await d.waitForTimeout(80); await d.click('#dossier .ds-circ[data-n="Echo Pet"][data-i="2"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.abilityTicks['Echo Pet'] === 2, 'echo pet ticks: ' + JSON.stringify(s.abilityTicks));
  // bank + stacks + items + load
  await d.click('#dossier .ds-dia[data-act="stacks"][data-n="2"]'); await d.click('#dossier .ds-dia[data-act="bank"][data-n="13"]'); await d.waitForTimeout(100);
  await d.click('#dossier [data-act="tobank"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.stacks === 1 && s.bank === 14, 'stacks/bank: ' + s.stacks + '/' + s.bank);
  await d.click('#dossier .ds-item[data-n="Armor"]'); await d.waitForTimeout(100);
  const budget = await d.evaluate(() => document.querySelector('#dossier .budget').textContent + '|' + document.querySelector('#dossier .budget').className);
  assert(/6 \/ 3 load\|budget bad/.test(budget), 'load total over with stacks: ' + budget);
  await d.click('#dossier [data-act="limit"][data-v="loud"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.loadLimit === 'loud', 'loud');
  // contacts cycle + add
  await d.click('#dossier [data-act="contact"][data-i="2"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.contacts[2].kind === 'friend', 'contact cycled');
  await d.fill('#dossier .ds-newcname', 'Ferret'); await d.fill('#dossier .ds-newcrole', 'a fence'); await d.click('#dossier [data-act="addcontact"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.contacts.length === 6 && s.contacts[5].name === 'Ferret', 'contact added');
  // text debounce: harm + crew, update must not clobber a focused field
  await d.fill('#dossier input[data-path="harm.l2.0"]', 'Broken rib'); await d.waitForTimeout(600);
  s = await d.evaluate(() => window.saved.play); assert(s.harm.l2[0] === 'Broken rib', 'harm text debounced save: ' + JSON.stringify(s.harm));
  await d.focus('#dossier input[data-path="crew"]'); await d.type('#dossier input[data-path="crew"]', 'The Crows'); await d.waitForTimeout(50);
  const kept = await d.evaluate(() => { const doc = { id: 't1', playbook: 'hound', sheet: B68.S.sheet, play: Object.assign({}, window.saved.play, { crew: 'STALE', stress: 7 }) }; B68Tracker.update(doc); const a = document.activeElement; return { active: a && a.dataset.path, value: a && a.value, stress: document.querySelectorAll('#dossier .ds-sbox.on').length }; });
  assert(kept.active === 'crew' && kept.value === 'The Crows', 'focused field kept through update: ' + JSON.stringify(kept));
  await d.waitForTimeout(600);
  const after = await d.evaluate(() => { B68Tracker.update({ id: 't1', playbook: 'hound', sheet: B68.S.sheet, play: Object.assign({}, window.saved.play, { stress: 7 }) }); return document.querySelectorAll('#dossier .ds-sbox.on').length; });
  assert(after === 7, 'update re-rendered stress when idle: ' + after);
  // log
  await d.fill('#dossier .ds-newlog', 'Session 1: we robbed the Autodrome.'); await d.click('#dossier [data-act="log"]'); await d.waitForTimeout(100);
  s = await d.evaluate(() => window.saved.play); assert(s.log.length === 1 && /Autodrome/.test(s.log[0].text) && s.log[0].at, 'log entry');
  // remove: two clicks
  await d.click('#dossier [data-act="remove"]'); await d.waitForTimeout(50);
  assert(await d.evaluate(() => /again/.test(document.querySelector('#dossier [data-act="remove"]').textContent)), 'remove asks for a second click');
  // read-only re-open
  const ro = await d.evaluate(() => { B68Tracker.close(); const c = B68Tracker.isOpen(); B68Tracker.open({ id: 't2', name: 'RO', playbook: 'hound', playbookName: 'Hound', code: 'HND-968-0001', spec: B68.S.spec, sheet: B68.S.sheet, play: window.saved.play }, { save: () => Promise.resolve(), edit() {}, back() {}, remove() {}, me: null, canWrite: false }); return { closed: !c, status: document.getElementById('ds-status').textContent, disabled: document.querySelector('#dossier .ds-sbox').disabled, backOk: !document.querySelector('#dossier [data-act="back"]').disabled }; });
  assert(ro.closed && ro.status === 'Read only' && ro.disabled && ro.backOk, 'read only: ' + JSON.stringify(ro));
  await d.screenshot({ path: 'out/tracker-desk-after.png', fullPage: true });

  /* phone light */
  const { p: ph } = await open(400, 800, 'hound-phone', 'hound', false);
  await ph.screenshot({ path: 'out/tracker-phone.png', fullPage: true });
  /* dark desktop, Hull */
  const { p: hu, r: rh } = await open(1360, 900, 'hull-dark', 'hull', true);
  if (rh.ok) { assert(rh.play.abilities[0] === 'Automaton' && rh.play.memories.length === 4 && rh.play.keys.length === 0 && rh.play.vice === '', 'hull seeding: ' + JSON.stringify([rh.play.abilities, rh.play.memories.length, rh.play.keys.length])); }
  assert(await hu.evaluate(() => document.querySelectorAll('#dossier .ds-sbox').length === 10 && document.querySelector('#dossier .ds-dia[data-act="bank"]').disabled), 'hull drain 10 and bank disabled');
  await hu.click('#dossier .ds-seg[data-act="memory"][data-i="0"][data-n="3"]'); await hu.waitForTimeout(100);
  assert(await hu.evaluate(() => window.saved.play.memories[0].filled === 3), 'memory clock ticked');
  await hu.screenshot({ path: 'out/tracker-hull-dark.png', fullPage: true });
  /* dark phone, Veteran */
  const { p: ve, r: rv } = await open(400, 800, 'veteran-phone-dark', 'veteran', true);
  if (rv.ok) { assert(rv.play.abilities[0] === 'Military Discipline' && rv.play.keys[0].deadlock === 'up', 'veteran seeding: ' + JSON.stringify([rv.play.abilities, rv.play.keys[0]])); }
  await ve.screenshot({ path: 'out/tracker-vet-phone-dark.png', fullPage: true });
  /* every other playbook opens */
  for (const id of ['intellectual', 'operative', 'paranormalist', 'radical', 'swinger']) { const { p: x } = await open(1100, 800, id, id, false); await x.close(); }

  console.log('ASSERTIONS:', fails.length ? 'FAILED\n - ' + fails.join('\n - ') : 'all passed');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
