// kit-keys (KS04.5 of the kit and stage build): every key on the Shortcuts card, pressed with the kit off and with it on, and what happened compared.
// It reads the card's own rows (app/gm/shortcuts.js SECTIONS: key rows, every hit) and, for each hit, in a fresh GM page of the demo night
// (scripts/demo-night.mjs): sets the context the key needs (the Score, the Run view for the site's arrows, an open Blade panel with invented cards for its keys, an open
// Find for its keys), takes a snapshot, presses the key, waits, takes a snapshot, and keeps what changed:
//   on the page   the ids that became visible or hidden, the states that changed (aria-pressed, aria-selected, aria-current, aria-expanded, data-state, data-open,
//                 data-alarm, data-active, data-on), where focus went, the hash, a toast's words
//   on the server what the GM state, the iPad's ambient document, the display and the campaign gained, lost or changed (times and ids of time dropped)
// Two demo nights, one after the other, the same keys in the same order: the five settings written OFF, then all five ON (kit.desk kit.stage kit.phone night.who
// blade.pitches). The check passes when (1) with the kit off every hit was pressed and no page error came up, (2) every key but the few named in NO_EFFECT_OK did
// something (so a key that stops working is caught), and (3) the same key did the same thing with the kit on: the server effect equal, the writes the page made
// while it loaded equal (the snapshot waits for the server to be still, so a late load write is not taken for the key's), the page effect equal for every element
// both pages have. A kit-off effect on an element the kit-on page does not have at all is LOST and fails (the review of KS04: it used to be dropped); an element
// only the new markup has is listed as a note (the new desk may add markup, it may not change what a key does). Deliberate differences are KEYS_EXEMPT, a named
// list with reasons and the overseer's ruling, printed with the hits that used them. The comparison checks itself first (KIT_KEYS_SELF_ONLY=1: that alone).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9402] [KIT_KEYS_ONLY=<key labels, comma separated>] node checks/runtime/kit-keys.e2e.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startDemo, setClock, clockScript } from '../../scripts/kit-fingerprint.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9402);
const GM = 'gm@example.test';
const SC = require('../../app/gm/shortcuts.js');
const ONLY = (process.env.KIT_KEYS_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };

/* THE EXEMPTIONS: where a key deliberately does something else with the kit on, each named with its reason and the overseer's ruling, each printed with the hits
   that used it. Adding one is one entry here, with the PR that makes the change. Each entry: name, reason, and one or more parts, each a `hit` (a pattern on the
   hit's label, "<keys> [<act or via> <key>]") with ONE of:
     off       kit-off page lines that may be missing with the kit on
     on        kit-on page lines that may appear only with the kit on
     loadOn    writes ONLY the kit-on page makes while it loads (never a key's write, never a kit-off one)
     serverOn  writes ONLY the kit-on page makes on that key's press
   An entry with a single part may carry hit and its pattern itself; one with several lists them in `parts`. Nothing else is forgiven: a toast, the focus and
   the hash never are. */
/* the keys that open or leave a put-away view (the third review of KS04, note 3: that exemption used to hold for every key): C, S, J (the Score panel's J on the
   G / B / S / J row, not the Blade panel's J on J / K / U), O, Find's Enter, Esc, and the place keys */
