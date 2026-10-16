# Blades '68 ambient scenes

Six full-screen idle scenes for the table iPad. Each page is self-contained, 4:3, covers whatever frame it is given, pauses when hidden, and asks for a wake lock.

| Page | What it shows |
|---|---|
| `second-harvest.html` | The crew at home in the lair |
| `planning-board.html` | The score site's player map on cork, crew polaroids, red string |
| `score-exploded.html` | The score site as an exploded blueprint, the camera easing down through the floors |
| `watch-feed.html` | City Watch monitors watching the crew, heat and wanted level on the console |
| `duskwall-after-dark.html` | The city at night in the rain, the crew on a rooftop |
| `test-card.html` | Please stand by, with a working clock, for breaks |

## The scenes built here (16/10/2026)

Nine more scenes are built in this folder, from the Blades '68 design system (palette tokens, fonts, figure kit), one script each in
`scenes/`:

```
node tools/ambient/scenes/boneyard.js     # boneyard-dawn.html   the Boneyard at dawn
node tools/ambient/scenes/undertow.js     # undertow.html        Mira's club in the drained baths
node tools/ambient/scenes/bluetime.js     # bluetime.html        the city under the B.L.U.E. Array
node tools/ambient/scenes/vet.js          # grunts-vet.html      Grunt's
node tools/ambient/scenes/tram.js         # night-tram.html      the night tram
node tools/ambient/scenes/lurker.js       # lurker-press.html    the Lurker press room (edit HEADLINES at the top)
node tools/ambient/scenes/cards.js        # calling-cards.html   faction cards (local only, see below)
node tools/ambient/scenes/pells.js        # pells-provisions.html Pell's Provisions
node tools/ambient/scenes/wanted.js       # wanted-wall.html     the wanted wall (heat and wanted like the watch feed)
node tools/ambient/redress.js             # Booker's suit and Alfie's cigarette in the lair, the rooftop and the watch feed
```

- `lib.js`: the design system's colour tokens, the kit and cast (`app/figures/`), the vault NPCs copied into `figures/`, `fig()` and
  `at()` to draw and place a figure (25 kit units = 1 inch, feet on the floor line), and `build()`, which wraps `shell.js`.
- `motion.js`: figure motion. It renders a figure in a few poses and folds them into one SVG: unchanged parts once, moving parts as
  per-frame variants, any reference that differs between frames given its own id. The page's `Motion.show(id, k)` and
  `move(id, [[frame, ms], ...])` cut between frames, the book's hard-cut motion rather than a tween. Arm moves use the kit's pose
  blend, `pose.arms.R = { a: "down", b: "smoke", t: 0.7, as: "smoke" }` (added to `app/figures/figure-kit.js`: the joint angles are
  blended, the parts read the arm as pose `as`, so a held cigarette or glass stays in the hand).
- `redress.js` swaps figures inside the designer-built pages. It finds the render options that reproduce each original exactly
  (scale, silhouette, shadow), learns the page's colour treatment from the old cast (git `a3d5370`), and renders the new spec or
  motion frames the same way. It always starts from the committed page, so it can be re-run.
- **Calling cards are local only.** The faction deck's art is the book's, and this repository is public, so `calling-cards.html` and
  `cards/` are gitignored. To rebuild: read the design system's `assets/factions/NN-name.png` files for the factions the crew know,
  shrink each to 520 px wide JPEG (quality 80) as `cards/NN-name.jpg`, then run `scenes/cards.js`. Deploy from the PC that has the file.

## Embedding

Serve the pages from the table app (for example `app/ambient/`) and show one in an `<iframe>` from the display page. Only `index.html` carries `frame-ancestors 'none'`, so same-origin assets can be framed.

## Heat and wanted level (`watch-feed.html`)

The newest of these wins:

1. A message from the framing page, same origin only: `iframe.contentWindow.postMessage({ type: "b68:crew", heat, wanted }, location.origin)`
2. `GET /api/campaign` every 30 s, reading `doc.crew.heat` and `doc.crew.wanted`. `?api=off` turns this off, `?api=/other/path` points it elsewhere.
3. `?heat=4&wanted=1` on the address.

The console's `LINE ·` readout says which one is in use. The `display` sign-in (`DISPLAY_EMAILS`) is refused `/api/campaign` by design, so on that sign-in use option 1 (the display page already has the crew if you pass it along) or option 3.

## A new score site

`planning-board.html` and `score-exploded.html` are built from a location-generator roll. They hold the **player** render only: hidden rooms, threats and the back route are never written into the files.

```
cd tools
node make-score-scenes.js path/to/roll.json --reveal public,working --out ..
```

`--reveal` lists the surveyed bands (default `public`); re-run it as the crew gathers information. `--seed N` re-lays the walls without changing the score. The kits in `tools/kits/` are copies from the design system; point `--map-kit`, `--figure-kit` and `--cast` at newer ones when they change.
