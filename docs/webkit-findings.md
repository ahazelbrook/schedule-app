# WebKit pass: findings (F4, B07)

Test tooling only. This lists failures; it fixes none (B33 fixes the ones on the Saturday path, the rest go to `TODO.md`).

## How it was run
- Engine: Playwright 1.56.1 WebKit 26.0 (Windows build) against Edge (channel `msedge`) as the comparison.
- `app/checks/pw-webkit.js` is a `PW_MODULE` wrapper beside `pw-msedge.js`. `PW_DEVICE=ipad|iphone` adds a touch/mobile profile (user agent, scale factor, `isMobile`) while keeping each suite's own viewport. `PW_ENGINE=chromium` runs the same profile on Edge, so an engine difference can be told from a profile difference.
- `node checks/webkit-pass.mjs` runs every `app/checks` suite (15 files, not 12; `kitlazy.js` and `session.js` count too) plus two display checks, each as plain / iPad / iPhone on WebKit and on Edge.
- `checks/runtime/display-webkit.e2e.mjs` is new: the display at 1180x820, 820x1180, 1024x768, 390x844 and 844x390 (map and status inside the viewport, no sideways scroll, no page error) plus a probe listing web APIs the engine lacks. Fixtures are invented (The Test Rooms).
- Not done here: the real-device half (Friday's tech run), and the Playwright WebKit build is not iOS Safari itself.

## Results (plain / iPad / iPhone profile)
| Suite | WebKit | Edge | Reading |
|---|---|---|---|
| e2e, pn-e2e, kitlazy | pass all three | pass all three | no WebKit problem |
| display-webkit, display-band (iPad profile) | pass | pass | display holds at iPad sizes; iPhone profile and plain not re-run after a memory stop |
| session | pass all three | pass all three | no problem (the script prints "FAILS: none") |
| dice | pass plain; fails iPad and iPhone (30 s click timeout) | same | profile, not engine: a mobile profile at a desktop viewport covers the target. Edge fails identically |
| trackercheck | pass plain; fails iPad and iPhone (click timeout) | same | profile, not engine |
| ms3 | pass plain; fails iPad and iPhone ("the phone's thumbnail node is carried across a tap") | same | profile, not engine |
| mu2 | pass plain; fails iPad and iPhone (prose 12.5 px, below 14 px on a phone; Special abilities order) | same | profile, not engine; likely a real layout finding at a desktop viewport with a mobile profile |
| table | pass plain; fails iPad and iPhone | same | profile, not engine (assertion text not captured) |
| campaign | **fails plain**: "the All button keeps the focus", "the summary row keeps the focus" | passes plain | WebKit-only. Safari does not focus a button or summary on click, so `document.activeElement` is not the target |
| crewsheet | **fails plain**: "phone: the covers unfold, focus stays on the button" | passes plain | WebKit-only, same cause (button focus on click) |
| trackerpn, printcheck | `page.pdf()` unsupported outside headless Chromium | trackerpn fails at `#dossier .ds-gone` on Edge too; printcheck passes plain | harness, not app, for the WebKit failure; the trackerpn Edge failure predates this ticket |
| schedule | fails (assertion text not captured) | fails too | not engine-specific; needs a look on Edge first |
| season | fails | fails: `spawnSync pdfinfo ENOENT` | harness, not app (poppler's `pdfinfo` is not installed here) |

[TODO: capture the failing assertion text for table, schedule and the iPad/iPhone runs of campaign and crewsheet; the full-pass logs kept only the first flagged line per suite, and a memory stop ended the detail re-run.]

## Suggested fixes for B33 (guesses, not confirmed)
- campaign and crewsheet: assert on the control's state (`aria-expanded`, `aria-pressed`) rather than `document.activeElement`, or call `.focus()` in the handler. iOS Safari never focuses a button on tap, so the assertion cannot hold on a real iPad. Check that no app code relies on that focus.
- Profile-dependent failures (dice, trackercheck, ms3, mu2, table): rerun at real device sizes before treating them as app bugs; they fail identically on Edge.
- Harness: skip `page.pdf()` and `pdfinfo` steps when the engine is not Chromium.

## Try it
```
npx playwright-core install webkit            (in a scratch folder with playwright-core 1.56.1)
set PW_CORE_DIR=<that folder>\node_modules\playwright-core
node checks/webkit-pass.mjs --only=campaign,crewsheet --device=none
PW_MODULE=app/checks/pw-webkit.js PORT=9150 node checks/runtime/display-webkit.e2e.mjs
```
On Windows the WebKit download can stall at extraction; unzip the cached archive into `%LOCALAPPDATA%\ms-playwright\webkit-<n>` and add an empty `INSTALLATION_COMPLETE` file, and do the same for `winldd`.
