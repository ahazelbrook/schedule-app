process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* Headless check of the season print (#print, season.js; CAMPAIGN.md "Season print"): the route from every mode and
   Back, the pages (cover, crew, one per character, ordered by playbook then name), GM / player clocks, nothing written,
   the live sheet untouched, phone width, light and dark, and PDFs in A4 and Letter rendered to PNG for a look.
   Run from this dir: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node season.js */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, 'out');
/* the creator's sheets for the paranormal and core playbooks (shared with trackerpn.js / printcheck.js) */
const SHEET = fs.readFileSync('trackerpn.js', 'utf8').match(/const SHEET = `([\s\S]*?)`;\n/)[1].replace(/\\\\/g, '\\');   /* the template literal's own unescaping */

/* The stubbed window.claude: the store survives reloads (localStorage), the role is localStorage.__role (gm | player).
   Every write is counted in window.__writes. */
const STUB = `(() => {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('__stub') || '{}'); } catch (e) {}
  const store = saved; const colSubs = {}; const docSubs = {};
  const role = (() => { try { return localStorage.getItem('__role') || 'gm'; } catch (e) { return 'gm'; } })();
  const persist = () => { try { localStorage.setItem('__stub', JSON.stringify(store)); } catch (e) {} };
  const copy = (o) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  const dm = (t, s) => { for (const k in s) { const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) dm(t[k], v); else t[k] = v; } return t; };
  const snapOf = (p) => ({ id: p.split('/')[1], exists: p in store, data: () => copy(store[p]), metadata: {} });
  const query = (c) => { const docs = Object.keys(store).filter(p => p.indexOf(c + '/') === 0).map(snapOf).sort((a, b) => (store[c + '/' + b.id].updatedAt || '').localeCompare(store[c + '/' + a.id].updatedAt || '')); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
  const fire = (p) => { (docSubs[p] || []).forEach(fn => fn(snapOf(p))); const c = p.split('/')[0]; (colSubs[c] || []).forEach(fn => fn(query(c))); };
  const docRef = (c, id) => { const p = c + '/' + id; return { id,
    get: async () => { window.__reads.push(p); return snapOf(p); },
    set: async (d) => { store[p] = copy(d); window.__writes.push(['set', p]); persist(); fire(p); },
    update: async (u) => { if (!(p in store)) throw new Error('No document to update: ' + p); dm(store[p], copy(u)); window.__writes.push(['update', p]); persist(); fire(p); },
    delete: async () => { delete store[p]; window.__writes.push(['delete', p]); persist(); fire(p); },
    onSnapshot: (fn) => { (docSubs[p] = docSubs[p] || []).push(fn); setTimeout(() => fn(snapOf(p)), 0); return () => { docSubs[p] = (docSubs[p] || []).filter(f => f !== fn); }; } }; };
  const col = (c) => { const q = () => ({ orderBy: q, limit: q, where: q, get: async () => { window.__reads.push(c); return query(c); }, onSnapshot: (fn) => { (colSubs[c] = colSubs[c] || []).push(fn); setTimeout(() => fn(query(c)), 0); return () => {}; } }); return Object.assign(q(), { doc: (id) => docRef(c, id), path: c }); };
  window.__writes = []; window.__reads = []; window.__store = store; window.__role = role;
  window.__seed = (p, d) => { store[p] = copy(d); persist(); fire(p); };   /* the test's own setup: not counted as a write */
  const ids = { gm: 'u_gm', player: 'u_player' };
  const user = { id: async () => ids[role], can: async (n) => true, isOwner: async () => role === 'gm', canEdit: async () => role === 'gm',
    me: async () => ({ id: ids[role], name: '', email: null }), profiles: async (list) => { const names = { u_gm: 'Gail the GM', u_player: 'Pat' }; const o = {}; list.forEach(id => { o[id] = { id, name: names[id] || '' }; }); return o; } };
  window.claude = { use: async (name) => ({ db: { collection: col, doc: (p) => docRef(p.split('/')[0], p.split('/')[1]) }, user, downloads: { save: async () => {} } })[name] || null };
})();`;

