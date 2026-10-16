process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the Session and Downtime boxes on the living sheet (round 5). Run from this dir:
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node session.js */
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
    const clipped = await p.evaluate(() => { const root = document.getElementById('dossier'); const R = root.getBoundingClientRect(); const out = []; root.querySelectorAll('.ds-box, .ds-roll, .ds-roll *, button, input').forEach(n => { const r = n.getBoundingClientRect(), sheet = n.closest('.ds-roll'), fx = !!sheet && getComputedStyle(sheet).position === 'fixed', lo = fx ? 0 : R.left, hi = fx ? innerWidth : R.right; /* a phone's bottom sheet spans the screen */ if (r.width && (r.right > hi + 1 || r.left < lo - 1)) out.push(n.className + ' ' + Math.round(r.left) + '-' + Math.round(r.right) + ' vs ' + Math.round(R.right)); }); return out.slice(0, 5); });
    if (clipped.length) errs.push(name + ' elements outside the dossier: ' + clipped.join(' | '));
  };
  const play = (p) => p.evaluate(() => B68Tracker.play());
  const stored = (p) => p.evaluate(() => { const id = Object.keys(window.__store)[0]; return window.__store[id].play; });
  const writes = (p) => p.evaluate(() => window.__writes.length);
  const has = (p, sel) => p.$(sel).then(x => !!x);
  const text = (p, sel) => p.$eval(sel, n => n.textContent).catch(() => null);
  const click = async (p, sel) => { const h = await p.$(sel); if (!h) { fails.push('missing ' + sel); return false; } await h.click(); await p.waitForTimeout(150); return true; };
  const shot = async (p, sel, path) => { const h = await p.$(sel); if (h) await h.screenshot({ path }); else fails.push('no element to shoot: ' + sel); };
  /* clicks one control and checks it caused exactly one write */
  const once = async (p, sel, what) => { const w0 = await writes(p); await click(p, sel); await p.waitForTimeout(150); const w1 = await writes(p); assert(w1 - w0 === 1, what + ': one save (' + (w1 - w0) + ')'); };
  const ATTRS = { Insight: ['Hunt', 'Study', 'Survey', 'Tinker'], Prowess: ['Finesse', 'Prowl', 'Skirmish', 'Wreck'], Resolve: ['Attune', 'Command', 'Consort', 'Sway'] };
  const lowest = (dots) => Math.min.apply(null, Object.keys(ATTRS).map(a => ATTRS[a].filter(x => (dots[x] || 0) > 0).length));

  /* ---------- Hound: session, key hits, end of session, downtime ---------- */
  {
    const p = await open(1360, 900, 'hound', 'hound');
    const keys = await p.evaluate(() => Object.keys(B68Tracker).sort().join(','));
    assert(keys === '_rng,close,initialPlay,isOpen,open,play,refresh,renderStatic,update', 'hound: public surface unchanged: ' + keys);
    let s = await stored(p);
    assert(s.session === 0 && JSON.stringify(s.keyHitSession) === '{}' && s.trainedThisDowntime === false, 'hound: new fields seeded ' + JSON.stringify([s.session, s.keyHitSession, s.trainedThisDowntime]));
    assert(await has(p, '#dossier .ds-c2 .ds-sessbox') && await has(p, '#dossier .ds-c2 .ds-dtbox'), 'hound: Session and Downtime boxes in column 2');
    assert((await text(p, '#dossier [data-act="sessstart"]')) === 'Start session 1', 'hound: start label ' + (await text(p, '#dossier [data-act="sessstart"]')));
    /* start session 1 */
    await once(p, '#dossier [data-act="sessstart"]', 'start session');
    s = await stored(p);
    assert(s.session === 1 && s.log[0].kind === 'note' && s.log[0].text === 'Session 1 started' && typeof s.log[0].at === 'string', 'hound: session 1 started ' + JSON.stringify([s.session, s.log[0]]));
    assert((await text(p, '#dossier [data-act="sessstart"]')) === 'Start session 2', 'hound: label moves on');
    /* a key hit: +1 xp, flagged for this session; a second hit on the same key this session gives no xp */
    const xp0 = s.xp.playbook;
    await once(p, '#dossier .ds-pip[data-act="keyhit"][data-i="0"][data-n="1"]', 'key hit');
    s = await stored(p);
    assert(s.keys[0].hits === 1 && s.xp.playbook === xp0 + 1 && s.keyHitSession['0'] === true, 'hound: key hit flagged ' + JSON.stringify([s.keys[0].hits, s.xp.playbook, s.keyHitSession]));
    assert(await has(p, '#dossier .ds-key .ds-hitnow'), 'hound: key shows "hit this session"');
    await click(p, '#dossier .ds-pip[data-act="keyhit"][data-i="0"][data-n="2"]');
    s = await stored(p); assert(s.keys[0].hits === 2 && s.xp.playbook === xp0 + 1, 'hound: second hit same session, no xp ' + JSON.stringify([s.keys[0].hits, s.xp.playbook]));
    /* end of session: two triggers at 1 and 2 → +3 */
    await click(p, '#dossier [data-act="endopen"]');
    assert(await has(p, '#dossier .ds-sessbox .ds-endp'), 'hound: end panel under the Session box');
    const rows = await p.$$eval('#dossier .ds-endrow', ns => ns.map(n => n.firstChild.textContent));
    notes.push('hound triggers: ' + rows.join(' | '));
    assert(rows.length === 2 && /^You addressed a challenge with violence or discipline\.$|^You addressed a challenge with/.test(rows[0]) && /deadlock/.test(rows[1]), 'hound: trigger rows ' + rows.join(' | '));
    const xpBoxLines = await p.$$eval('#dossier .ds-trig li:not(.ds-trig-h)', ns => ns.slice(2).map(n => n.textContent));
    assert(JSON.stringify(xpBoxLines) === JSON.stringify(rows), 'hound: panel lists the XP box lines ' + JSON.stringify(xpBoxLines));
    await click(p, '#dossier [data-act="endval"][data-i="0"][data-v="1"]');
    await click(p, '#dossier [data-act="endval"][data-i="1"][data-v="2"]');
    assert((await text(p, '#dossier .ds-endp .ds-roll-big')) === '+3 xp', 'hound: total ' + (await text(p, '#dossier .ds-endp .ds-roll-big')));
    assert(/clears this session’s key hits \(1 key\)/.test(await text(p, '#dossier .ds-endp')), 'hound: says key hits clear');
    await shot(p, '#dossier .ds-sessbox', 'out/session-desk-panel.png');
    await once(p, '#dossier [data-act="endmark"]', 'end session');
    s = await stored(p);
    assert(s.xp.playbook === xp0 + 4, 'hound: playbook xp +3 after the key hit: ' + s.xp.playbook);
    assert(JSON.stringify(s.keyHitSession) === '{}', 'hound: key hit flag cleared ' + JSON.stringify(s.keyHitSession));
    assert(s.keys[0].hits === 2, 'hound: the key marks stay');
    assert(s.log[0].kind === 'note' && /^Session 1 ended: \+3 xp \(addressed a challenge with .+; struggled with issues stemming from a deadlock ×2\)$/.test(s.log[0].text), 'hound: end log ' + s.log[0].text);
    assert(!(await has(p, '#dossier .ds-key .ds-hitnow')), 'hound: "hit this session" gone');
    assert(/Applied/.test(await text(p, '#dossier .ds-endp .ds-roll-applied')) && !(await has(p, '#dossier [data-act="endmark"]')), 'hound: end panel shows the result once');
    await shot(p, '#dossier .ds-sessbox', 'out/session-desk-ended.png');
    /* the same key can earn xp again next session */
    await click(p, '#dossier [data-act="sessstart"]');
    await click(p, '#dossier .ds-pip[data-act="keyhit"][data-i="0"][data-n="3"]');
    s = await stored(p); assert(s.session === 2 && s.xp.playbook === xp0 + 5 && s.keyHitSession['0'] === true, 'hound: next session key hit pays again ' + JSON.stringify([s.session, s.xp.playbook, s.keyHitSession]));
    /* the cap: 5 + 4 → 8, 1 lost, advance pointer */
    await click(p, '#dossier [data-act="endopen"]');
    await click(p, '#dossier [data-act="endval"][data-i="0"][data-v="2"]'); await click(p, '#dossier [data-act="endval"][data-i="1"][data-v="2"]');
    assert(/1 lost to the cap/.test(await text(p, '#dossier .ds-endp .ds-roll-go')), 'hound: preview says 1 lost: ' + (await text(p, '#dossier .ds-endp .ds-roll-go')));
    await click(p, '#dossier [data-act="endmark"]');
    s = await stored(p);
    assert(s.xp.playbook === 8 && /^Session 2 ended: \+4 xp .* · 1 lost to the cap$/.test(s.log[0].text), 'hound: capped ' + s.xp.playbook + ' ' + s.log[0].text);
    assert(/Special abilities box/.test(await text(p, '#dossier .ds-endfull')), 'hound: points at the advance: ' + (await text(p, '#dossier .ds-endfull')));
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    assert(!(await has(p, '#dossier .ds-endp')), 'hound: Esc closes the end panel');

    /* ---- downtime: indulge vice ---- */
    s = await stored(p);
    const lo = lowest(s.dots); notes.push('hound lowest attribute rating ' + lo);
    await click(p, '#dossier .ds-sbox[data-n="5"]');
    await click(p, '#dossier [data-act="dtopen"][data-k="indulge"]');
    assert(await has(p, '#dossier .ds-dtbox .ds-dt'), 'hound: indulge panel under the Downtime box');
    assert((await text(p, '#dossier .ds-dt .ds-roll-big')) === lo + 'd', 'hound: indulge rolls the lowest rating ' + (await text(p, '#dossier .ds-dt .ds-roll-big')));
    await p.evaluate(RNG([4, 1, 1, 1]));
    await once(p, '#dossier .ds-dt [data-act="dtroll"]', 'indulge');
    s = await stored(p);
    const hi1 = lo === 0 ? 1 : 4; /* 0 dice: 2d take the lowest of 4,1 */
    assert(s.stress === 5 - hi1, 'hound: indulge cleared ' + hi1 + ': stress ' + s.stress);
    assert(s.log[0].kind === 'roll' && s.log[0].text === 'Indulge vice ' + (lo || 0) + 'd' + (lo ? '' : ' (2d take lowest)') + ' · ' + [4, 1, 1, 1].slice(0, lo || 2).join(',') + ' → clear ' + hi1 + ' Stress (5 → ' + (5 - hi1) + ')', 'hound: indulge log ' + s.log[0].text);
    assert(!(await has(p, '#dossier .ds-over')), 'hound: no overindulge when it fits');
    await p.evaluate(RNG([6, 6, 6, 6]));
    await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    s = await stored(p);
    assert(s.stress === 0 && /overindulge/.test(s.log[0].text), 'hound: overindulge clears to 0 ' + s.stress + ' ' + s.log[0].text);
    assert((await text(p, '#dossier .ds-over')) === 'Overindulge: tell the GM.', 'hound: overindulge shown');
    /* ---- recover: the healing clock and harm stepping down ---- */
    await p.fill('#dossier [data-path="harm.l3"]', 'Broken ribs'); await p.fill('#dossier [data-path="harm.l2.0"]', 'Twisted ankle'); await p.fill('#dossier [data-path="harm.l1.0"]', 'Bruised'); await p.waitForTimeout(700);
    await click(p, '#dossier .ds-seg[data-act="heal"][data-n="2"]');
    s = await stored(p); assert(s.healing === 2 && s.harm.l3 === 'Broken ribs', 'hound: harm and healing set ' + JSON.stringify([s.healing, s.harm]));
    await click(p, '#dossier [data-act="dtopen"][data-k="recover"]');
    assert(!(await has(p, '#dossier .ds-over')) && (await p.$$eval('#dossier .ds-roll', ns => ns.length)) === 1, 'hound: one panel at a time');
    await click(p, '#dossier [data-act="dtopt"][data-k="who"][data-v="healer"]');
    await click(p, '#dossier [data-act="dtopt"][data-k="n"][data-v="2"]');
    await p.evaluate(RNG([5, 3]));
    await once(p, '#dossier .ds-dt [data-act="dtroll"]', 'recover');
    s = await stored(p);
    assert(s.healing === 0 && s.harm.l3 === '' && s.harm.l2[0] === 'Broken ribs' && s.harm.l2[1] === '' && s.harm.l1[0] === 'Twisted ankle' && s.harm.l1[1] === '', 'hound: 2 + 2 fills the clock and steps harm down ' + JSON.stringify([s.healing, s.harm]));
    assert(s.log[0].kind === 'roll' && s.log[0].text === 'Recover (a healer) 2d · 5,3 → partial, +2 healing, clock filled: harm steps down (0 / 4)', 'hound: recover log ' + s.log[0].text);
    /* yourself, 0 dots in Tinker: 2d take lowest, 1–3 one tick */
    await click(p, '#dossier [data-act="dtopt"][data-k="who"][data-v="self"]');
    const tinker = s.dots.Tinker || 0;
    await click(p, '#dossier [data-act="dtopt"][data-k="action"][data-v="Tinker"]');
    await p.evaluate(RNG([3, 3, 3, 3])); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    s = await stored(p); assert(s.healing === 1 && s.log[0].text === 'Recover (Tinker) ' + tinker + 'd' + (tinker ? '' : ' (2d take lowest)') + ' · ' + Array(tinker || 2).fill(3).join(',') + ' → failure, +1 healing (1 / 4)', 'hound: self recover ' + s.healing + ' ' + s.log[0].text);
    /* 4–5 two ticks, 6 three, critical five (overflow kept) */
    await click(p, '#dossier [data-act="dtopt"][data-k="who"][data-v="healer"]'); await click(p, '#dossier [data-act="dtopt"][data-k="n"][data-v="1"]');
    await p.evaluate(RNG([6])); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    s = await stored(p); assert(s.healing === 0 && s.harm.l2[0] === '' && s.harm.l1[0] === 'Broken ribs' && s.harm.l1[1] === '', 'hound: a 6 is three ticks, 1 + 3 fills again ' + JSON.stringify([s.healing, s.harm]));
    await click(p, '#dossier [data-act="dtopt"][data-k="n"][data-v="3"]');
    await p.evaluate(RNG([6, 6, 2])); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    s = await stored(p); assert(s.healing === 1 && s.harm.l1[0] === '' && /critical, \+5 healing, clock filled/.test(s.log[0].text), 'hound: critical is five ticks, overflow kept ' + s.healing + ' ' + s.log[0].text);
    await p.evaluate(RNG([4])); await click(p, '#dossier [data-act="dtopt"][data-k="n"][data-v="1"]'); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    s = await stored(p); assert(s.healing === 3, 'hound: 4 is two ticks ' + s.healing);
    await shot(p, '#dossier .ds-dtbox', 'out/session-desk-downtime-recover.png');
    /* ---- long-term project on a new clock ---- */
    const nClocks = s.clocks.length;
    await click(p, '#dossier [data-act="dtopen"][data-k="project"]');
    assert((await p.$eval('#dossier [data-act="dtopt"][data-k="clock"][data-v="new"]', n => n.getAttribute('aria-pressed'))) === 'true', 'hound: no clocks yet → new clock');
    await p.fill('#dossier .ds-newproj', 'Build a still');
    await click(p, '#dossier [data-act="dtopt"][data-k="size"][data-v="6"]');
    assert((await p.$eval('#dossier .ds-newproj', n => n.value)) === 'Build a still', 'hound: typed name survives a re-render');
    await click(p, '#dossier [data-act="dtopt"][data-k="action"][data-v="Hunt"]');
    const hunt = s.dots.Hunt;
    assert((await text(p, '#dossier .ds-dt .ds-roll-big')) === hunt + 'd', 'hound: project dice = Hunt ' + hunt);
    await p.evaluate(RNG([6, 1, 1, 1]));
    await once(p, '#dossier .ds-dt [data-act="dtroll"]', 'project');
    s = await stored(p);
    const c = s.clocks[nClocks];
    assert(s.clocks.length === nClocks + 1 && c && c.name === 'Build a still' && c.size === 6 && c.filled === 3, 'hound: new clock ticked 3 ' + JSON.stringify(s.clocks));
    assert(s.log[0].kind === 'roll' && s.log[0].text === 'Long-term project “Build a still” (Hunt) ' + hunt + 'd · ' + [6, 1, 1, 1].slice(0, hunt).join(',') + ' → success, +3 (3 / 6)', 'hound: project log ' + s.log[0].text);
    await shot(p, '#dossier .ds-dtbox', 'out/session-desk-downtime.png');
    await p.evaluate(RNG([6, 6, 1, 1])); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    s = await stored(p); assert(s.clocks.length === nClocks + 1 && s.clocks[nClocks].filled === 6 && /, complete$/.test(s.log[0].text), 'hound: same clock completes (no second clock) ' + JSON.stringify(s.clocks) + ' ' + s.log[0].text);
    /* ---- train: once per downtime ---- */
    await click(p, '#dossier [data-act="dtopen"][data-k="train"]');
    const pr0 = s.xp.prowess;
    await click(p, '#dossier [data-act="dtopt"][data-k="track"][data-v="prowess"]');
    await once(p, '#dossier [data-act="dttrain"]', 'train');
    s = await stored(p);
    assert(s.xp.prowess === pr0 + 1 && s.trainedThisDowntime === true && s.log[0].kind === 'roll' && s.log[0].text === 'Train Prowess · +1 xp (' + (pr0 + 1) + ' / 6)', 'hound: trained ' + JSON.stringify([s.xp.prowess, s.trainedThisDowntime, s.log[0]]));
    await click(p, '#dossier [data-act="dtopt"][data-k="track"][data-v="insight"]');
    assert(await p.$eval('#dossier [data-act="dttrain"]', n => n.disabled) && /Already trained this downtime/.test(await text(p, '#dossier .ds-trained')), 'hound: second train refused');
    const w0 = await writes(p); await p.evaluate(() => { const b = document.querySelector('#dossier [data-act="dttrain"]'); b.disabled = false; b.click(); }); await p.waitForTimeout(150);
    s = await stored(p); assert((await writes(p)) === w0 && s.xp.insight === 0, 'hound: forced second train still refused');
    assert(await p.$eval('#dossier [data-act="dtopt"][data-k="track"][data-v="playbook"]', n => n.disabled), 'hound: full playbook track cannot be trained');
    await click(p, '#dossier [data-act="sessstart"]');
    s = await stored(p); assert(s.session === 3 && s.trainedThisDowntime === false, 'hound: start session clears training');
    assert(await has(p, '#dossier .ds-dt') && !(await has(p, '#dossier .ds-trained')) && !(await p.$eval('#dossier [data-act="dttrain"]', n => n.disabled)), 'hound: the open Train panel is live again after Start session');
    await click(p, '#dossier [data-act="dttrain"]');
    s = await stored(p); assert(s.xp.insight === 1 && s.trainedThisDowntime === true, 'hound: train allowed again after the next session start');
    /* a roll panel closes the downtime panel */
    await click(p, '#dossier .ds-actbtn[data-a="Hunt"]');
    assert(!(await has(p, '#dossier .ds-dt')) && (await p.$$eval('#dossier .ds-roll', ns => ns.length)) === 1, 'hound: roll panel replaces the downtime panel');
    await click(p, '#dossier .ds-roll-x');

    /* ---- removing a key re-indexes the per-session flags ---- */
    await click(p, '#dossier .ds-pip[data-act="keyhit"][data-i="2"][data-n="1"]');
    s = await stored(p); assert(s.keyHitSession['2'] === true, 'hound: key 2 hit');
    await click(p, '#dossier [data-act="rmkey"][data-i="0"]');
    s = await stored(p); assert(JSON.stringify(s.keyHitSession) === '{"1":true}', 'hound: flags follow the keys ' + JSON.stringify(s.keyHitSession));

    /* ---- an older document without the new fields opens unchanged ---- */
    const old = await p.evaluate(() => { const id = Object.keys(window.__store)[0]; const d = JSON.parse(JSON.stringify(window.__store[id])); delete d.play.session; delete d.play.keyHitSession; delete d.play.trainedThisDowntime; window.__oldSaves = 0; B68Tracker.open(Object.assign({ id }, d), { save: () => { window.__oldSaves++; return Promise.resolve(); }, canWrite: true }); const pl = B68Tracker.play(); return { s: pl.session, k: pl.keyHitSession, t: pl.trainedThisDowntime, saves: window.__oldSaves, label: document.querySelector('#dossier [data-act="sessstart"]').textContent }; });
    assert(old.s === 0 && JSON.stringify(old.k) === '{}' && old.t === false && old.saves === 0 && old.label === 'Start session 1', 'hound: older doc defaults ' + JSON.stringify(old));

    /* ---- read only: downtime rolls happen, nothing is written ---- */
    const roBefore = await p.evaluate(() => { const id = Object.keys(window.__store)[0]; const d = JSON.parse(JSON.stringify(window.__store[id])); d.play.stress = 4; window.__roSaves = 0; B68Tracker.open(Object.assign({ id }, d), { save: () => { window.__roSaves++; return Promise.resolve(); }, canWrite: false }); return B68Tracker.play(); });
    assert(await p.$eval('#dossier [data-act="sessstart"]', n => n.disabled) && await p.$eval('#dossier [data-act="endopen"]', n => n.disabled), 'ro: session buttons disabled');
    assert(!(await p.$eval('#dossier [data-act="dtopen"][data-k="indulge"]', n => n.disabled)), 'ro: downtime buttons live');
    await click(p, '#dossier [data-act="dtopen"][data-k="indulge"]'); await p.evaluate(RNG([2, 2, 2])); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    assert(/Not saved \(read only\)/.test(await text(p, '#dossier .ds-dt .ds-roll-applied')), 'ro: indulge not saved: ' + (await text(p, '#dossier .ds-dt .ds-roll-applied')));
    await click(p, '#dossier [data-act="dtopen"][data-k="project"]'); await p.fill('#dossier .ds-newproj', 'Read-only clock'); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    assert(/Not saved \(read only\)/.test(await text(p, '#dossier .ds-dt .ds-roll-applied')), 'ro: project not saved');
    await click(p, '#dossier [data-act="dtopen"][data-k="recover"]'); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    await click(p, '#dossier [data-act="dtopen"][data-k="train"]');
    assert(await p.$eval('#dossier [data-act="dttrain"]', n => n.disabled), 'ro: train disabled');
    const roAfter = await play(p), roSaves = await p.evaluate(() => window.__roSaves);
    assert(JSON.stringify(roAfter) === JSON.stringify(roBefore) && roSaves === 0, 'ro: nothing changed or saved (' + roSaves + ' saves)');
    notes.push('hound dialogs: ' + p.__dialogs.join(' / '));
    await p.context().close();
  }

  /* ---------- the table's session (api.table, wired by boot from campaign/main): Join, End uses the table's number ---------- */
  {
    const p = await open(1360, 900, 'table', 'hound');
    const camp = (session) => p.evaluate((s) => window.claude.use('db').then(db => db.collection('campaign').doc('main').set({ v: 1, session: s, crew: {}, clocks: [], log: [], updatedAt: new Date().toISOString() })), session);
    assert(await has(p, '#dossier [data-act="sessstart"]') && !(await has(p, '#dossier .ds-tablebar')), 'table: no table, the manual start stays');
    await camp({ number: 3, startedAt: new Date().toISOString(), endedAt: null }); await p.waitForTimeout(250);
    assert((await text(p, '#dossier .ds-tablebar .ds-tbline b')) === 'Table: session 3 · in play', 'table: bar names the table’s session: ' + (await text(p, '#dossier .ds-tablebar')));
    assert((await text(p, '#dossier [data-act="sessjoin"]')) === 'Join session 3' && await p.$eval('#dossier [data-act="sessjoin"]', n => n.classList.contains('primary')), 'table: one primary Join session 3');
    assert(!(await has(p, '#dossier [data-act="sessstart"]')), 'table: the manual start is gone while there is a table');
    assert((await text(p, '#dossier [data-act="endopen"]')) === 'End session 3', 'table: End session uses the table’s number: ' + (await text(p, '#dossier [data-act="endopen"]')));
    assert(/Table: session 3 · in play/.test(await text(p, '#dossier .ds-sessnote')), 'table: Session box says where the table is');
    await once(p, '#dossier [data-act="sessjoin"]', 'join session');
    let s = await stored(p);
    assert(s.session === 3 && s.log[0].kind === 'note' && s.log[0].text === 'Session 3 started' && s.trainedThisDowntime === false, 'table: joined session 3 ' + JSON.stringify([s.session, s.log[0]]));
    assert(!(await has(p, '#dossier [data-act="sessjoin"]')) && (await text(p, '#dossier .ds-tablebar .ds-tbline b')) === 'Table: session 3 · in play', 'table: caught up, no Join');
    await click(p, '#dossier [data-act="endopen"]');
    assert(/End of session · 3/.test(await text(p, '#dossier .ds-endp .ds-roll-t')) && /^Ends session 3: /.test(await text(p, '#dossier .ds-endp .ds-roll-body p.hint:last-child')), 'table: panel ends session 3: ' + (await text(p, '#dossier .ds-endp .ds-roll-body p.hint:last-child')));
    await click(p, '#dossier [data-act="endval"][data-i="0"][data-v="1"]');
    await once(p, '#dossier [data-act="endmark"]', 'end session 3');
    s = await stored(p);
    assert(/^Session 3 ended: \+1 xp/.test(s.log[0].text), 'table: end log ' + s.log[0].text);
    assert(/then join the next session when the GM starts it\./.test(await text(p, '#dossier .ds-endp')), 'table: points at joining, not a manual start');
    /* the GM ends 3 and starts 4 at the table; the player ends it without joining first: the sheet follows the table */
    await camp({ number: 3, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() }); await p.waitForTimeout(250);
    assert((await text(p, '#dossier .ds-tablebar .ds-tbline b')) === 'Table: session 3 · ended', 'table: ended: ' + (await text(p, '#dossier .ds-tablebar')));
    await camp({ number: 4, startedAt: new Date().toISOString(), endedAt: null }); await p.waitForTimeout(250);
    assert((await text(p, '#dossier [data-act="sessjoin"]')) === 'Join session 4' && /This sheet is on session 3/.test(await text(p, '#dossier .ds-tablebar')), 'table: ahead again: ' + (await text(p, '#dossier .ds-tablebar')));
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    await click(p, '#dossier [data-act="endopen"]');
    assert(/this sheet is on 3/.test(await text(p, '#dossier .ds-endp')), 'table: panel says the sheet is behind');
    await click(p, '#dossier [data-act="endmark"]');
    s = await stored(p);
    assert(s.session === 4 && /^Session 4 ended: \+0 xp/.test(s.log[0].text) && !(await has(p, '#dossier [data-act="sessjoin"]')), 'table: ended the table’s session 4 ' + JSON.stringify([s.session, s.log[0].text]));
    /* a table that has not started a session: no manual start, End session waits for the GM */
    await camp({ number: 0, startedAt: null, endedAt: null }); await p.waitForTimeout(250);
    assert(!(await has(p, '#dossier .ds-tablebar')) && !(await has(p, '#dossier [data-act="sessstart"]')) && await p.$eval('#dossier [data-act="endopen"]', n => n.disabled) && /The GM starts sessions/.test(await text(p, '#dossier .ds-sessnote')), 'table: session 0 at the table');
    await shot(p, '#dossier .ds-sessbox', 'out/session-table.png');
    await p.context().close();
  }

  /* ---------- Hull: Repair, no Indulge, xp into a memory clock ---------- */
  {
    const p = await open(1360, 900, 'hull', 'hull');
    assert(!(await has(p, '#dossier [data-act="dtopen"][data-k="indulge"]')), 'hull: no Indulge button');
    assert((await text(p, '#dossier [data-act="dtopen"][data-k="recover"]')) === 'Repair', 'hull: Recover says Repair');
    assert(/Recharge −5/.test(await text(p, '#dossier .ds-dtbox')), 'hull: points at Recharge');
    await click(p, '#dossier [data-act="dtopen"][data-k="recover"]');
    assert(/Repair/.test(await text(p, '#dossier .ds-dt .ds-roll-t')) && /A mechanic/.test(await text(p, '#dossier .ds-dt')), 'hull: repair panel');
    await click(p, '#dossier [data-act="dtopt"][data-k="who"][data-v="healer"]'); await click(p, '#dossier [data-act="dtopt"][data-k="n"][data-v="1"]');
    await p.evaluate(RNG([5])); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    let s = await stored(p); assert(s.healing === 2 && /^Repair \(a mechanic\) 1d · 5 → partial, \+2 repair \(2 \/ 4\)$/.test(s.log[0].text), 'hull: repair log ' + s.log[0].text);
    await shot(p, '#dossier .ds-dtbox', 'out/session-hull-downtime.png');
    await click(p, '#dossier [data-act="sessstart"]');
    await click(p, '#dossier [data-act="endopen"]');
    const rows = await p.$$eval('#dossier .ds-endrow', ns => ns.map(n => n.firstChild.textContent));
    assert(rows.length === 2 && /^You obeyed orders, or addressed a challenge with cold simplicity\.$/.test(rows[0]), 'hull: triggers ' + rows.join(' | '));
    assert(await has(p, '#dossier [data-act="endtarget"][data-v="0"]'), 'hull: memory clock choice offered');
    await click(p, '#dossier [data-act="endval"][data-i="0"][data-v="2"]'); await click(p, '#dossier [data-act="endval"][data-i="1"][data-v="1"]');
    await click(p, '#dossier [data-act="endtarget"][data-v="0"]');
    await shot(p, '#dossier .ds-sessbox', 'out/session-hull-panel.png');
    const xp0 = s.xp.playbook;
    await once(p, '#dossier [data-act="endmark"]', 'hull end session');
    s = await stored(p);
    assert(s.memories[0].filled === 3 && s.xp.playbook === xp0, 'hull: 3 xp went into memory 1 ' + JSON.stringify([s.memories[0].filled, s.xp.playbook]));
    assert(/^Session 1 ended: \+3 xp \(.+\) · 3 to memory 1$/.test(s.log[0].text), 'hull: end log ' + s.log[0].text);
    await p.context().close();
  }

  /* ---------- the paranormal four: replacements, no Indulge; Vampire cannot Recover ---------- */
  {
    const p = await open(1360, 900, 'para', 'hound');
    for (const [pb, want] of [['ghost', /Consume/], ['vampire', /Feed/], ['timetraveler', /Restabilize/], ['timepast', /Restabilize/]]) {
      await p.evaluate((pb) => B68Tracker.open({ id: 'x-' + pb, playbook: pb, name: 'Test ' + pb, sheet: { playbook: pb } }, { save: () => Promise.resolve(), canWrite: true }), pb);
      await p.waitForTimeout(100);
      assert(!(await has(p, '#dossier [data-act="dtopen"][data-k="indulge"]')), pb + ': no Indulge');
      assert(want.test(await text(p, '#dossier .ds-dtbox')), pb + ': names its replacement');
      const rec = await has(p, '#dossier [data-act="dtopen"][data-k="recover"]');
      assert(pb === 'vampire' ? !rec && /cannot Recover/.test(await text(p, '#dossier .ds-dtbox')) : rec, pb + ': recover ' + rec);
      await click(p, '#dossier [data-act="endopen"]');
      const rows = await p.$$eval('#dossier .ds-endrow', ns => ns.map(n => n.firstChild.textContent));
      const want2 = await p.evaluate((pb) => B68Content.byId[pb].xpTriggers, pb);
      assert(JSON.stringify(rows) === JSON.stringify(want2), pb + ': end panel lists pb.xpTriggers ' + JSON.stringify(rows));
    }
    await p.context().close();
  }

  /* ---------- phone and dark: layout and screenshots ---------- */
  for (const [w, h, scheme, tag] of [[390, 860, 'light', 'phone'], [390, 860, 'dark', 'phone-dark'], [1360, 900, 'dark', 'desk-dark']]) {
    const p = await open(w, h, tag, 'hound', scheme);
    await click(p, '#dossier [data-act="sessstart"]');
    await click(p, '#dossier .ds-pip[data-act="keyhit"][data-i="0"][data-n="1"]');
    await click(p, '#dossier [data-act="endopen"]');
    await click(p, '#dossier [data-act="endval"][data-i="0"][data-v="1"]'); await click(p, '#dossier [data-act="endval"][data-i="1"][data-v="2"]');
    await overflow(p, tag + ' end panel');
    await shot(p, '#dossier .ds-sessbox', 'out/session-' + tag + '-panel.png');
    if (w < 760) await click(p, '#dossier .ds-endp .ds-roll-x');   /* on a phone the panel is a bottom sheet over the page: closed before the next tap */
    await click(p, '#dossier .ds-sbox[data-n="6"]');
    await click(p, '#dossier [data-act="dtopen"][data-k="indulge"]'); await p.evaluate(RNG([6, 6, 6])); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    await overflow(p, tag + ' indulge');
    await shot(p, '#dossier .ds-dtbox', 'out/session-' + tag + '-indulge.png');
    await click(p, '#dossier [data-act="dtopen"][data-k="project"]'); await p.fill('#dossier .ds-newproj', 'Restore the Zephyr'); await p.evaluate(RNG([5, 2, 2])); await click(p, '#dossier .ds-dt [data-act="dtroll"]');
    await overflow(p, tag + ' project');
    await shot(p, '#dossier .ds-dtbox', 'out/session-' + tag + '-downtime.png');
    await p.context().close();
  }

  /* ---------- print: both boxes hidden ---------- */
  {
    const p = await open(1360, 900, 'print', 'hound');
    await click(p, '#dossier [data-act="dtopen"][data-k="recover"]');
    await p.emulateMedia({ media: 'print' });
    const vis = await p.evaluate(() => ['.ds-sessbox', '.ds-dtbox', '.ds-dt'].map(s => { const n = document.querySelector('#dossier ' + s); return s + ':' + (n ? getComputedStyle(n).display : 'none'); }).join(' '));
    assert(/\.ds-sessbox:none/.test(vis) && /\.ds-dtbox:none/.test(vis), 'print: ' + vis);
    await p.context().close();
  }

  console.log('NOTES:\n' + notes.join('\n'));
  console.log('FAILS:', fails.length ? '\n' + fails.join('\n') : 'none');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await b.close();
  process.exit(fails.length || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
