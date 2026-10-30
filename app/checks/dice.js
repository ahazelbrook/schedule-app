process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the dice on the living sheet (round 4). Run from this dir:
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node dice.js */
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

const SHEET = `(pb) => {
  const CT = B68Content, P = CT.byId[pb], S = B68.S;
  B68.choosePlaybook(pb);
  const sh = S.sheet;
  sh.name = { hound: 'Aldo Crane', hull: 'Unit Seven' }[pb]; sh.alias = { hound: 'Dusty', hull: '' }[pb];
  sh.heritage = 'Akoros'; sh.background = 'Underworld'; sh.look = 'Lean, weathered.'; sh.wearing = ['Trench coat'];
  const dots = Object.assign({}, P.printed || {});
  if (pb === 'hound') Object.assign(dots, { Hunt: 2, Survey: 1, Prowl: 1, Skirmish: 1, Consort: 2 });
  if (pb === 'hull') Object.assign(dots, { Skirmish: 2, Attune: 1, Wreck: 2, Tinker: 1 });
  sh.dots = dots;
  if (pb === 'hound') { sh.ability = P.abilities[0][0]; sh.keys = P.keys.slice(0, 3); sh.contacts = {}; sh.contacts[P.contacts[0][0]] = 'friend'; sh.contacts[P.contacts[1][0]] = 'rival'; sh.vice = 'Gambling'; sh.purveyor = 'The Docks'; sh.items = [P.items[0][0], 'Binoculars']; }
  if (pb === 'hull') { sh.ability = P.abilities[0][0]; sh.owning = P.owning[0]; sh.items = [P.items[0][0]]; }
  if (B68.syncNameToSpec) B68.syncNameToSpec(); B68.changed();
  B68.fileCharacter();
}`;

/* a deterministic rng: each call yields the next die face in the sequence */
const RNG = (seq) => `window.B68Tracker._rng = (() => { const s = ${JSON.stringify(seq)}; let i = 0; return () => (s[i++ % s.length] - 0.5) / 6; })(); true`;

