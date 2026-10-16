// Pell's Provisions: a Daggerite grocer in Charhollow, the district of concrete blocks where most of Doskvol's Daggerites live
// ('68 p.394). Tins, rice, jars, Fluff instant mash on the bottom shelf (one packet's corner is dented: Alex's call, kept
// deliberately small), rain past the window. Pell has no canon look, so no shopkeeper is drawn: a cat minds the counter.
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng } = L;

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(394);
  let defs = "", room = "", shelves = "", front = "";
  defs += `<linearGradient id="pp-tube" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f4e0" stop-opacity=".28"/><stop offset="1" stop-color="#e8f4e0" stop-opacity="0"/></linearGradient>
  <linearGradient id="pp-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1218"/><stop offset="1" stop-color="#1c242c"/></linearGradient>
  <radialGradient id="pp-dark" cx=".55" cy=".35" r=".8"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#050807" stop-opacity=".7"/></radialGradient>
  <clipPath id="pp-win"><rect x="60" y="180" width="380" height="560"/></clipPath>`;

  // ---------- the room ----------
  room += `<rect width="${W}" height="${H}" fill="#c8c2a8"/><rect x="0" y="0" width="${W}" height="120" fill="#a9a48c"/>`;
  room += `<rect x="0" y="980" width="${W}" height="${H - 980}" fill="#6b6455"/>`;
  let lino = "";
  for (let x = 0; x < W; x += 80) for (let y = 980; y < H; y += 80) if (((x + y) / 80) % 2) lino += `<rect x="${x}" y="${y}" width="80" height="80"/>`;
  room += `<g fill="#5a5447">${lino}</g>`;
  // the window onto the street: rain and the block across the road
  room += `<rect x="44" y="164" width="412" height="592" fill="#3a3a34"/><g clip-path="url(#pp-win)"><rect x="60" y="180" width="380" height="560" fill="url(#pp-night)"/>`;
  room += `<rect x="40" y="260" width="420" height="520" fill="#2a3038"/>`;
  for (let wy = 290; wy < 720; wy += 56) for (let wx = 70; wx < 440; wx += 64) room += `<rect x="${wx}" y="${wy}" width="34" height="30" fill="${r() < .45 ? "#f0cc80" : "#1a2028"}" opacity=".85"/>`;
  room += `<g id="ppass" transform="translate(-200 0)"><ellipse cx="0" cy="560" rx="40" ry="46" fill="#0b0f13"/><path d="M-90 760 Q-80 610 0 600 Q80 610 90 760z" fill="#0b0f13"/><path d="M-120 540 Q0 440 120 540z" fill="#0b0f13"/></g>`;
  let rain = `<g id="prain" stroke="#9fb0c0" stroke-width="1.5" opacity=".5">`;
  for (let k = 0; k < 40; k++) rain += `<line x1="0" y1="0" x2="-4" y2="${f2(20 + r() * 16)}" data-x="${f2(60 + r() * 400)}" data-y="${f2(180 + r() * 560)}"/>`;
  room += rain + `</g></g>`;
  room += `<rect x="60" y="452" width="380" height="10" fill="#3a3a34"/><rect x="246" y="180" width="8" height="560" fill="#3a3a34"/>`;
  room += `<g transform="translate(250 0) scale(-1 1)" fill="${C.signal500}" opacity=".85"><text x="0" y="250" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="58" letter-spacing="2">PELL'S</text><text x="0" y="290" text-anchor="middle" font-family="Archivo Condensed" font-weight="700" font-size="26" letter-spacing="6">PROVISIONS</text></g>`;
  room += `<g transform="translate(250 600)"><rect x="-70" y="-26" width="140" height="52" rx="6" fill="${C.alarm700}"/><text x="0" y="12" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="34" fill="${C.paper100}" transform="scale(-1 1)">OPEN</text></g>`;
  // a calendar from home
  room += `<g transform="translate(1440 160) rotate(2)"><rect width="130" height="190" fill="${C.paper100}"/><rect x="8" y="8" width="114" height="90" fill="#4f96a0"/><circle cx="96" cy="30" r="12" fill="${C.caution500}"/><path d="M8 98 Q40 70 70 86 Q96 70 122 90 V98z" fill="${C.covert700}"/><path d="M30 98 L34 54 M34 54 q-16 -6 -22 4 M34 54 q14 -10 22 0" stroke="${C.ink700}" stroke-width="3" fill="none"/>
    <text x="65" y="122" text-anchor="middle" font-family="Archivo Condensed" font-weight="800" font-size="14" fill="${C.ink900}">DAGGER ISLES</text><text x="65" y="140" text-anchor="middle" font-family="Space Mono" font-size="11" fill="${C.ink700}">968</text>
    ${Array.from({ length: 20 }, (_, k) => `<rect x="${12 + (k % 5) * 22}" y="${150 + Math.floor(k / 5) * 9}" width="16" height="5" fill="${C.ink300}"/>`).join("")}</g>`;

  // ---------- shelves on the back wall ----------
  const SX = 520, SW = 880, rows = [300, 470, 640, 810];
  shelves += `<rect x="${SX - 20}" y="150" width="${SW + 40}" height="${810 - 150 + 30}" fill="#8a7a5a"/><rect x="${SX}" y="170" width="${SW}" height="${810 - 170}" fill="#5e5340"/>`;
  rows.forEach((y, ri) => {
    shelves += `<rect x="${SX - 20}" y="${y}" width="${SW + 40}" height="16" fill="#a8946c"/><rect x="${SX - 20}" y="${y + 16}" width="${SW + 40}" height="6" fill="#3e3628"/>`;
    // price tags
    for (let k = 0; k < 7; k++) shelves += `<rect x="${SX + 30 + k * 125}" y="${y + 2}" width="40" height="12" fill="${C.paper100}"/><text x="${SX + 50 + k * 125}" y="${y + 12}" text-anchor="middle" font-family="Space Mono" font-size="9" fill="${C.ink900}">${(1 + Math.floor(r() * 9))}s</text>`;
    if (ri === 3) return; // the bottom shelf is the mash
    let x = SX + 14;
    while (x < SX + SW - 60) {
      const kind = r();
      if (kind < .45) { // tins
        const w = 46, h = 60 + (ri === 0 ? 10 : 0), col = [C.alarm700, C.file700, C.covert700, C.caution500, "#c9c3b8"][Math.floor(r() * 5)];
        for (let s = 0; s < 2; s++) shelves += `<g transform="translate(${f2(x)} ${y - h * (s + 1)})"><rect width="${w}" height="${h}" fill="#9aa09b"/><rect y="10" width="${w}" height="${h - 20}" fill="${col}"/><rect x="6" y="${h / 2 - 6}" width="${w - 12}" height="12" fill="${C.paper100}" opacity=".85"/><rect width="${w}" height="5" fill="#c9cdc8"/><rect x="${w - 8}" width="5" height="${h}" fill="#000" opacity=".15"/></g>`;
        x += w + 4;
      } else if (kind < .7) { // jars
        const w = 54, h = 80, col = ["#b8491a", "#7a8a3a", "#c9a03a"][Math.floor(r() * 3)];
        shelves += `<g transform="translate(${f2(x)} ${y - h})"><rect width="${w}" height="${h}" rx="8" fill="${col}" opacity=".85"/><rect x="4" width="${w - 8}" height="14" fill="${C.ink700}"/><rect x="8" y="30" width="${w - 16}" height="26" fill="${C.paper100}" opacity=".8"/><rect x="8" y="20" width="6" height="50" fill="#fff" opacity=".2"/></g>`;
        x += w + 6;
      } else { // a rice sack
        const w = 110, h = 120;
        shelves += `<g transform="translate(${f2(x)} ${y - h})"><path d="M10 ${h} Q0 40 14 14 Q${w / 2} 0 ${w - 14} 14 Q${w} 40 ${w - 10} ${h}z" fill="#d8ccaa"/><path d="M20 20 Q${w / 2} 34 ${w - 20} 20" stroke="#a89a78" stroke-width="4" fill="none"/><text x="${w / 2}" y="${h - 36}" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="26" fill="${C.alarm700}">RICE</text><text x="${w / 2}" y="${h - 16}" text-anchor="middle" font-family="Space Mono" font-size="11" fill="${C.ink700}">10 KG</text></g>`;
        x += w + 8;
      }
    }
  });
  // the bottom shelf: Fluff instant mash in rows going back; the third packet along has a dented corner
  const fluff = (x, y, s, dent) => `<g transform="translate(${f2(x)} ${f2(y)}) scale(${s})"><rect x="0" y="-104" width="70" height="104" fill="${C.caution500}"/><rect x="0" y="-104" width="70" height="26" fill="${C.alarm700}"/>
    <text x="35" y="-84" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="20" fill="${C.paper100}">FLUFF</text><text x="35" y="-46" text-anchor="middle" font-family="Archivo Condensed" font-weight="800" font-size="11" fill="${C.alarm700}">INSTANT</text><text x="35" y="-32" text-anchor="middle" font-family="Archivo Condensed" font-weight="800" font-size="11" fill="${C.alarm700}">MASH</text>
    <ellipse cx="35" cy="-16" rx="18" ry="6" fill="${C.paper100}"/>${dent ? `<polygon points="70,-104 54,-104 70,-90" fill="#b89a2a"/><polygon points="54,-104 70,-90 58,-92" fill="#8a7420" opacity=".8"/>` : ""}<rect x="64" y="-104" width="6" height="104" fill="#000" opacity=".12"/></g>`;
  let mash = "";
  // back rows first (smaller, darker), the front row last
  for (const [row, s, dy, op] of [[2, .78, -16, .7], [1, .88, -8, .85], [0, 1, 0, 1]]) {
    let g = "";
    for (let k = 0; k < 11; k++) g += fluff(SX + 30 + k * 78 + row * 10, rows[3] + dy, s, row === 0 && k === 2);
    mash += `<g opacity="${op}">${g}</g>`;
  }
  shelves += mash;

  // ---------- the counter, the till, the radio, the cat ----------
  front += `<path d="M960 910 L1600 892 L1600 1200 L990 1200z" fill="#7a5a3a"/><path d="M940 910 L1600 890 L1600 918 L948 938z" fill="#a8946c"/>`;
  front += `<g transform="translate(1390 822)"><rect x="-90" y="0" width="180" height="70" fill="#3e4340"/><path d="M-80 0 L-60 -80 L60 -80 L80 0z" fill="#545e5a"/><rect x="-50" y="-70" width="100" height="30" fill="#1a1f1c"/><text id="till" x="0" y="-48" text-anchor="middle" font-family="Space Mono" font-weight="700" font-size="20" fill="#e8b860">0.00</text>
    ${Array.from({ length: 12 }, (_, k) => `<circle cx="${-60 + (k % 6) * 24}" cy="${-24 + Math.floor(k / 6) * 16}" r="7" fill="${C.paper200}"/>`).join("")}</g>`;
  front += `<g transform="translate(1090 862)"><rect x="-70" y="-60" width="140" height="70" rx="12" fill="${C.rust700}"/><rect x="-58" y="-48" width="70" height="44" rx="6" fill="#d8c79a"/><line id="dial" x1="-40" y1="-48" x2="-40" y2="-4" stroke="${C.alarm700}" stroke-width="3"/><circle cx="40" cy="-26" r="16" fill="#2a2521"/><circle cx="40" cy="-26" r="5" fill="#8a8f96"/></g>`;
  front += `<g id="notes" fill="${C.ink900}" opacity="0"><text x="1110" y="772" font-family="Space Mono" font-size="30">♪</text></g>`;
  // the cat, asleep on the counter, tail flicking
  front += `<g transform="translate(1240 904)"><path d="M-90 0 Q-96 -56 -30 -64 Q30 -70 60 -40 Q80 -20 74 0z" fill="${C.ink700}"/><circle cx="66" cy="-38" r="26" fill="${C.ink700}"/><polygon points="50,-58 56,-82 68,-62" fill="${C.ink700}"/><polygon points="72,-62 84,-80 88,-54" fill="${C.ink700}"/><path d="M56 -38 q6 4 12 0 M74 -38 q6 4 12 0" stroke="${C.caution500}" stroke-width="2.5" fill="none"/>
    <g id="tail"><path d="M-86 -8 Q-150 -10 -150 30 Q-150 50 -126 46" fill="none" stroke="${C.ink700}" stroke-width="14" stroke-linecap="round"/></g></g>`;

  // ---------- the tube ----------
  front += `<g><rect x="640" y="60" width="600" height="18" rx="9" fill="#f2fae8" id="tube"/><rect x="620" y="52" width="640" height="10" fill="#8a8f96"/></g>`;
  front += `<rect id="tubelight" x="0" y="70" width="${W}" height="900" fill="url(#pp-tube)"/><circle id="fly" r="3" fill="${C.ink900}" cx="900" cy="110"/>`;
  front += `<rect width="${W}" height="${H}" fill="url(#pp-dark)"/><rect id="dim" width="${W}" height="${H}" fill="#020403" opacity="0"/>`;

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>${room}${shelves}${front}</svg>`;

  const script = `
