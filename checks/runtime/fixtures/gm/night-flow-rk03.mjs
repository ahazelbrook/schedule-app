// RK03 (night.flow): a stamped consequence ticks its clock. The browser half of the check, run by checks/runtime/night-flow.e2e.mjs on the demo night (the
// invented Pelican Rooms, the Dovetail Crew in the Showroom, the site's hidden "House alarm" clock). No key, no model, no spend.
//   off      no Tick control and no night-ticks.js; a stamped 1-3 moves no clock
//   alarm    on: the control starts from the play's alarm clock +1; stamp, 1-3: the alarm 0 to 1, with Undo; 1-3 again: still 1; a new stamp and Clean:
//            still 1; a new stamp and 4/5: 2, Undo: 1; the night log has the line
//   room     the Showroom's "If it goes wrong" line given a `▶ tick: House alarm / 2` span (the browser's own route over the pack: nothing stored): the
//            Roll's line has no span, the iPad's payload is the line alone, and a 4/5 ticks by 2
//   loose    a span naming "House alarms" (a near miss): the control says No clock called, and a stamped 1-3 toasts it and ticks nothing (RK04's rule)
//   typed    a span typed into the Roll's line: the iPad gets the line without it, and the 1-3 ticks the clock it names
//   kit      the same on the kit desk (kit.desk on)
//   secrecy  the display's GET never holds the hidden clock's name; a phone's table document marks it hidden; no request leaves the origin
//   shots    RK_SHOTS=<dir>: the Roll with the control, 1366x768 and 1536x864, Paper and Night, kit.desk off and on; 1024x768; 390x844
//   reset    at its start and its end: night.flow and kit.desk off, the alarm back at the demo night's 2 of 6, the Roll's line empty, nothing on the iPad
const LINE = 'If it goes wrong: Dov Kessler turns and looks straight at you';
export async function reset(c) {
  const flags = { 'night.flow': false, 'kit.desk': false };
  await c.api('PATCH', '/gm/state', { features: flags, con: { live: { threat: '' } } }); await c.api('PATCH', '/campaign', { features: flags });
  await c.api('PATCH', '/campaign', { clockOps: [{ id: 'c-alarm', filled: 2 }] });
  await c.api('PATCH', '/gm/ambient', { overlay: null });
}
export async function rk03(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots } = c;
  await reset(c);
  const alarm = async () => (((await api('GET', '/campaign')).json.doc.clocks || []).find((k) => k.id === 'c-alarm') || {}).filled;
  const setAlarm = async (n) => { await api('PATCH', '/campaign', { clockOps: [{ id: 'c-alarm', filled: n }] }); return until(async () => (await alarm()) === n, 5000); };
  const setting = async (on, extra) => { const f = { 'night.flow': on, 'kit.desk': false, ...(extra || {}) }; await api('PATCH', '/gm/state', { features: f }); await api('PATCH', '/campaign', { features: f }); };
  const overlay = async () => { const o = (((await api('GET', '/gm/display', undefined, IPAD)).json || {}).ambient || {}).doc; return o && o.overlay ? o.overlay : null; };
  const wait = (fn, ms = 8000) => until(fn, ms);
  const outside = [];
  check((await alarm()) === 2, 'reset: the part starts from the demo night’s alarm at 2 of 6');

  async function open(o = {}) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: o.w || 1366, height: o.h || 768 }, serviceWorkers: 'block', colorScheme: o.scheme || 'light' });
    await ctx.addInitScript(atPlace('score'));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('rk03 gm: ' + e.message));
    p.on('request', (r) => { const u = r.url(); if (!/^(?:http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) outside.push(u); });
    let routed = false;
    if (o.span) {
      /* the room's line with a tick span: the pack as the page fetches it, changed in the browser only */
      await p.route('**/api/gm/pack**', async (route) => {
        const r = await route.fetch(); let body = await r.text();
        if (body.includes(LINE)) { body = body.split(LINE).join(LINE + ' `▶ tick: ' + o.span + '`'); routed = true; }
        return route.fulfill({ response: r, body });
      });
    }
    await p.goto(BASE + '/#gm');
    await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
    await sleep(2000);
    if (o.span) check(routed, 'the room’s line is given its span (' + o.span + ') in the browser');
    return { p, ctx };
  }
  const undoBtn = (p) => p.locator('.gm-ugtoast button:has-text("Undo"), [data-kit-toast] button:has-text("Undo"), .ui-toast button:has-text("Undo")').first();
  const body = (p) => p.evaluate(() => document.body.innerText);
  const ctl = (p) => p.evaluate(() => {
    const d = document.querySelector('#gm-nt'); if (!d) return null;
    const row = (r) => { const x = d.querySelector('[data-nt-row="' + r + '"]'); return { clock: x.querySelector('[data-nt="clock"]').value, n: x.querySelector('[data-nt="n"]').value }; };
    const r = d.getBoundingClientRect();
    return { r13: row('13'), r45: row('45'), note: d.querySelector('.nt-note').textContent, after: (d.previousElementSibling || {}).id || (d.previousElementSibling || {}).className || '', h: r.height, fs: getComputedStyle(d.querySelector('.nt-on')).fontSize };
  });
  /* a stamp: risky, the Roll's line, on the iPad; -> the overlay the display is served */
  const stampIt = async (p) => {
    await p.click('#gm-pos [data-v="risky"]'); await sleep(300);
    const prev = (await overlay()) || {};
    await p.click('#gm-stamp [data-gm="stamp"]');
    return wait(async () => { const o = await overlay(); return o && o.kind === 'report' && o.id !== prev.id ? o : null; }, 8000);
  };
  const mark = (p, sit) => p.click('#gm-buttons [data-sit="' + sit + '"]');
  const settle = () => sleep(1500);

  /* ---------- off ---------- */
  await setting(false);
  {
    const { p, ctx } = await open();
    check(await p.evaluate(() => !window.B68GmNightTicks && !document.querySelector('#gm-nt')), 'off: no night-ticks.js and no Tick control on the Roll');
    await setAlarm(0);
    const o = await stampIt(p);
    check(!!o, 'off: the stamp goes up');
    await mark(p, 'onetothree'); await settle();
    check((await alarm()) === 0, 'off: a stamped 1–3 moves no clock (the alarm stays at 0)');
    await ctx.close();
  }

  /* ---------- on: the play's alarm clock ---------- */
  await setting(true);
  await setAlarm(0);
  {
    const { p, ctx } = await open();
    check(!!(await wait(() => p.evaluate(() => !!window.B68GmNightTicks && !!document.querySelector('#gm-nt')))), 'on: the night-flow bundle loads night-ticks.js and the Roll has the Tick control');
    const k = await ctl(p);
    check(!!k && k.r13.clock === 'c-alarm' && k.r13.n === '1' && k.r45.clock === 'c-alarm' && k.r45.n === '1' && /alarm clock/.test(k.note), 'alarm: both rows start from the play’s alarm clock, +1 (' + JSON.stringify(k) + ')');
    check(!!k && k.after === 'gm-stamp' && parseFloat(k.fs) >= 12, 'alarm: the control sits under the stamp, 12 px or more (' + (k && k.fs) + ')');
    const o = await stampIt(p);
    check(!!o && !JSON.stringify(o.payload).includes('House alarm'), 'alarm: the stamp is up, and its payload never names the clock');
    await mark(p, 'onetothree');
    check(!!(await wait(async () => (await alarm()) === 1)), 'alarm: a stamped 1–3 ticks the alarm clock 0 to 1');
    check(!!(await wait(() => undoBtn(p).isVisible())) && /On 1–3: House alarm ticks 0 to 1 of 6/.test(await body(p)), 'alarm: the toast says so, with Undo');
    await shots(p, 'rk03-ticked-toast');
    await mark(p, 'onetothree'); await settle();
    check((await alarm()) === 1, 'alarm: marking 1–3 again leaves it at 1');
    await stampIt(p);
    await p.click('#gm-stamp [data-gm="stamp-clean"]'); await settle();
    check((await alarm()) === 1, 'alarm: a new stamp and Clean change nothing');
    await stampIt(p);
    await mark(p, 'fourfive');
    check(!!(await wait(async () => (await alarm()) === 2)), 'alarm: a new stamp and a 4/5 tick it once more (2)');
    await wait(() => undoBtn(p).isVisible());
    await undoBtn(p).click();
    check(!!(await wait(async () => (await alarm()) === 1)), 'alarm: Undo puts it back to 1');
    const want = ['Tick on 1–3: House alarm 0 to 1/6', 'Tick on 4/5: House alarm 1 to 2/6', 'Tick undone: House alarm'];
    const st = await wait(async () => { const t = (await api('GET', '/gm/state')).text; return want.every((w) => t.includes(w)) ? t : null; }, 8000) || (await api('GET', '/gm/state')).text;
    check(want.every((w) => st.includes(w)), 'alarm: the night log has the ticks and the Undo (' + want.map((w) => st.includes(w)).join() + '; ' + (st.match(/Tick[^"]{0,40}/g) || []).join(' | ') + ')');
    await ctx.close();
  }

  /* ---------- the room's span ---------- */
  await setAlarm(0);
  {
    const { p, ctx } = await open({ span: 'House alarm / 2' });
    await wait(() => p.$('#gm-nt'));
    const k = await wait(async () => { const x = await ctl(p); return x && x.r13.n === '2' ? x : null; });
    check(!!k && k.r13.clock === 'c-alarm' && k.r45.n === '2' && /room/.test(k.note), 'room: the control starts from the room’s span, House alarm +2 (' + JSON.stringify(k) + ')');
    const line = await p.inputValue('#gm-c-threat');
    check(line === 'Dov Kessler turns and looks straight at you', 'room: the Roll’s line has no span (' + line + ')');
    const o = await stampIt(p);
    check(!!o && o.payload && o.payload.text === line && !/House alarm|tick:|▶/.test(JSON.stringify(o.payload)), 'room: the iPad’s payload is the line alone (' + JSON.stringify(o && o.payload) + ')');
    await mark(p, 'fourfive');
    check(!!(await wait(async () => (await alarm()) === 2)), 'room: a 4/5 ticks it by 2 (0 to 2)');
    await ctx.close();
  }

  /* ---------- a near miss never ticks ---------- */
  await setAlarm(0);
  {
    const { p, ctx } = await open({ span: 'House alarms / 1' });
    const k = await wait(async () => { const x = await ctl(p); return x && /No clock called/.test(x.note) ? x : null; });
    check(!!k && k.r13.clock === '' && /House alarms/.test(k.note) && /House alarm”/.test(k.note), 'loose: the control says No clock called “House alarms”, and names the near one (' + (k && k.note) + ')');
    await shots(p, 'rk03-loose');
    await stampIt(p);
    await mark(p, 'onetothree');
    check(!!(await wait(async () => /No clock called “House alarms” on the table: nothing ticked/.test(await body(p)))), 'loose: a stamped 1–3 toasts No clock called, never silence');
    await settle();
    check((await alarm()) === 0, 'loose: and ticks nothing');
    await ctx.close();
  }

  /* ---------- a span typed into the Roll's line ---------- */
  await setAlarm(0);
  {
    const { p, ctx } = await open();
    await wait(() => p.$('#gm-nt'));
    await p.click('#gm-pos [data-v="risky"]');
    await p.fill('#gm-c-threat', 'The lights go out `▶ tick: House alarm / 1`');
    const k = await wait(async () => { const x = await ctl(p); return x && /your line/.test(x.note) ? x : null; });
    check(!!k && k.r13.clock === 'c-alarm', 'typed: the control reads the span in the line (' + (k && k.note) + ')');
    const prev = (await overlay()) || {};
    await p.press('#gm-c-threat', 'Enter');
    const o = await wait(async () => { const x = await overlay(); return x && x.kind === 'report' && x.id !== prev.id ? x : null; });
    check(!!o && o.payload && o.payload.text === 'The lights go out', 'typed: the iPad’s payload has the line without the span (' + JSON.stringify(o && o.payload) + ')');
    await mark(p, 'onetothree');
    check(!!(await wait(async () => (await alarm()) === 1)), 'typed: the 1–3 ticks the clock it names');
    await ctx.close();
  }

  /* ---------- the kit desk ---------- */
  await setting(true, { 'kit.desk': true });
  await setAlarm(0);
  {
    const { p, ctx } = await open();
    check(!!(await wait(() => p.evaluate(() => { const r = document.querySelector('#gm-rl'); return !!r && r.getAttribute('data-kr') === '1' && !!document.querySelector('#gm-nt'); }), 30000)), 'kit desk: the Roll is the kit card, with the Tick control');
    const k = await ctl(p);
    check(!!k && /kr-stamprow/.test(k.after), 'kit desk: the control sits under the stamp row (' + (k && k.after) + ')');
    await stampIt(p);
    await mark(p, 'onetothree');
    check(!!(await wait(async () => (await alarm()) === 1)), 'kit desk: a stamped 1–3 ticks the alarm clock');
    check(!!(await wait(() => undoBtn(p).isVisible())), 'kit desk: with Undo');
    await ctx.close();
  }

  /* ---------- secrecy ---------- */
  const dg = await api('GET', '/gm/display', undefined, IPAD);
  const pc = await api('GET', '/campaign', undefined, P1);
  const pk = ((pc.json && (pc.json.doc || pc.json).clocks) || []).find((x) => x.name === 'House alarm');
  check(!dg.text.includes('House alarm') && !/tick:/.test(dg.text), 'secrecy: the display GET never holds the clock’s name or a tick span');
  check(!pk || pk.hidden === true, 'secrecy: the table document a phone reads keeps the alarm clock hidden');
  check(outside.length === 0, 'the GM page made no request outside its own origin (' + outside.length + ')');

  /* ---------- the screenshots to look at (RK_SHOTS) ---------- */
  if (c.SHOTS) {
    const sizes = [[1366, 768], [1536, 864]];
    for (const desk of [false, true]) {
      await setting(true, { 'kit.desk': desk });
      for (const scheme of ['light', 'dark']) {
        for (const [w, h] of sizes) {
          await setAlarm(2);
          const { p, ctx } = await open({ w, h, scheme, span: 'House alarm / 2' });
          await wait(() => p.$('#gm-nt'));
          await p.click('#gm-pos [data-v="risky"]'); await sleep(600);
          const tag = 'rk03-desk-' + (desk ? 'on' : 'off') + '-' + (scheme === 'dark' ? 'night' : 'paper') + '-' + w + 'x' + h;
          await p.$eval('#gm-nt', (e) => e.scrollIntoView({ block: 'center' }));
          await shots(p, tag);
          const rl = await p.$('#gm-rl');
          if (rl && c.SHOTS) await rl.screenshot({ path: c.path.join(c.SHOTS, tag + '-roll.png') }).catch(() => {});
          await ctx.close();
        }
      }
    }
    await setting(true);
    for (const [w, h, tag] of [[1024, 768, 'rk03-ipad-width-1024x768'], [390, 844, 'rk03-phone-390x844']]) {
      const { p, ctx } = await open({ w, h });
      await wait(() => p.$('#gm-nt'), 15000);
      await p.$eval('#gm-nt', (e) => e.scrollIntoView({ block: 'center' })).catch(() => {});
      await shots(p, tag);
      await ctx.close();
    }
  }
  return true;
}
