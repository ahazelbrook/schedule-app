// Night tram: across the carriage, Crowfoot slides past the windows in three layers (b68g-s01: Apple Lane's record shops
// dragging speakers into the street, Candle Bridge), straps sway, the tubes flicker, the board names the next stop.
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng } = L;

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(212);
  let defs = "", outside = "", car = "", people = "", over = "";
  const WY0 = 250, WY1 = 640;                       // the window band
  const wins = [[90, 470], [570, 470], [1050, 470]]; // x, width
  defs += `<linearGradient id="tr-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0e1a"/><stop offset="1" stop-color="#2a2238"/></linearGradient>
  <linearGradient id="tr-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".09"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="tr-tube" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8e0" stop-opacity=".35"/><stop offset="1" stop-color="#fff8e0" stop-opacity="0"/></linearGradient>
`;

  // ---------- the city outside: three repeating strips ----------
  const SW = 2400;
  // each strip is its own SVG three stage-widths wide (two copies of a 2400-unit tile), slid with a CSS transform: the GPU moves
  // it as a picture, nothing is redrawn
  function strip(id, gen) { const one = gen(); return `<svg class="strip" id="${id}" viewBox="0 0 ${SW * 2} ${H}" preserveAspectRatio="none" aria-hidden="true"><g>${one}</g><g transform="translate(${SW} 0)">${one}</g></svg>`; }
  const far = () => { let o = ""; for (let x = 0; x < SW;) { const w = 60 + r() * 120, h = 120 + r() * 220; o += `<rect x="${f2(x)}" y="${f2(WY1 - 80 - h)}" width="${f2(w)}" height="${f2(h + 80)}" fill="#1c2236"/>`; for (let k = 0; k < 6; k++) if (r() < .5) o += `<rect x="${f2(x + 8 + r() * (w - 16))}" y="${f2(WY1 - 80 - h + 10 + r() * h)}" width="5" height="7" fill="#e8c878" opacity=".5"/>`; x += w; } return o; };
  const mid = () => {
    let o = "";
    for (let x = 0; x < SW;) {
      const kind = r(), w = 180 + r() * 160;
      if (kind < .3) {
        // Apple Lane: a record shop front with its speakers out on the pavement
        o += `<rect x="${f2(x)}" y="${WY1 - 300}" width="${f2(w)}" height="300" fill="#2b2238"/><rect x="${f2(x + 14)}" y="${WY1 - 160}" width="${f2(w - 28)}" height="110" fill="#e8b860" opacity=".75"/>`;
        o += `<rect x="${f2(x + 10)}" y="${WY1 - 220}" width="${f2(w - 20)}" height="44" fill="${C.ink900}"/><text x="${f2(x + w / 2)}" y="${WY1 - 188}" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="32" fill="${[C.swing500, C.caution500, C.signal500][Math.floor(r() * 3)]}">RECORDS</text>`;
        for (let k = 0; k < 3; k++) o += `<rect x="${f2(x + 20 + k * 30)}" y="${WY1 - 150}" width="14" height="14" fill="${C.ink900}" opacity=".5"/>`;
        o += `<rect x="${f2(x + w - 50)}" y="${WY1 - 70}" width="40" height="64" fill="${C.ink900}"/><circle cx="${f2(x + w - 30)}" cy="${WY1 - 50}" r="12" fill="#3a3346"/><circle cx="${f2(x + w - 30)}" cy="${WY1 - 20}" r="7" fill="#3a3346"/>`;
      } else if (kind < .45) {
        // Candle Bridge: a span with its lamps
        o += `<rect x="${f2(x)}" y="${WY1 - 120}" width="${f2(w + 160)}" height="22" fill="#2b2238"/>`;
        for (let k = 0; k < 5; k++) { const lx = x + 20 + k * (w + 120) / 4; o += `<rect x="${f2(lx)}" y="${WY1 - 220}" width="6" height="100" fill="#2b2238"/><circle cx="${f2(lx + 3)}" cy="${WY1 - 226}" r="9" fill="#ffd98a"/><circle cx="${f2(lx + 3)}" cy="${WY1 - 226}" r="26" fill="#ffd98a" opacity=".18"/>`; }
        o += `<rect x="${f2(x)}" y="${WY1 - 98}" width="${f2(w + 160)}" height="98" fill="#141a2a"/>`;
        w + 160;
      } else {
        const h = 260 + r() * 140;
        o += `<rect x="${f2(x)}" y="${f2(WY1 - h)}" width="${f2(w)}" height="${f2(h)}" fill="#241e30"/>`;
        for (let wy = WY1 - h + 24; wy < WY1 - 40; wy += 40) for (let wx = x + 16; wx < x + w - 24; wx += 34) if (r() < .45) o += `<rect x="${f2(wx)}" y="${f2(wy)}" width="16" height="22" fill="#f0cc80" opacity=".8"/>`;
      }
      x += (kind >= .3 && kind < .45 ? w + 160 : w) + 6;
    }
    return o;
  };
  const near = () => { let o = ""; for (let x = 0; x < SW; x += 300 + r() * 260) o += `<rect x="${f2(x)}" y="${WY0 - 20}" width="22" height="${WY1 - WY0 + 40}" fill="#07080d"/>`; return o; };
  const sky = `<rect x="0" y="${WY0 - 30}" width="${W}" height="${WY1 - WY0 + 60}" fill="url(#tr-sky)"/><circle cx="1320" cy="320" r="26" fill="#e9e3cc" opacity=".8"/>`;
  outside += strip("far", far) + strip("mid", mid) + strip("near", near);

  // ---------- the carriage ----------
  car += `<rect x="0" y="${WY0}" width="${W}" height="${WY1 - WY0}" fill="url(#tr-glass)"/>`;
  car += `<rect x="0" y="0" width="${W}" height="${WY0 - 20}" fill="${C.hullA}"/><rect x="0" y="${WY1 + 20}" width="${W}" height="${H - WY1 - 20}" fill="${C.hullA}"/>`;
  // window frames (cut out of the panel by drawing the panel around the clip)
  car += `<path fill-rule="evenodd" fill="${C.hullA}" d="M0 ${WY0 - 20} H${W} V${WY1 + 20} H0z ${wins.map(([x, w]) => `M${x + 22} ${WY0} H${x + w - 22} Q${x + w} ${WY0} ${x + w} ${WY0 + 22} V${WY1 - 22} Q${x + w} ${WY1} ${x + w - 22} ${WY1} H${x + 22} Q${x} ${WY1} ${x} ${WY1 - 22} V${WY0 + 22} Q${x} ${WY0} ${x + 22} ${WY0}z`).join(" ")}"/>`;
  car += wins.map(([x, w]) => `<rect x="${x - 6}" y="${WY0 - 6}" width="${w + 12}" height="${WY1 - WY0 + 12}" rx="26" fill="none" stroke="#c9c3b8" stroke-width="6" opacity=".7"/>`).join("");
  // ceiling, tubes, rail and the ad cards above the windows
  car += `<rect x="0" y="0" width="${W}" height="70" fill="#25384a"/>`;
  const tubes = [200, 700, 1200].map((x) => `<rect x="${x}" y="40" width="240" height="14" rx="7" fill="#fff8e0"/><rect x="${x - 60}" y="54" width="360" height="200" fill="url(#tr-tube)"/>`).join("");
  const ads = [["FLUFF", "INSTANT MASH · JUST ADD WATER", C.caution500, C.alarm700], ["THE LURKER", "ALL THE NEWS · ALL THE TIME", C.paper100, C.ink900], ["STRANGFORD-MICHTER", "YOUR MONEY · OUR FUTURE", C.file700, C.paper100]];
  car += ads.map(([a, b, bg, ink], i) => `<g transform="translate(${130 + i * 480} 112)"><rect width="390" height="96" fill="${bg}"/><text x="195" y="52" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="44" fill="${ink}">${a}</text><text x="195" y="80" text-anchor="middle" font-family="Archivo Condensed" font-weight="700" font-size="16" fill="${ink}" letter-spacing="2">${b}</text></g>`).join("");
  car += `<rect x="0" y="608" width="${W}" height="8" fill="#c9c3b8"/><rect x="0" y="236" width="${W}" height="6" fill="#c9c3b8" opacity=".5"/>`;
  // the bench under the windows
  car += `<rect x="40" y="${WY1 + 90}" width="${W - 80}" height="120" rx="14" fill="${C.rust500}"/><rect x="40" y="${WY1 + 200}" width="${W - 80}" height="80" fill="${C.rust700}"/>`;
  for (let k = 0; k < 6; k++) car += `<rect x="${60 + k * 250}" y="${WY1 + 100}" width="6" height="100" fill="${C.rust700}" opacity=".6"/>`;
  car += `<rect x="0" y="${H - 220}" width="${W}" height="220" fill="#1a2430"/><g opacity=".25">${Array.from({ length: 30 }, (_, k) => `<rect x="${k * 60}" y="${H - 220}" width="4" height="220" fill="#000"/>`).join("")}</g>`;
  // straps from the rail
  let straps = `<g id="straps">`;
  for (let k = 0; k < 9; k++) { const x = 100 + k * 175; straps += `<g class="strap" data-x="${x}" data-ph="${f2(r() * 6)}"><line x1="0" y1="0" x2="0" y2="90" stroke="#c9c3b8" stroke-width="5"/><ellipse cx="0" cy="104" rx="16" ry="18" fill="none" stroke="#e8e2d4" stroke-width="7"/></g>`; }
  straps += `</g>`;
  // the next-stop board
  over += `<g transform="translate(560 6)"><rect width="480" height="30" fill="#0e0d0b"/><text id="next" x="240" y="22" text-anchor="middle" font-family="Space Mono" font-weight="700" font-size="17" fill="#f0a830" letter-spacing="3">NEXT · APPLE LANE</text></g>`;

  // ---------- passengers holding the straps ----------
  const insp = L.fig(Object.assign(JSON.parse(JSON.stringify(L.cast.byId.inspector)), { id: "pax1", props: [], pose: { stance: "easy", weight: "R", arms: { R: "raise", L: "pocket" }, hands: { R: "grip" }, head: { tilt: 3 } } }), { id: "pax1", place: 0.255, frames: [{}, { pose: { head: { tilt: 3, yaw: -16 } } }] });
  const intl = L.fig(Object.assign(JSON.parse(JSON.stringify(L.cast.byId.intellectual)), { id: "pax2", props: [{ type: "book", side: "L" }], pose: { stance: "easy", weight: "L", arms: { R: "raise", L: "hold" }, hands: { R: "grip" }, head: { tilt: 8 } } }), { id: "pax2", place: 0.255, frames: [{}, { pose: { head: { tilt: 10, yaw: 6 } } }] });
  people += L.at(insp, 512, 1120, 0.255) + L.at(intl, 1212, 1120, 0.255);

  // Layers, back to front, each composited on its own: the sky, the three strips, the carriage (static), the passengers (static
  // but for their glances), the straps (the only layer redrawn every frame, and it is tiny), the tubes, the board. The whole
  // stack rocks as one with a CSS transform, so the heavy figures are never repainted for it.
  const V = (inner, id) => `<svg class="tl"${id ? ` id="${id}"` : ""} viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
  const body = `<div id="rock">${V(`<defs>${defs}</defs>${sky}`)}${outside}${V(car)}${V(people)}${V(straps)}${V(tubes, "tubes")}${V(over)}</div><div id="dim"></div>`;
  const css = `#rock{position:absolute;inset:0;transform-origin:50% 108%;will-change:transform}
