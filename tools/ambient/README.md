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
