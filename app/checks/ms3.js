process.chdir(__dirname);
/* Headless check of the sheet's keyed redraw (MS3): a tap replaces its own box and the vitals and nothing else; a redraw
   with nothing changed touches no node; focus, scroll and the drawn figure survive; a read-only sheet stays disabled; print
   still draws the figure. Run from this dir: PW_MODULE=... node ms3.js   (MS3_APP=<dir> points it at another build of app/) */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const path = require('path');
const APP = process.env.MS3_APP ? path.resolve(process.env.MS3_APP) : path.resolve(__dirname, '..');
const URL = 'file://' + path.join(APP, 'index.html').replace(/\\/g, '/');
(async () => {
  const b = await chromium.launch();
  const errs = [], fails = [], info = [];
  function assert(ok, msg) { if (!ok) fails.push(msg); }
  async function open(w, canWrite, name) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    p.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push(name + ' console.error: ' + m.text()); });
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    await p.goto(URL); await p.waitForTimeout(700);
    const r = await p.evaluate((canWrite) => {
      try {
        const pb = 'hound'; B68.choosePlaybook(pb);
        const sh = B68.S.sheet; sh.name = 'Slot Sam'; sh.alias = 'Tock'; sh.heritage = 'Hillfolk'; sh.background = 'Quarry hand'; sh.look = 'Lean, weathered.'; sh.wearing = ['Trench coat'];
        const P = B68Content.byId[pb]; sh.ability = P.abilities[0][0]; sh.keys = P.keys.slice(0, 3); sh.customKey = 'Hopeful (▼ Cynical ▲ Content)';
        if (P.contacts[0]) sh.contacts[P.contacts[0][0]] = 'friend'; sh.vice = 'Gambling'; sh.purveyor = 'A card game'; sh.items = [P.items[0][0], 'A Blade or Two'];
        sh.cohortName = 'Biscuit'; sh.cohortType = 'hound dog'; sh.cohortEdges = 'Loyal'; sh.cohortFlaws = 'Greedy';
        const play = B68Tracker.initialPlay(sh, pb); window.saves = 0;
        window.api = { save: () => { window.saves++; return Promise.resolve(); }, edit() {}, back() {}, remove() { return Promise.resolve(); }, me: null, canWrite };
        window.doc = { id: 't1', name: sh.name, alias: sh.alias, playbook: pb, playbookName: P.name, code: P.prefix + '-968-1234', spec: B68.S.spec, sheet: sh, play };
        B68Tracker.open(window.doc, window.api);
        document.body.dataset.mode = 'sheet'; document.getElementById('dossier').hidden = false;
        const st = document.querySelector('.studio'); if (st) st.hidden = true; const cr = document.querySelector('.crew'); if (cr) cr.hidden = true;
        /* a recorder: every DOM mutation under #dossier, labelled with the box(es) it fell in */
        window.rec = []; const root = document.getElementById('dossier');
        const lab = (n) => { if (!n || n.nodeType !== 1) return null; if (n.id === 'ds-status') return 'status'; const c = n.closest ? n.closest('#ds-status, .ds-vitals, .ds-box, .ds-head, .ds-tablebar') : null; if (!c) return null; if (c.id === 'ds-status') return 'status'; if (c.classList.contains('ds-vitals')) return 'vitals'; if (c.classList.contains('ds-box')) return c.className.split(' ').pop().replace(/^ds-/, ''); return c.classList.contains('ds-head') ? 'head' : 'bar'; };
        const toRec = (m) => { const set = new Set(); const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (m.type === 'childList' && (t === root || (t && (t.classList.contains('ds-col') || t.classList.contains('ds-bar') || t.classList.contains('ds-grid'))))) { /* a box moved in or out of its column */ m.addedNodes.forEach(n => set.add(lab(n) || (n.nodeType === 1 ? n.className : '#' + n.nodeName))); m.removedNodes.forEach(n => set.add(lab(n) || (n.nodeType === 1 ? n.className : '#' + n.nodeName))); } else set.add(lab(t) || (t === root ? '(root)' : '(other)')); set.delete('#comment'); set.delete('#text'); return { type: m.type, slot: Array.from(set).join('+'), added: m.addedNodes.length, removed: m.removedNodes.length }; };
        window.mo = new MutationObserver((l) => { for (const m of l) window.rec.push(toRec(m)); });
        window.mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
        window.takeRec = () => { for (const m of window.mo.takeRecords()) window.rec.push(toRec(m)); const r = window.rec; window.rec = []; return r; };
        /* mark every box, the head and the table bar, to see which survive */
        window.markSlots = () => { document.querySelectorAll('#dossier .ds-box, #dossier .ds-head, #dossier .ds-tablebar').forEach(s => { s.__m = 1; }); };
        return { ok: true, open: B68Tracker.isOpen(), slots: document.querySelectorAll('#dossier .ds-box').length, wrappers: document.querySelectorAll('#dossier .ds-slot').length };
      } catch (e) { return { ok: false, err: e.message + '\n' + e.stack }; }
    }, canWrite);
    if (!r.ok) errs.push(name + ' open failed: ' + r.err);
    await p.waitForTimeout(300);
    return { p, r };
  }
  const settle = (p) => p.waitForTimeout(400);

  for (const [w, label] of [[1360, 'desk'], [390, 'phone']]) {
    const { p, r } = await open(w, true, label);
    assert(r.ok && r.open && r.slots >= 12 && r.wrappers === 0, label + ': the sheet opened, with no wrapper elements around its boxes: ' + JSON.stringify(r));
    await p.evaluate(() => { window.takeRec(); window.markSlots(); });
    /* 1. a tap on one stress box: only the stress box and the vitals are replaced */
    const sel = '#dossier .ds-stress .ds-sbox[data-n="3"]';
    await p.evaluate(() => { window.saves = 0; });
    await p.click(sel); await settle(p);
    const rec = await p.evaluate(() => window.takeRec());
    const slots = Array.from(new Set(rec.flatMap(x => x.slot.split('+')))).sort();
    const play = await p.evaluate(() => B68Tracker.play());
    assert(play.stress === 3, label + ': the tap landed (stress 3): ' + play.stress);
    assert(slots.every(s => ['stressbox', 'vitals', 'status'].indexOf(s) >= 0) && slots.indexOf('stressbox') >= 0 && slots.indexOf('vitals') >= 0, label + ': one tap touched only the stress box, the vitals and the status line: ' + JSON.stringify(slots));
    assert(rec.length <= 8, label + ': a tap is a handful of mutations, got ' + rec.length + ': ' + JSON.stringify(rec));
    info.push(label + ': mutations for one stress tap = ' + rec.length + ' (' + slots.join(', ') + '); removed ' + rec.reduce((a, x) => a + x.removed, 0) + ', added ' + rec.reduce((a, x) => a + x.added, 0));
    const surv = await p.evaluate(() => { const lost = []; document.querySelectorAll('#dossier .ds-box, #dossier .ds-head, #dossier .ds-tablebar').forEach(s => { if (!s.__m && !s.classList.contains('ds-stressbox')) lost.push(s.className); }); return lost; });
    assert(surv.length === 0, label + ': every other box kept its node: replaced ' + JSON.stringify(surv));
    assert((await p.evaluate(() => window.saves)) === 1, label + ': one tap = one write: ' + (await p.evaluate(() => window.saves)));
    assert(/Saved|Saving/.test(await p.textContent('#ds-status')), label + ': the status line is written: ' + (await p.textContent('#ds-status')));
    /* the status settles to the saved message, not a stale "Saving…" */
    await p.waitForTimeout(500);
    assert(!/Saving/.test(await p.textContent('#ds-status')), label + ': the status is not left on Saving…: ' + (await p.textContent('#ds-status')));
    /* a replaced box still takes taps, and once: three "Mark +1" taps are +3, three writes */
    await p.evaluate(() => { window.saves = 0; });
    for (let i = 0; i < 3; i++) { await p.click('#dossier [data-act="stressd"][data-d="1"]'); await settle(p); }
    const p2 = await p.evaluate(() => ({ s: B68Tracker.play().stress, saves: window.saves }));
    assert(p2.s === 6 && p2.saves === 3, label + ': a replaced box keeps its handler, once (stress ' + p2.s + ', writes ' + p2.saves + ')');
    /* a box that gains and loses rows keeps working: add a clock, then tick it */
    await p.fill('#dossier .ds-newclock', 'Slot clock'); await p.click('#dossier [data-act="addclock"][data-n="4"]'); await settle(p);
    assert((await p.evaluate(() => B68Tracker.play().clocks.length)) === 1, label + ': a clock was added');

    /* 2. a redraw with nothing changed touches no node; so does a poll that echoes our own write */
    await p.evaluate(() => { window.takeRec(); });
    await p.evaluate(() => B68Tracker.refresh()); await settle(p);
    const none = await p.evaluate(() => window.takeRec());
    assert(none.length === 0, label + ': refresh() with nothing changed made ' + none.length + ' mutations: ' + JSON.stringify(none.slice(0, 4)));
    await p.evaluate(() => { const d = Object.assign({}, window.doc, { play: B68Tracker.play() }); B68Tracker.update(d); }); await settle(p);
    const echo = await p.evaluate(() => window.takeRec());
    assert(echo.length === 0, label + ': a poll echoing the sheet’s own state made ' + echo.length + ' mutations');

    /* 3. focus, the caret, scroll and the typed text survive a poll that changes another box */
    await p.click('#dossier textarea[data-path="notes"]'); await p.keyboard.type('hello world'); await p.waitForTimeout(1500);
    await p.evaluate(() => { const t = document.querySelector('#dossier textarea[data-path="notes"]'); t.setSelectionRange(3, 3); window.__notes = t; window.scrollTo(0, 120); window.__sy = window.scrollY; window.takeRec(); });
    await p.evaluate(() => { const pl = B68Tracker.play(); pl.stress = 2; const d = Object.assign({}, window.doc, { play: pl }); B68Tracker.update(d); }); await settle(p);
    const fs = await p.evaluate(() => { const t = document.querySelector('#dossier textarea[data-path="notes"]'); return { same: t === window.__notes, active: document.activeElement === t, v: t.value, s: t.selectionStart, sy: window.scrollY, sy0: window.__sy, stress: B68Tracker.play().stress, rec: window.takeRec().flatMap(x => x.slot.split('+')) }; });
    assert(fs.stress === 2, label + ': the poll changed the stress box (so this test sees a real redraw): ' + fs.stress);
    assert(fs.same && fs.active && fs.v === 'hello world' && fs.s === 3, label + ': the focused field kept its node, text and caret: ' + JSON.stringify(fs));
    assert(Math.abs(fs.sy - fs.sy0) <= 1, label + ': scroll survived the poll: ' + fs.sy0 + ' -> ' + fs.sy);
    assert(fs.rec.every(s => ['stressbox', 'vitals', 'status'].indexOf(s) >= 0) && fs.rec.length > 0, label + ': the poll touched only the changed box: ' + JSON.stringify(Array.from(new Set(fs.rec))));

    /* 3b. a keystroke builds one box, not the sheet (a full build stringifies the figure's spec; one box does not), and the
       remembered markup still matches: the redraw after typing makes no mutations */
    await p.evaluate(() => { window.__sp = 0; const o = JSON.stringify; window.__js = o; JSON.stringify = function (v) { if (v === window.doc.spec) window.__sp++; return o.apply(this, arguments); }; });
    await p.click('#dossier textarea[data-path="notes"]'); await p.keyboard.type('abcdefghij0123456789');
    const sp = await p.evaluate(() => { JSON.stringify = window.__js; return window.__sp; });
    assert(sp === 0, label + ': 20 keystrokes built only the typed box (sheet-wide builds seen: ' + sp + ')');
    await p.waitForTimeout(1500); await p.evaluate(() => { window.takeRec(); });
    await p.evaluate(() => { B68Tracker.refresh(); }); await settle(p);
    const typedRec = await p.evaluate(() => window.takeRec());
    assert(typedRec.length === 0, label + ': after typing, the next redraw makes ' + typedRec.length + ' mutations: ' + JSON.stringify(typedRec.slice(0, 3)));

    /* 4. harm typed into a line: the vitals follow, and clearing it brings them back (the cached markup is not stale) */
    const hv = async () => p.evaluate(() => { const v = document.querySelector('#dossier .ds-vitals'); return v ? v.textContent : null; });
    const before = await hv();
    await p.fill('#dossier input[data-path="harm.l1.0"]', 'Bruised'); await settle(p);
    const mid = await hv();
    await p.fill('#dossier input[data-path="harm.l1.0"]', ''); await settle(p);
    await p.evaluate(() => B68Tracker.refresh()); await settle(p);
    const after = await hv();
    assert(mid !== before, label + ': a typed harm line changes the vitals: ' + before + ' -> ' + mid);
    assert(after === before, label + ': and clearing it restores them: ' + before + ' / ' + after);

    /* 5. the figure kept: a tap on a desk keeps the drawn SVG node */
    if (w > 760) {
      const fg = await p.evaluate(() => { const f = document.querySelector('#dossier .ds-figbox [data-k="fig"]'); document.querySelector('#dossier .ds-sbox[data-n="1"]').click(); const g = document.querySelector('#dossier .ds-figbox [data-k="fig"]'); return { has: !!(g && g.querySelector('svg')), same: f === g }; });
      assert(fg.has && fg.same, label + ': the figure node is carried across a tap: ' + JSON.stringify(fg));
      await p.click('#dossier [data-act="view"][data-v="mug"]'); await settle(p);
      const mg = await p.evaluate(() => ({ cls: document.querySelector('#dossier .ds-figbox [data-k="fig"]').className, n: document.querySelectorAll('#dossier .ds-figbox svg').length > 0 }));
      assert(/mug/.test(mg.cls) && mg.n, label + ': the Mugshot view redraws the figure slot: ' + JSON.stringify(mg));
      await p.click('#dossier [data-act="view"][data-v="fig"]'); await settle(p);
    } else {
      const th = await p.evaluate(() => { const t = document.querySelector('#dossier img.ds-thumb'); document.querySelector('#dossier .ds-sbox[data-n="1"]').click(); return { has: !!t, same: t === document.querySelector('#dossier img.ds-thumb') }; });
      assert(th.has && th.same, label + ': the phone’s thumbnail node is carried across a tap: ' + JSON.stringify(th));
    }

    /* 6. print still draws the figure into its slot and clears it after */
    await p.emulateMedia({ media: 'print' });
    await p.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); await settle(p);
    const pr = await p.evaluate(() => { const f = document.querySelector('#dossier .ds-printfig'); const r = document.querySelector('#dossier').getBoundingClientRect(); return { svg: !!(f && f.querySelector('svg')), w: Math.round(r.width), boxes: document.querySelectorAll('#dossier .ds-box').length }; });
    assert(pr.svg && pr.boxes >= 12 && pr.w > 300, label + ': print draws the figure and the boxes: ' + JSON.stringify(pr));
    await p.evaluate(() => { B68Tracker.refresh(); }); await settle(p);
    assert(await p.evaluate(() => !!document.querySelector('#dossier .ds-printfig svg')), label + ': a redraw during print keeps the print figure');
    await p.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await settle(p);
    assert(await p.evaluate(() => !document.querySelector('#dossier .ds-printfig svg')), label + ': after print the slot is empty again');
    await p.emulateMedia({ media: 'screen' });
    await p.close();
  }

  /* 8. every save of an open sheet comes back as a roster snapshot: with the sheet showing, the hidden cards are not redrawn
     (a figure per card was most of a phone's tap), and they are drawn when the sheet closes */
  {
    const p = await b.newPage({ viewport: { width: 390, height: 900 } });
    p.on('pageerror', e => errs.push('roster pageerror: ' + e.message));
    await p.goto(URL); await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const mk = (id, name) => ({ id, name, alias: '', playbook: 'hound', playbookName: 'Hound', code: 'H-1', spec: JSON.parse(JSON.stringify(B68.S.spec)), sheet: { name }, play: null, owner: null });
      const n = () => document.querySelectorAll('#cards .card').length;
      B68.setMode('home', true); B68._renderRoster([mk('a', 'Alpha')]); const home = n();
      B68.setMode('sheet', true); B68._renderRoster([mk('a', 'Alpha'), mk('b', 'Bravo')]); const during = n(); const rosterDuring = B68.roster.length;
      B68.setMode('home', true); const after = n();
      return { home, during, rosterDuring, after };
    });
    assert(r.home === 1 && r.during === 1 && r.rosterDuring === 2 && r.after === 2, 'roster: cards wait while the sheet is open and are drawn on leaving it: ' + JSON.stringify(r));
    await p.close();
  }

  /* 7. a read-only sheet disables its controls, in every box, through redraws, and comes back when it becomes writable */
  {
    const { p, r } = await open(1360, false, 'readonly');
    assert(r.ok, 'readonly: opened');
    const live = () => p.evaluate(() => { let live = 0, total = 0; document.querySelectorAll('#dossier button, #dossier input, #dossier textarea, #dossier select').forEach(n => { if (n.dataset.always) return; total++; if (!n.disabled) live++; }); return { live, total }; });
    let c = await live(); assert(c.total > 40 && c.live === 0, 'readonly: every control is disabled at the start: ' + JSON.stringify(c));
    await p.evaluate(() => { const pl = B68Tracker.play(); pl.stress = 4; B68Tracker.update(Object.assign({}, window.doc, { play: pl })); }); await settle(p);
    c = await live(); assert(c.total > 40 && c.live === 0, 'readonly: still disabled after a poll redrew a box: ' + JSON.stringify(c));
    assert((await p.evaluate(() => B68Tracker.play().stress)) === 4, 'readonly: the poll did redraw (stress 4)');
    assert(await p.evaluate(() => document.getElementById('dossier').classList.contains('ds-ro')), 'readonly: the sheet says so');
    await p.evaluate(() => { window.api.canWrite = true; B68Tracker.refresh(); }); await settle(p);
    c = await live(); assert(c.total > 40 && c.live > c.total * 0.7, 'readonly: becoming writable enables the controls again: ' + JSON.stringify(c));
    await p.evaluate(() => { window.api.canWrite = false; B68Tracker.refresh(); }); await settle(p);
    c = await live(); assert(c.live === 0, 'readonly: and read-only again disables them: ' + JSON.stringify(c));
    await p.close();
  }

  await b.close();
  info.forEach(s => console.log('INFO', s));
  console.log(fails.length ? 'ASSERTIONS FAILED:\n  ' + fails.join('\n  ') : 'ASSERTIONS: all passed');
  console.log(errs.length ? 'ERRORS:\n  ' + errs.join('\n  ') : 'ERRORS: none');
  process.exit(fails.length || errs.length ? 1 : 0);
})();
