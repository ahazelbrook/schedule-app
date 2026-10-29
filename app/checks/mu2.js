process.chdir(__dirname);
/* Headless check of the roll panel's abilities strip (MU2) on the real page, through the real boot path: a player's sheet
   reads the crew's abilities from the campaign document (crew.abilities, which every player already receives) and the
   text from crews.js, which the sheet route does not load until the strip needs it.
   Checks: the strip lists the character's abilities and the crew's; it is folded by default; a tap opens one's text (set
   as text, never markup); a read-only sheet shows and works it too and writes nothing; with no table the crew's half says
   so; on a phone Special abilities sit right after Actions. Names and text are read from the app's own content at run
   time: nothing is typed here. Screenshots go to ../../gm-private/mu2/ at 360 x 780.
   Run from this dir: PW_MODULE=<path to pw-msedge.js> node mu2.js */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = path.resolve(__dirname, '..', '..', 'gm-private', 'mu2');
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}

/* the stubbed window.claude of crewsheet.js, taken from it so the two never drift */
const src = fs.readFileSync(path.join(__dirname, 'crewsheet.js'), 'utf8');
const a0 = src.indexOf('const STUB = `') + 'const STUB = `'.length, a1 = src.indexOf('})();`;', a0);
if (a0 < 20 || a1 < 0) throw new Error('could not take the stub from crewsheet.js');
const STUB = src.slice(a0, a1) + '})();';

