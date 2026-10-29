process.chdir(__dirname);
/* Headless check of the lazy figure kit (MS2): first paint draws no figure and loads no kit; every caller shows a placeholder
   (this character's last thumbnail from localStorage, else a silhouette) and the kit's arrival swaps the real one in, in place,
   touching nothing else; the creator waits for the kit and then works; a character's last thumbnail is remembered; the cast
   page and the schedule board wait for it too. The kit file is HELD by the test (page.route) so the "before" state is seen for
   as long as it takes. Run from this dir: PW_MODULE=... node kitlazy.js   (KITLAZY_APP=<dir> points it at another build of app/)
   The app is served over http from a node server on 9034 (route() does not reach file://). */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const APP = process.env.KITLAZY_APP ? path.resolve(process.env.KITLAZY_APP) : path.resolve(__dirname, '..');
const PORT = Number(process.env.KITLAZY_PORT || 9034);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
/* the kit files wait here while a test holds them (hold.gate, a promise); hold.asked lists what was requested meanwhile */
const hold = { gate: null, asked: null };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  if (hold.gate && (p === '/figures/figure-kit.js' || p === '/figures/cast.js')) { hold.asked.push(p.split('/').pop()); await hold.gate; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
});
const BASE = 'http://127.0.0.1:' + PORT + '/';
(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const b = await chromium.launch();
  const errs = [], fails = [], info = [];
  const assert = (ok, msg) => { if (!ok) fails.push(msg); };
  /* a page whose kit files wait for release() */
  async function holdPage(ctx, name, w) {
    const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: 900 });
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|favicon|404/.test(m.text())) errs.push(name + ' console.error: ' + m.text()); });
    p.on('pageerror', (e) => errs.push(name + ' pageerror: ' + e.message));
    let release; hold.gate = new Promise((r) => { release = r; }); const asked = hold.asked = [];
    return { p, release: () => { release(); hold.gate = null; }, asked };
  }
  /* open a sheet the way ms3.js does, but with the kit still held */
  const SEED = () => {
    const pb = 'hound'; B68.choosePlaybook(pb);
    const sh = B68.S.sheet; sh.name = 'Lazy Lou'; sh.alias = 'Tick'; sh.heritage = 'Hillfolk'; sh.background = 'Quarry hand'; sh.look = 'Lean.'; sh.wearing = ['Trench coat'];
    const P = B68Content.byId[pb]; sh.ability = P.abilities[0][0]; sh.keys = P.keys.slice(0, 3); sh.vice = 'Gambling'; sh.purveyor = 'A card game'; sh.items = [P.items[0][0]];
    const play = B68Tracker.initialPlay(sh, pb);
    window.saves = 0; window.api = { save: () => { window.saves++; return Promise.resolve(); }, edit() {}, back() {}, remove() { return Promise.resolve(); }, me: null, canWrite: true };
    window.doc = { id: 'lazy1', name: sh.name, alias: sh.alias, playbook: pb, playbookName: P.name, code: P.prefix + '-968-1234', spec: B68.S.spec, sheet: sh, play };
  };
  const OPEN = () => {
    B68Tracker.open(window.doc, window.api);
    document.body.dataset.mode = 'sheet'; document.getElementById('dossier').hidden = false;
    const st = document.querySelector('.studio'); if (st) st.hidden = true; const cr = document.querySelector('.crew'); if (cr) cr.hidden = true;
    window.rec = []; const root = document.getElementById('dossier');
    window.mo = new MutationObserver((l) => { for (const m of l) window.rec.push({ type: m.type, name: m.attributeName || '', tgt: (m.target.nodeType === 1 ? m.target : m.target.parentElement || m.target).className || m.target.nodeName, tag: m.target.nodeName, added: m.addedNodes.length, removed: m.removedNodes.length, inThumb: !!(m.target.closest && m.target.closest('img.ds-thumb')) || (m.target.nodeName === 'IMG' && /ds-thumb/.test(m.target.className)) }); });
    window.mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  };
  const kitIn = (p) => p.evaluate(() => !!window.B68Figure);
  const isSil = (src) => /circle/.test(decodeURIComponent(String(src).replace(/^data:[^,]*,/, ''))) && decodeURIComponent(String(src)).length < 600;

  /* every page gets a context of its own (a script already in a renderer's memory cache would not be asked for again); the browser storage is carried over */
  let saved;
  const fresh = async () => b.newContext(saved ? { storageState: saved } : {});
  for (const [w, label] of [[390, 'phone'], [1360, 'desk']]) {
    saved = undefined; let ctx = await fresh();
    /* 1. first paint without the kit */
    const h1 = await holdPage(ctx, label, w);
    await h1.p.goto(BASE, { waitUntil: 'domcontentloaded' }); await h1.p.waitForFunction(() => window.B68 && window.B68Tracker && window.B68Load, null, { timeout: 15000 });
    await h1.p.waitForTimeout(600);
    const first = await h1.p.evaluate(() => ({ kit: !!window.B68Figure, cast: !!window.B68Cast, ready: B68.kitReady, panels: document.querySelectorAll('#panels .panel').length, scripts: [...document.scripts].map((s) => s.src.split('/').slice(-2).join('/')).filter((s) => /figure|cast\.js/.test(s)), mode: document.body.dataset.mode }));
    assert(!first.kit && !first.cast && !first.ready, label + ': first paint has no kit: ' + JSON.stringify(first));
    assert(first.panels === 0, label + ': the creator built no panels before the kit: ' + first.panels);
    assert(first.scripts.every((s) => /^figures\//.test(s)) , label + ': ' + JSON.stringify(first.scripts));
    assert(h1.asked.length >= 1, label + ': the kit was asked for after the first render (home, idle): ' + JSON.stringify(h1.asked));
    /* the sheet, kit still held: a silhouette in the thumbnail (phone) or a note in the Figure box (desk) */
    await h1.p.evaluate(SEED); await h1.p.evaluate(OPEN); await h1.p.waitForTimeout(400);
    const ph = await h1.p.evaluate(() => ({ thumb: (document.querySelector('#dossier img.ds-thumb') || {}).src || null, fig: (document.querySelector('#dossier .ds-figbox .ds-art') || {}).innerHTML || null, svgs: document.querySelectorAll('#dossier .ds-figbox svg').length, kit: !!window.B68Figure, ls: localStorage.getItem('b68.thumbs.v1') }));
    if (label === 'phone') assert(ph.thumb && isSil(ph.thumb), label + ': the thumbnail is the silhouette placeholder: ' + String(ph.thumb).slice(0, 120));
    else assert(/Drawing the figure/.test(ph.fig || '') && ph.svgs === 0, label + ': the Figure box says it is drawing: ' + (ph.fig || '').slice(0, 100));
    assert(!ph.kit && ph.ls === null, label + ': nothing drawn, nothing remembered yet');
    await h1.p.evaluate(() => { window.rec.length = 0; window.mo.takeRecords(); });
    /* 2. release: the real figure comes in, in place, and nothing else is touched */
    h1.release(); await h1.p.waitForFunction(() => window.B68Figure && window.B68Cast, null, { timeout: 15000 }); await h1.p.waitForTimeout(900);
    const after = await h1.p.evaluate(() => { for (const m of window.mo.takeRecords()) window.rec.push({ type: m.type, name: m.attributeName || '', tgt: (m.target.nodeType === 1 ? m.target : m.target.parentElement || m.target).className || m.target.nodeName, tag: m.target.nodeName, added: m.addedNodes.length, removed: m.removedNodes.length, inThumb: !!(m.target.closest && m.target.closest('img.ds-thumb')) || (m.target.nodeName === 'IMG' && /ds-thumb/.test(m.target.className)) }); return { rec: window.rec, thumb: (document.querySelector('#dossier img.ds-thumb') || {}).src || null, svgs: document.querySelectorAll('#dossier .ds-figbox svg').length, ls: localStorage.getItem('b68.thumbs.v1'), kitReady: B68.kitReady }; });
    if (label === 'phone') {
      assert(after.thumb && !isSil(after.thumb) && decodeURIComponent(after.thumb).length > 2000, label + ': the thumbnail is now the drawn portrait: ' + String(after.thumb).slice(0, 60));
      assert(after.rec.length >= 1 && after.rec.length <= 2 && after.rec.every((m) => m.type === 'attributes' && m.name === 'src' && m.tag === 'IMG'), label + ': the swap is the <img> src and nothing else: ' + JSON.stringify(after.rec));
      const stored = JSON.parse(after.ls || 'null'); assert(stored && stored.by && stored.by.lazy1 && String(stored.by.lazy1.u).startsWith('data:image/') && stored.by.lazy1.u.length < 60000, label + ': a small picture of the drawn thumbnail is remembered under this character: ' + String(after.ls).slice(0, 80));
    } else {
      assert(after.svgs >= 1, label + ': the Figure box has its figure: ' + after.svgs);
      assert(after.rec.length >= 1 && after.rec.every((m) => /ds-art/.test(String(m.tgt)) || /^(svg|g|path|defs|text|rect|clipPath|linearGradient|filter|use)$/i.test(m.tag) || m.inThumb === false && /ds-art|ds-figbox/.test(String(m.tgt))), label + ': only the Figure box changed: ' + JSON.stringify(after.rec.slice(0, 4)));
    }
    assert(after.kitReady === true, label + ': the creator shells are bound');
    info.push(label + ': swap mutations = ' + after.rec.length);
    saved = await ctx.storageState(); await h1.p.close(); await ctx.close();

    /* 3. a second visit: the placeholder is this character's last thumbnail (phone) */
    if (label === 'phone') {
      ctx = await fresh(); const h2 = await holdPage(ctx, label + '2', w);
      await h2.p.goto(BASE, { waitUntil: 'domcontentloaded' }); await h2.p.waitForFunction(() => window.B68 && window.B68Tracker && window.B68Load, null, { timeout: 15000 }); await h2.p.waitForTimeout(400);
      await h2.p.evaluate(SEED); await h2.p.evaluate(OPEN); await h2.p.waitForTimeout(300);
      const t2 = await h2.p.evaluate(() => ({ thumb: (document.querySelector('#dossier img.ds-thumb') || {}).src || null, kit: !!window.B68Figure }));
      assert(!t2.kit && t2.thumb && !isSil(t2.thumb) && (t2.thumb.startsWith('data:image/webp') || t2.thumb.startsWith('data:image/png')), label + ': the placeholder is the remembered thumbnail, not the silhouette: ' + String(t2.thumb).length + ' ' + decodeURIComponent(String(t2.thumb)).slice(0, 160));
      const before = t2.thumb;
      h2.release(); await h2.p.waitForFunction(() => window.B68Figure, null, { timeout: 15000 }); await h2.p.waitForTimeout(700);
      const t3 = await h2.p.evaluate(() => ({ thumb: (document.querySelector('#dossier img.ds-thumb') || {}).src || null }));
      assert(t3.thumb && !isSil(t3.thumb), label + ': after the kit the drawn one is shown');
      await h2.p.close(); await ctx.close();
    }

    /* 4. the creator waits for the kit, says so, and then works */
    ctx = await fresh(); const h4 = await holdPage(ctx, label + '-create', w);
    await h4.p.goto(BASE + '#create', { waitUntil: 'domcontentloaded' }); await h4.p.waitForFunction(() => window.B68 && window.B68Load, null, { timeout: 15000 }); await h4.p.waitForTimeout(700);
    const c1 = await h4.p.evaluate(() => ({ mode: document.body.dataset.mode, panels: document.querySelectorAll('#panels .panel').length, warn: (document.getElementById('warnings') || {}).textContent, art: !!document.querySelector('#art svg'), kit: !!window.B68Figure }));
    assert(c1.mode === 'create' && c1.panels === 0 && !c1.art && !c1.kit && /Loading the figure kit/.test(c1.warn || ''), label + ': the creator says it is loading and built nothing: ' + JSON.stringify(c1));
    assert(h4.asked.length >= 1, label + ': opening the creator asked for the kit at once: ' + JSON.stringify(h4.asked));
    h4.release(); await h4.p.waitForFunction(() => document.querySelectorAll('#panels .panel').length > 0 && document.querySelector('#art svg'), null, { timeout: 20000 });
    const c2 = await h4.p.evaluate(() => {
      const out = { panels: document.querySelectorAll('#panels .panel').length, lineup: !!document.querySelector('#lineup svg'), skins: B68.SKINS.length, cloth: B68.CLOTH.length, opts: Object.keys(B68.O).length, warn: document.getElementById('warnings').textContent, controls: B68.controls.length };
      B68.choosePlaybook('slide'); out.look = B68.S.spec.hair && B68.S.spec.hair.style;
      return out;
    });
    assert(c2.panels === 16 && c2.lineup && c2.skins > 3 && c2.cloth > 10 && c2.opts > 10, label + ': the creator is built and drawn after the kit: ' + JSON.stringify(c2));
    /* it edits: change the hair on the Hair step and see the figure redraw */
    const k0 = await h4.p.evaluate(() => document.getElementById('art').innerHTML.length);
    await h4.p.evaluate(() => { B68.showStep(3); B68.set('hair.style', 'bald'); });
    await h4.p.waitForTimeout(900);
    const k1 = await h4.p.evaluate(() => ({ len: document.getElementById('art').innerHTML.length, hair: B68.S.spec.hair.style, svg: !!document.querySelector('#art svg') }));
    assert(k1.svg && k1.hair === 'bald' && k1.len !== k0, label + ': a hair change redrew the figure: ' + JSON.stringify([k0, k1]));
    await h4.p.close(); await ctx.close();

    /* 5. the cast page draws silhouettes while the kit is held and the figures when it arrives */
    ctx = await fresh(); const h5 = await holdPage(ctx, label + '-cast', w);
    await h5.p.goto(BASE, { waitUntil: 'domcontentloaded' }); await h5.p.waitForFunction(() => window.B68 && window.B68CastPage && window.B68Load, null, { timeout: 15000 });
    await h5.p.evaluate(() => {
      const spec = JSON.parse(JSON.stringify(B68.BASE_FIGURE));
      const docs = [{ id: 'n1', name: 'Pip Stub', alias: '', role: 'A lamplighter', faction: '', description: 'Invented.', spec, revealed: true, firstSeen: '2026-10-01T00:00:00Z', tags: [], gmNotes: '' }];
      const fake = { collection: () => ({ onSnapshot: (cb) => { setTimeout(() => cb({ docs: docs.map((d) => ({ id: d.id, data: () => d })) }), 0); return () => {}; } }) };
      B68CastPage.init({ db: () => fake, me: () => null, isGM: () => false, canWrite: () => false, saveScene: () => Promise.resolve(), back() {} });
      document.body.dataset.mode = 'cast'; document.getElementById('cast-page').hidden = false; B68CastPage.open('#cast');
    });
    await h5.p.waitForTimeout(500);
    const q1 = await h5.p.evaluate(() => ({ kit: !!window.B68Figure, sil: document.querySelectorAll('#cast-page .cp-sil').length, figs: document.querySelectorAll('#cast-page [data-fig] svg:not(.cp-sil)').length, holders: document.querySelectorAll('#cast-page [data-fig]').length }));
    assert(!q1.kit && q1.holders >= 1 && q1.sil === q1.holders && q1.figs === 0, label + ': the cast page shows silhouettes while the kit is held: ' + JSON.stringify(q1));
    assert(h5.asked.length >= 1, label + ': opening the cast asked for the kit at once: ' + JSON.stringify(h5.asked));
    h5.release(); await h5.p.waitForFunction(() => window.B68Figure && window.B68Cast, null, { timeout: 15000 }); await h5.p.waitForTimeout(700);
    const q2 = await h5.p.evaluate(() => ({ sil: document.querySelectorAll('#cast-page .cp-sil').length, figs: document.querySelectorAll('#cast-page [data-fig] svg').length, holders: document.querySelectorAll('#cast-page [data-fig]').length, empty: [...document.querySelectorAll('#cast-page [data-fig]')].filter((n) => !n.firstChild).length }));
    assert(q2.sil === 0 && q2.figs === q2.holders && q2.holders >= 1, label + ': every cast figure is drawn once the kit arrives: ' + JSON.stringify(q2));
    await h5.p.close(); await ctx.close();
  }

  await b.close(); server.close();
  info.forEach((s) => console.log('info: ' + s));
  if (errs.length) { console.log('ERRORS:\n' + errs.join('\n')); }
  if (fails.length || errs.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('kitlazy: all passed');
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); try { server.close(); } catch (_) {} process.exit(1); });
