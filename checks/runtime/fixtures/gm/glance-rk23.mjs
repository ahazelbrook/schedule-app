// RK23 (gm.glance): when it goes loud. The browser half of the check, run by checks/runtime/glance.e2e.mjs on the demo night (the invented Pelican Rooms; the site's hidden
// "House alarm" clock, 6 segments and 6 beats; the Dovetail Crew). The part appends the fixture's "## When it goes loud" section (fixtures/gm/glance-rk23-loud.md) to the
// demo's prep note in the LOCAL pack and puts the pack back at its end. No model, no key, $0.
//   off      the alarm's popover is as it was: no beats list, no plan, no getaway chip, and gm/loud.js is not on the page (the section is in the pack all the same)
//   on       the popover lists every beat (Done / Now / Next in words); below the top segment the plan is one dim line; the getaway chip makes ONE hidden danger clock in one tap
//            (Undo takes it out), and then reads where it stands; at the top segment the plan is on screen: who goes where, which doors shut, where the VIP goes
//   kit      the same on the kit desk, the chip a B68Ui button
//   secrecy  the display's GET, a phone's campaign and the table screen hold none of the plan, its markers or the getaway clock
//   shots    RK_SHOTS=<dir>: the popover at the top segment, 1366x768 and 1536x864, Paper and Night, kit.desk off and on; and 1024x768
// Every part sets the settings and the clocks it uses at its start, and leaves gm.glance, map.security, kit.desk, the alarm clock and the pack as it found them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOTE = readFileSync(path.join(HERE, 'glance-rk23-loud.md'), 'utf8');
const SECTION = (() => { const a = NOTE.search(/^## When it goes loud · /m), b = NOTE.indexOf('\n## Cues'); return NOTE.slice(a, b).trim(); })();
let ORIG = null;      /* the demo's prep part as found: { src, body } */

async function putPrep(c, withSection) {
  const { api } = c;
  if (!ORIG) {
    const r = await api('GET', '/gm/pack?part=prep');
    if (r.status !== 200 || !r.json || !r.json.body) throw new Error('no prep part: ' + r.status);
    ORIG = { src: r.json.src || {}, body: r.json.body };
  }
  const body = JSON.parse(JSON.stringify(ORIG.body));
  if (withSection) {
    const note = body.notes[body.notes.length - 1], blocks = note.blocks.filter((b) => b && b.k === 'md'), last = blocks[blocks.length - 1];
    if (!last) throw new Error('the prep note has no md block');
    last.src = String(last.src) + '\n\n' + SECTION;
  }
  const r = await api('POST', '/gm/pack', { part: 'prep', src: ORIG.src, body });
  if (r.status !== 200) throw new Error('could not put the prep part: ' + r.status + ' ' + r.text.slice(0, 200));
}
async function resetState(c, on, extra, filled) {
  const { api, sleep } = c;
  const f = { 'gm.glance': on, 'map.security': on ? true : null, 'kit.desk': null, ...(extra || {}) };
  await api('PATCH', '/gm/state', { features: f }); await api('PATCH', '/campaign', { features: f });
  const doc = (await api('GET', '/campaign')).json.doc, ops = (doc.clocks || []).filter((k) => /^getaway$/i.test(String(k.name))).map((k) => ({ remove: k.id }));
  ops.push({ id: 'c-alarm', filled: filled == null ? 2 : filled });
  await api('PATCH', '/campaign', { clockOps: ops });
  const crew = {}; for (const [id, room] of Object.entries({ 'pc-nell': 'Cocktail lounge', 'pc-ray': 'Showroom', 'pc-tam': 'Showroom' })) crew[id] = { room, disguise: 'guest', moved: null, noticed: null };
  await api('PATCH', '/gm/state', { ball: { site: 'The Pelican Rooms', v: 2, start: 45, t: 45, crew, view: null, fic: null, timer: null } });
  await sleep(300);
}
export const reset = async (c) => { await resetState(c, false); if (ORIG) await putPrep(c, false).catch(() => {}); };
export async function rk23(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots } = c;
  const alarm = async () => (((await api('GET', '/campaign')).json.doc.clocks || []).find((k) => k.id === 'c-alarm') || {}).filled;
  const getaways = async () => ((await api('GET', '/campaign')).json.doc.clocks || []).filter((k) => /^getaway$/i.test(String(k.name)));

  async function open(w, h, scheme) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w || 1366, height: h || 768 }, serviceWorkers: 'block', colorScheme: scheme || 'light' });
    await ctx.addInitScript(atPlace('score'));
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 700; });
    if (scheme) await ctx.addInitScript((t) => { try { localStorage.setItem('b68.theme', t); } catch (e) { /* no storage */ } }, scheme === 'dark' ? 'dark' : 'light');
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('rk23 gm: ' + e.message));
    p.on('dialog', (d) => d.accept());
    await p.goto(BASE + '/#gm');
    await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
    await sleep(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.keyboard.press('b');
    await p.keyboard.press('g');
    await p.waitForSelector('.rv-head', { timeout: 20000 });
    return { p, ctx };
  }
  /* open the alarm's popover (the header's alarm button) and wait for it */
  async function openPop(p, need) {
    await p.waitForSelector('#gm-runv [data-rv="alarm"]', { timeout: 20000 });
    if (!(await p.$('#gm-runv .rv-alarmpop'))) await p.click('#gm-runv [data-rv="alarm"]');
    await p.waitForSelector('#gm-runv .rv-alarmpop', { timeout: 10000 });
    if (need) await p.waitForSelector(need, { timeout: 15000 });
  }
  const rows = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#gm-runv .rv-alarmpop .gl-lb')).map((li) => ({ state: (li.className.match(/gl-lb-(done|now|next)/) || [])[1] || '', text: li.querySelector('.gl-lb-t').textContent, word: li.querySelector('.gl-lb-s').textContent.replace(/\s+/g, ' ').trim() })));
  const popText = (p) => p.evaluate(() => { const e = document.querySelector('#gm-runv .rv-alarmpop'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const waitFilled = (n) => until(async () => (await alarm()) === n, 8000, 200);

  try {
    await putPrep(c, true);

    /* ---------- off: the popover as it was, the section in the pack all the same ---------- */
    await resetState(c, false, { 'map.security': true });
    {
      const { p, ctx } = await open();
      await openPop(p);
      const t = await popText(p);
      check(await p.evaluate(() => !window.B68GmLoud), 'off: gm/loud.js is not on the page (the gm-glance bundle is not asked for)');
      check((await p.$$('#gm-runv .rv-alarmpop .gl-loud, #gm-runv .rv-alarmpop [data-site="loud-make"]')).length === 0, 'off: no beats list, no plan, no getaway chip in the popover');
      check(/House alarm 2:/.test(t) && /GM-ONLY-BEAT-2/.test(t) && !/GM-ONLY-BEAT-3/.test(t), 'off: the popover says this beat alone: ' + t.slice(0, 120));
      await ctx.close();
    }

    /* ---------- on, below the top segment: every beat; the plan is one dim line; the getaway chip is one tap ---------- */
    await resetState(c, true);
    {
      const { p, ctx } = await open();
      await openPop(p, '#gm-runv .rv-alarmpop .gl-lb');
      const r = await rows(p);
      check(r.length === 6 && r.map((x) => x.state).join() === 'done,now,next,,,', 'on: six beats, Done / Now / Next by the clock at 2/6: ' + r.map((x) => x.state || '-').join(' '));
      check(r.every((x, i) => x.text === 'GM-ONLY-BEAT-' + (i + 1)), 'on: each row is its own beat, in order');
      check(r[1].word === '● Now' && r[2].word === '→ Next' && r[0].word === '✓ Done', 'on: the states are words with a shape: ' + r.slice(0, 3).map((x) => x.word).join(' | '));
      check((await p.$$('#gm-runv .rv-alarmpop .gl-loud-beats button, #gm-runv .rv-alarmpop .gl-loud-beats a')).length === 0, 'on: the next beat is a read-only line, never a control');
      const t = await popText(p);
      check(/House alarm 2:/.test(t) && /The plan for the top segment is written: 7 lines/.test(t), 'on: the popover still says this beat, and that the plan is written');
      check(!/Mabel Quist goes down|GM-ONLY-LOUD-DOORS/.test(t) && (await p.$$('#gm-runv .gl-loud-plan')).length === 0, 'on: below the top segment the plan itself is not drawn');
      const chip = await p.$$('#gm-runv .rv-alarmpop [data-site="loud-make"]');
      check(chip.length === 1 && /Make the Getaway clock/.test(await chip[0].textContent()), 'on: one getaway chip: Make the Getaway clock');
      check((await getaways()).length === 0, 'on: nothing is on the table before the tap');
      await chip[0].click();
      const k = await until(async () => (await getaways())[0], 8000, 200);
      check(!!k && (await getaways()).length === 1 && k.size === 6 && k.filled === 0 && k.hidden === true && k.kind === 'danger', 'one tap makes ONE hidden danger clock, Getaway 0/6: ' + JSON.stringify(k));
      check(!!(await until(async () => /Getaway is on the table: 0\/6/.test(await popText(p)), 8000, 200)), 'then the popover reads it, and the chip is gone: ' + (await popText(p)).slice(-90));
      check((await p.$$('#gm-runv .rv-alarmpop [data-site="loud-make"]')).length === 0, 'the chip is gone once the clock is there');
      /* the clock is hidden and the table's doc is one shared doc, so (as for the site's own alarm clock) a phone's copy may list it, flagged hidden; the display and the table screen never name it */
      const dg = await api('GET', '/gm/display', undefined, IPAD), pc = await api('GET', '/campaign', undefined, P1), ts = await api('GET', '/table/screen', undefined, P1);
      const bad = ['GM-ONLY-LOUD', 'Mabel Quist goes down', 'When it goes loud', 'loud-make', 'Getaway', 'gl-loud'].filter((x) => dg.text.includes(x) || ts.text.includes(x)).concat(['GM-ONLY-LOUD', 'Mabel Quist goes down', 'When it goes loud', 'loud-make', 'gl-loud'].filter((x) => pc.text.includes(x)));
      const phoneClock = (((pc.json && (pc.json.doc || pc.json).clocks) || []).filter((k) => /^getaway$/i.test(String(k.name))));
      check(bad.length === 0 && phoneClock.every((k) => k.hidden === true), 'secrecy: the display GET and the table screen never name the clock or the plan, a phone campaign holds none of the plan, and the clock there is flagged hidden (' + bad + ')');
      /* Undo, from the toast */
      const undo = await p.waitForSelector('button:has-text("Undo")', { timeout: 6000 }).catch(() => null);
      if (undo) { await undo.click(); check(!!(await until(async () => (await getaways()).length === 0, 8000, 200)), 'Undo takes the clock off the table'); }
      else check(false, 'the toast has an Undo button');
      check(!!(await until(async () => (await p.$$('#gm-runv .rv-alarmpop [data-site="loud-make"]')).length === 1, 8000, 200)), 'after Undo the chip is back');
      await ctx.close();
    }

    /* ---------- on, at the top segment: the plan is on screen ---------- */
    await resetState(c, true, null, 6);
    {
      const { p, ctx } = await open();
      await openPop(p, '#gm-runv .rv-alarmpop .gl-loud-plan');
      const t = await popText(p), r = await rows(p);
      check(r.length === 6 && r.map((x) => x.state).join() === 'done,done,done,done,done,now', 'top: the last beat is Now, nothing after it: ' + r.map((x) => x.state || '-').join(' '));
      check(/When it goes loud the evacuation/.test(t) && /Who goes where/.test(t) && /Doors/.test(t), 'top: the plan\'s heading and its groups are on screen');
      check(/Guests out through the Cocktail lounge to the quay steps/.test(t) && /Staff Dov Kessler holds the Security control room/.test(t), 'top: who goes where');
      check(/Shut the Private card rooms and the lift \(GM-ONLY-LOUD-DOORS\)/.test(t) && /Open the Cocktail lounge, and nothing else/.test(t), 'top: which doors shut');
      check(/VIP Mabel Quist goes down to the Underground counting room with Lotte Brand/.test(t), 'top: where the VIP goes');
      check(!/The plan for the top segment is written/.test(t), 'top: the dim line is gone');
      check(!/▶|handout|night plan|Getaway \/ 6/.test(t), 'top: the chips of the note are not text in the plan');
      check((await p.$$('#gm-runv .rv-alarmpop [data-site="loud-make"]')).length === 1, 'top: the getaway chip is there too');
      const m = await p.evaluate(() => { const e = document.querySelector('#gm-runv .rv-alarmpop'), r = e.getBoundingClientRect(), small = []; e.querySelectorAll('.gl-loud *').forEach((n) => { const s = parseFloat(getComputedStyle(n).fontSize); if (n.textContent.trim() && s < 12) small.push(s); });
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, over: e.scrollWidth - e.clientWidth, small, docOver: document.documentElement.scrollWidth - innerWidth }; });
      check(m.left >= 0 && m.right <= m.vw && m.bottom <= m.vh && m.over <= 0 && m.docOver <= 0 && !m.small.length, 'top: the popover fits the screen (' + JSON.stringify(m) + ')');
      await shots(p, 'rk23-popover-1366x768-paper-off');
      await ctx.close();
    }

    /* ---------- the kit desk ---------- */
    await resetState(c, true, { 'kit.desk': true }, 6);
    {
      const { p, ctx } = await open();
      await openPop(p, '#gm-runv .rv-alarmpop .gl-loud-plan');
      const chip = await p.$$('#gm-runv .rv-alarmpop .ui-btn[data-site="loud-make"]');
      check(chip.length === 1, 'kit desk: the plan is on screen and the getaway chip is a B68Ui button');
      await chip[0].click();
      check(!!(await until(async () => (await getaways()).length === 1, 8000, 200)), 'kit desk: one tap makes the clock');
      check(!!(await until(async () => /Getaway is on the table: 0\/6/.test(await popText(p)), 8000, 200)), 'kit desk: and the popover reads it');
      await ctx.close();
    }

    /* ---------- the screenshots to look at (RK_SHOTS) ---------- */
    if (c.SHOTS) {
      for (const desk of [false, true]) {
        for (const scheme of ['light', 'dark']) {
          for (const [w, h] of [[1366, 768], [1536, 864], [1024, 768]]) {
            if (w === 1024 && scheme === 'dark') continue;
            for (const filled of [2, 6]) {
              await resetState(c, true, { 'kit.desk': desk ? true : null }, filled);
              const { p, ctx } = await open(w, h, scheme);
              await openPop(p, '#gm-runv .rv-alarmpop .gl-lb');
              await sleep(400);
              await shots(p, 'rk23-popover-' + (filled === 6 ? 'top' : 'mid') + '-desk-' + (desk ? 'on' : 'off') + '-' + (scheme === 'dark' ? 'night' : 'paper') + '-' + w + 'x' + h);
              await ctx.close();
            }
          }
        }
      }
    }
  } finally {
    await resetState(c, false).catch(() => {});
    if (ORIG) await putPrep(c, false).catch(() => {});
  }
  return true;
}