const drops=[...document.querySelectorAll('#prain line')].map(l=>({l,x:+l.dataset.x,y:+l.dataset.y}));
const tail=$('tail'),tube=$('tube'),tl=$('tubelight'),dim=$('dim'),fly=$('fly'),dial=$('dial'),notes=$('notes'),pass=$('ppass');
let flick=0;
loop((dt,c)=>{
 for(const d of drops){d.y+=700*dt;if(d.y>760){d.y=170;d.x=60+Math.random()*400;}d.l.setAttribute('transform','translate('+d.x.toFixed(1)+' '+d.y.toFixed(1)+')');}
 tail.setAttribute('transform','rotate('+(Math.sin(c*1.3)*6+(Math.sin(c*.23)>.9?Math.sin(c*9)*10:0)).toFixed(1)+' -86 -8)');
 fly.setAttribute('cx',(900+Math.cos(c*2.1)*90+Math.sin(c*5.3)*20).toFixed(1));fly.setAttribute('cy',(115+Math.sin(c*2.7)*26).toFixed(1));
 dial.setAttribute('transform','translate('+(Math.sin(c*.05)*20+20).toFixed(1)+' 0)');
 notes.setAttribute('opacity',(Math.max(0,Math.sin(c*.8))*.5).toFixed(2));notes.setAttribute('transform','translate('+(Math.sin(c*.8)*10).toFixed(1)+' '+(-((c*14)%40)).toFixed(1)+')');
 if(flick>0){flick-=dt;const on=Math.random()<.5;tube.setAttribute('opacity',on?1:.3);tl.setAttribute('opacity',on?1:.2);dim.setAttribute('opacity',on?0:.35);if(flick<=0){tube.setAttribute('opacity',1);tl.setAttribute('opacity',1);dim.setAttribute('opacity',0);}}
});
every(18,45,()=>{flick=R(.3,1.2);},6);
every(35,90,()=>{let x=-200;const step=()=>{x+=6;pass.setAttribute('transform','translate('+x+' 0)');if(x<700)setTimeout(step,40);};step();},12);
`;
  return L.build({ file: "pells-provisions.html", title: "Pell's Provisions", fonts: ["Archivo Compressed", "Archivo Condensed", "Space Mono"], body, script, grain: .16, vignette: .5, bg: "#0d1218", fps: 24 });
};
if (require.main === module) module.exports();