(async () => {
  const b = await chromium.launch();
  const errs = [], fails = [], notes = [];
  function assert(ok, msg) { if (!ok) fails.push(msg); }
  async function open(w, h, name, pb, scheme) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme || 'light' });
    await ctx.addInitScript(STUB);
    const p = await ctx.newPage(); p.__dialogs = [];
    p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/ERR_FILE_NOT_FOUND/.test(t)) errs.push(name + ' console.error: ' + t); } });
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('dialog', d => { p.__dialogs.push(d.type() + ': ' + d.message().slice(0, 90)); d.accept(); });
    await p.goto(URL); await p.waitForTimeout(1200);
    await p.evaluate(`(${SHEET})(${JSON.stringify(pb)}); true`).catch(e => { errs.push(name + ' sheet setup failed: ' + e.message); });
    await p.waitForTimeout(1200);
    const mode = await p.evaluate(() => document.body.dataset.mode);
    assert(mode === 'sheet', name + ': mode after filing is ' + mode);
    return p;
  }
  const overflow = async (p, name) => {
    const sw = await p.evaluate(() => document.documentElement.scrollWidth), cw = await p.evaluate(() => document.documentElement.clientWidth);
    if (sw > cw) errs.push(name + ' horizontal overflow ' + sw + '>' + cw);
    const clipped = await p.evaluate(() => { const root = document.getElementById('dossier'); const R = root.getBoundingClientRect(); const out = []; root.querySelectorAll('.ds-box, .ds-roll, .ds-roll *, button').forEach(n => { const r = n.getBoundingClientRect(), sheet = n.closest('.ds-roll'), fx = !!sheet && getComputedStyle(sheet).position === 'fixed', lo = fx ? 0 : R.left, hi = fx ? innerWidth : R.right; /* a phone's bottom sheet spans the screen */ if (r.width && (r.right > hi + 1 || r.left < lo - 1)) out.push(n.className + ' ' + Math.round(r.left) + '-' + Math.round(r.right) + ' vs ' + Math.round(R.right)); }); return out.slice(0, 5); });
    if (clipped.length) errs.push(name + ' elements outside the dossier: ' + clipped.join(' | '));
  };
  const play = (p) => p.evaluate(() => B68Tracker.play());
  const stored = (p) => p.evaluate(() => { const id = Object.keys(window.__store)[0]; return window.__store[id].play; });
  const has = (p, sel) => p.$(sel).then(x => !!x);
  const text = (p, sel) => p.$eval(sel, n => n.textContent).catch(() => null);
  const click = async (p, sel) => { const h = await p.$(sel); if (!h) { fails.push('missing ' + sel); return false; } await h.click(); await p.waitForTimeout(150); return true; };
  const shotPanel = async (p, path) => { const h = await p.$('#dossier .ds-actbox'); if (h) await h.screenshot({ path }); };
  /* everyone rolls physical dice: an action opens the mark strip and the Resist chip its helper; the in-app rolls sit behind "Roll in the app" */
  const openRoll = async (p, a) => { await click(p, '#dossier .ds-actbtn[data-a="' + a + '"]'); await click(p, '#dossier .ds-mark [data-act="rollapp"]'); };
  const openResist = async (p, attr) => { await click(p, '#dossier [data-act="resistopen"][data-attr="' + attr + '"]'); await click(p, '#dossier .ds-mark [data-act="resistapp"]'); };

  /* ---------- Hound ---------- */
  {
    const p = await open(1360, 900, 'hound', 'hound');
    assert(typeof (await p.evaluate(() => typeof B68Tracker._rng)) === 'string' && (await p.evaluate(() => B68Tracker._rng === Math.random)), 'hound: _rng defaults to Math.random');
    const keys = await p.evaluate(() => Object.keys(B68Tracker).sort().join(','));
    assert(keys === '_rng,close,initialPlay,isOpen,open,play,refresh,renderStatic,update', 'hound: public surface unchanged: ' + keys);
    let s = await play(p);
    const skirmish = s.dots.Skirmish, prowessXp = s.xp.prowess, stress0 = s.stress, hold0 = s.xpHold || 0;
    notes.push('hound Skirmish ' + skirmish + ' dots, stress ' + stress0 + ', prowess xp ' + prowessXp);
    /* action names are buttons, pips still work */
    assert((await p.$$eval('#dossier .ds-actbtn', ns => ns.length)) === 12, 'hound: 12 action buttons');
    await click(p, '#dossier .ds-pip[data-a="Hunt"][data-n="3"]'); s = await stored(p); assert(s.dots.Hunt === 3, 'hound: pips still set dots ' + s.dots.Hunt);
    await click(p, '#dossier .ds-pip[data-a="Hunt"][data-n="3"]'); s = await stored(p); assert(s.dots.Hunt === 2, 'hound: pips still toggle down ' + s.dots.Hunt);
    assert(!(await has(p, '#dossier .ds-roll')), 'hound: no panel before a click');
    /* ---- the mark strip (physical dice): the dice count, Push / Assist / Bargain marking their cost, Harm N, +1 Stress ---- */
    await click(p, '#dossier .ds-actbtn[data-a="Skirmish"]');
    assert(await has(p, '#dossier .ds-actbox .ds-mark') && !(await has(p, '#dossier .ds-roll:not(.ds-mark)')), 'strip: an action opens the mark strip, not the roll panel');
    assert((await text(p, '#dossier .ds-mark .ds-roll-t')) === 'Skirmish · ' + skirmish + 'd', 'strip: the title carries the dice: ' + (await text(p, '#dossier .ds-mark .ds-roll-t')));
    await click(p, '#dossier [data-act="markopt"][data-k="push"]');
    s = await stored(p);
    assert(s.stress === stress0 + 2 && (await text(p, '#dossier .ds-mark .ds-roll-t')) === 'Skirmish · ' + (skirmish + 1) + 'd' && /\+2 Stress \(push\)/.test(await text(p, '#dossier .ds-mark .ds-roll-applied')), 'strip: Push marks 2 Stress and adds a die: ' + s.stress + ' ' + (await text(p, '#dossier .ds-mark .ds-roll-t')));
    const w0 = await p.evaluate(() => window.__writes.length);
    await click(p, '#dossier [data-act="markopt"][data-k="assist"]');
    s = await stored(p); assert(s.stress === stress0 + 2 && (await text(p, '#dossier .ds-mark .ds-roll-t')) === 'Skirmish · ' + (skirmish + 2) + 'd' && /helper: 1 Stress/.test(await text(p, '#dossier [data-act="markopt"][data-k="assist"]')), 'strip: Assist adds a die and costs this sheet nothing (the helper marks their own): ' + s.stress + ' ' + (await text(p, '#dossier [data-act="markopt"][data-k="assist"]')));
    await click(p, '#dossier [data-act="markopt"][data-k="bargain"]');
    s = await stored(p); assert(s.stress === stress0 + 2 && (await text(p, '#dossier .ds-mark .ds-roll-t')) === 'Skirmish · ' + (skirmish + 3) + 'd', 'strip: a Devil’s Bargain adds a die and is free: ' + s.stress);
    assert((await p.evaluate(() => window.__writes.length)) === w0, 'strip: Assist and Bargain write nothing');
    await click(p, '#dossier [data-act="markopt"][data-k="push"]'); await click(p, '#dossier [data-act="markopt"][data-k="assist"]'); await click(p, '#dossier [data-act="markopt"][data-k="bargain"]');
    s = await stored(p); assert(s.stress === stress0 && (await text(p, '#dossier .ds-mark .ds-roll-t')) === 'Skirmish · ' + skirmish + 'd' && !s.log.length, 'strip: untapping gives the Stress back, nothing logged: ' + s.stress);
    await click(p, '#dossier [data-act="markharm"][data-l="2"]');
    assert(await p.evaluate(() => document.activeElement && document.activeElement.dataset.path === 'harm.l2.0'), 'strip: Harm 2 focuses the first level-2 line');
    await p.fill('#dossier [data-path="harm.l2.0"]', 'Cracked ribs'); await p.waitForTimeout(600);
    await click(p, '#dossier [data-act="markharm"][data-l="2"]');
    assert(await p.evaluate(() => document.activeElement && document.activeElement.dataset.path === 'harm.l2.1'), 'strip: Harm 2 again focuses the empty second line');
    await click(p, '#dossier .ds-mark [data-act="stressd"][data-d="1"]');
    s = await stored(p); assert(s.stress === stress0 + 1, 'strip: +1 Stress marks one: ' + s.stress);
    await click(p, '#dossier .ds-sbox[data-n="' + (stress0 + 1) + '"]');
    s = await stored(p); assert(s.stress === stress0 && await has(p, '#dossier .ds-mark'), 'strip: a pip tap re-renders with the strip still open');
    /* the resist helper: the action's attribute by default; the player rolls, taps the highest die, the cost is applied and logged */
    await click(p, '#dossier [data-act="markresist"]');
    const prA = ['Finesse', 'Prowl', 'Skirmish', 'Wreck'].filter(a => s.dots[a] > 0).length;
    assert((await p.$eval('#dossier [data-act="markrattr"][data-v="Prowess"]', n => n.getAttribute('aria-pressed'))) === 'true' && new RegExp('Roll ' + prA + 'd').test(await text(p, '#dossier .ds-rhelp')), 'helper: Prowess by default, with its dice: ' + (await text(p, '#dossier .ds-rhelp')));
    const before1 = s.stress, logs1 = s.log.length;
    await click(p, '#dossier [data-act="markrdie"][data-v="4"]');
    s = await stored(p);
    assert(s.stress === before1 + 2, 'helper: highest die 4 costs 2 Stress: ' + s.stress);
    assert(s.log.length === logs1 + 1 && s.log[0].kind === 'roll' && s.log[0].text === 'Resist Prowess ' + prA + 'd · 4 → 2 Stress', 'helper: logged like the in-app resistance: ' + s.log[0].text);
    assert(/Applied/.test(await text(p, '#dossier .ds-rhelp .ds-roll-applied')) && /\+2 Stress/.test(await text(p, '#dossier .ds-rhelp .ds-roll-applied')), 'helper: Applied line: ' + (await text(p, '#dossier .ds-rhelp .ds-roll-applied')));
    assert(await p.$eval('#dossier [data-act="markrattr"][data-v="Insight"]', n => n.disabled) && !(await has(p, '#dossier [data-act="markrdie"]')), 'helper: applied once, the attribute locks');
    await click(p, '#dossier [data-act="markrdone"]');
    assert(!(await has(p, '#dossier .ds-rhelp')) && await has(p, '#dossier .ds-mark'), 'helper: Done closes it, the strip stays');
    await click(p, '#dossier [data-act="markresist"]'); await click(p, '#dossier [data-act="markrattr"][data-v="Insight"]');
    const insA = ['Hunt', 'Study', 'Survey', 'Tinker'].filter(a => s.dots[a] > 0).length, before2 = s.stress;
    await click(p, '#dossier [data-act="markrdie"][data-v="crit"]');
    s = await stored(p);
    assert(s.stress === before2 - 1 && s.log[0].text === 'Resist Insight ' + insA + 'd · 6,6 → critical, clear 1 Stress', 'helper: two sixes clear 1: ' + s.stress + ' ' + s.log[0].text);
    await click(p, '#dossier [data-act="markrdone"]');
    await click(p, '#dossier [data-act="resistopen"][data-attr="Resolve"]');
    assert(/Resist · Resolve/.test(await text(p, '#dossier .ds-mark .ds-roll-t')) && await has(p, '#dossier .ds-rhelp') && !(await has(p, '#dossier [data-act="markharm"]')), 'helper: an attribute’s Resist chip opens the helper on its own');
    await click(p, '#dossier .ds-mark .ds-roll-x');
    assert(!(await has(p, '#dossier .ds-mark')), 'strip: × closes it');
    /* Push marked in the strip, then "Roll in the app": the first roll does not pay the push again, a second roll does */
    await click(p, '#dossier .ds-actbtn[data-a="Skirmish"]'); const st1 = (await stored(p)).stress;
    await click(p, '#dossier [data-act="markopt"][data-k="push"]'); await click(p, '#dossier .ds-mark [data-act="rollapp"]');
    assert(await p.$eval('#dossier [data-act="rollopt"][data-k="push"]', n => n.disabled && n.getAttribute('aria-pressed') === 'true' && /marked already/.test(n.textContent)) && (await text(p, '#dossier .ds-roll-big')) === (skirmish + 1) + 'd', 'strip → app: the push comes along, marked already');
    await p.evaluate(RNG([5, 2, 2])); await click(p, '#dossier [data-act="roll"]');
    s = await stored(p); assert(s.stress === st1 + 2 && /\(push\)/.test(s.log[0].text), 'strip → app: the roll did not pay the push twice: ' + s.stress);
    assert((await text(p, '#dossier [data-act="roll"]')) === 'Roll again (pays again)', 'strip → app: Roll again (pays again)');
    await p.evaluate(RNG([4, 2, 2])); await click(p, '#dossier [data-act="roll"]');
    s = await stored(p); assert(s.stress === st1 + 4 && s.log.length >= 2 && /\(push\)/.test(s.log[0].text), 'strip → app: rolling again paid the push again: ' + s.stress);
    await click(p, '#dossier .ds-roll-x');
    /* the helper logged two lines and the harm line is written: the in-app checks below count from a clean sheet */
    await p.evaluate((st) => { const id = Object.keys(window.__store)[0]; const d = JSON.parse(JSON.stringify(window.__store[id])); d.play.log = []; d.play.harm.l2 = ['', '']; d.play.stress = st; window.__store[id] = d; B68Tracker.update(Object.assign({ id }, d)); }, stress0);
    await p.waitForTimeout(100);
    /* ---- the in-app roll (behind "Roll in the app"): open Skirmish ---- */
    await openRoll(p, 'Skirmish');
    assert(await has(p, '#dossier .ds-actbox .ds-roll'), 'hound: panel opened under the Actions box');
    assert(/Skirmish/.test(await text(p, '#dossier .ds-roll-t')), 'hound: panel titled with the action');
    assert((await text(p, '#dossier .ds-roll-big')) === skirmish + 'd', 'hound: dice readout ' + (await text(p, '#dossier .ds-roll-big')));
    assert((await p.$eval('#dossier [data-act="rollpos"][data-v="risky"]', n => n.getAttribute('aria-pressed'))) === 'true', 'hound: risky by default');
    assert((await p.$eval('#dossier [data-act="rolleff"][data-v="standard"]', n => n.getAttribute('aria-pressed'))) === 'true', 'hound: standard effect by default');
    /* push + desperate */
    await click(p, '#dossier [data-act="rollopt"][data-k="push"]');
    await click(p, '#dossier [data-act="rollpos"][data-v="desperate"]');
    assert((await text(p, '#dossier .ds-roll-big')) === (skirmish + 1) + 'd', 'hound: push adds a die: ' + (await text(p, '#dossier .ds-roll-big')));
    const pushNote = await text(p, '#dossier [data-act="rollopt"][data-k="push"]'); assert(/2 Stress/.test(pushNote), 'hound: push costs 2 Stress: ' + pushNote);
    assert(/earns 1 xp/.test(await text(p, '#dossier .ds-roll-body')) && !/earns 2 xp/.test(await text(p, '#dossier .ds-roll-body')), 'hound: a desperate dotted action earns 1 xp');
    await p.evaluate(RNG([6, 4, 2, 1]));
    await shotPanel(p, 'out/dice-desk-panel.png');
    await click(p, '#dossier [data-act="roll"]');
    const dice = await p.$$eval('#dossier .ds-roll-res .ds-die', ns => ns.map(n => n.getAttribute('aria-label')));
    assert(dice.length === skirmish + 1 && dice[0] === 'die 6', 'hound: dice drawn ' + dice.join(','));
    assert(await has(p, '#dossier .ds-roll-res .ds-die.hi.six'), 'hound: the highest die (a 6) is highlighted in accent');
    const word = await text(p, '#dossier .ds-roll-word'); assert(word === 'Success', 'hound: reading ' + word);
    s = await stored(p);
    assert(s.stress === stress0 + 2, 'hound: push marked 2 Stress: ' + s.stress);
    assert(s.xp.prowess === prowessXp && s.xpHold === hold0 + 1, 'hound: desperate put 1 xp on the bar, Prowess xp unchanged: ' + JSON.stringify([s.xp.prowess, s.xpHold]));
    assert(s.log.length === 1 && s.log[0].kind === 'roll' && typeof s.log[0].at === 'string', 'hound: one roll log entry ' + JSON.stringify(s.log[0]));
    const want = 'Skirmish ' + (skirmish + 1) + 'd (push) · desperate · ' + [6, 4, 2, 1].slice(0, skirmish + 1).join(',') + ' → success';
    assert(s.log[0].text === want, 'hound: log text "' + s.log[0].text + '" vs "' + want + '"');
    const applied = await text(p, '#dossier .ds-roll-applied'); assert(/\+2 Stress/.test(applied) && applied.indexOf('+1 xp on the bar (' + (hold0 + 1) + ' to spend)') >= 0, 'hound: applied line ' + applied);
    const writes = await p.evaluate(() => window.__writes.length);
    await p.screenshot({ path: 'out/dice-desk.png', fullPage: true });
    const li = await p.$eval('#dossier .ds-log li', n => n.className + '|' + !!n.querySelector('.ds-logdie') + '|' + n.querySelector('.ds-logt').className);
    assert(li === 'roll|true|ds-logt mono', 'hound: roll entry renders mono with a die: ' + li);
    /* once rolled, the paid options lock and the button says a second roll pays again; a changed position clears the result */
    assert(await p.$eval('#dossier [data-act="rollopt"][data-k="push"]', n => n.disabled) && await p.$eval('#dossier [data-act="rollopt"][data-k="assist"]', n => n.disabled) && (await text(p, '#dossier [data-act="roll"]')) === 'Roll again (pays again)', 'hound: after a roll Push / Assist lock and the button reads Roll again (pays again)');
    const resTop = await p.evaluate(() => { const r = document.querySelector('#dossier .ds-roll-res').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert(resTop, 'hound: the verdict is in view after the roll');
    assert(await p.$eval('#dossier [data-act="rollpos"][data-v="controlled"]', n => n.disabled) && await p.$eval('#dossier [data-act="rolleff"][data-v="great"]', n => n.disabled) && await p.$eval('#dossier [data-act="rollopt"][data-k="bargain"]', n => n.disabled), 'hound: after a roll position, effect and bargain are locked too');
    await p.evaluate(() => { const b = document.querySelector('#dossier [data-act="rollpos"][data-v="controlled"]'); b.disabled = false; b.click(); }); await p.waitForTimeout(150);
    assert(await has(p, '#dossier .ds-roll-res') && (await p.$eval('#dossier [data-act="rollpos"][data-v="desperate"]', n => n.getAttribute('aria-pressed'))) === 'true', 'hound: a forced position tap after the roll changes nothing');
    /* a 0-dot action: two dice, lowest read */
    const zero = Object.keys(s.dots).filter(a => !s.dots[a])[0]; notes.push('hound zero-dot action: ' + zero);
    await openRoll(p, '' + zero + '');
    assert(/take the lowest/.test(await text(p, '#dossier .ds-roll-go')), 'hound: 0d says take lowest');
    assert((await text(p, '#dossier .ds-roll-big')) === '0d', 'hound: 0d readout');
    assert(/zero-dot: earns 1 xp/.test(await text(p, '#dossier .ds-roll-body')), 'hound: a zero-dot risky action says it earns 1 xp');
    await p.evaluate(RNG([5, 2]));
    await click(p, '#dossier [data-act="roll"]');
    const zd = await p.$$eval('#dossier .ds-roll-res .ds-die', ns => ns.map(n => n.getAttribute('aria-label') + (n.classList.contains('hi') ? '*' : '')));
    assert(zd.join(',') === 'die 5,die 2*', 'hound: zero-dot dice ' + zd.join(','));
    assert((await text(p, '#dossier .ds-roll-word')) === 'Failure', 'hound: zero-dot reads the lowest (2 = failure)');
    s = await stored(p);
    assert(s.log[0].text === zero + ' 0d (2d take lowest) · risky · 5,2 → failure', 'hound: zero-dot log ' + s.log[0].text);
    assert(s.stress === stress0 + 2 && s.xp.prowess === prowessXp && s.xpHold === hold0 + 2, 'hound: the zero-dot risky roll put 1 xp on the bar and changed nothing else: ' + JSON.stringify([s.stress, s.xp.prowess, s.xpHold]));
    assert(/A zero-dot action earns 1 xp, even with a push or help\./.test(await text(p, '#dossier .ds-roll-res')) && (await text(p, '#dossier .ds-roll-applied')).indexOf('+1 xp on the bar (' + (hold0 + 2) + ' to spend)') >= 0, 'hound: zero-dot hint and applied line: ' + (await text(p, '#dossier .ds-roll-applied')));
    /* critical: two 6s */
    await openRoll(p, 'Skirmish');
    await click(p, '#dossier [data-act="rollopt"][data-k="assist"]');
    await click(p, '#dossier [data-act="rollopt"][data-k="bargain"]');
    await p.evaluate(RNG([6, 6, 3, 1]));
    await click(p, '#dossier [data-act="roll"]');
    assert((await text(p, '#dossier .ds-roll-word')) === 'Critical' && await has(p, '#dossier .ds-roll-word.critical'), 'hound: two 6s read critical');
    assert((await p.$$eval('#dossier .ds-roll-res .ds-die.six', ns => ns.length)) === 2, 'hound: both 6s in accent');
    s = await stored(p);
    assert(new RegExp('^Skirmish ' + (skirmish + 2) + 'd \\(assist, bargain\\) · risky · 6,6(,[1-6])* → critical$').test(s.log[0].text), 'hound: critical log ' + s.log[0].text);
    assert(s.stress === stress0 + 2 && s.xpHold === hold0 + 2, 'hound: no push, no stress; a risky dotted roll earns nothing: ' + JSON.stringify([s.stress, s.xpHold]));
    /* zero dice cannot crit: 6,6 taken lowest is a success */
    await openRoll(p, '' + zero + ''); await p.evaluate(RNG([6, 6])); await click(p, '#dossier [data-act="roll"]');
    assert((await text(p, '#dossier .ds-roll-word')) === 'Success', 'hound: 0d 6,6 is a success, not a critical');
    /* resistance: Prowess */
    await openResist(p, 'Prowess');
    s = await stored(p); const pr = ['Finesse', 'Prowl', 'Skirmish', 'Wreck'].filter(a => s.dots[a] > 0).length;
    assert(/Resist/.test(await text(p, '#dossier .ds-roll-t')) && (await text(p, '#dossier .ds-roll-big')) === pr + 'd', 'hound: resist dice = rating ' + pr + ': ' + (await text(p, '#dossier .ds-roll-big')));
    await p.evaluate(RNG([5, 3, 1, 1]));
    await click(p, '#dossier [data-act="roll"]');
    assert(/6 − 5 = 1 Stress/.test(await text(p, '#dossier .ds-roll-why')), 'hound: resist cost shown: ' + (await text(p, '#dossier .ds-roll-why')));
    const before = (await stored(p)).stress, logs = (await stored(p)).log.length;
    assert((await text(p, '#dossier [data-act="resistapply"]')) === 'Apply +1 Stress', 'hound: apply label ' + (await text(p, '#dossier [data-act="resistapply"]')));
    await click(p, '#dossier [data-act="resistapply"]');
    s = await stored(p);
    assert(s.stress === before + 1, 'hound: resistance applied 1 Stress: ' + s.stress);
    assert(s.log.length === logs + 1 && s.log[0].text === 'Resist Prowess ' + pr + 'd · ' + [5, 3, 1, 1].slice(0, pr).join(',') + ' → 1 Stress', 'hound: resist log ' + s.log[0].text);
    assert(!(await has(p, '#dossier [data-act="resistapply"]')) && /Applied/.test(await text(p, '#dossier .ds-roll-applied')), 'hound: apply once');
    /* resistance critical clears 1 */
    await click(p, '#dossier [data-act="roll"]'); await p.evaluate(RNG([6, 6, 6, 6])); await click(p, '#dossier [data-act="roll"]');
    assert(/clear 1 Stress/.test(await text(p, '#dossier .ds-roll-why')), 'hound: resist critical clears 1');
    const b2 = (await stored(p)).stress; await click(p, '#dossier [data-act="resistapply"]'); s = await stored(p);
    assert(s.stress === b2 - 1 && /critical, clear 1 Stress$/.test(s.log[0].text), 'hound: resist critical applied ' + s.stress + ' ' + s.log[0].text);
    /* fortune */
    await click(p, '#dossier .ds-band .ds-fortune');
    assert(/Fortune/.test(await text(p, '#dossier .ds-roll-t')), 'hound: fortune panel');
    await click(p, '#dossier [data-act="fortn"][data-n="3"]'); await p.evaluate(RNG([4, 2, 1])); await click(p, '#dossier [data-act="roll"]');
    assert((await text(p, '#dossier .ds-roll-word')) === 'Partial', 'hound: fortune reading');
    s = await stored(p); assert(s.log[0].text === 'Fortune 3d · 4,2,1 → partial', 'hound: fortune log ' + s.log[0].text);
    await click(p, '#dossier [data-act="fortn"][data-n="0"]'); await p.evaluate(RNG([3, 6])); await click(p, '#dossier [data-act="roll"]');
    s = await stored(p); assert(s.log[0].text === 'Fortune 0d (2d take lowest) · 3,6 → failure', 'hound: fortune 0d log ' + s.log[0].text);
    /* Esc and × close; one panel at a time */
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    assert(!(await has(p, '#dossier .ds-roll')), 'hound: Esc closes the panel');
    await openRoll(p, 'Hunt'); await openResist(p, 'Insight');
    assert((await p.$$eval('#dossier .ds-roll', ns => ns.length)) === 1 && /Resist/.test(await text(p, '#dossier .ds-roll-t')), 'hound: one panel at a time');
    await click(p, '#dossier .ds-roll-x'); assert(!(await has(p, '#dossier .ds-roll')), 'hound: × closes');
    /* push blocked at the top of the track */
    await click(p, '#dossier .ds-sbox[data-n="8"]'); await openRoll(p, 'Hunt');
    assert(await p.$eval('#dossier [data-act="rollopt"][data-k="push"]', n => n.disabled), 'hound: push disabled when it would pass 9');
    assert(/trauma rule applies/.test(await text(p, '#dossier .ds-roll-body')), 'hound: trauma hint shown');
    await click(p, '#dossier .ds-sbox[data-n="8"]'); await click(p, '#dossier .ds-sbox[data-n="3"]');
    /* a note keeps the Log button */
    await p.fill('#dossier .ds-newlog', 'Session 2: the heist at the Gaddoc sluice.'); await click(p, '#dossier [data-act="log"]');
    s = await stored(p); assert(s.log[0].kind === 'note' && /Gaddoc/.test(s.log[0].text), 'hound: note entry ' + JSON.stringify(s.log[0]));
    const noteLi = await p.$eval('#dossier .ds-log li', n => n.className + '|' + !!n.querySelector('.ds-logdie')); assert(noteLi === '|false', 'hound: note renders as before: ' + noteLi);
    /* an old entry without kind still renders */
    await p.evaluate(() => { const id = Object.keys(window.__store)[0]; const d = JSON.parse(JSON.stringify(window.__store[id])); d.play.log.push({ at: '2026-01-02T00:00:00.000Z', text: 'Old entry' }); B68Tracker.open(Object.assign({ id }, d), { save: () => Promise.resolve(), canWrite: true }); });
    assert((await p.$$eval('#dossier .ds-log li', ns => ns.map(n => n.textContent))).some(t => /Old entry/.test(t)), 'hound: kind-less entry renders');
    /* read only: rolls happen, nothing written */
    const roBefore = await p.evaluate(() => { const id = Object.keys(window.__store)[0]; const d = JSON.parse(JSON.stringify(window.__store[id])); window.__roSaves = 0; B68Tracker.open(Object.assign({ id }, d), { save: () => { window.__roSaves++; return Promise.resolve(); }, canWrite: false }); return B68Tracker.play(); });
    assert(!(await p.$eval('#dossier .ds-actbtn[data-a="Skirmish"]', n => n.disabled)), 'ro: action buttons stay live');
    await openRoll(p, 'Skirmish'); await click(p, '#dossier [data-act="rollopt"][data-k="push"]'); await click(p, '#dossier [data-act="rollpos"][data-v="desperate"]');
    await p.evaluate(RNG([4, 4, 4, 4])); await click(p, '#dossier [data-act="roll"]');
    assert((await text(p, '#dossier .ds-roll-word')) === 'Partial', 'ro: roll shown');
    assert(/Not saved \(read only\)/.test(await text(p, '#dossier .ds-roll-applied')), 'ro: says not saved: ' + (await text(p, '#dossier .ds-roll-applied')));
    const roAfter = await play(p); const roSaves = await p.evaluate(() => window.__roSaves);
    assert(JSON.stringify(roAfter) === JSON.stringify(roBefore) && roSaves === 0, 'ro: nothing changed or saved (' + roSaves + ' saves)');
    await openResist(p, 'Prowess'); await click(p, '#dossier [data-act="roll"]');
    assert(await p.$eval('#dossier [data-act="resistapply"]', n => n.disabled) && /not saved \(read only\)/.test(await text(p, '#dossier .ds-roll-apply')), 'ro: resist apply disabled with a note');
    notes.push('hound dialogs: ' + p.__dialogs.join(' / ') + ' · writes after first roll: ' + writes);
    await p.context().close();
  }

  /* ---------- Hull: Drain wording ---------- */
  {
    const p = await open(1360, 900, 'hull', 'hull');
    let s = await play(p); const d0 = s.stress;
    await openRoll(p, 'Skirmish');
    const pushNote = await text(p, '#dossier [data-act="rollopt"][data-k="push"]'); assert(/2 Drain/.test(pushNote) && !/Stress/.test(pushNote), 'hull: push costs Drain: ' + pushNote);
    await click(p, '#dossier [data-act="rollopt"][data-k="push"]'); await p.evaluate(RNG([3, 2, 1])); await click(p, '#dossier [data-act="roll"]');
    s = await stored(p); assert(s.stress === d0 + 2, 'hull: push marked Drain ' + s.stress);
    assert(/\+2 Drain \(2 \/ 10\)/.test(await text(p, '#dossier .ds-roll-applied')), 'hull: applied says Drain: ' + (await text(p, '#dossier .ds-roll-applied')));
    await openResist(p, 'Prowess');
    assert(/Drain cost is 6 minus the highest die/.test(await text(p, '#dossier .ds-roll-body')), 'hull: resist hint says Drain');
    await p.evaluate(RNG([4, 1, 1])); await click(p, '#dossier [data-act="roll"]');
    assert((await text(p, '#dossier [data-act="resistapply"]')) === 'Apply +2 Drain', 'hull: apply label ' + (await text(p, '#dossier [data-act="resistapply"]')));
    await click(p, '#dossier [data-act="resistapply"]'); s = await stored(p);
    assert(s.stress === d0 + 4 && /→ 2 Drain$/.test(s.log[0].text), 'hull: resist wrote Drain ' + s.stress + ' ' + s.log[0].text);
    /* push blocked at 9 / 10 with the On Program rule */
    await click(p, '#dossier .ds-sbox[data-n="9"]'); await openRoll(p, 'Wreck');
    assert(await p.$eval('#dossier [data-act="rollopt"][data-k="push"]', n => n.disabled) && /On Program rule applies/.test(await text(p, '#dossier .ds-roll-body')), 'hull: push blocked with the On Program hint');
    await p.screenshot({ path: 'out/dice-hull-desk.png', fullPage: true });
    await p.context().close();
    /* dark */
    const q = await open(1360, 900, 'hull-dark', 'hull', 'dark');
    await openRoll(q, 'Skirmish'); await q.evaluate(RNG([6, 6, 2])); await click(q, '#dossier [data-act="rollopt"][data-k="assist"]'); await click(q, '#dossier [data-act="roll"]');
    await shotPanel(q, 'out/dice-dark-panel.png');
    await q.context().close();
  }

  /* ---------- phone ---------- */
  {
    const p = await open(390, 800, 'phone', 'hound');
    /* the on-stage strip is 58px tall at the foot (cast.css sets --cp-stage-h): the mark strip sits on it, a bottom sheet with
       the toggles three across and the five consequences in one row, every control at least 40px tall */
    await p.evaluate(() => document.documentElement.style.setProperty('--cp-stage-h', '58px'));
    await click(p, '#dossier .ds-actbtn[data-a="Skirmish"]');
    const ms = await p.evaluate(() => {
      const s = document.querySelector('#dossier .ds-mark'), r = s.getBoundingClientRect();
      const tops = (sel) => [...s.querySelectorAll(sel)].map(n => Math.round(n.getBoundingClientRect().top));
      const hs = [...s.querySelectorAll('button')].filter(n => n.offsetParent && !n.classList.contains('ds-x')).map(n => Math.round(n.getBoundingClientRect().height));
      return { pos: getComputedStyle(s).position, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight, toggles: tops('.ds-mtog'), cons: tops('.ds-mark-cons .btn'), minH: Math.min.apply(null, hs), wide: [...s.querySelectorAll('button, .ds-roll-t, .ds-roll-sub, small')].some(n => { const q = n.getBoundingClientRect(); return q.width && (q.left < r.left - 0.5 || q.right > r.right + 0.5); }) };
    });
    notes.push('phone mark strip ' + JSON.stringify(ms));
    assert(ms.pos === 'fixed' && ms.bottom === ms.vh - 58 && ms.h <= 260, 'phone: the strip is a bottom sheet on the on-stage strip, compact: ' + JSON.stringify(ms));
    assert(ms.toggles.length === 3 && new Set(ms.toggles).size === 1 && ms.cons.length === 5 && new Set(ms.cons).size === 1, 'phone: Push / Assist / Bargain in one row, the five consequences in one row: ' + JSON.stringify(ms));
    assert(ms.minH >= 40 && !ms.wide, 'phone: the strip controls are 40px tall and nothing sticks out: ' + JSON.stringify(ms));
    await click(p, '#dossier .ds-mark [data-act="markresist"]');
    const rh = await p.evaluate(() => { const s = document.querySelector('#dossier .ds-mark'), r = s.getBoundingClientRect(), d = [...s.querySelectorAll('.ds-dieb')].map(n => n.getBoundingClientRect()); return { top: Math.round(r.top), dice: d.length, row: new Set(d.map(x => Math.round(x.top))).size, minH: Math.min.apply(null, d.map(x => Math.round(x.height))), minW: Math.min.apply(null, d.map(x => Math.round(x.width))) }; });
    assert(rh.top >= 0 && rh.dice === 7 && rh.row === 1 && rh.minH >= 44 && rh.minW >= 40, 'phone: the resist helper fits, the seven dice in a row a thumb wide: ' + JSON.stringify(rh));
    await click(p, '#dossier .ds-mark [data-act="rollapp"]');
    await click(p, '#dossier [data-act="rollopt"][data-k="push"]'); await click(p, '#dossier [data-act="rollpos"][data-v="desperate"]');
    const st0 = (await stored(p)).stress;
    await p.evaluate(RNG([6, 4])); await click(p, '#dossier [data-act="roll"]');
    await p.waitForTimeout(400);
    const vr = await p.evaluate(() => { const res = document.querySelector('#dossier .ds-roll-res').getBoundingClientRect(), go = document.querySelector('#dossier [data-act="roll"]').getBoundingClientRect(); return { top: Math.round(res.top), bottom: Math.round(res.bottom), go: [Math.round(go.top), Math.round(go.bottom)], limit: innerHeight - 58 }; });
    assert(vr.top >= 0 && vr.bottom <= vr.limit && vr.go[0] >= 0 && vr.go[1] <= vr.limit, 'phone: the verdict and Roll again are on screen, above the on-stage strip: ' + JSON.stringify(vr));
    assert((await text(p, '#dossier [data-act="roll"]')) === 'Roll again (pays again)' && (await stored(p)).stress === st0 + 2, 'phone: pushed once, Roll again (pays again)');
    await p.evaluate(RNG([3, 4])); await click(p, '#dossier [data-act="roll"]');
    const s2 = await stored(p);
    assert(s2.stress === st0 + 4 && s2.log.filter(e => /^Skirmish /.test(e.text)).length === 2, 'phone: a second roll pays the push again and logs again: ' + s2.stress);
    await overflow(p, 'phone');
    const r = await p.$eval('#dossier .ds-roll', n => { const b = n.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; });
    notes.push('phone panel rect ' + JSON.stringify(r) + ', scrollY ' + (await p.evaluate(() => Math.round(window.scrollY))));
    await shotPanel(p, 'out/dice-phone-panel.png');
    await p.screenshot({ path: 'out/dice-phone.png', fullPage: false });
    await p.context().close();
  }

  /* ---------- print: panel and roll buttons hidden ---------- */
  {
    const p = await open(1360, 900, 'print', 'hound');
    await openRoll(p, 'Skirmish'); await click(p, '#dossier [data-act="roll"]');
    await p.emulateMedia({ media: 'print' });
    const vis = await p.evaluate(() => ['.ds-roll', '.ds-resist', '.ds-fortune', '.ds-actbtn'].map(s => { const n = document.querySelector('#dossier ' + s); return s + ':' + (n ? getComputedStyle(n).display : 'none'); }).join(' '));
    assert(/\.ds-roll:none/.test(vis) && /\.ds-resist:none/.test(vis) && /\.ds-fortune:none/.test(vis) && !/\.ds-actbtn:none/.test(vis), 'print: ' + vis);
    await p.context().close();
  }

  console.log('NOTES:\n' + notes.join('\n'));
  console.log('FAILS:', fails.length ? '\n' + fails.join('\n') : 'none');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await b.close();
  process.exit(fails.length || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
