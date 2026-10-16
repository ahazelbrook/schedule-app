process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the living character sheet (tracker.js). Run from this dir:
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node trackercheck.js */
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
  /* someone else's sheet: read only, says whose, the editing controls are off, and a re-render keeps the status */
  const fo = await d.evaluate(async () => {
    B68Tracker.open({ id: 't3', name: 'Vera Lux', owner: 'u_sam', playbook: 'hound', playbookName: 'Hound', code: 'HND-968-0002', spec: B68.S.spec, sheet: B68.S.sheet, play: window.saved.play },
      { save: () => Promise.resolve(), edit() {}, back() {}, remove() {}, me: 'u_pat', canWrite: false, profiles: async (ids) => ({ u_sam: 'Sam' }) });
    const first = document.getElementById('ds-status').textContent;
    await new Promise(r => setTimeout(r, 50));
    const named = document.getElementById('ds-status').textContent;
    document.querySelector('#dossier [data-act="view"][data-v="mug"]').click();
    const q = s => document.querySelector('#dossier ' + s);
    return { first, named, after: document.getElementById('ds-status').textContent, edit: q('[data-act="edit"]').disabled, remove: q('[data-act="remove"]').disabled, pip: q('.ds-pip[data-act="dot"]').disabled, input: q('input[data-path="crew"]').disabled, roll: !q('[data-act="rollopen"]').disabled, ro: document.getElementById('dossier').classList.contains('ds-ro') };
  });
  assert(fo.first === 'Read only · another player’s character' && fo.named === 'Read only · Sam’s character' && fo.after === fo.named, 'others’ sheet status: ' + JSON.stringify(fo));
  assert(fo.edit && fo.remove && fo.pip && fo.input && fo.roll && fo.ro, 'others’ sheet controls: ' + JSON.stringify(fo));
  /* a re-render shows the last real status, never a made-up "Saved" */
  const st = await d.evaluate(async () => {
    B68Tracker.open({ id: 't4', name: 'Errol', playbook: 'hound', playbookName: 'Hound', code: 'HND-968-0003', spec: B68.S.spec, sheet: B68.S.sheet, play: window.saved.play },
      { save: () => Promise.reject(new Error('offline')), edit() {}, back() {}, remove() {}, me: 'u_pat', canWrite: true });
    const fresh = document.getElementById('ds-status').textContent;
    document.querySelector('#dossier .ds-sbox[data-n="2"]').click(); await new Promise(r => setTimeout(r, 30));
    const failed = document.getElementById('ds-status').textContent;
    document.querySelector('#dossier [data-act="view"][data-v="mug"]').click();
    return { fresh, failed, after: document.getElementById('ds-status').textContent, bad: document.getElementById('ds-status').classList.contains('bad') };
  });
  assert(st.fresh === 'Saved' && st.failed === 'Could not save: offline' && st.after === st.failed && st.bad, 'status survives a re-render: ' + JSON.stringify(st));
  /* the title is the character, the playbook small; box titles are headings; one Back */
  const hd = await d.evaluate(() => ({ name: document.querySelector('#dossier h2.ds-name').textContent, pb: document.querySelector('#dossier .ds-pb').textContent, nameSize: parseFloat(getComputedStyle(document.querySelector('#dossier .ds-name')).fontSize), pbSize: parseFloat(getComputedStyle(document.querySelector('#dossier .ds-pb')).fontSize), boxes: document.querySelectorAll('#dossier .ds-box').length, h3: document.querySelectorAll('#dossier .ds-box > .ds-band > h3').length, back: document.querySelector('#dossier [data-act="back"]').textContent, h3Margin: getComputedStyle(document.querySelector('#dossier .ds-band h3')).marginTop, h3Font: getComputedStyle(document.querySelector('#dossier .ds-band h3')).fontSize, hitDesk: getComputedStyle(document.querySelector('#dossier .ds-pip'), '::before').content }));
  assert(hd.name === 'Errol' && hd.pb === 'Hound' && hd.nameSize > 40 && hd.pbSize < 16, 'title: ' + JSON.stringify(hd));
  assert(hd.boxes > 10 && hd.h3 === hd.boxes && hd.h3Margin === '0px' && hd.h3Font === '11px', 'box headings: ' + JSON.stringify(hd));
  assert(hd.back === '← Back', 'back label: ' + hd.back);
  assert(hd.hitDesk === 'none', 'desktop pips carry no hit area: ' + hd.hitDesk);
  await d.screenshot({ path: 'out/tracker-desk-after.png', fullPage: true });

  /* phone light: the play order, the mugshot thumbnail, 44px targets that never take a neighbour's tap */
  const { p: ph } = await open(400, 800, 'hound-phone', 'hound', false);
  await ph.screenshot({ path: 'out/tracker-phone.png', fullPage: true });
  for (const dark of [false, true]) {
    const tag = 'phone390' + (dark ? '-dark' : '');
    const { p: q } = await open(390, 844, tag, 'hound', dark);
    const lay = await q.evaluate(() => {
      const top = s => { const n = document.querySelector('#dossier ' + s); return n && n.offsetParent ? Math.round(n.getBoundingClientRect().top + scrollY) : null; };
      const th = document.querySelector('#dossier .ds-thumb');
      return { stress: top('.ds-stressbox'), harm: top('.ds-harmbox'), actions: top('.ds-actbox'), items: top('.ds-itembox'), keys: top('.ds-keybox'), abilities: top('.ds-abbox'), fig: top('.ds-figbox'), thumb: th && th.offsetParent ? [th.naturalWidth, Math.round(th.getBoundingClientRect().width)] : null,
        rollMin: Math.min.apply(null, [...document.querySelectorAll('#dossier .ds-actbtn')].map(n => n.getBoundingClientRect().height)) };
    });
    assert(lay.stress < lay.harm && lay.harm < lay.actions && lay.actions < lay.items && lay.items < lay.keys && lay.keys < lay.abilities, tag + ': play order Stress, Harm, Actions, Items, Keys, then the rest: ' + JSON.stringify(lay));
    assert(lay.actions < lay.keys, tag + ': Actions above Keys');
    assert(lay.fig === null && lay.thumb && lay.thumb[0] > 0 && lay.thumb[1] <= 100, tag + ': mugshot thumbnail instead of the Figure box: ' + JSON.stringify(lay));
    assert(lay.rollMin >= 44, tag + ': roll buttons 44px tall: ' + lay.rollMin);
    if (!dark) {
      /* a row in every list that carries a ×: a log line, a clock, an extra item, a custom ability */
      await q.fill('#dossier .ds-newlog', 'We took the Autodrome.'); await q.click('#dossier [data-act="log"]');
      await q.fill('#dossier .ds-newlog', 'Bluecoats on the bridge.'); await q.click('#dossier [data-act="log"]');
      await q.fill('#dossier .ds-newclock', 'Courier'); await q.click('#dossier [data-act="addclock"][data-n="4"]');
      await q.fill('#dossier .ds-newitem', 'Lockpicks'); await q.click('#dossier [data-act="additem"]');
      await q.fill('#dossier .ds-newab', 'Ghost Contract'); await q.click('#dossier [data-act="addability"]'); await q.waitForTimeout(150);
      /* an action opens the mark strip as a fixed bottom sheet on a phone, its controls 40px tall; it is closed again before the sweep below
         (a fixed sheet would sit over whatever is scrolled under it) */
      await q.click('#dossier [data-act="rollopen"][data-a="Hunt"]'); await q.waitForTimeout(250);
      const strip = await q.evaluate(() => { const s = document.querySelector('#dossier .ds-mark'); if (!s) return null; const r = s.getBoundingClientRect(); const hs = [...s.querySelectorAll('button')].filter(n => n.offsetParent && !n.classList.contains('ds-x')).map(n => Math.round(n.getBoundingClientRect().height)); return { pos: getComputedStyle(s).position, bottom: Math.round(r.bottom), vh: innerHeight, minH: Math.min.apply(null, hs), n: hs.length }; });
      assert(strip && strip.pos === 'fixed' && strip.bottom <= strip.vh + 1 && strip.minH >= 40 && strip.n >= 8, tag + ': the mark strip is a fixed bottom sheet with 40px controls: ' + JSON.stringify(strip));
      /* the in-app roll panel's Push / Assist / Bargain rows are 40px tall too */
      await q.click('#dossier .ds-mark [data-act="rollapp"]'); await q.waitForTimeout(200);
      const rtog = await q.evaluate(() => [...document.querySelectorAll('#dossier .ds-rtog, #dossier .ds-roll .chip.sm')].filter(n => n.offsetParent).map(n => Math.round(n.getBoundingClientRect().height)));
      assert(rtog.length >= 9 && Math.min.apply(null, rtog) >= 40, tag + ': the roll panel’s options are 40px tall: ' + rtog.join(','));
      await q.click('#dossier .ds-roll .ds-roll-x'); await q.waitForTimeout(150);
      /* touch: every play control 40px tall (buttons, chips, item rows, Resist, the Armor / Heavy rows and their boxes' hit areas);
         Mark +1 / +2 first, side by side; 16px fields (no iOS zoom on focus); no double-tap zoom on buttons */
      const touch = await q.evaluate(() => {
        const vis = (s) => [...document.querySelectorAll('#dossier ' + s)].filter(n => n.offsetParent);
        const low = (s, min) => vis(s).map(n => [n.className + ' ' + (n.textContent || '').trim().slice(0, 14), Math.round(n.getBoundingClientRect().height)]).filter(x => x[1] < min);
        const sq = vis('.ds-resrow button.ds-sq').map(n => parseFloat(getComputedStyle(n, '::before').height));
        const tools = vis('.ds-stressbox .ds-markrow button').map(n => ({ t: n.textContent, top: Math.round(n.getBoundingClientRect().top) }));
        const fields = vis('input:not([type="checkbox"]), textarea, select').map(n => parseFloat(getComputedStyle(n).fontSize)).filter(f => f < 16);
        const ta = vis('button').filter(n => getComputedStyle(n).touchAction !== 'manipulation').length;
        return { low: low('.btn.sm, .chip.sm, .ds-item, .ds-resist, .ds-resrow, .ds-coh', 40), sq, tools, fields, ta };
      });
      assert(!touch.low.length, tag + ': play controls under 40px: ' + JSON.stringify(touch.low.slice(0, 8)));
      assert(touch.sq.length >= 2 && Math.min.apply(null, touch.sq) >= 40, tag + ': Armor / Heavy boxes have 40px hit areas: ' + touch.sq.join(','));
      assert(touch.tools.length === 4 && touch.tools[0].t === 'Mark +1' && touch.tools[1].t === 'Mark +2' && touch.tools[0].top === touch.tools[1].top && /^Clear 1$/.test(touch.tools[2].t), tag + ': Mark +1 / +2 first, side by side, then Clear 1 / Clear 3: ' + JSON.stringify(touch.tools));
      assert(!touch.fields.length && !touch.ta, tag + ': fields are 16px and buttons do not double-tap zoom: ' + JSON.stringify([touch.fields, touch.ta]));
      const hit = await q.evaluate(() => {
        const out = { min: {}, owns: [], stolen: [] };
        const kinds = { pip: '.ds-act .ds-pip', keypip: '.ds-key .ds-pip', sbox: '.ds-sbox', xbox: '.ds-attr-h .ds-xbox', xpbox: '.ds-tools .ds-xbox', bandxp: '.ds-band .ds-xbox', bank: '.ds-bank .ds-dia', stacks: '.ds-stackrow .ds-dia', x: '.ds-key .ds-x, .ds-clockrow .ds-x, .ds-roll-x', xlist: '.ds-contact .ds-x, .ds-log .ds-x, .ds-items .ds-x, .ds-custom .ds-x' };
        const at = (x, y) => document.elementFromPoint(x, y);
        for (const k in kinds) {
          [...document.querySelectorAll('#dossier ' + kinds[k])].filter(n => n.offsetParent).forEach(n => {
            n.scrollIntoView({ block: 'center' });
            const cs = getComputedStyle(n, '::before'), w = parseFloat(cs.width), h = parseFloat(cs.height), r = n.getBoundingClientRect();
            const m = out.min[k] || (out.min[k] = { w: 1e9, h: 1e9 }); m.w = Math.min(m.w, w); m.h = Math.min(m.h, h);
            const L = k === 'x' || k === 'xlist' ? r.left - 4 : r.left + r.width / 2 - w / 2, cy = r.top + r.height / 2;
            [[L + 2, cy], [L + w - 2, cy], [L + w / 2, cy - h / 2 + 2], [L + w / 2, cy + h / 2 - 2]].forEach(pt => { const e = at(pt[0], pt[1]); if (!(e === n || n.contains(e))) out.owns.push(k + ' ' + (n.getAttribute('data-act') || '') + (n.getAttribute('data-n') || '') + ' @' + pt.map(Math.round) + ' → ' + (e ? e.className || e.tagName : null)); });
          });
        }
        /* every control still owns its own visible box */
        [...document.querySelectorAll('#dossier button, #dossier input, #dossier select, #dossier textarea')].filter(n => n.offsetParent && n.getBoundingClientRect().width > 4).forEach(n => {
          n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          [[cx, cy], [r.left + 2, cy], [r.right - 2, cy], [cx, r.top + 2], [cx, r.bottom - 2]].forEach(pt => { const e = at(pt[0], pt[1]); if (e && !(e === n || n.contains(e))) out.stolen.push((n.className || n.tagName) + ' ' + (n.getAttribute('data-act') || '') + ' @' + pt.map(Math.round) + ' → ' + (e.className || e.tagName) + ' ' + (e.getAttribute('data-act') || '')); });
        });
        out.owns = out.owns.slice(0, 12); out.stolen = out.stolen.slice(0, 12);
        return out;
      });
      console.log(tag + ' hit areas', JSON.stringify(hit.min));
      ['pip', 'keypip', 'sbox', 'xbox', 'xpbox', 'bandxp', 'stacks', 'x'].forEach(k => assert(hit.min[k] && hit.min[k].h >= 44, tag + ': ' + k + ' hit area 44px tall: ' + JSON.stringify(hit.min[k])));
      assert(hit.min.x.w >= 44 && hit.min.xlist && hit.min.xlist.w >= 44, tag + ': × hit areas 44px wide (as tall as their row in a list): ' + JSON.stringify([hit.min.x, hit.min.xlist]));
      assert(hit.min.pip.w >= 19 && hit.min.sbox.w >= 25 && hit.min.xbox.w >= 16 && hit.min.bank.w >= 23 && hit.min.bank.h >= 18, tag + ': marks fill their pitch: ' + JSON.stringify(hit.min));
      assert(!hit.owns.length, tag + ': each mark owns its whole hit area: ' + hit.owns.join(' | '));
      assert(!hit.stolen.length, tag + ': no control loses taps to a neighbour’s hit area: ' + hit.stolen.join(' | '));
      await q.evaluate(() => scrollTo(0, 0));
    }
    await q.screenshot({ path: 'out/tracker-' + tag + '.png' });
    await q.screenshot({ path: 'out/tracker-' + tag + '-full.png', fullPage: true });
    await q.close();
  }
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