const PBS = ['vampire', 'hound', 'timetraveler', 'ghost'];   /* filed out of order on purpose */
const DAY = 864e5, T0 = Date.parse('2026-06-04T19:00:00Z');
const iso = (n) => new Date(T0 + n * DAY).toISOString();

(async () => {
  const b = await chromium.launch();
  const errs = [], fails = [], notes = [], shots = [];
  const assert = (ok, msg) => { if (!ok) fails.push(msg); };
  function watch(p, name) {
    p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/ERR_FILE_NOT_FOUND/.test(t)) errs.push(name + ' console.error: ' + t); } });
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('dialog', d => d.accept());
  }
  const mode = (p) => p.evaluate(() => document.body.dataset.mode);
  const writes = (p) => p.evaluate(() => window.__writes.length);
  const ready = (p) => p.waitForFunction(() => { const s = document.getElementById('season'); return s && s.dataset.state === 'ready'; }, null, { timeout: 15000 }).then(() => true, () => false);

  /* ---------- seed: four characters through the creator, one more without play, the campaign ---------- */
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage(); watch(p, 'seed');
  await p.goto(URL); await p.evaluate(() => { localStorage.removeItem('__stub'); localStorage.setItem('__role', 'gm'); }); await p.reload(); await p.waitForTimeout(1000);
  for (let i = 0; i < PBS.length; i++) {
    await p.evaluate((h) => { B68.S.sheet = B68.blankSheet(); B68.S.spec = JSON.parse(JSON.stringify(B68.BASE_FIGURE)); B68.S.spec.heightIn = h; B68.S.dirty = false; }, 64 + i * 3);
    await p.evaluate(`(${SHEET})(${JSON.stringify(PBS[i])}); true`); await p.waitForTimeout(700);
  }
  const ids = await p.evaluate(() => Object.keys(window.__store).filter(k => k.indexOf('characters/') === 0).map(k => k.slice(11)));
  assert(ids.length === 4, 'seed: expected 4 filed characters, got ' + ids.length);
  /* marks on the living sheets, a fifth hound filed before the tracker existed (no play), and the campaign */
  await p.evaluate(({ ids, iso }) => {
    const st = window.__store, CR = B68Crews;
    ids.forEach((id, i) => { const d = JSON.parse(JSON.stringify(st['characters/' + id])); d.play.stress = 2 + i; d.play.harm.l2[0] = 'Cracked ribs'; d.play.xp.playbook = 3; d.play.notes = 'Owes the Lampblacks.\nNever trust Inspector Dahl.\nThird line of notes that should print whole, not clipped by a fixed-height box.\nFourth line.\nFifth line.'; d.play.log = [{ at: iso[2], kind: 'note', text: 'Session 2 ended: +2 xp' }, { at: iso[1], kind: 'roll', text: 'Skirmish 2d · risky · 6,3 → success' }]; window.__seed('characters/' + id, d); });
    const hound = ids.map(id => st['characters/' + id]).filter(d => d.playbook === 'hound')[0];
    const bea = JSON.parse(JSON.stringify(hound)); bea.name = 'Bea Nix'; bea.sheet.name = 'Bea Nix'; bea.alias = 'Ledger'; delete bea.play; bea.spec.heightIn = 61; bea.updatedAt = iso[0];
    window.__seed('characters/bea-nix-old', bea);
    const crew = { name: 'The Lamplighters', tier: 2, hold: 'strong', rep: 5, heat: 4, wanted: 1, cohorts: [], factions: [{ name: 'Bluecoats', status: -2 }, { name: 'The Lampblacks', status: 1 }], notes: 'We owe Bazso a favour.' };
    B68Campaign.crewSheet.seed(crew, CR.byId.shadows);
    crew.abilities['Everyone Steals'] = 1; crew.xp = 4; crew.cohorts[0].name = 'The Quiet Ones';
    window.__seed('campaign/main', { v: 1, session: { number: 3, startedAt: iso[14], endedAt: iso[14] }, crew,
      clocks: [{ id: 'c_a', name: 'Bluecoat crackdown', size: 8, filled: 5, kind: 'danger', hidden: false }, { id: 'c_b', name: 'Buy the Silver Nail', size: 6, filled: 2, kind: 'project', hidden: false },
        { id: 'c_c', name: 'The Inspector’s secret', size: 4, filled: 3, kind: 'faction', hidden: true }],
      log: [{ at: iso[14] + '', by: 'u_gm', text: 'Session 3 ended' }, { at: iso[14], by: 'u_gm', text: 'Session 3 started' }, { at: iso[8], by: 'u_player', text: 'Bea paid off the Lampblacks.' },
        { at: iso[7], by: 'u_gm', text: 'Session 2 started' }, { at: iso[0], by: 'u_gm', text: 'Session 1 started' }], updatedAt: iso[14] });
  }, { ids, iso: [0, 1, 2, 7, 8, 14].reduce((o, n) => (o[n] = iso(n), o), {}) });
  const SEED = await p.evaluate(() => JSON.stringify(window.__store));
  await ctx.close();

  /* the expected order: rulebook order of playbooks, then name */
  async function expected(pg) {
    return pg.evaluate(() => {
      const CT = B68Content, order = {}; CT.PLAYBOOKS.concat(CT.PARANORMAL).forEach((q, i) => { if (!(q.id in order)) order[q.id] = i; });
      return Object.keys(window.__store).filter(k => k.indexOf('characters/') === 0).map(k => Object.assign({ id: k.slice(11) }, window.__store[k]))
        .sort((a, b) => (order[a.playbook] - order[b.playbook]) || String(a.name).localeCompare(String(b.name))).map(d => ({ id: d.id, name: d.name, playbook: d.playbook, pb: CT.byId[d.playbook].name, ghost: !!CT.byId[d.playbook].ghost, hasPlay: !!d.play }));
    });
  }
  /* what the print shows: pages, their kinds and what is inside each shadow copy */
  async function structure(pg) {
    return pg.evaluate(() => {
      const pages = [...document.querySelectorAll('#season .sn-page')];
      return pages.map(pgEl => {
        const host = pgEl.querySelector('.sn-host'), sr = host && host.shadowRoot;
        const o = { cls: pgEl.className, id: pgEl.dataset.id || null };
        if (sr) {
          const dos = sr.querySelector('#dossier'), tp = sr.querySelector('#table-page');
          if (dos) { o.pb = (dos.querySelector('.ds-pb') || {}).textContent; o.name = (dos.querySelector('.ds-ident b') || {}).textContent; o.fig = !!dos.querySelector('.ds-printfig svg'); o.ghostFig = !!dos.querySelector('.ds-printfig.ghostly'); o.boxes = dos.querySelectorAll('.ds-box').length; o.inert = dos.hasAttribute('inert') && dos.inert === true; o.inputs = dos.querySelectorAll('input[type="text"], input:not([type])').length; o.disabled = dos.querySelectorAll('[disabled]').length; o.textareas = dos.querySelectorAll('textarea').length; o.stress = (dos.querySelector('.ds-stress .ds-count') || {}).textContent; o.boxBg = getComputedStyle(dos.querySelector('.ds-box')).borderTopStyle; o.rootDisplay = getComputedStyle(dos).display; o.figVisible = getComputedStyle(dos.querySelector('.ds-printfig')).display; }
          if (tp) { o.crew = (tp.querySelector('.cs-sheet') || {}).dataset ? tp.querySelector('.cs-sheet').dataset.playbook : null; o.clocks = [...tp.querySelectorAll('.tp-clock .sn-clockname')].map(n => n.textContent); o.log = [...tp.querySelectorAll('.tp-log li .tp-logt')].map(n => n.textContent); o.logBy = [...tp.querySelectorAll('.tp-log li .tp-logby')].map(n => n.textContent); o.inert = tp.inert === true; o.inputs = tp.querySelectorAll('input, textarea').length; o.tpDisplay = getComputedStyle(tp).display; o.bandBg = getComputedStyle(tp.querySelector('.tp-band')).backgroundColor; }
        } else {
          o.text = pgEl.textContent.replace(/\s+/g, ' ').slice(0, 400); o.figures = pgEl.querySelectorAll('.sn-chart .b68-figure').length; o.ghostly = pgEl.querySelectorAll('.sn-chart .b68-figure.ghostly').length;
          o.names = [...pgEl.querySelectorAll('.sn-names > span')].map(n => n.firstChild.textContent);
        }
        return o;
      });
    });
  }
  async function hiddenOthers(pg) {
    return pg.evaluate(() => ['header.top', '.studio', '.crew', '.roster', '#dossier', '#table-page'].filter(s => { const n = document.querySelector(s); return n && getComputedStyle(n).display !== 'none'; }));
  }
  function checkPages(tag, st, exp, isGM) {
    assert(st.length === 2 + exp.length, tag + ': expected ' + (2 + exp.length) + ' pages, got ' + st.length);
    assert(/sn-cover/.test(st[0] && st[0].cls), tag + ': page 1 is not the cover');
    assert(/sn-crew/.test(st[1] && st[1].cls), tag + ': page 2 is not the crew');
    const cov = st[0] || {};
    ['The Lamplighters', 'Shadows', '3 sessions', 'First session', 'Last session', 'Printed', '5 characters'].forEach(w => assert((cov.text || '').indexOf(w) >= 0, tag + ': cover lacks “' + w + '”: ' + cov.text));
    assert(cov.figures === exp.length, tag + ': line-up has ' + cov.figures + ' figures, expected ' + exp.length);
    assert(cov.ghostly === exp.filter(e => e.ghost).length, tag + ': ghostly figures in the line-up ' + cov.ghostly);
    assert(JSON.stringify(cov.names) === JSON.stringify(exp.map(e => e.name)), tag + ': line-up names ' + JSON.stringify(cov.names));
    const crew = st[1] || {};
    assert(crew.crew === 'shadows', tag + ': crew sheet playbook ' + crew.crew);
    const wantClocks = isGM ? ['Bluecoat crackdown', 'Buy the Silver Nail', 'The Inspector’s secret'] : ['Bluecoat crackdown', 'Buy the Silver Nail'];
    assert(JSON.stringify(crew.clocks) === JSON.stringify(wantClocks), tag + ': clocks ' + JSON.stringify(crew.clocks));
    assert((crew.log || []).length === 5 && crew.log[0] === 'Session 3 ended' && crew.log[4] === 'Session 1 started', tag + ': log ' + JSON.stringify(crew.log));
    assert((crew.logBy || []).indexOf('Pat') >= 0, tag + ': log authors not named ' + JSON.stringify(crew.logBy));
    assert(crew.inert && crew.inputs === 0, tag + ': the crew copy is not inert or still has fields (' + crew.inputs + ')');
    assert(crew.tpDisplay && crew.tpDisplay !== 'none', tag + ': the crew copy is not displayed');
    assert(crew.bandBg === 'rgb(20, 17, 14)', tag + ': the crew copy is not styled by campaign.css (band ' + crew.bandBg + ')');
    exp.forEach((e, i) => {
      const s = st[2 + i] || {};
      assert(s.id === e.id, tag + ': page ' + (3 + i) + ' is ' + s.id + ', expected ' + e.id);
      assert(s.pb === e.pb, tag + ': ' + e.name + ' playbook header ' + s.pb);
      assert(s.name === e.name, tag + ': ' + e.name + ' name header ' + s.name);
      assert(s.fig, tag + ': ' + e.name + ' has no small figure');
      assert(!e.ghost || s.ghostFig, tag + ': ghost figure not ghostly');
      assert(s.boxes > 8, tag + ': ' + e.name + ' has only ' + s.boxes + ' boxes');
      assert(s.inert && s.inputs === 0, tag + ': ' + e.name + ' copy not inert or still has text inputs (' + s.inputs + ')');
      assert(s.textareas === 0, tag + ': ' + e.name + ' still has textareas');
      assert(s.rootDisplay === 'grid', tag + ': ' + e.name + ' copy not styled by tracker.css (display ' + s.rootDisplay + ')');
      assert(s.figVisible === 'block', tag + ': ' + e.name + ' small figure hidden on screen');
    });
  }

  /* ---------- GM, desk: from the table, the print, Back ---------- */
  async function session(name, opts) {
    const c = await b.newContext(Object.assign({ viewport: { width: 1360, height: 900 } }, opts.ctx || {}));
    /* each context starts from the seeded store (localStorage is per context) */
    await c.addInitScript(({ seed, role }) => { try { if (!localStorage.getItem('__stub')) localStorage.setItem('__stub', seed); localStorage.setItem('__role', role); } catch (e) {} }, { seed: SEED, role: opts.role || 'gm' });
    await c.addInitScript(STUB);
    const pg = await c.newPage(); watch(pg, name);
    return { c, pg };
  }
  {
    const { c, pg } = await session('gm-desk', { role: 'gm' });
    await pg.goto(URL + '#t'); await pg.waitForTimeout(1200);
    assert(await mode(pg) === 'table', 'gm: start mode ' + await mode(pg));
    const exp = await expected(pg);
    assert(exp.length === 5 && exp.some(e => !e.hasPlay), 'gm: seed has ' + exp.length + ' characters');
    notes.push('order: ' + exp.map(e => e.pb + ' ' + e.name).join(', '));
    const w0 = await writes(pg);
    await pg.evaluate(() => B68Season.open());
    assert(await ready(pg), 'gm: the print never became ready');
    assert(await mode(pg) === 'print', 'gm: mode ' + await mode(pg));
    assert(await pg.evaluate(() => location.hash) === '#print', 'gm: hash ' + await pg.evaluate(() => location.hash));
    const vis = await hiddenOthers(pg); assert(!vis.length, 'gm: still visible in print mode: ' + vis.join(', '));
    checkPages('gm', await structure(pg), exp, true);
    /* the doc without play renders from the creator's starting play, and stays without play in the store */
    assert(await pg.evaluate(() => !window.__store['characters/bea-nix-old'].play), 'gm: the print wrote a play into the store');
    /* the ids in the copies never shadow the live page's */
    assert(await pg.evaluate(() => document.querySelectorAll('#dossier').length === 1 && document.querySelectorAll('#table-page').length === 1 && document.getElementById('dossier').parentElement.classList.contains('wrap')), 'gm: duplicate ids leaked into the document');
    const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw[0] <= sw[1], 'gm desk: horizontal scroll ' + sw);
    /* screenshots: the toolbar and cover, the crew page, two sheets */
    await pg.screenshot({ path: path.join(OUT, 'season-desk-light.png') }); shots.push('season-desk-light.png');
    await pg.locator('#season .sn-page').nth(1).screenshot({ path: path.join(OUT, 'season-desk-crew.png') }); shots.push('season-desk-crew.png');
    const vampIdx = exp.findIndex(e => e.playbook === 'vampire'), ghostIdx = exp.findIndex(e => e.playbook === 'ghost');
    await pg.locator('#season .sn-page').nth(2 + ghostIdx).screenshot({ path: path.join(OUT, 'season-desk-ghost.png') }); shots.push('season-desk-ghost.png');
    /* PDFs in A4 and Letter, then PNG pages */
    await pg.emulateMedia({ media: 'print' });
    const vis2 = await pg.evaluate(() => getComputedStyle(document.querySelector('#season .sn-bar')).display);
    assert(vis2 === 'none', 'gm: the toolbar prints (' + vis2 + ')');
    for (const [fmt, file] of [['A4', 'season-a4.pdf'], ['Letter', 'season-letter.pdf']]) {
      await pg.pdf({ path: path.join(OUT, file), format: fmt, printBackground: true });
      const info = cp.execFileSync('pdfinfo', [path.join(OUT, file)]).toString(); const n = +(/Pages:\s+(\d+)/.exec(info) || [])[1];
      notes.push(fmt + ' PDF: ' + n + ' pages');
      assert(n >= 2 + exp.length, fmt + ': only ' + n + ' pages');
      /* each section starts on its own page: the page that carries a character's name in its header begins with that sheet */
      const pagesText = []; for (let i = 1; i <= n; i++) pagesText.push(cp.execFileSync('pdftotext', ['-f', String(i), '-l', String(i), '-layout', path.join(OUT, file), '-']).toString());
      assert(/The Lamplighters/.test(pagesText[0]) && /the season/i.test(pagesText[0]), fmt + ': page 1 is not the cover');
      const flat = (t) => t.replace(/\s+/g, '').toLowerCase();
      const starts = exp.map(e => pagesText.findIndex((t, i) => i > 0 && flat(t).indexOf(flat(e.name)) >= 0 && flat(t).indexOf('alias') >= 0));
      assert(starts.every((s, i) => s > 0 && (i === 0 || s > starts[i - 1])), fmt + ': character pages out of order or missing ' + JSON.stringify(starts));
      notes.push(fmt + ' sheet start pages: ' + starts.map((s, i) => exp[i].name + ' p' + (s + 1)).join(', '));
      const prefix = path.join(OUT, file.replace('.pdf', ''));
      cp.execFileSync('pdftoppm', ['-r', '60', '-png', path.join(OUT, file), prefix]);
    }
    await pg.emulateMedia({ media: null });
    assert(await writes(pg) === w0, 'gm: the print wrote to the db (' + (await writes(pg) - w0) + ' writes)');
    /* Back returns to the table */
    await pg.click('#season [data-sn="back"]'); await pg.waitForTimeout(600);
    assert(await mode(pg) === 'table', 'gm: Back went to ' + await mode(pg));
    assert(await pg.evaluate(() => location.hash) === '#t', 'gm: Back hash ' + await pg.evaluate(() => location.hash));
    assert(await pg.evaluate(() => !document.querySelector('#season .sn-page') && document.getElementById('season').hidden), 'gm: the print was not cleared on Back');
    assert(await writes(pg) === w0, 'gm: Back wrote to the db');
    /* dark desk */
    await pg.emulateMedia({ colorScheme: 'dark' });
    await pg.evaluate(() => B68Season.open()); assert(await ready(pg), 'gm dark: not ready');
    await pg.screenshot({ path: path.join(OUT, 'season-desk-dark.png') }); shots.push('season-desk-dark.png');
    await pg.locator('#season .sn-page').nth(2 + vampIdx).screenshot({ path: path.join(OUT, 'season-desk-dark-vampire.png') }); shots.push('season-desk-dark-vampire.png');
    await pg.goBack(); await pg.waitForTimeout(600);
    assert(await mode(pg) === 'table', 'gm: the browser Back went to ' + await mode(pg));
    assert(await writes(pg) === w0, 'gm: writes after dark pass');
    await c.close();
  }

  /* ---------- player: from a sheet; hidden clocks stay hidden; Back reopens the sheet, which still works ---------- */
  {
    const { c, pg } = await session('player-sheet', { role: 'player' });
    await pg.goto(URL); await pg.waitForTimeout(1200);
    const exp = await expected(pg); const target = exp.find(e => e.playbook === 'vampire');
    await pg.evaluate((id) => B68.openCharacter(id), target.id); await pg.waitForTimeout(800);
    assert(await mode(pg) === 'sheet', 'player: sheet mode ' + await mode(pg));
    const w0 = await writes(pg);
    await pg.evaluate(() => { location.hash = '#print'; });
    assert(await ready(pg), 'player: the print never became ready (hash route)');
    assert(await mode(pg) === 'print', 'player: mode ' + await mode(pg));
    checkPages('player', await structure(pg), exp, false);
    assert(await pg.evaluate(() => document.getElementById('dossier').innerHTML === ''), 'player: the live sheet stayed open under the print');
    await pg.click('#season [data-sn="back"]'); await pg.waitForTimeout(900);
    assert(await mode(pg) === 'sheet', 'player: Back went to ' + await mode(pg));
    assert(await pg.evaluate(() => location.hash) === '#c/' + target.id, 'player: Back hash ' + await pg.evaluate(() => location.hash));
    assert(await pg.evaluate(() => !!document.querySelector('#dossier .ds-head') && B68Tracker.isOpen()), 'player: the live sheet did not come back');
    assert(await writes(pg) === w0, 'player: the print wrote to the db');
    /* the live sheet still saves after the print (renderStatic left it alone) */
    await pg.click('#dossier .ds-stress .ds-sbox[data-n="9"]'); await pg.waitForTimeout(500);
    assert(await writes(pg) === w0 + 1, 'player: the live sheet did not save a click after the print (' + (await writes(pg) - w0) + ')');
    await c.close();
  }

  /* ---------- cold load at #print on a phone, light and dark: Back goes Home (nothing before it in this tab) ---------- */
  for (const scheme of ['light', 'dark']) {
    const { c, pg } = await session('phone-' + scheme, { role: 'gm', ctx: { viewport: { width: 390, height: 844 }, colorScheme: scheme, deviceScaleFactor: 2 } });
    await pg.goto(URL + '#print');
    assert(await ready(pg), 'phone ' + scheme + ': the print never became ready');
    assert(await mode(pg) === 'print', 'phone ' + scheme + ': mode ' + await mode(pg));
    const w0 = await writes(pg);
    const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw[0] <= sw[1], 'phone ' + scheme + ': horizontal scroll ' + sw);
    const wide = await pg.evaluate(() => { const out = []; document.querySelectorAll('#season .sn-page').forEach((pgEl, i) => { const r = pgEl.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) out.push(i + ':' + Math.round(r.left) + '-' + Math.round(r.right)); const sr = pgEl.querySelector('.sn-host') && pgEl.querySelector('.sn-host').shadowRoot; if (sr) sr.querySelectorAll('.ds-box, .tp-box, .ds-head').forEach(n => { const q = n.getBoundingClientRect(); if (q.width && (q.right > r.right + 1)) out.push(i + ' ' + n.className + ' ' + Math.round(q.right) + '>' + Math.round(r.right)); }); }); return out.slice(0, 6); });
    assert(!wide.length, 'phone ' + scheme + ': content wider than its page: ' + wide.join(' | '));
    await pg.screenshot({ path: path.join(OUT, 'season-phone-' + scheme + '.png') }); shots.push('season-phone-' + scheme + '.png');
    await pg.locator('#season .sn-page').nth(1).screenshot({ path: path.join(OUT, 'season-phone-' + scheme + '-crew.png') }); shots.push('season-phone-' + scheme + '-crew.png');
    await pg.locator('#season .sn-page').nth(2).screenshot({ path: path.join(OUT, 'season-phone-' + scheme + '-sheet.png') }); shots.push('season-phone-' + scheme + '-sheet.png');
    await pg.click('#season [data-sn="back"]'); await pg.waitForTimeout(600);
    assert(await mode(pg) === 'home', 'phone ' + scheme + ': Back from a cold #print went to ' + await mode(pg));
    assert(await pg.evaluate(() => location.hash) === '', 'phone ' + scheme + ': hash after Back ' + await pg.evaluate(() => location.hash));
    assert(await writes(pg) === w0, 'phone ' + scheme + ': writes');
    await c.close();
  }

  await b.close();
  notes.forEach(n => console.log('note: ' + n));
  console.log('shots: ' + shots.map(s => 'out/' + s).join(', '));
  console.log('pdf pages as PNG: out/season-a4-*.png, out/season-letter-*.png');
  if (errs.length) { console.log('ERRORS (' + errs.length + '):'); errs.forEach(e => console.log('  ' + e)); }
  if (fails.length) { console.log('FAILS (' + fails.length + '):'); fails.forEach(f => console.log('  ' + f)); }
  console.log(errs.length || fails.length ? 'season: FAILED' : 'season: all checks passed');
  process.exit(errs.length || fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