.tl{position:absolute;inset:0;width:100%;height:100%;display:block;will-change:transform}
.strip{position:absolute;left:0;top:0;width:300%;height:100%;display:block;will-change:transform}
#dim{position:absolute;inset:0;background:#05060a;opacity:0;pointer-events:none;will-change:opacity}`;

  const script = `
const far=$('far'),mid=$('mid'),near=$('near'),rockEl=$('rock'),dim=$('dim'),next=$('next'),tubes=$('tubes');
const straps=[...document.querySelectorAll('.strap')].map(g=>({g,x:+g.dataset.x,ph:+g.dataset.ph}));
const SW=${SW};let xf=0,xm=0,xn=0,speed=1;
const stops=['APPLE LANE','CANDLE BRIDGE','CROWFOOT MARKET','THE DOCKS','THE BONEYARD','CHARHOLLOW'];let si=0;
const slide=(el,x)=>{el.style.transform='translate3d('+(-x/(SW*2)*100).toFixed(4)+'%,0,0)';};
loop((dt,c)=>{
 xf=(xf+40*speed*dt)%SW;xm=(xm+190*speed*dt)%SW;xn=(xn+900*speed*dt)%SW;
 slide(far,xf);slide(mid,xm);slide(near,xn);
 const rock=Math.sin(c*1.7)*.3*speed+Math.sin(c*5.3)*.08*speed;
 rockEl.style.transform='rotate('+rock.toFixed(3)+'deg) translate3d(0,'+(Math.abs(Math.sin(c*9))*.1*speed).toFixed(3)+'%,0)';
 for(const s of straps){s.g.setAttribute('transform','translate('+s.x+' 616) rotate('+(-rock*8+Math.sin(c*2.1+s.ph)*3*speed).toFixed(2)+')');}
 tubes.style.opacity=Math.random()<.01?'.4':'1';
});
// a bridge overhead now and then: the carriage goes dark for a moment
every(20,50,async()=>{for(const o of [.55,.25,.6,0]){dim.style.opacity=o;await new Promise(r=>setTimeout(r,o?220:0));}});
// a stop: slow down, wait, the board moves on
const loops=[];loop(dt=>{for(let i=loops.length-1;i>=0;i--){loops[i](dt);if(loops[i].done)loops.splice(i,1);}});
every(50,90,()=>{let t=0;const f=(dt)=>{t+=dt;speed=t<4?1-t/4:t<10?0:Math.min(1,(t-10)/5);if(t>10.1&&t<10.3){si=(si+1)%stops.length;next.textContent='NEXT · '+stops[si];}if(t>15){speed=1;f.done=true;}};f.done=false;loops.push(f);},30);
every(12,28,()=>move('pax1',[[1,2200],[0,0]]),4);every(15,30,()=>move('pax2',[[1,3000],[0,0]]),9);
`;
  return L.build({ file: "night-tram.html", title: "Night tram", fonts: ["Archivo Compressed", "Archivo Condensed", "Space Mono Bold"], body, css, script, grain: .15, vignette: .55, bg: "#0b0e1a", fps: 30 });
};
if (require.main === module) module.exports();