(async () => {
  const b = await chromium.launch();
  const errs = [], fails = [];
  const assert = (ok, msg) => { if (!ok) fails.push(msg); };

  /* 1. a scratch page for the run-time content: a filed character with two playbook abilities and an invented custom one
     (its name carries markup on purpose), and the crew's first two abilities. crews.js is loaded only here. */
  const scratch = await b.newPage();
  await scratch.goto(URL); await scratch.waitForTimeout(700);
  const seed = await scratch.evaluate(async () => {
    await B68Load.need('crews');
    const pb = 'hound', P = B68Content.byId[pb];
    B68.choosePlaybook(pb);
    const sh = B68.S.sheet; sh.name = 'Zzq Sheet'; sh.ability = P.abilities[0][0]; sh.ability2 = P.abilities[1][0]; sh.customAbility = '<i>Quuxmaster</i> invented test ability';
    const play = B68Tracker.initialPlay(sh, pb);
    const char = { v: 2, name: sh.name, alias: '', code: P.prefix + '-968-1234', playbook: pb, playbookName: P.name, spec: null, sheet: sh, play, owner: 'u_player', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
    const R = B68Crews.byId.dealers, own = [R.abilities[0], R.abilities[1]];
    return { char, own: own.map(a => ({ name: a[0], text: a[1] })), mine: [P.abilities[0], P.abilities[1]].map(a => ({ name: a[0], text: a[1] })) };
  });
  await scratch.close();
  const campaign = { crew: { playbook: 'dealers', name: 'Zzq Crew', abilities: { [seed.own[0].name]: 1, [seed.own[1].name]: 1 } }, session: { number: 1, startedAt: '2026-01-02T00:00:00.000Z' }, clocks: [], updatedAt: '2026-01-02T00:00:00.000Z' };
  const store = (withTable) => { const s = { 'characters/pc1': seed.char }; if (withTable) s['campaign/main'] = campaign; return s; };

  async function open(role, withTable, w, h, pre) {
    const ctx = await b.newContext({ viewport: { width: w || 360, height: h || 780 } });
    await ctx.addInitScript(([role, st]) => { try { localStorage.setItem('__role', role); localStorage.setItem('__stub', JSON.stringify(st)); } catch (e) {} }, [role, store(withTable)]);
    await ctx.addInitScript(STUB);
    if (pre) await pre(ctx);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push(role + ' console.error: ' + m.text()); });
    p.on('pageerror', e => errs.push(role + ' pageerror: ' + e.message));
    await p.goto(URL + '#c/pc1'); await p.waitForTimeout(1500);
    return { p, ctx };
  }
  const items = (p, g) => p.$$eval('#dossier .ds-abstrip-b .ds-abgrp:nth-of-type(' + g + ') .ds-abi .ds-abi-n', n => n.map(x => x.textContent));

  for (const role of ['player', 'ro']) {
    const { p, ctx } = await open(role, true);
    const L = role;
    assert(await p.evaluate(() => document.body.dataset.mode === 'sheet' && B68Tracker.isOpen()), L + ': the sheet is open');
    const ro = await p.evaluate(() => document.getElementById('dossier').classList.contains('ds-ro'));
    assert(ro === (role === 'ro'), L + ': read-only state is ' + (role === 'ro') + ', got ' + ro);
    /* the sheet route has not loaded crews.js: the strip must fetch it itself, and a cold start must not break */
    assert(await p.evaluate(() => typeof window.B68Crews === 'undefined'), L + ': crews.js is not loaded before the strip is needed');
    await p.click('#dossier .ds-actbtn'); await p.waitForTimeout(250);
    assert(await p.evaluate(() => !!document.querySelector('#dossier .ds-roll .ds-abstrip')), L + ': the roll panel carries the strip');
    await p.waitForFunction(() => typeof window.B68Crews !== 'undefined', null, { timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(400);
    assert(await p.evaluate(() => typeof window.B68Crews !== 'undefined'), L + ': the strip asked for crews.js');
    const folded = await p.evaluate(() => { const s = document.querySelector('#dossier .ds-abstrip'), t = s.querySelector('.ds-abstrip-t'); return { open: s.classList.contains('open'), exp: t.getAttribute('aria-expanded'), body: !!s.querySelector('.ds-abstrip-b'), sum: t.textContent.replace(/\s+/g, ' ').trim(), vis: !!s.querySelector('.ds-abi') }; });
    assert(!folded.open && folded.exp === 'false' && !folded.body && !folded.vis, L + ': folded by default: ' + JSON.stringify(folded));
    assert(/yours 3/.test(folded.sum) && /crew.s 2/.test(folded.sum), L + ': the fold says how many of each: ' + folded.sum);
    await p.screenshot({ path: path.join(SHOTS, L + '-folded.png') });
    const w0 = await p.evaluate(() => (window.__writes || []).length);
    await p.click('#dossier [data-act="abstrip"]'); await p.waitForTimeout(250);
    const mine = await items(p, 1), crew = await items(p, 2);
    for (const a of seed.mine) assert(mine.indexOf(a.name) >= 0, L + ': yours lists ' + a.name);
    assert(mine.length === 3 && mine.some(n => n.indexOf('<i>Quuxmaster</i>') === 0), L + ': yours holds the two playbook abilities and the custom one, as text: ' + JSON.stringify(mine));
    assert(crew.length === 2 && seed.own.every(a => crew.indexOf(a.name) >= 0), L + ': the crew’s lists both of its abilities: ' + JSON.stringify(crew));
    assert(await p.evaluate(() => !document.querySelector('#dossier .ds-abstrip-b i')), L + ': an ability name set as text never becomes an element');
    /* each is one line until tapped, then its whole text */
    const one = await p.evaluate(() => { const t = document.querySelector('#dossier .ds-abstrip-b .ds-abgrp:nth-of-type(2) .ds-abi .ds-abi-t'); const cs = getComputedStyle(t); return { ws: cs.whiteSpace, h: t.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4, fs: parseFloat(cs.fontSize) }; });
    assert(one.ws === 'nowrap' && one.h < one.lh * 1.6, L + ': one line each while folded: ' + JSON.stringify(one));
    assert(one.fs >= 14, L + ': prose is at least 14px on a phone: ' + one.fs);
    await p.click('#dossier .ds-abstrip-b .ds-abgrp:nth-of-type(2) .ds-abi'); await p.waitForTimeout(250);
    const full = await p.evaluate(() => { const i = document.querySelector('#dossier .ds-abstrip-b .ds-abgrp:nth-of-type(2) .ds-abi'); const t = i.querySelector('.ds-abi-t'); return { open: i.classList.contains('open'), exp: i.getAttribute('aria-expanded'), text: t.textContent, ws: getComputedStyle(t).whiteSpace }; });
    assert(full.open && full.exp === 'true' && full.text === seed.own[0].text && full.ws === 'normal', L + ': a tap opens the whole text, exactly: ' + JSON.stringify({ open: full.open, ws: full.ws, same: full.text === seed.own[0].text }));
    await p.screenshot({ path: path.join(SHOTS, L + '-open.png') });
    /* it stays open across a redraw of the panel, and the same strip is in the roll-in-the-app panel */
    await p.click('#dossier [data-act="rollapp"]'); await p.waitForTimeout(300);
    assert(await p.evaluate(() => !!document.querySelector('#dossier .ds-roll:not(.ds-mark) .ds-abstrip.open .ds-abi.open')), L + ': the in-app roll panel has the strip too, as left');
    const writes = await p.evaluate(() => (window.__writes || []).filter(w => w[1].indexOf('characters/') === 0 || w[1] === 'campaign/main').length);
    assert(writes === w0, L + ': opening the strip writes nothing (' + w0 + ' -> ' + writes + ')');
    const dis = await p.$$eval('#dossier .ds-abstrip button', n => n.map(x => x.disabled));
    assert(dis.length >= 4 && dis.every(d => !d), L + ': the strip’s controls are live' + (role === 'ro' ? ' on a read-only sheet' : ''));
    /* phones: Special abilities right after Actions */
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const ord = await p.evaluate(() => { const t = s => { const n = document.querySelector('#dossier ' + s); return n && n.offsetParent ? n.getBoundingClientRect().top + scrollY : null; }; return { act: t('.ds-actbox'), ab: t('.ds-abbox'), xp: t('.ds-xpbox') }; });
    assert(ord.act != null && ord.ab != null && ord.xp != null && ord.act < ord.ab && ord.ab < ord.xp, L + ': on a phone Special abilities follow Actions, before XP: ' + JSON.stringify(ord));
    await ctx.close();
  }

  /* 2. no table yet: the crew's half says so instead of guessing, and the character's own half still works */
  {
    const { p, ctx } = await open('player', false);
    await p.click('#dossier .ds-actbtn'); await p.waitForTimeout(250);
    await p.click('#dossier [data-act="abstrip"]'); await p.waitForTimeout(250);
    const t = await p.evaluate(() => ({ sum: document.querySelector('#dossier .ds-abstrip-t').textContent.replace(/\s+/g, ' ').trim(), note: !!Array.from(document.querySelectorAll('#dossier .ds-abstrip-b .ds-abnone')).some(n => /not available/.test(n.textContent)), n: document.querySelectorAll('#dossier .ds-abstrip-b .ds-abi').length }));
    assert(/yours 3/.test(t.sum) && !/crew/.test(t.sum) && t.note && t.n === 3, 'no table: yours only, and it says the crew’s are not available: ' + JSON.stringify(t));
    await ctx.close();
  }

  /* 3. a desk: the strip is in the inline panel and Special abilities keep their column */
  {
    const { p, ctx } = await open('player', true, 1360, 900);
    await p.click('#dossier .ds-actbtn'); await p.waitForTimeout(250);
    assert(await p.evaluate(() => !!document.querySelector('#dossier .ds-roll .ds-abstrip')), 'desk: the panel carries the strip');
    await ctx.close();
  }

  /* 4. crews.js cannot be fetched: the strip says the crew's are not available, nothing throws, and redraws do not refetch
     (a failed fetch is retried at most every 30 s, not once per render) */
  {
    let hits = 0, n0 = errs.length;
    const { p, ctx } = await open('player', true, 360, 780, async (c) => { await c.route('**/crews.js*', (rt) => { hits++; rt.abort(); }); });
    await p.click('#dossier .ds-actbtn'); await p.waitForTimeout(600);
    await p.click('#dossier [data-act="abstrip"]'); await p.waitForTimeout(300);
    const h1 = hits;
    assert(h1 >= 1, 'aborted crews.js: the strip did try to fetch it (' + h1 + ')');
    for (let i = 0; i < 4; i++) { await p.click('#dossier [data-act="abstrip"]'); await p.waitForTimeout(150); await p.click('#dossier [data-act="abstrip"]'); await p.waitForTimeout(150); await p.evaluate(() => B68Tracker.refresh()); }
    await p.click('#dossier .ds-abi'); await p.waitForTimeout(300);
    const t = await p.evaluate(() => ({ note: Array.from(document.querySelectorAll('#dossier .ds-abstrip-b .ds-abnone')).some(n => /not available here/.test(n.textContent)), mine: document.querySelectorAll('#dossier .ds-abstrip-b .ds-abi').length }));
    assert(t.note && t.mine === 3, 'aborted crews.js: "not available here" shows and the character’s own half still lists: ' + JSON.stringify(t));
    assert(hits - h1 <= 1, 'aborted crews.js: taps and redraws made ' + (hits - h1) + ' more crews.js requests (at most 1 allowed), total ' + hits);
    const mine = errs.splice(n0).filter(e => !/console.error: .*ERR_FAILED/.test(e));
    mine.forEach(e => errs.push(e));
    await ctx.close();
  }

  await b.close();
  console.log(fails.length ? 'ASSERTIONS FAILED:\n  ' + fails.join('\n  ') : 'ASSERTIONS: all passed');
  console.log(errs.length ? 'ERRORS:\n  ' + errs.join('\n  ') : 'ERRORS: none');
  process.exit(fails.length || errs.length ? 1 : 0);
})();
