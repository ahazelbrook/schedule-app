// RK06 (night.flow): public lines can't get lost. The browser half of the check, run by checks/runtime/night-flow.e2e.mjs on the demo night (the invented
// Pelican Rooms, the Dovetail Crew; the public lines are "The speeches" at 22:00 and "The fireworks" at 00:00, and a hidden "Mabel at the card tables").
// Needs stage.players (where public lines queue); the settings are PATCHed on the GM state and the campaign, as players-screen.e2e does. No model, no key.
//   off      night.flow off: the box is the old one (no large card, no toggle, no flash, no tabindex, no timer) and the bundle's file is not on the page
//   large    on: a queued line flashes the box once and the oldest is large (its words in full, Send and Not now, whole and clickable, nothing under 12 px)
//   auto     auto-send off by default: nothing goes by itself (22 s); Enter on the box sends the oldest; the toggle is stored on the night (night.pubAuto),
//            logged, and with it on the oldest line goes after 20 s with its timer showing, and the send is logged; Hold keeps a line waiting for Send
//   night    End the night drops what waits (logged) and clears the choice; a reload keeps the choice for the night
//   calm     reduced motion: the flash is a cut (no animation)
//   secrecy  a line that waits is on neither the display's GET nor a phone's; the choice is on neither; the GM page makes no request outside its own origin
//   shots    RK_SHOTS=<dir>: the large card with auto-send on, 1366x768 and 1536x864, Paper and Night, kit.desk off and on; 1024x768
/* the part's own state: no choice stored on the night, no overlay up. The harness calls it before and after the part (and after a timeout); the settings are its BASE_OFF's. */
export async function reset(c) {
  await c.api('PATCH', '/gm/state', { night: { pubAuto: null } });
  await c.api('PATCH', '/gm/ambient', { overlay: null });
}
export async function rk06(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots, path, SHOTS } = c;
  const outside = [];
  const setting = async (f) => { await api('PATCH', '/gm/state', { features: f }); await api('PATCH', '/campaign', { features: f }); };
  const state = async () => { const j = (await api('GET', '/gm/state')).json || {}; return j.doc || j; };
  const nightLog = async () => { const d = await state(); return d.night && d.night.log ? Object.values(d.night.log).map((e) => e.text || '') : []; };
  const stored = async () => { const d = await state(); return d.night ? d.night.pubAuto : undefined; };
  const overlay = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; return (j.doc || {}).overlay || null; };
  const clearOverlay = () => api('PATCH', '/gm/ambient', { overlay: null });
  /* the part's own state, at its start and at its end (pass or fail): every setting it turns on is off, no choice is stored on the night, no overlay is up */
  const resetAll = async () => { await setting({ 'stage.players': false, 'night.flow': false, 'kit.desk': false }); await reset(c); };
  const displayText = async () => (await api('GET', '/gm/display?seq=-1&aseq=-1&sseq=-1&hseq=-1', null, IPAD)).text || '';

  async function open(w, h, o = {}) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', colorScheme: o.scheme || 'light', reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(atPlace('score'));
    await ctx.addInitScript(() => { window.__plAnim = 0; window.__plBg = []; const a = Element.prototype.animate; if (a) Element.prototype.animate = function () { if (this.id === 'gm-p2-lines') window.__plAnim++; return a.apply(this, arguments); };
    new MutationObserver((l) => l.forEach((m) => { if (m.target.id === 'gm-p2-lines') window.__plBg.push(m.target.style.backgroundColor); })).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true }); });
    await ctx.route('**/api/gm/assist/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], flags: [], asks: [], marked: 1 }) }));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('rk06 gm: ' + e.message));
    p.on('dialog', (d) => d.accept());
    p.on('request', (r) => { const u = r.url(); if (!/^(?:http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) outside.push(u); });
    await p.goto(BASE + '/#gm');
    await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
    await sleep(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.keyboard.press('g');
    await p.waitForSelector('.rv-head', { timeout: 15000 });
    return { p, ctx };
  }
  const boxShown = (p) => p.evaluate(() => { const o = document.querySelector('#gm-p2-lines'); return !!o && o.style.display !== 'none' && !o.hidden; });
  /* the real path: back to 21:45, then Next lands on the speeches at 22:00 and the line queues */
  async function realLine(p) {
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 14; i++) {
        if (await p.evaluate(() => { const o = document.querySelector('#rv-time'); return !!o && o.textContent.trim() === '21:45'; })) break;
        const b = await p.$('[data-rv="back"]:not([disabled])'); if (!b) break; await b.click(); await sleep(150);
      }
      await p.click('[data-rv="next"]'); await sleep(900);
      if (await until(() => boxShown(p), 2500, 150)) return true;
    }
    return false;
  }
  /* a further line, through the page's own queue (the module's lines() on the page root, logging to the night log as the page does; the flow stays from the real one) */
  const inject = (p, text) => p.evaluate((t) => {
    const box = document.querySelector('#gm-p2-lines'), P = window.B68GmPage;
    window.B68GmPlayersScreen.lines({ root: box.parentNode, log: (x) => { const n = P._night(); if (n) n.cue(x); } }).add({ kind: 'text', text: t, ms: 8000 }, (o) => P.showOverlay(o));
  }, text);
  const rows = (p) => p.evaluate(() => { const o = document.querySelector('#gm-p2-lines'); return o ? [...o.querySelectorAll('.gm-p2-line')].map((r) => ({ big: r.classList.contains('gm-pl-big'), text: r.textContent })) : []; });
  const geo = (p) => p.evaluate(() => {
    const box = document.querySelector('#gm-p2-lines'), r = box.getBoundingClientRect(), hit = (a, b) => !(b.left >= a.right || b.right <= a.left || b.top >= a.bottom || b.bottom <= a.top);
    const sendB = box.querySelector('[data-p2-line="send"]'), sr = sendB.getBoundingClientRect(), at = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
    const ctl = [...document.querySelectorAll('button, input, a[href], select, textarea')].filter((b) => !box.contains(b)).filter((b) => { const q = b.getBoundingClientRect(); return q.width > 0 && q.height > 0 && b.offsetParent !== null && q.top < innerHeight && hit(r, q); }).map((b) => (b.textContent || b.id || b.tagName).trim().slice(0, 24));
    const big = box.querySelector('.gm-pl-big'), tx = big && big.querySelector('.gm-p2-text'), cs = tx && getComputedStyle(tx);
    const small = [...box.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.textContent.trim().slice(0, 20));
    return { box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      sendWhole: sr.width > 0 && sr.right <= innerWidth && sr.bottom <= innerHeight && (at === sendB || sendB.contains(at)), covers: ctl, small,
      full: !!tx && cs.whiteSpace === 'normal' && cs.textOverflow !== 'ellipsis' && tx.scrollWidth <= tx.clientWidth + 1, px: tx ? parseFloat(cs.fontSize) : 0, tabindex: box.getAttribute('tabindex'), flash: box.getAttribute('data-pl-flash'), anim: window.__plAnim };
  });

  await resetAll();
  try {
  /* ---------- off ---------- */
  await setting({ 'stage.players': true, 'night.flow': false, 'kit.desk': false });
  await clearOverlay();
  {
    const { p, ctx } = await open(1366, 768);
    check(await p.evaluate(() => !window.B68GmPublicLines), 'off: gm/public-lines.js is not on the page (the night-flow bundle is not asked for)');
    check(await realLine(p), 'off: Next onto the public event queues the line (the players\' screen is on)');
    const g = await geo(p).catch(() => null);
    const old = await p.evaluate(() => { const o = document.querySelector('#gm-p2-lines'); return { big: o.querySelectorAll('.gm-pl-big').length, auto: o.querySelectorAll('[data-p2-line="auto"], [data-pl]').length, tab: o.hasAttribute('tabindex'), flash: o.hasAttribute('data-pl-flash'), anim: window.__plAnim, rows: o.querySelectorAll('.gm-p2-line').length, ell: getComputedStyle(o.querySelector('.gm-p2-text')).textOverflow }; });
    check(old.big === 0 && old.auto === 0 && !old.tab && !old.flash && old.anim === 0 && old.rows === 1 && old.ell === 'ellipsis', 'off: the old box, byte for byte: one small row, no large card, no toggle, no flash, no tabindex (' + JSON.stringify(old) + ')');
    check((await stored()) === undefined, 'off: nothing is stored on the night (night.pubAuto)');
    await p.evaluate(() => document.querySelector('#gm-p2-lines [data-p2-line="send"]').click());
    check(!!(await until(async () => { const o = await overlay(); return o && o.kind === 'text' ? o : null; }, 6000)), 'off: Send shows the line, as before');
    void g;
    await ctx.close();
  }

  /* ---------- on ---------- */
  await setting({ 'stage.players': true, 'night.flow': true, 'kit.desk': false });
  await clearOverlay();
  let first = '';
  {
    const { p, ctx } = await open(1366, 768);
    check(!!(await until(() => p.evaluate(() => !!window.B68GmPublicLines && typeof window.B68GmPublicLines.attach === 'function'), 10000)), 'on: the night-flow bundle loads gm/public-lines.js');
    check(await realLine(p), 'on: Next onto the public event queues the line');
    await sleep(500);
    let g = await geo(p);
    let r = await rows(p);
    first = r[0] ? r[0].text : '';
    check(r.length === 1 && r[0].big && /speeches/i.test(r[0].text), 'large: the one waiting line is the large card (' + JSON.stringify(r) + ')');
    check(g.flash === '1' && g.anim === 1, 'large: the box flashed once as the line queued (count ' + g.flash + ', animations ' + g.anim + ')');
    check(g.full && g.px >= 14, 'large: its words are in full, not clipped, at ' + g.px + ' px');
    check(g.sendWhole && g.inside, 'large: Send is whole and clickable, and the box is inside the window ' + JSON.stringify(g.box));
    check(g.covers.length === 0, 'large: the box covers no control (' + g.covers.join(', ') + ')');
    check(g.small.length === 0, 'large: nothing in the box is under 12 px (' + g.small.join(', ') + ')');
    check(g.tabindex === '0', 'large: the box can take the focus (tabindex 0)');
    const tg = await p.$eval('#gm-p2-lines [data-p2-line="auto"]', (e) => ({ checked: e.checked, label: e.parentNode.textContent.trim(), type: e.type }));
    check(tg.type === 'checkbox' && tg.checked === false && tg.label === 'Send them by themselves after 20 s', 'auto: the toggle is there, off by default (' + JSON.stringify(tg) + ')');
    check((await p.$$('#gm-p2-lines [data-pl-timer]')).length === 0, 'auto: no timer while it is off');

    /* a second line: flashes again, the first stays the large one */
    await inject(p, 'The fireworks go up over the quay');
    await sleep(500);
    r = await rows(p); g = await geo(p);
    check(r.length === 2 && r[0].big && !r[1].big && /speeches/i.test(r[0].text) && /fireworks/i.test(r[1].text), 'large: a second line queues behind it, small; the oldest stays the large one (' + r.map((x) => (x.big ? 'BIG ' : '') + x.text.slice(0, 24)).join(' | ') + ')');
    check(g.flash === '2' && g.anim === 2, 'large: and the box flashed again (count ' + g.flash + ')');
    check(g.covers.length === 0 && g.inside, 'large: two lines, still no control covered');
    check(!!(await until(async () => { const l = await nightLog(); return l.some((t) => /^Public line waiting for Send: The speeches/.test(t)) && l.some((t) => /^Public line waiting for Send: The fireworks/.test(t)); }, 8000)), 'large: both are in the night log as they queue');
    await shots(p, 'rk06-large-two-lines-desk-off-paper');

    /* secrecy while they wait */
    const dt = await displayText(), pc = (await api('GET', '/campaign', undefined, P1)).text || '';
    check(!/fireworks go up/i.test(dt) && !/pubAuto/.test(dt) && !/pubAuto/.test(pc), 'secrecy: a line that waits, and the choice, are on neither the display\'s GET nor a phone\'s');
    check(!/card tables/i.test(await p.$eval('#gm-p2-lines', (e) => e.textContent)), 'secrecy: a hidden event\'s line never queues');

    /* nothing goes by itself while the choice is off */
    await sleep(22000);
    r = await rows(p);
    check(r.length === 2 && !(await overlay()), 'auto: with the choice off, 22 s on, both lines still wait and nothing is on the iPad');

    /* Enter on the box sends the oldest */
    await p.evaluate(() => document.querySelector('#gm-p2-lines').focus());
    check(await p.evaluate(() => document.activeElement === document.querySelector('#gm-p2-lines')), 'keys: the box takes the focus');
    await p.keyboard.press('Enter');
    const ov = await until(async () => { const o = await overlay(); return o && o.kind === 'text' ? o : null; }, 6000);
    check(!!ov && /speeches/i.test(ov.text || ''), 'keys: Enter on the box sends the oldest line (' + (ov && ov.text) + ')');
    r = await rows(p);
    check(r.length === 1 && r[0].big && /fireworks/i.test(r[0].text), 'keys: the next line is now the large one');
    await clearOverlay();

    /* the toggle, stored for the night, logged */
    await p.click('#gm-p2-lines [data-p2-line="auto"]');
    const st1 = await until(async () => { const v = await stored(); return typeof v === 'number' ? v : null; }, 5000);
    const t0 = Date.now();
    check(!!st1 && Math.abs(st1 - t0) < 30000, 'auto: the toggle is stored on the night, one number (night.pubAuto ' + st1 + ')');
    check(!!(await until(async () => (await nightLog()).includes('Public lines: auto-send on'), 5000)), 'auto: and logged');
    const tm = await until(() => p.evaluate(() => { const t = document.querySelector('#gm-p2-lines [data-pl-timer]'); return t ? t.textContent : null; }), 3000);
    check(/^Sends in \d+ s$/.test(tm || '') && (await p.$('#gm-p2-lines [data-p2-line="hold"]')) !== null && (await p.$eval('#gm-p2-lines [data-p2-line="auto"]', (e) => e.checked)), 'auto: the oldest line shows its timer ("' + tm + '") and Hold; the toggle is ticked');
    await sleep(3200);
    const tm2 = await p.evaluate(() => document.querySelector('#gm-p2-lines [data-pl-timer]').textContent);
    check(Number((/\d+/.exec(tm2) || [99])[0]) < Number((/\d+/.exec(tm) || [0])[0]), 'auto: the timer counts down (' + tm + ' then ' + tm2 + ')');
    await shots(p, 'rk06-auto-on-timer-desk-off-paper');
    const sent = await until(async () => { const o = await overlay(); return o && o.kind === 'text' && /fireworks/i.test(o.text || '') ? o : null; }, 30000, 250);
    const took = (Date.now() - st1) / 1000;
    check(!!sent && took >= 18 && took <= 27, 'auto: the line goes by itself after about 20 s (' + took.toFixed(1) + ' s)');
    check((await rows(p)).length === 0 && !(await boxShown(p)), 'auto: and the box is gone');
    check(!!(await until(async () => (await nightLog()).some((t) => /^Public line auto-sent: The fireworks/.test(t)), 5000)), 'auto: the auto-send is in the night log');
    await clearOverlay();

    /* Hold */
    await inject(p, 'The band plays the last waltz');
    await sleep(600);
    check(/^Sends in \d+ s$/.test(await p.evaluate(() => document.querySelector('#gm-p2-lines [data-pl-timer]').textContent)), 'hold: a new line with the choice on starts its own 20 s');
    await p.click('#gm-p2-lines [data-p2-line="hold"]');
    check(/^Held/.test(await p.evaluate(() => document.querySelector('#gm-p2-lines [data-pl-timer]').textContent)) && (await p.$('#gm-p2-lines [data-p2-line="hold"]')) === null, 'hold: Hold stops the timer and says the line is held');
    await sleep(23000);
    check((await rows(p)).length === 1 && !(await overlay()), 'hold: 23 s on, the held line still waits for Send and nothing went to the iPad');
    await p.click('#gm-p2-lines [data-p2-line="later"]');
    check(!!(await until(async () => (await nightLog()).some((t) => /^Public line not shown \(Not now\): The band plays/.test(t)), 5000)), 'hold: Not now puts it away and logs it');

    /* a GM overlay on the iPad holds the countdown: the stamp stays, and the line goes once it has cleared */
    await inject(p, 'The doors open to the street');
    await sleep(600);
    await api('PATCH', '/gm/ambient', { overlay: { id: 'rk06-stamp', kind: 'text', text: 'The stamp is up', ms: 60000 } });
    await sleep(24000);
    const held1 = await overlay();
    check((await rows(p)).length === 1 && !!held1 && held1.id === 'rk06-stamp', 'wait: 24 s on with the GM overlay up, the line still waits and the overlay is untouched (' + (held1 && held1.id) + ')');
    check(/clear/.test(await p.evaluate(() => (document.querySelector('#gm-p2-lines [data-pl-timer]') || {}).textContent || '')), 'wait: and its card says it sends once the iPad is clear');
    await clearOverlay();
    const went = await until(async () => { const o = await overlay(); return o && /doors open/.test(o.text || '') ? o : null; }, 15000, 250);
    check(!!went && (await rows(p)).length === 0, 'wait: the overlay cleared, the line went (' + (went && went.text) + ')');
    check(!!(await until(async () => (await nightLog()).some((t) => /^Public line auto-sent: The doors open/.test(t)), 5000)), 'wait: and that is logged');
    await clearOverlay();

    /* the setting is read at send time: off mid-countdown, nothing is sent */
    await inject(p, 'The band packs up for the night');
    await sleep(600);
    await setting({ 'night.flow': false });
    await sleep(26000);
    check(!(await overlay()) && (await rows(p)).length === 1, 'setting: night.flow off mid-countdown, 26 s on, nothing was sent and the line waits');
    await p.click('#gm-p2-lines [data-p2-line="later"]');
    await setting({ 'night.flow': true });
    await sleep(5000);

    /* a reload keeps the choice for the night */
    await p.reload();
    await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
    await sleep(1500); await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.keyboard.press('g'); await p.waitForSelector('.rv-head', { timeout: 15000 });
    check(typeof (await stored()) === 'number', 'night: a reload keeps the choice (night.pubAuto is still stored)');
    check(await realLine(p), 'night: a line queues after the reload');
    await sleep(500);
    check(await p.$eval('#gm-p2-lines [data-p2-line="auto"]', (e) => e.checked) && /^Sends in \d+ s$/.test(await p.evaluate(() => document.querySelector('#gm-p2-lines [data-pl-timer]').textContent)), 'night: the toggle comes back ticked with its timer running');

    /* End the night: the lines are dropped and logged, and the choice goes with the night */
    await p.click('[data-rv="menu"]'); await p.waitForSelector('[data-rv="menuitem"][data-mid="end-night"]', { timeout: 5000 });
    await p.click('[data-rv="menuitem"][data-mid="end-night"]');
    check(!!(await until(async () => !(await boxShown(p)), 8000)), 'night: End the night empties the box');
    check(!!(await until(async () => (await nightLog()).some((t) => /^Public line not sent \(the night ended\): The speeches/.test(t)), 8000)), 'night: and logs the line as not sent');
    check(!!(await until(async () => (await stored()) === undefined, 8000)), 'night: and the choice goes with the night (night.pubAuto is gone)');
    check(!(await overlay()), 'night: nothing was sent to the iPad by the end');
    await ctx.close();
  }

  /* ---------- reduced motion: a cut ---------- */
  {
    await clearOverlay();
    const { p, ctx } = await open(1366, 768, { reduced: true });
    check(await realLine(p), 'calm: a line queues under reduced motion');
    await sleep(250);
    const g = await geo(p), bgs = await p.evaluate(() => window.__plBg.slice());
    check(g.flash === '1' && g.anim === 0 && bgs.some((b) => /107, 58, 18/.test(b)), 'calm: the flash is a cut: no animation, a brighter ground at once (' + bgs.join(' | ') + ', animations ' + g.anim + ')');
    await sleep(1200);
    check(/26, 23, 20/.test(await p.$eval('#gm-p2-lines', (e) => e.style.backgroundColor)), 'calm: and back to normal within a second');
    await p.evaluate(() => document.querySelector('#gm-p2-lines [data-p2-line="later"]').click());
    await ctx.close();
  }

  /* ---------- both desks, the sizes ---------- */
  void first;
  const SIZES = [[1366, 768], [1536, 864]];
  for (const kit of [false, true]) {
    await setting({ 'stage.players': true, 'night.flow': true, 'kit.desk': kit });
    for (const scheme of ['light', 'dark']) {
      for (const [w, h] of SIZES.concat(!kit && scheme === 'light' ? [[1024, 768]] : [])) {
        if (!SHOTS && (w !== 1366 || scheme !== 'light')) continue;
        const { p, ctx } = await open(w, h, { scheme });
        const tag = 'desk-' + (kit ? 'on' : 'off') + '-' + (scheme === 'dark' ? 'night' : 'paper') + '-' + w;
        if (!(await realLine(p))) { check(false, tag + ': a line queues'); await ctx.close(); continue; }
        await inject(p, 'The band plays the last waltz of the night and the room turns to watch');
        await sleep(700);
        await p.click('#gm-p2-lines [data-p2-line="auto"]').catch(() => {});
        await sleep(800);
        const g = await geo(p);
        check(g.inside && g.sendWhole && g.small.length === 0 && g.full, tag + ': the large card is whole, readable and inside the window (' + JSON.stringify({ box: g.box, inside: g.inside, send: g.sendWhole, small: g.small, full: g.full, covers: g.covers, px: g.px }) + ')');
        if (g.covers.length) console.log('NOTE ' + tag + ': the box meets ' + g.covers.join(', '));
        await shots(p, 'rk06-' + tag);
        await p.click('#gm-p2-lines [data-p2-line="auto"]').catch(() => {});
        await api('PATCH', '/gm/state', { night: { pubAuto: null } });
        await ctx.close();
      }
    }
  }
  check(outside.length === 0, 'the GM page made no request outside its own origin (' + outside.length + ')');
  } finally { await resetAll(); }
}