const PUT_AWAY_KEYS = /(?:\[panel [cso]\]|S \/ J \[panel j\]|\[find Enter\]|\[esc Escape\]|\[place Control\+Arrow(?:Left|Right)\])$/;
export const KEYS_EXEMPT = [
  { name: 'KS06: the pinned stamp', reason: 'KS06 (PR #216) pins the stamped line above the Blade fold with kit.desk on, so leaving the Score (Ctrl+Right, F, a Find result) no longer hides #gm-stamp. Ruled intended 12/11',
    hit: /\[(place Control\+ArrowRight|focus f|find Enter)\]$/, off: /^hidden #gm-stamp$/ },
  { name: 'KS07: the Screen, the Now zone and the tab put away', reason: 'KS07 (PR #214, ccd1010) hides the right-edge tab (#as-launch), the Now zone (#as-nowz, #as-now) and the Screen section (#as-screen, #as-sc-*) with kit.desk on, so A opens Blade without hiding the tab or showing them. Ruled intended 12/11',
    hit: /\[assist a\]$/, off: /^(hidden #as-launch|shown #as-(nowz|now|screen|sc-[a-z]+))$/ },
  /* a load lands on whichever hit opens the page after it changed: any hit */
  { name: 'KS12.5: the polaroid list on load', reason: 'KS12.5: night.who clears the stored polaroid list on load (and writes the playing characters\' list while a session is open; disclosed in #212). Ruled intended 12/11',
    hit: /./, loadOn: /^[+~-] \/ambient\/doc\/polaroids(?:\/[^\s]*)?(?: |$)/ },
  { name: 'KS14: the band faces layer', reason: 'KS14 (#220): with kit.stage on, gm/pcstatus.js writes the iPad band\'s faces layer while the page loads, and Esc and 0 (clearing the iPad) take it down. Ruled intended 12/11',
    parts: [{ hit: /./, loadOn: /^[+~-] \/ambient\/doc\/layers\/band\/faces(?:\/[^\s]*)?(?: |$)/ },
      { hit: /\[(esc Escape|clear 0)\]$/, serverOn: /^- \/ambient\/doc\/layers\/band\/faces(?:\/[^\s]*)?$/ }] },
  { name: 'KS09: a place opens on a view that is not put away', reason: 'KS09 (#221) puts Chase, Street, Score generator and Opportunities out of the view row with kit.desk on, and a place\'s first view skips them (current()), so Ctrl+Left onto a place whose first view is Opportunities opens its next view (#gm-vpane), not the Opportunities board. C, S, J, O and Find still open them. For the overseer\'s ruling',
    parts: [{ hit: /\[place Control\+Arrow(Left|Right)\]$/, off: /^shown #(gm-cards|gm-opp-iv|gm-opps-gm|gm-opps-players)$/ }, { hit: /\[place Control\+Arrow(Left|Right)\]$/, on: /^shown #gm-vpane$/ },
      /* that next view here is the corkboard: its tab comes in selected with the kit on, unselected with it off */
      { hit: /\[place Control\+Arrow(Left|Right)\]$/, off: /^new #gm-root~\.gm-v[ct]\[data-pv=corkboard\]:\d+ aria-selected false$/ },
      { hit: /\[place Control\+Arrow(Left|Right)\]$/, on: /^new #gm-root~\.gm-v[ct]\[data-pv=corkboard\]:\d+ aria-selected true$/ }] },
  { name: 'KS09: the put-away views\' tabs', reason: 'KS09 (#221): with kit.desk on, the tabs of the four put-away views (RETIRED in gm/kit/shell.js: chase, scenes, score, cards) leave the view row and the chip row and come back only while one is open, so a key that opens one adds its tab (new, selected) where kit off selects a standing tab, and leaving it takes the tab away. Only the keys that open or leave one (C, S, J, O, Find\'s Enter, Esc, Ctrl+Left / Ctrl+Right), only those four tabs\' aria-selected; what the view shows is still compared. For the overseer\'s ruling',
    parts: [{ hit: PUT_AWAY_KEYS, off: /^(?:state|new|gone) #gm-root~\.gm-v[ct]\[data-pv=(?:chase|scenes|score|cards)\]:\d+ aria-selected(?: |$)/ },
      { hit: PUT_AWAY_KEYS, on: /^(?:new|gone) #gm-root~\.gm-v[ct]\[data-pv=(?:chase|scenes|score|cards)\]:\d+ aria-selected(?: |$)/ }] }
];
const partsOf = (x) => (x.parts || [x]).map((p) => Object.assign({ name: x.name }, p));

/* what a page line is about: an id (shown/hidden #id) or a state key (an id, or a short path from the nearest id) */
const lineKey = (line) => { let m = /^(?:shown|hidden) #(\S+)$/.exec(line); if (m) return { id: m[1] }; m = /^(?:new|state|gone) (\S+) (\S+)/.exec(line); if (m) return { attr: m[1] + ' ' + m[2] }; return null; };
const knows = (known, k) => (k.id ? known.ids.has(k.id) : known.attrs.has(k.attr));
/* One key, kit off (o) against kit on (n). Each: { hit, page, server, load, known: { ids, attrs } } (known: every id and state key on that page, before or after
   the press). A kit-off line about an element the kit-on page does not have at all is LOST (the hooks rule: every id stays): a failure, unless exempted. A kit-on
   line about an element the kit-off page never had is new markup: a note. Every other page line, every server effect and every write the page made while it
   loaded must be the same. Returns { ok, lost, offOnly, onOnly, extra, exempted: [names], why: [lines] }. */
export function judge(o, n, exempt = KEYS_EXEMPT) {
  const ex = [].concat(...exempt.map(partsOf)).filter((x) => x.hit.test(o.hit.label));
  const okOff = (l) => ex.find((x) => x.off && x.off.test(l));
  const used = new Set(), lost = [], po = [], pn = [], extra = [];
  for (const l of o.page) { const k = lineKey(l); if (k && !knows(n.known, k)) { const x = okOff(l); if (x) used.add(x.name); else lost.push(l); } else po.push(l); }
  for (const l of n.page) { const k = lineKey(l); if (k && !knows(o.known, k)) extra.push(l); else pn.push(l); }
  const okOn = (l) => ex.find((x) => x.on && x.on.test(l));
  let offOnly = po.filter((l) => !pn.includes(l)); const onOnly = pn.filter((l) => !po.includes(l)).filter((l) => { const x = okOn(l); if (x) { used.add(x.name); return false; } return true; });
  offOnly = offOnly.filter((l) => { const x = okOff(l); if (x) { used.add(x.name); return false; } return true; });
  const sv = (a, b) => a.filter((l) => !b.includes(l));
  const loadOnOk = (l) => ex.find((x) => x.loadOn && x.loadOn.test(l));
  const lOn = sv(n.load || [], o.load || []).filter((l) => { const x = loadOnOk(l); if (x) { used.add(x.name); return false; } return true; });
  const serverOnOk = (l) => ex.find((x) => x.serverOn && x.serverOn.test(l));
  const kOn = sv(n.server, o.server).filter((l) => { const x = serverOnOk(l); if (x) { used.add(x.name); return false; } return true; });
  const sOff = sv(o.server, n.server).concat(sv(o.load || [], n.load || []).map((l) => 'load ' + l)), sOn = kOn.concat(lOn.map((l) => 'load ' + l));
  const ok = !lost.length && !offOnly.length && !onOnly.length && !sOff.length && !sOn.length;
  return { ok, lost, offOnly: offOnly.concat(sOff), onOnly: onOnly.concat(sOn), extra, exempted: [...used] };
}

/* THE CLASS CHECK (the third review of KS04, note 2; the hooks rule, KIT-STANDING 4: new markup keeps every old class name the old markup carried). The key of a
   state line is ONE hook class, so a kit-on element that kept its hook and dropped a second old class (gm-place-btw beside gm-place) matched before. Here, for
   every element with an id and every state element (by its key), in the same context, before and after the same press: every class the kit-off element carries
   must be on its kit-on counterpart. An element the kit-on page does not have at all is judge's business (LOST), not this check's. A class the kit retires on
   purpose is CLASS_EXEMPT: named, with the reason and the kit PR that says so (each one printed with the elements that used it). Nothing else is let go. */
export const CLASS_EXEMPT = [
];
/* offRes / onRes: [{ hit: { label }, cls: [before, after] }] in the same order (cls: "<key>" -> "class class"). Returns { compared, findings: Map("<key> .<class>"
   -> [hit labels]), used: Map(name -> Set of "<key> .<class>") } */
export function classCheck(offRes, onRes, exempt = CLASS_EXEMPT) {
  const findings = new Map(), used = new Map();
  let compared = 0;
  offRes.forEach((o, i) => {
    const n = onRes[i];
    if (!n || !o.cls || !n.cls) return;
    o.cls.forEach((oc, s) => {
      const nc = n.cls[s]; if (!oc || !nc) return;
      for (const k of Object.keys(oc)) {
        if (!(k in nc)) continue;
        compared++;
        const have = new Set(nc[k] ? nc[k].split(' ') : []);
        for (const c of (oc[k] ? oc[k].split(' ') : [])) {
          if (have.has(c)) continue;
          const line = k + ' .' + c, x = exempt.find((e) => e.key.test(k) && e.cls.test(c));
          if (x) { if (!used.has(x.name)) used.set(x.name, new Set()); used.get(x.name).add(line); continue; }
          if (!findings.has(line)) findings.set(line, []);
          if (!findings.get(line).includes(o.hit.label)) findings.get(line).push(o.hit.label);
        }
      }
    });
  });
  return { compared, findings, used };
}

/* the comparison checks itself first (no browser): a lost effect fails, a press-made element is compared, an exemption lets only its own lines go */
{
  const K = (ids, attrs = []) => ({ ids: new Set(ids), attrs: new Set(attrs) });
  const r = (label, page, known, server = [], load = []) => ({ hit: { label }, page, server, load, known });
  check(judge(r('X [t x]', ['shown #panel'], K(['panel'])), r('X [t x]', ['shown #panel'], K(['panel']))).ok, 'judge: the same effect is the same');
  const lostR = judge(r('X [t x]', ['shown #panel'], K(['panel'])), r('X [t x]', [], K([])));
  check(!lostR.ok && lostR.lost.includes('shown #panel'), 'judge: kit off shows #panel, the kit-on page lost #panel and the key does nothing: a failure (lost)');
  check(!judge(r('X [t x]', ['shown #made'], K(['made'])), r('X [t x]', [], K(['made']))).ok, 'judge: an element the press makes is compared (kit on has it, never shows it): a failure');
  check(!judge(r('X [t x]', ['state #gm-x aria-pressed false -> true'], K([], ['#gm-x aria-pressed'])), r('X [t x]', [], K([], []))).ok, 'judge: a state change on an element the kit-on page lost: a failure');
  check(!judge(r('X [t x]', ['state #gm-x aria-pressed false -> true'], K([], ['#gm-x aria-pressed'])), r('X [t x]', [], K([], ['#gm-x aria-selected']))).ok, 'judge: a state attribute the kit-on element lost (aria-pressed): a failure');
  check(!judge(r('X [t x]', [], K([]), ['+ /state/doc/a = 1']), r('X [t x]', [], K([]), ['+ /state/doc/a = 1', '+ /state/doc/b = 2'])).ok, 'judge: a server write only the kit makes: a failure');
  check(!judge(r('X [t x]', [], K([]), [], []), r('X [t x]', [], K([]), [], ['+ /state/doc/b = 2'])).ok, 'judge: a write only the kit page makes while it loads: a failure');
  const nw = judge(r('X [t x]', ['shown #panel'], K(['panel'])), r('X [t x]', ['shown #panel', 'shown #kit-only'], K(['panel', 'kit-only'])));
  check(nw.ok && nw.extra.includes('shown #kit-only'), 'judge: markup only the kit-on page has is a note, not a failure');
  const exA = judge(r('A [assist a]', ['shown #as-screen', 'shown #as-feed'], K(['as-screen', 'as-feed'])), r('A [assist a]', ['shown #as-feed'], K(['as-screen', 'as-feed'])));
  check(exA.ok && exA.exempted.length === 1, 'judge: a named exemption lets its own line go (KS07, A)');
  check(!judge(r('A [assist a]', ['shown #as-feed'], K(['as-feed'])), r('A [assist a]', [], K(['as-feed']))).ok, 'judge: the exemption lets nothing else go (A: #as-feed not shown)');
  check(!judge(r('Q [t q]', ['shown #as-screen'], K(['as-screen'])), r('Q [t q]', [], K(['as-screen']))).ok, 'judge: the exemption holds for its own key only');
  /* KS12.5: only the kit-on page's load writes under /ambient/doc/polaroids go; nothing else does */
  const pol = ['+ /ambient/doc/polaroids/0/id = "x"', '+ /ambient/doc/polaroids/0/cap = "X"'];
  const p1 = judge(r('1 [situation 1]', [], K([]), [], []), r('1 [situation 1]', [], K([]), [], pol));
  check(p1.ok && p1.exempted.includes('KS12.5: the polaroid list on load'), 'judge: the kit-on page writing the polaroid list while it loads is let go (KS12.5), and says so');
  check(!judge(r('1 [situation 1]', [], K([]), [], []), r('1 [situation 1]', [], K([]), [], pol.concat(['+ /ambient/doc/shown = "x"']))).ok, 'judge: KS12.5 lets no other load write go (/ambient/doc/shown)');
  check(!judge(r('1 [situation 1]', [], K([]), [], []), r('1 [situation 1]', [], K([]), [], ['+ /ambient/doc/polaroidsx = 1'])).ok, 'judge: KS12.5 lets no look-alike path go (/ambient/doc/polaroidsx)');
  check(!judge(r('1 [situation 1]', [], K([]), [], []), r('1 [situation 1]', [], K([]), [], ['+ /campaign/doc/polaroids/0/id = "x"'])).ok, 'judge: KS12.5 lets no polaroids write elsewhere go (the campaign)');
  check(!judge(r('1 [situation 1]', [], K([]), [], []), r('1 [situation 1]', [], K([]), pol, [])).ok, 'judge: KS12.5 lets no KEY write go (a press that writes the polaroids is a failure)');
  check(!judge(r('1 [situation 1]', [], K([]), [], pol), r('1 [situation 1]', [], K([]), [], [])).ok, 'judge: KS12.5 lets no kit-off-only load write go');
  /* KS14: the faces layer written on load (any key) and taken down by Esc and 0 only */
  const faces = ['+ /ambient/doc/layers/band/faces/0/name = "x"', '+ /ambient/doc/layers/band/faces/0/stress = 2'], down = ['- /ambient/doc/layers/band/faces/0/name', '- /ambient/doc/layers/band/faces/0/stress'];
  const f1 = judge(r('G [panel g]', [], K([]), [], []), r('G [panel g]', [], K([]), [], faces));
  check(f1.ok && f1.exempted.includes('KS14: the band faces layer'), 'judge: KS14: the faces layer written while the kit-on page loads is let go, and says so');
  check(judge(r('Esc [esc Escape]', [], K([])), r('Esc [esc Escape]', [], K([]), down)).ok, 'judge: KS14: Esc taking the faces layer down is let go');
  check(judge(r('0 [clear 0]', [], K([])), r('0 [clear 0]', [], K([]), down)).ok, 'judge: KS14: 0 taking the faces layer down is let go');
  check(!judge(r('G [panel g]', [], K([])), r('G [panel g]', [], K([]), down)).ok, 'judge: KS14 lets no other key take the faces layer down (G)');
  check(!judge(r('Esc [esc Escape]', [], K([])), r('Esc [esc Escape]', [], K([]), ['+ /ambient/doc/layers/band/faces/0/name = "x"'])).ok, 'judge: KS14 lets no key WRITE the faces layer (Esc)');
  check(!judge(r('Esc [esc Escape]', [], K([])), r('Esc [esc Escape]', [], K([]), ['- /ambient/doc/layers/band/facesx'])).ok, 'judge: KS14 lets no look-alike path go (facesx)');
  check(!judge(r('Esc [esc Escape]', [], K([])), r('Esc [esc Escape]', [], K([]), ['- /ambient/doc/layers/band/clock'])).ok, 'judge: KS14 lets no other band layer go down (clock)');
  check(!judge(r('G [panel g]', [], K([]), [], []), r('G [panel g]', [], K([]), [], ['+ /ambient/doc/layers/band/facesx = 1', '+ /ambient/doc/layers/stage/faces/0 = 1'])).ok, 'judge: KS14 lets no look-alike load write go');
  check(!judge(r('Esc [esc Escape]', [], K([]), down), r('Esc [esc Escape]', [], K([]))).ok, 'judge: KS14 lets no kit-off-only removal go');
  check(!judge(r('G [panel g]', [], K([]), [], faces), r('G [panel g]', [], K([]), [], [])).ok, 'judge: KS14 lets no kit-off-only load write go');
  /* KS09: Ctrl+Left / Ctrl+Right only, the Opportunities board's own ids and #gm-vpane only */
  const opp = ['shown #gm-cards', 'shown #gm-opps-gm'], ko = K(['gm-cards', 'gm-opps-gm', 'gm-vpane', 'gm-other']);
  const k9 = judge(r('Ctrl [place Control+ArrowLeft]', opp, ko), r('Ctrl [place Control+ArrowLeft]', ['shown #gm-vpane'], ko));
  check(k9.ok && k9.exempted.includes('KS09: a place opens on a view that is not put away'), 'judge: KS09: Ctrl+Left opening the next view, not Opportunities, is let go, and says so');
  check(!judge(r('G [panel g]', opp, ko), r('G [panel g]', ['shown #gm-vpane'], ko)).ok, 'judge: KS09 holds for Ctrl+Left / Ctrl+Right only');
  check(!judge(r('Ctrl [place Control+ArrowLeft]', ['shown #gm-other'], ko), r('Ctrl [place Control+ArrowLeft]', ['shown #gm-vpane'], ko)).ok, 'judge: KS09 lets no other view go missing');
  check(!judge(r('Ctrl [place Control+ArrowLeft]', [], ko), r('Ctrl [place Control+ArrowLeft]', ['shown #gm-other'], ko)).ok, 'judge: KS09 lets no other view appear');
  const cbK = K([], ['#gm-root~.gm-vt[data-pv=corkboard]:0 aria-selected', '#gm-root~.gm-vt[data-pv=intel]:0 aria-selected']);
  check(judge(r('Ctrl [place Control+ArrowLeft]', ['new #gm-root~.gm-vt[data-pv=corkboard]:0 aria-selected false'], cbK), r('Ctrl [place Control+ArrowLeft]', ['new #gm-root~.gm-vt[data-pv=corkboard]:0 aria-selected true'], cbK)).ok, 'judge: KS09: Ctrl+Left selecting the corkboard (the next view) is let go');
  check(!judge(r('Ctrl [place Control+ArrowLeft]', ['new #gm-root~.gm-vt[data-pv=intel]:0 aria-selected false'], cbK), r('Ctrl [place Control+ArrowLeft]', ['new #gm-root~.gm-vt[data-pv=intel]:0 aria-selected true'], cbK)).ok, 'judge: KS09 lets no other tab be selected instead (intel)');
  check(!judge(r('B [panel b]', ['new #gm-root~.gm-vt[data-pv=corkboard]:0 aria-selected false'], cbK), r('B [panel b]', ['new #gm-root~.gm-vt[data-pv=corkboard]:0 aria-selected true'], cbK)).ok, 'judge: KS09: the corkboard allowance holds for Ctrl+Left / Ctrl+Right only');
  /* KS09: the put-away tabs, those four only, aria-selected only, and only a new or gone tab on the kit-on side */
  const tabK = K([], ['#gm-root~.gm-vt[data-pv=chase]:0 aria-selected', '#gm-root~.gm-vt[data-pv=intel]:0 aria-selected']);
  const pt = judge(r('C [panel c]', ['state #gm-root~.gm-vt[data-pv=chase]:0 aria-selected false -> true'], tabK), r('C [panel c]', ['new #gm-root~.gm-vt[data-pv=chase]:0 aria-selected true'], tabK));
  check(pt.ok && pt.exempted.includes('KS09: the put-away views\' tabs'), 'judge: KS09: a put-away view\'s tab coming back when its key opens it is let go, and says so');
  check(!judge(r('I [panel i]', ['state #gm-root~.gm-vt[data-pv=intel]:0 aria-selected false -> true'], tabK), r('I [panel i]', ['new #gm-root~.gm-vt[data-pv=intel]:0 aria-selected true'], tabK)).ok, 'judge: KS09 lets no standing tab (intel) go');
  check(!judge(r('C [panel c]', [], tabK), r('C [panel c]', ['state #gm-root~.gm-vt[data-pv=chase]:0 aria-selected false -> true'], tabK)).ok, 'judge: KS09 lets no kit-on state change on a put-away tab go (only its coming and going)');
  check(!judge(r('C [panel c]', ['shown #gm-chase'], K(['gm-chase'])), r('C [panel c]', [], K(['gm-chase']))).ok, 'judge: KS09: a put-away view that does not open is still a failure');
  /* KS09 put-away tabs, by key (note 3): C, S, J (the Score panel's), O, Find's Enter, Esc and the place keys only */
  const ptOk = (label) => judge(r(label, ['state #gm-root~.gm-vt[data-pv=chase]:0 aria-selected false -> true'], tabK), r(label, ['new #gm-root~.gm-vt[data-pv=chase]:0 aria-selected true'], tabK)).ok;
  const PT_YES = ['C / D / O [panel c]', 'C / D / O [panel o]', 'G / B / S / J [panel s]', 'G / B / S / J [panel j]', '↑ / ↓ / Enter [find Enter]', 'Esc [esc Escape]', 'Ctrl ← / Ctrl → [place Control+ArrowLeft]', 'Ctrl ← / Ctrl → [place Control+ArrowRight]'];
  check(PT_YES.every(ptOk), 'judge: KS09 put-away tabs: let go for C, O, S, the Score panel\'s J, Find\'s Enter, Esc and Ctrl+Left / Ctrl+Right');
  const PT_NO = ['G / B / S / J [panel g]', 'R / T / N / I [panel i]', 'C / D / O [panel d]', 'J / K / U [panel j]', '↑ / ↓ / Enter [find ArrowDown]', 'Space / PgDn [go Space]', 'W [drawer w]', '0 [clear 0]', 'Shift H / H H [blank Shift+H]'];
  for (const l of PT_NO) check(!ptOk(l), 'judge: KS09 put-away tabs are NOT let go for another key: ' + l);
  /* the toast: the same tone and words in the old region (kit off) and in the stack (kit on) are the same line; other words, or another tone, are not */
  const snap = (toast) => ({ ids: [], attrs: {}, active: '', hash: '#gm', toast });
  check(JSON.stringify(pageDiff(snap([]), snap(['message Fired cue 1.']))) === JSON.stringify(pageDiff(snap(['message Older news']), snap(['message Older news', 'message Fired cue 1.']))), 'pageDiff: the toast words the press brought are compared wherever they show (old region or the stack)');
  check(JSON.stringify(pageDiff(snap([]), snap(['message Fired cue 1.']))) !== JSON.stringify(pageDiff(snap([]), snap(['message Fired cue 2.']))), 'pageDiff: different toast words are a difference');
  check(pageDiff(snap([]), snap(['error Not saved.'])).includes('toast error "Not saved."'), 'pageDiff: a toast line carries its tone ("toast error \\"Not saved.\\"")');
  /* MUTATION (note 1): an error toast drawn as an ordinary one, the same words: caught */
  check(JSON.stringify(pageDiff(snap([]), snap(['error Not saved.']))) !== JSON.stringify(pageDiff(snap([]), snap(['message Not saved.']))), 'pageDiff: the same words as an error and as news are a difference (tone)');
  check(!judge(r('Space [go Space]', ['toast error "Not saved."'], K([])), r('Space [go Space]', ['toast message "Not saved."'], K([]))).ok, 'judge: MUTATION: kit off says it as an error, kit on as news, the same words: a failure');
  check(!judge(r('Space [go Space]', ['toast message "Fired cue 1."'], K([])), r('Space [go Space]', ['toast error "Fired cue 1."'], K([]))).ok, 'judge: MUTATION: news turned into an error, the same words: a failure');
  check(judge(r('Space [go Space]', ['toast error "Choose a beat first."'], K([])), r('Space [go Space]', ['toast error "Choose a beat first."'], K([]))).ok, 'judge: an error the stack lets fade (KS09.3, read as the page\'s bad flag) against the old error: the same');
  check(!judge(r('Space [go Space]', ['toast message "Fired cue 1."'], K([])), r('Space [go Space]', [], K([]))).ok, 'judge: a toast the kit-on page never says is a failure');
  /* the class check (note 2): every old class of a hooked element stays on its kit-on counterpart, or is a named exemption */
  const cr = (label, before, after = before) => ({ hit: { label }, cls: [before, after] });
  const same = classCheck([cr('B [panel b]', { '#gm-band~.gm-place:3': 'gm-place gm-place-btw', '#gm-x': 'gm-x on' })], [cr('B [panel b]', { '#gm-band~.gm-place:3': 'gm-place gm-place-btw kband-place ui-tab', '#gm-x': 'gm-x on ui-button' })], []);
  check(same.findings.size === 0 && same.compared === 4, 'classCheck: every old class kept (kit classes beside them): nothing found');
  const drop = classCheck([cr('B [panel b]', { '#gm-band~.gm-place:3': 'gm-place gm-place-btw' })], [cr('B [panel b]', { '#gm-band~.gm-place:3': 'gm-place kband-place' })], []);
  check(drop.findings.has('#gm-band~.gm-place:3 .gm-place-btw'), 'classCheck: MUTATION: the kit-on tab keeps its hook (gm-place) and drops a second old class (gm-place-btw): found');
  const dropB = classCheck([cr('B [panel b]', { '#gm-bar': 'gm-bar gm-bb' })], [cr('B [panel b]', { '#gm-bar': 'gm-bar ui-band' })], []);
  check(dropB.findings.has('#gm-bar .gm-bb'), 'classCheck: MUTATION: an element with an id keeps it and drops an old class (gm-bb): found');
  const dropA = classCheck([cr('B [panel b]', { '#gm-x': 'gm-x' }, { '#gm-x': 'gm-x on' })], [cr('B [panel b]', { '#gm-x': 'gm-x' }, { '#gm-x': 'gm-x' })], []);
  check(dropA.findings.has('#gm-x .on'), 'classCheck: a class the press turns on with the kit off and not with it on: found (after the press)');
  check(classCheck([cr('B [panel b]', { '#gm-x': 'gm-x' })], [cr('B [panel b]', {})], []).compared === 0, 'classCheck: an element the kit-on page lacks is judge\'s (LOST), not compared here');
  const exT = [{ name: 'T: a retired class', reason: 'invented', key: /^#gm-bar$/, cls: /^gm-bb$/ }];
  const ex1 = classCheck([cr('B [panel b]', { '#gm-bar': 'gm-bar gm-bb' })], [cr('B [panel b]', { '#gm-bar': 'gm-bar' })], exT);
  check(ex1.findings.size === 0 && ex1.used.get('T: a retired class').has('#gm-bar .gm-bb'), 'classCheck: a named exemption lets its own class go, and says so');
  check(classCheck([cr('B [panel b]', { '#gm-bar': 'gm-bar gm-bb gm-bc' })], [cr('B [panel b]', { '#gm-bar': 'gm-bar' })], exT).findings.has('#gm-bar .gm-bc'), 'classCheck: the exemption lets no other class go');
  check(classCheck([cr('B [panel b]', { '#gm-baz': 'gm-baz gm-bb' })], [cr('B [panel b]', { '#gm-baz': 'gm-baz' })], exT).findings.has('#gm-baz .gm-bb'), 'classCheck: the exemption holds for its own element only');
  for (const x of CLASS_EXEMPT) check(x.name && x.reason && /#\d+/.test(x.reason) && x.key instanceof RegExp && x.cls instanceof RegExp, 'CLASS_EXEMPT: "' + x.name + '" is named, has a reason citing its PR, and is narrow (key and class patterns)');
  /* state keys: the same hook under the same id is the same line, wherever a wrapper puts it; a hook the kit-on page lacks is still lost */
  const st = (k, a = 'aria-selected') => 'state ' + k + ' ' + a + ' false -> true', ka = (k, a = 'aria-selected') => k + ' ' + a;
  check(judge(r('C [place c]', [st('#gm-band~.gm-place:3')], K([], [ka('#gm-band~.gm-place:3')])), r('C [place c]', [st('#gm-band~.gm-place:3')], K([], [ka('#gm-band~.gm-place:3')]))).ok, 'judge: a state line keyed by its hook under the nearest id matches across a wrapper');
  check(!judge(r('C [place c]', [st('#gm-band~.gm-band-panic:0', 'aria-pressed')], K([], [ka('#gm-band~.gm-band-panic:0', 'aria-pressed')])), r('C [place c]', [], K([], [ka('#gm-band~.kband-panic:0', 'aria-pressed')]))).ok, 'judge: a state line whose hook the kit-on page lost is still LOST');
  const added = judge(r('C [place c]', [st('#gm-band~.gm-place:3')], K([], [ka('#gm-band~.gm-place:3')])), r('C [place c]', [st('#gm-band~.gm-place:3'), st('#gm-band~.gm-place:3', 'aria-pressed')], K([], [ka('#gm-band~.gm-place:3'), ka('#gm-band~.gm-place:3', 'aria-pressed')])));
  check(added.ok && added.extra.length === 1, 'judge: an attribute only the kit part carries (aria-pressed beside aria-selected) is a note; the old one is still compared');
  check(!judge(r('C [place c]', [st('#gm-band~.gm-place:3')], K([], [ka('#gm-band~.gm-place:3')])), r('C [place c]', [st('#gm-band~.gm-place:4')], K([], [ka('#gm-band~.gm-place:3'), ka('#gm-band~.gm-place:4')]))).ok, 'judge: the old attribute changing on another tab is a difference');
}
if (process.env.KIT_KEYS_SELF_ONLY === '1') { console.log(failed ? 'FAIL kit-keys (self-checks only)' : 'PASS kit-keys (self-checks only)'); process.exit(failed ? 1 : 0); }
if (!process.env.PW_MODULE) { console.log('SKIP kit-keys: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);

/* keys that, in the context this check can set up, may legitimately do nothing: each with the reason (a capture bar that is off, nothing to undo) */
const NO_EFFECT_OK = {
  'u': 'nothing of Blade\'s to undo on a fresh night', 'p': 'the capture bar is off (it is a Menu setting)', 'x': 'the capture bar is off', 'm': 'the capture bar is off',
  'l': 'the capture bar is off; no roll to file', '0': 'the iPad is already clear', 'h': 'one tap of H H is half a blank',
  'panel k': 'at the first card there is nothing before it', 'panel u': 'nothing to undo on a fresh night',
  'panel j': 'with no card focused J has nothing to move from (the Now card leaving was its timer, not J: NOW_MS)'
};

/* the keys, from the card: [{ label, key (Playwright), ctx, via, sec, id }] in card order, the Esc and blanking keys last (they change the night's state for everyone after) */
const toPw = (h) => (h.ctrl ? 'Control+' : '') + (h.shift ? 'Shift+' : '') + (h.key === ' ' ? 'Space' : h.key);
const ctxOf = (h) => (h.via === 'site' ? 'run' : h.via === 'panel' ? 'panel' : h.via === 'find' ? 'find' : 'score');
const HITS = [];
for (const s of SC.SECTIONS) for (const r of s.rows) if (r.k === 'key') r.hits.forEach((h, i) => HITS.push({ sec: s.id, label: r.keys.join(' / ') + ' [' + (h.act ? h.act.type : h.via) + ' ' + toPw(h) + ']', key: toPw(h), ctx: ctxOf(h), act: h.act ? h.act.type : '', via: h.via || '', letter: (h.via ? h.via + ' ' : '') + h.key.toLowerCase() }));
const LAST = new Set(['esc', 'blank', 'blank-tap', 'clear']);
HITS.sort((a, b) => (LAST.has(a.act) ? 1 : 0) - (LAST.has(b.act) ? 1 : 0));
const hits = ONLY.length ? HITS.filter((h) => ONLY.some((o) => h.label.includes(o))) : HITS;

const NOW = Date.now(), iso = (m) => new Date(NOW - m * 60000).toISOString();
const CARDS = [
  { seat: 'ref', kind: 'rule', at: iso(9), text: 'Invented slip.', headline: 'No resistance roll was offered after the harm', bullets: ['The harm can be resisted'], cite: 'p.12', check: 'resist' },
  { seat: 'mystery', kind: 'idea', at: iso(8), text: 'Invented idea.', headline: 'Push the second key into the scene', bullets: ['How: the cook drops it'] },
  { seat: 'clerk', kind: 'note', at: iso(5), text: 'Invented note.', headline: 'Loose end: the missing ledger', bullets: ['Not yet in the cast'] }
];

/* in the page */
function snapPage() {
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]'); };
  /* a step of a path: the tag and its FIRST CLASS IN SORTED ORDER (a kit part puts its ui-* class first and keeps the old one: the order is not a hook) */
  const sigOf = (a) => a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className.trim() ? '.' + a.className.trim().split(/\s+/).sort()[0] : '');
  /* the insides of an svg (a figure's groups) are drawing, not hooks: the fingerprint skips them too */
  const inSvg = (e) => !!(e.parentElement && e.parentElement.closest('svg'));
  void sigOf;
  /* WHERE A STATE LINE IS (the re-review of KS04: a DOM path made KS05's wrappers and moves read as lost elements): the element's own id, else its nearest
     ancestor with an id, "~", its hook and its number among the elements with that hook under that id. The hook is the element's first old hook class (one
     with a hyphen, the kit's own ui- kband- kr- kbl- who- is- classes left out; a state class like "on" has no hyphen), else its first data-* hook, else its
     tag. Wrappers and moves inside the same id do not change it; a hook that is gone does. */
  const KIT_CLASS = /^(ui-|kband-|kr-|kbl-|who-|is-)/, NOT_HOOK = /^data-(state|open|alarm|active|on|kit|kit-.*|ui-.*)$/;
  /* a naming data-* hook (which view, place, panel, tray button or setting an element is), first of this list it carries: with the class it names the element
     wherever the kit puts it, so a tab row the kit shortens (KS09 puts four views away) does not renumber the rest */
  const NAMING = ['data-pv', 'data-pvx', 'data-place', 'data-panel', 'data-tray', 'data-set', 'data-set-row', 'data-band', 'data-as', 'data-gm'];
  const hook = (e) => {
    const cls = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).filter((c) => c && !KIT_CLASS.test(c));
    const nm = NAMING.find((n) => e.hasAttribute(n)), named = nm ? '[' + nm + '=' + String(e.getAttribute(nm)).replace(/\d{5,}/g, '#').replace(/\s+/g, '_').slice(0, 40) + ']' : '';
    const hy = cls.filter((c) => c.indexOf('-') > 0).sort(); if (hy.length) return '.' + hy[0] + named;
    if (named) return named;
    const ds = [...e.attributes].filter((x) => /^data-/.test(x.name) && !NOT_HOOK.test(x.name)).map((x) => x.name + '=' + String(x.value).replace(/\d{5,}/g, '#').replace(/\s+/g, '_').slice(0, 40)).sort();
    if (ds.length) return '[' + ds[0] + ']';
    return cls.length ? '.' + cls.sort()[0] : e.tagName.toLowerCase();
  };
  const rootOf = (e) => { let a = e.parentElement; while (a && a !== document.body && !(a.id && !inSvg(a))) a = a.parentElement; return a && a !== document.body ? a : document.body; };
  const rootKey = (r) => (r === document.body ? 'body' : '#' + r.id);
  const memo = new Map(), rh = (e) => { let v = memo.get(e); if (!v) { v = { r: rootOf(e), h: hook(e) }; memo.set(e, v); } return v; };
  const keyIn = (e, list) => { if (e.id) return '#' + e.id; const { r, h } = rh(e); const same = list.filter((x) => { if (x.id) return false; const q = rh(x); return q.r === r && q.h === h; }); return rootKey(r) + '~' + h + ':' + same.indexOf(e); };
  /* live, not the key's: the Now card (it leaves Now on a 1.5 s timer, NOW_MS) and the Run view's people rows (presence arrives with the polls) */
  const liveEl = (e) => !!(e.closest('#as-now') || e.closest('.rv-ppl'));
  const A = ['aria-pressed', 'aria-selected', 'aria-current', 'aria-expanded', 'data-state', 'data-open', 'data-alarm', 'data-active', 'data-on'];
  /* the toast: its WORDS are compared, wherever they show (the old #toast region, or the kit's one stack, KS09.3: "moved: the page's toast line into the one
     stack"); the old region's own boxes are not hooks */
  const TOAST_BOX = new Set(['toast', 'toastMsg', 'toastErr']);
  const ids = [...document.querySelectorAll('[id]')].filter((e) => !inSvg(e) && !TOAST_BOX.has(e.id) && vis(e)).map((e) => e.id).sort();
  const stateEls = [...document.querySelectorAll(A.map((a) => '[' + a + ']').join(','))].filter((e) => !inSvg(e) && !liveEl(e));
  /* one entry per attribute the element carries ("<where> <attribute>"): a kit part that adds aria-pressed beside the old aria-selected is new markup (a note),
     while the old attribute is still held to what it did */
  const attrs = {}; stateEls.forEach((e) => { const k = keyIn(e, stateEls); A.forEach((a) => { if (e.hasAttribute(a)) attrs[k + ' ' + a] = e.getAttribute(a); }); });
  const path = (e) => keyIn(e, [...rootOf(e).querySelectorAll('*')]);
  /* and its TONE (the third review of KS04, note 1): each line is "error <words>" or "message <words>". The old region: #toastErr (class "bad", role alert) is an
     error, #toastMsg news. The stack: the ui-toast--error style or the "Error" kind label is an error. KS09.3 lets a routine hint the page sent as an error
     (toast(msg, true)) fade as news does, so on the stack the tone is the PAGE'S bad flag: a line B68KitShell.toast was handed with bad set (recorded by the
     init script in pass(), window.__kkBad) is an error however it is drawn. Whether it sticks is not compared. */
  const bad = new Set((window.__kkBad || []).map((t) => String(t).trim()));
  const oldTone = (e) => (e.id === 'toastErr' || e.classList.contains('bad') ? 'error' : 'message');
  const kitTone = (t, words) => { const k = t.querySelector('.ui-toast-kind'); return t.classList.contains('ui-toast--error') || (k && /^error$/i.test(k.textContent.trim())) || bad.has(words) ? 'error' : 'message'; };
  const a = document.activeElement, toast = ['toastMsg', 'toastErr'].map((i) => { const e = document.getElementById(i), w = e ? e.textContent.trim() : ''; return w ? oldTone(e) + ' ' + w : ''; })
    .concat([...document.querySelectorAll('.ui-toast')].map((t) => { const e = t.querySelector('.ui-toast-text'), w = e && vis(e) ? e.textContent.trim() : ''; return w ? kitTone(t, w) + ' ' + w : ''; })).filter(Boolean);
  /* every old class a hooked element carries (the third review of KS04, note 2): the hook is ONE class, so a second old class the kit-on markup drops would not
     change the key. Every element with an id, and every state element by its key: "<key>" -> its classes. classCheck compares them, kit off against kit on. */
  const cls = {}, clsOf = (e) => (typeof e.className === 'string' ? e.className : (e.getAttribute('class') || '')).trim().split(/\s+/).filter(Boolean).sort().join(' ');
  [...document.querySelectorAll('[id]')].filter((e) => !inSvg(e) && !TOAST_BOX.has(e.id) && !liveEl(e)).forEach((e) => { cls['#' + e.id] = clsOf(e); });
  stateEls.forEach((e) => { const k = keyIn(e, stateEls); if (!(k in cls)) cls[k] = clsOf(e); });
  const all = [...document.querySelectorAll('[id]')].filter((e) => !inSvg(e)).map((e) => e.id);
  return { ids, all, attrs, cls, active: a && a !== document.body ? path(a) : '', hash: location.hash, toast, find: !!document.querySelector('#gm-find-q') && vis(document.querySelector('#gm-find-q')) };
}
/* an id the page made from the clock and a dice roll (hmwdbhyvbau3l, nmwdbi3uc013): a letter, then letters and at least one digit, 10 to 15 characters, or a letter and the clock's m... */
const GEN_ID = /^(?:[a-z](?=[a-z0-9]*\d)[a-z0-9]{9,14}|[a-z]m[a-z0-9]{9,12})$/;      /* the second shape: a letter, then the clock's base 36 (m...) */
const clean = (v) => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) { if (/^(at|ts|updated|seq|rev|etag|until|sent|exportedAt|nowMs|savedAt|lastAt)$/.test(k)) continue; o[k] = clean(v[k]); } return o; }
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:/.test(v)) return 'ISO';
  if (typeof v === 'string' && GEN_ID.test(v)) return '<id>';
  if (typeof v === 'number' && v > 1e11) return 'EPOCH';
  return v;
};
const flat = (v, p = '', out = new Map()) => {
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) flat(v[k], p + '/' + (GEN_ID.test(k) ? '<id>' : k), out); if (!Object.keys(v).length) out.set(p, Array.isArray(v) ? '[]' : '{}'); }
  else out.set(p, JSON.stringify(v));
  return out;
};
/* the display GET is built from the ambient and campaign documents, which are compared themselves; an overlay's age and its timed expiry are the clock's */
const QUIET = (path) => /^\/display\//.test(path) || /\/age$/.test(path);
function serverDiff(a, b) {
  const out = [], A = new Map([...flat(clean(a))].filter(([k]) => !QUIET(k))), B = new Map([...flat(clean(b))].filter(([k]) => !QUIET(k)));
  for (const [k, v] of B) if (!A.has(k)) out.push('+ ' + k + ' = ' + v.slice(0, 60)); else if (A.get(k) !== v) out.push('~ ' + k + ' ' + A.get(k).slice(0, 40) + ' -> ' + v.slice(0, 40));
  for (const k of A.keys()) if (!B.has(k)) out.push('- ' + k);
  return out.sort();
}
function pageDiff(a, b) {
  const out = [], sa = new Set(a.ids), sb = new Set(b.ids);
  for (const i of b.ids) if (!sa.has(i)) out.push('shown #' + i);
  for (const i of a.ids) if (!sb.has(i)) out.push('hidden #' + i);
  /* state the clock or a poll changes, not the key: Blade's seat state (waiting, setting up); the Now card (it leaves Now 1.5 s after the panel shows it,
     app/gm/assist-panel.js NOW_MS); the Run view's people rows (presence arrives with the polls: kit-off masks the players chip for the same reason) */
  const live = (k) => /^#as-state /.test(k);        /* the Now card and the people rows are left out in the page itself (snapPage's liveEl) */
  for (const k of Object.keys(b.attrs).filter((x) => !live(x))) if (a.attrs[k] === undefined) out.push('new ' + k + ' ' + b.attrs[k]); else if (a.attrs[k] !== b.attrs[k]) out.push('state ' + k + ' ' + a.attrs[k] + ' -> ' + b.attrs[k]);
  for (const k of Object.keys(a.attrs).filter((x) => !live(x))) if (b.attrs[k] === undefined) out.push('gone ' + k);
  if (a.active !== b.active) out.push('focus ' + (a.active || 'none') + ' -> ' + (b.active || 'none'));
  if (a.hash !== b.hash) out.push('hash ' + a.hash + ' -> ' + b.hash);
  for (const t of b.toast) if (!a.toast.includes(t)) { const sp = t.indexOf(' '); out.push('toast ' + t.slice(0, sp) + ' "' + t.slice(sp + 1) + '"'); }        /* the tone and words the press brought, wherever they show */
  return out.sort();
}

/* one demo night, every hit: returns [{ hit, page: [lines], server: [lines], known: { ids, attrs }, errors }] */
async function pass(port, kit) {
  const demo = await startDemo(ROOT, port, ['--kit', kit, '--clock', '20:00']);
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const api = (p) => fetch(demo.base + '/api' + p, { headers: { 'X-Dev-User': GM } }).then((r) => r.json().catch(() => null), () => null);
  const server = async () => ({ state: await api('/gm/state'), ambient: await api('/gm/ambient'), display: await api('/gm/display'), campaign: await api('/campaign') });
  await fetch(demo.base + '/api/gm/stt', { method: 'PATCH', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: '{"want":"on"}' });      /* Blade's tick runs while Listening is wanted */
  const res = [];
  try {
    for (const h of hits) {
      const errors = [];
      const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
      await c.addInitScript(() => { window.__B68_POLL_MS = 1000; });
      /* the same dice and the same time of day in both passes: the two demo nights must be the same night (scripts/kit-fingerprint.mjs) */
      await c.addInitScript(() => { let a = 0x9e3779b9; Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
      const ck = clockScript(); if (ck) await c.addInitScript(ck[0], ck[1]);
      /* the page's bad flag on the kit stack (snapPage's toast tone): B68KitShell.toast is wrapped as the kit file defines it, to note the words it took as an
         error. It passes every call through unchanged; with the kit off the file never loads */
      await c.addInitScript(() => {
        const bad = window.__kkBad = []; let mod;
        Object.defineProperty(window, 'B68KitShell', { configurable: true, enumerable: true, get: () => mod, set: (m) => {
          if (m && typeof m.toast === 'function' && !m.__kkWrapped) { const f = m.toast; m.toast = function (msg, isBad) { const r = f.apply(this, arguments); if (isBad && r) bad.push(String(msg == null ? '' : msg)); return r; }; m.__kkWrapped = true; }
          mod = m; } });
      });
      const page = await c.newPage();
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
      page.on('dialog', (d) => d.accept());
      let tick = CARDS.slice();
      if (h.ctx === 'panel') {
        await page.route('**/api/gm/assist/tick', (route) => { const cards = tick.splice(0); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards, updates: [], flags: [], spend: { tonight: 0.2, cap: 30, tier: 'all', tick: 0.02 }, last: 9 }) }); });
        await page.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"marked":1}' }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], asks: [] }) }));
      }
      try {
        const s0 = await server();
        await page.goto(demo.base + '/#gm');
        await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
        await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
        await page.waitForFunction(() => window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 20000 });
        await page.evaluate(() => window.B68GmPage.goPlace('score'));
        await page.waitForTimeout(900);
        const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        if (h.ctx === 'run') { await blur(); await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 }); await page.waitForTimeout(500); }
        if (h.ctx === 'panel') {
          await page.waitForFunction(() => { const n = document.querySelector('#as-count'); return n && !n.hidden; }, null, { timeout: 20000 });
          await blur(); await page.keyboard.press('a');
          await page.waitForFunction(() => { const p = document.querySelector('#as-panel'); return p && p.getBoundingClientRect().left < innerWidth - 100; }, null, { timeout: 5000 });
          await page.waitForTimeout(600);
        }
        if (h.ctx === 'find') { await blur(); await page.keyboard.press('Control+k'); await page.waitForSelector('#gm-find-q', { timeout: 5000 }); await page.fill('#gm-find-q', 'go to'); await page.waitForTimeout(500); }
        else await blur();
        /* what the page writes while it loads and settles (going to the Score enters its phase; the Roll seeds its line from the room) lands before the press:
           wait until the server has been still for a moment, so a late write is not taken for the key's. Those writes are compared too (load) */
        let sb = await server();
        for (let t = 0; t < 12; t++) { await page.waitForTimeout(700); const s2 = await server(); if (!serverDiff(sb, s2).length) break; sb = s2; }
        const b = await page.evaluate(snapPage);
        await page.keyboard.press(h.key);
        await page.waitForTimeout(1100);
        const a = await page.evaluate(snapPage), sa = await server();
        res.push({ hit: h, page: pageDiff(b, a), server: serverDiff(sb, sa), load: serverDiff(s0, sb), before: b.ids, cls: [b.cls, a.cls],
          known: { ids: new Set(b.all.concat(a.all)), attrs: new Set(Object.keys(b.attrs).concat(Object.keys(a.attrs))) }, errors });
      } catch (e) {
        res.push({ hit: h, page: ['ERROR ' + String(e.message || e).split('\n')[0]], server: [], load: [], known: { ids: new Set(), attrs: new Set() }, errors: errors.concat(['setup failed']) });
      } finally { await c.close(); }
      console.log('  pressed ' + h.label + (res[res.length - 1].page.length + res[res.length - 1].server.length ? '' : '   (nothing changed)'));
    }
  } finally { await browser.close().catch(() => {}); await demo.stop(); }
  return res;
}

const timer = setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 2700000);
setClock('20:00');
let off = null, on = null;
try {
  console.log('kit OFF (the five settings written off): ' + hits.length + ' key presses');
  off = await pass(PORT, 'none');
  console.log('kit ON (desk, stage, phone, who, pitches): ' + hits.length + ' key presses');
  on = await pass(PORT + 1, 'desk,stage,phone,who,pitches');
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timer);

if (off && on) {
  const rows = SC.rows('key').reduce((n, r) => n + r.hits.length, 0);
  check(ONLY.length || off.length === rows, 'every hit of every key row on the card was pressed (' + off.length + ' of ' + rows + ', ' + SC.SECTIONS.length + ' sections)');
  check(off.every((r) => !r.errors.length), 'kit off: no page error on any press' + (off.some((r) => r.errors.length) ? ': ' + off.filter((r) => r.errors.length).slice(0, 3).map((r) => r.hit.label + ' ' + r.errors[0]).join(' | ') : ''));
  const idle = off.filter((r) => !r.page.length && !r.server.length && !NO_EFFECT_OK[r.hit.letter]);
  check(idle.length === 0, 'kit off: every key did something' + (idle.length ? ' (nothing: ' + idle.map((r) => r.hit.label).join(', ') + ')' : ''));
  for (const r of off.filter((x) => !x.page.length && !x.server.length && NO_EFFECT_OK[x.hit.letter])) console.log('  note: ' + r.hit.label + ' did nothing here: ' + NO_EFFECT_OK[r.hit.letter]);
  let same = 0, notes = 0;
  const usedEx = new Map();
  off.forEach((o, i) => {
    const n = on[i], j = judge(o, n);
    if (j.extra.length) { notes++; console.log('  note: ' + o.hit.label + ': only the kit-on page has ' + j.extra.slice(0, 3).join('; ')); }
    for (const x of j.exempted) { if (!usedEx.has(x)) usedEx.set(x, []); usedEx.get(x).push(o.hit.label); }
    if (j.ok) same++;
    else {
      check(false, 'the same key does the same thing, kit off and on: ' + o.hit.label);
      if (j.lost.length) console.log('    LOST (the kit-on page has no such element): ' + JSON.stringify(j.lost).slice(0, 500));
      if (j.offOnly.length) console.log('    only with the kit off: ' + JSON.stringify(j.offOnly).slice(0, 500));
      if (j.onOnly.length) console.log('    only with the kit on:  ' + JSON.stringify(j.onOnly).slice(0, 500));
      if (process.env.KIT_KEYS_DEBUG === '1' && o.before && n.before) {        /* the context before the press: what was in view on one page only */
        const bo = new Set(o.before), bn = new Set(n.before);
        console.log('    in view before the press, kit off only: ' + o.before.filter((x) => !bn.has(x)).slice(0, 25).join(' '));
        console.log('    in view before the press, kit on only:  ' + n.before.filter((x) => !bo.has(x)).slice(0, 25).join(' '));
      }
    }
  });
  console.log('exemptions (KEYS_EXEMPT, each named with its reason):');
  for (const x of KEYS_EXEMPT) console.log('  ' + x.name + ' (' + x.reason + '): ' + (usedEx.has(x.name) ? 'used by ' + usedEx.get(x.name).join(', ') : 'not needed this run'));
  check(same === off.length, 'kit on does what kit off does, for ' + same + ' of ' + off.length + ' presses (' + notes + ' note(s) of markup only the new pages have; ' + usedEx.size + ' exemption(s) used)');
  /* the class check: every old class of a hooked element, kit off against kit on, before and after every press */
  const cc = classCheck(off, on);
  console.log('class exemptions (CLASS_EXEMPT, each named with its reason and PR):');
  for (const x of CLASS_EXEMPT) console.log('  ' + x.name + ' (' + x.reason + '): ' + (cc.used.has(x.name) ? 'used by ' + [...cc.used.get(x.name)].slice(0, 12).join(', ') + (cc.used.get(x.name).size > 12 ? ' and ' + (cc.used.get(x.name).size - 12) + ' more' : '') : 'not needed this run'));
  for (const [line, labels] of cc.findings) console.log('    CLASS LOST: ' + line + '   (' + labels.length + ' press(es): ' + labels.slice(0, 4).join(', ') + (labels.length > 4 ? ', ...' : '') + ')');
  check(cc.findings.size === 0, 'kit on keeps every old class of every hooked element (' + cc.compared + ' element snapshots compared; ' + cc.findings.size + ' class(es) lost' + (cc.findings.size ? ': see CLASS LOST above' : '') + ')');
}
console.log(failed ? 'FAIL kit-keys' : 'PASS kit-keys');
process.exit(failed ? 1 : 0);
