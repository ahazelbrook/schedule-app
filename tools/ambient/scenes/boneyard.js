// The Boneyard at dawn: the fish market built inside a leviathan carcass at the Docks, the Limmerfield Gang's Flensing Yard,
// where the crew's lair sits (b68g-s01). Backlit ribs recede into the dawn through the carcass mouth; fog drifts; hooks sway.
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng } = L;

module.exports = function build() {
  const W = 1600, H = 1200, VX = 1130, VY = 610;
  const r = rng(68);
  let defs = "", sky = "", ribs = "", floor = "", stalls = "", hooks = "", front = "";

  defs += `<radialGradient id="by-dawn" cx="${VX / W}" cy="${(VY - 40) / H}" r=".55">
    <stop offset="0" stop-color="#fff1c8"/><stop offset=".12" stop-color="${C.caution500}"/><stop offset=".34" stop-color="${C.signal500}"/>
    <stop offset=".62" stop-color="${C.rust700}"/><stop offset="1" stop-color="${C.rust900}"/></radialGradient>
  <linearGradient id="by-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.signal500}" stop-opacity="0"/>
    <stop offset=".55" stop-color="#f3b46a" stop-opacity=".55"/><stop offset="1" stop-color="${C.signal500}" stop-opacity=".1"/></linearGradient>
  <linearGradient id="by-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8693a"/><stop offset=".25" stop-color="${C.rust700}"/>
    <stop offset="1" stop-color="${C.ink900}"/></linearGradient>
  <radialGradient id="by-lamp"><stop offset="0" stop-color="#ffe7a6" stop-opacity=".95"/><stop offset=".25" stop-color="${C.caution500}" stop-opacity=".45"/>
    <stop offset="1" stop-color="${C.signal500}" stop-opacity="0"/></radialGradient>
  <radialGradient id="by-fog"><stop offset="0" stop-color="#f6d6a6" stop-opacity=".5"/><stop offset="1" stop-color="#f6d6a6" stop-opacity="0"/></radialGradient>
  <linearGradient id="by-shaft" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe9b8" stop-opacity="0"/>
    <stop offset=".5" stop-color="#ffe9b8" stop-opacity=".22"/><stop offset="1" stop-color="#ffe9b8" stop-opacity="0"/></linearGradient>`;

  // ---------- the dawn beyond the carcass mouth ----------
  sky += `<rect width="${W}" height="${H}" fill="url(#by-dawn)"/>`;
  sky += `<circle cx="${VX + 30}" cy="${VY - 70}" r="54" fill="#fff4d6" opacity=".9"/><circle cx="${VX + 30}" cy="${VY - 70}" r="120" fill="#fff0c0" opacity=".18"/>`;
  // the docks through the mouth: cranes, masts and a warehouse line, in haze
  let dock = "";
  const dx0 = VX - 240, dx1 = VX + 260, dy = VY + 70;
  dock += `<rect x="${dx0}" y="${dy - 34}" width="${dx1 - dx0}" height="60" fill="${C.rust700}" opacity=".45"/>`;
  for (let i = 0; i < 9; i++) { const x = dx0 + 20 + i * 54 + r() * 20, h = 30 + r() * 50; dock += `<rect x="${f2(x)}" y="${f2(dy - 34 - h)}" width="${f2(22 + r() * 26)}" height="${f2(h)}" fill="${C.rust700}" opacity=".4"/>`; }
  for (const [cx, h, arm] of [[VX - 160, 170, 90], [VX + 150, 210, -110]]) {
    dock += `<g fill="none" stroke="${C.rust700}" stroke-width="5" opacity=".5"><path d="M${cx} ${dy - 34} L${cx} ${dy - 34 - h} L${cx + arm} ${dy - 34 - h + 18} M${cx} ${dy - 34 - h + 26} L${cx + arm * .8} ${dy - 34 - h + 20} M${cx + arm * .9} ${dy - 34 - h + 18} L${cx + arm * .9} ${dy - 34 - h + 70}"/></g>`;
  }
  for (let i = 0; i < 4; i++) { const x = VX - 60 + i * 38; dock += `<line x1="${x}" y1="${dy - 30}" x2="${x + 3}" y2="${dy - 150 - r() * 40}" stroke="${C.rust700}" stroke-width="3" opacity=".45"/>`; }
  sky += dock;
  // slow light shafts through the ribs
  sky += `<g id="shafts" opacity=".8">${[-420, -150, 160].map((o, i) => `<polygon points="${pts([[VX + o * .2, VY - 240], [VX + o * .2 + 40, VY - 240], [VX + o * 1.6 + 260, H], [VX + o * 1.6 - 60, H]])}" fill="url(#by-shaft)" class="shaft" data-i="${i}"/>`).join("")}</g>`;

  // ---------- the ribs, far to near: an arch per rib, backlit with a warm rim ----------
  const N = 9;
  const proj = (i) => 1 / (1 + i * 0.42);
  let spine = [];
  for (let i = N - 1; i >= 0; i--) {
    const p = proj(i);
    const cx = VX + (790 - VX) * p, fy = VY + 70 + (1290 - VY - 70) * p;
    const rx = 1180 * p + 30, ry = 1330 * p + 30, t = 120 * p + 6;
    const depth = 1 - p; // 0 near .. ~0.8 far
    // haze between ribs: each layer pushes everything behind it toward the dawn
    ribs += `<rect x="0" y="${f2(fy - ry * 1.3)}" width="${W}" height="${f2(ry * 1.6)}" fill="url(#by-haze)" opacity="${f2(0.1 + depth * 0.08)}"/>`;
    // the rib: a tapering band along the upper half of an ellipse, ends curling inward at the floor
    const outer = [], inner = [];
    const M = 40;
    for (let k = 0; k <= M; k++) {
      const a = Math.PI + (k / M) * Math.PI;
      const wob = 1 + Math.sin(k * 0.7 + i) * 0.012;
      const taper = 0.55 + 0.45 * Math.sin((k / M) * Math.PI);
      const x = cx + Math.cos(a) * rx * wob, y = fy + Math.sin(a) * ry * wob;
      const nx = Math.cos(a), ny = Math.sin(a);
      outer.push([x, y]);
      inner.push([x - nx * t * taper, y - ny * t * taper]);
    }
    // ends curl in at the floor
    const curl = (pt, s) => [pt[0] + s * t * 0.6, pt[1] + t * 0.5];
    const band = outer.concat([curl(outer[M], -1)], inner.slice().reverse(), [curl(outer[0], 1)]);
    const col = depth < 0.25 ? C.ink900 : depth < 0.5 ? C.rust900 : depth < 0.65 ? "#5a2c14" : "#8a4a22";
    ribs += `<polygon points="${pts(band)}" fill="${col}"/>`;
    // the rim: light from the mouth catches the inner edge of each rib
    const rim = inner.slice(4, M - 3);
    ribs += `<polyline points="${pts(rim)}" fill="none" stroke="#ffc884" stroke-width="${f2(Math.max(1.2, t * 0.07))}" opacity="${f2(0.35 + depth * 0.4)}" stroke-linecap="round"/>`;
    // bone texture on near ribs: a few stippled pits
    if (depth < 0.5) {
      let pits = "";
      for (let k = 0; k < 60 * p; k++) { const q = outer[4 + Math.floor(r() * (M - 8))]; pits += `<circle cx="${f2(q[0] + (r() - .5) * t * .4)}" cy="${f2(q[1] + t * (.2 + r() * .5))}" r="${f2(1 + r() * 2.5 * p)}"/>`; }
      ribs += `<g fill="#6a3418" opacity=".55">${pits}</g>`;
    }
    spine.push({ x: cx, y: fy - ry, t, p, depth, col });
    // the vertebra on this arch's crown, drawn with its rib so nearer ribs cover farther ones
    ribs += `<rect x="${f2(cx - t * .8)}" y="${f2(fy - ry - t * .5)}" width="${f2(t * 1.6)}" height="${f2(t * .7)}" rx="${f2(t * .22)}" fill="${col}"/>`;
    ribs += `<polygon points="${pts([[cx - t * .2, fy - ry - t * .45], [cx, fy - ry - t * 1.05], [cx + t * .2, fy - ry - t * .45]])}" fill="${col}"/>`;
    if (i <= 3) hooks += hookSet(i, cx, fy, rx, ry, t, p);
  }
  // the spine: a vertebra on each arch top, joined
  spine.sort((a, b) => a.p - b.p);

  function hookSet(i, cx, fy, rx, ry, t, p) {
    let o = "";
    const n = [3, 3, 2, 2][i];
    for (let k = 0; k < n; k++) {
      const a = Math.PI * (1.18 + 0.64 * (k + 0.5) / n) + (r() - .5) * .1;
      const ax = cx + Math.cos(a) * (rx - t * .5), ay = fy + Math.sin(a) * (ry - t * .5);
      const len = (220 + r() * 260) * p * 1.4;
      const hook = `<path d="M0 ${f2(len)} q0 ${f2(26 * p)} ${f2(-18 * p)} ${f2(26 * p)} q-12 0 -14 -12" fill="none" stroke="${C.ink900}" stroke-width="${f2(6 * p + 1)}" stroke-linecap="round"/>`;
      const meat = r() < .55 ? `<path d="M${f2(-40 * p)} ${f2(len + 20 * p)} q${f2(40 * p)} ${f2(-26 * p)} ${f2(80 * p)} 0 l${f2(-12 * p)} ${f2(120 * p)} q${f2(-28 * p)} ${f2(22 * p)} ${f2(-56 * p)} 0z" fill="#7a2e1c"/><path d="M${f2(-30 * p)} ${f2(len + 30 * p)} l${f2(56 * p)} 0" stroke="#e8b8a0" stroke-width="${f2(4 * p)}" opacity=".6"/>` : "";
      o += `<g class="hook" data-a="${f2(ax)}" data-b="${f2(ay)}" data-s="${f2(1.2 + r() * 1.5)}" data-ph="${f2(r() * 6)}" transform="translate(${f2(ax)} ${f2(ay)})">
        <line x1="0" y1="0" x2="0" y2="${f2(len)}" stroke="${C.ink900}" stroke-width="${f2(3 * p + 1)}" stroke-dasharray="${f2(8 * p + 2)} ${f2(3 * p + 1)}"/>${hook}${meat}</g>`;
    }
    return o;
  }

  // ---------- the floor: wet planks to the mouth, with reflections ----------
  const fy0 = VY + 70;
  floor += `<polygon points="${pts([[0, fy0 + 40], [W, fy0 + 40], [W, H], [0, H]])}" fill="url(#by-floor)"/>`;
  let planks = "";
  for (let k = -12; k <= 14; k++) planks += `<line x1="${VX + k * 9}" y1="${fy0 + 40}" x2="${VX + k * 160}" y2="${H}" stroke="${C.ink900}" stroke-width="2" opacity=".35"/>`;
  floor += planks;
  floor += `<polygon points="${pts([[VX - 70, fy0 + 40], [VX + 90, fy0 + 40], [VX + 420, H], [VX - 360, H]])}" fill="#ffd9a0" opacity=".16"/>`;
  floor += `<ellipse cx="${VX}" cy="${fy0 + 60}" rx="300" ry="26" fill="#ffe2b0" opacity=".25"/>`;
  // puddles
  for (let k = 0; k < 7; k++) { const x = 140 + r() * 1300, y = fy0 + 170 + r() * 380; floor += `<ellipse cx="${f2(x)}" cy="${f2(y)}" rx="${f2(60 + r() * 120)}" ry="${f2(6 + r() * 10)}" fill="#f4b878" opacity=".14"/>`; }

  // ---------- the stalls ----------
  function stall(x, y, s, flip, awning) {
    let o = "";
    const w = 300 * s, h = 120 * s;
    // trestle and crates
    o += `<rect x="${f2(x)}" y="${f2(y - h)}" width="${f2(w)}" height="${f2(h)}" fill="${C.rust700}"/>`;
    for (let k = 1; k < 4; k++) o += `<line x1="${f2(x)}" y1="${f2(y - h + k * h / 4)}" x2="${f2(x + w)}" y2="${f2(y - h + k * h / 4)}" stroke="${C.rust900}" stroke-width="${f2(2 * s + .5)}"/>`;
    o += `<rect x="${f2(x)}" y="${f2(y - h)}" width="${f2(w)}" height="${f2(10 * s)}" fill="#c88a5a"/>`;
    // ice tray of fish
    o += `<rect x="${f2(x + 10 * s)}" y="${f2(y - h - 26 * s)}" width="${f2(w - 20 * s)}" height="${f2(26 * s)}" fill="${C.paper300}"/>`;
    for (let k = 0; k < 9; k++) {
      const fx = x + 24 * s + k * (w - 48 * s) / 9, fyy = y - h - 16 * s + (k % 2) * 6 * s;
      o += `<g transform="translate(${f2(fx)} ${f2(fyy)}) rotate(${f2((r() - .5) * 30)}) scale(${f2(s)})"><ellipse cx="0" cy="0" rx="22" ry="7" fill="${k % 3 ? C.slate500 : "#9fb3b4"}"/><polygon points="20,0 32,-7 32,7" fill="${C.slate700}"/><ellipse cx="-4" cy="-2" rx="14" ry="2" fill="#dfe7e4" opacity=".7"/><circle cx="-15" cy="-1" r="1.6" fill="${C.ink900}"/></g>`;
    }
    // posts and a striped awning
    o += `<rect x="${f2(x + 6 * s)}" y="${f2(y - h - 210 * s)}" width="${f2(8 * s)}" height="${f2(210 * s)}" fill="${C.rust900}"/><rect x="${f2(x + w - 14 * s)}" y="${f2(y - h - 210 * s)}" width="${f2(8 * s)}" height="${f2(210 * s)}" fill="${C.rust900}"/>`;
    if (awning) {
      const ay = y - h - 210 * s, n = 7;
      for (let k = 0; k < n; k++) o += `<polygon points="${pts([[x - 10 * s + k * (w + 20 * s) / n, ay], [x - 10 * s + (k + 1) * (w + 20 * s) / n, ay], [x - 10 * s + (k + 1) * (w + 20 * s) / n, ay + 44 * s], [x - 10 * s + (k + .5) * (w + 20 * s) / n, ay + 54 * s], [x - 10 * s + k * (w + 20 * s) / n, ay + 44 * s]])}" fill="${k % 2 ? C.paper200 : awning}"/>`;
      o += `<rect x="${f2(x - 10 * s)}" y="${f2(ay - 6 * s)}" width="${f2(w + 20 * s)}" height="${f2(8 * s)}" fill="${C.ink900}" opacity=".6"/>`;
    }
    // a lamp under the awning
    const lx = x + w / 2, ly = y - h - 150 * s;
    o += `<line x1="${f2(lx)}" y1="${f2(y - h - 205 * s)}" x2="${f2(lx)}" y2="${f2(ly)}" stroke="${C.ink900}" stroke-width="${f2(2 * s)}"/>`;
    o += `<circle class="lamp" cx="${f2(lx)}" cy="${f2(ly + 10 * s)}" r="${f2(150 * s)}" fill="url(#by-lamp)"/>`;
    o += `<path d="M${f2(lx - 16 * s)} ${f2(ly + 8 * s)} l${f2(8 * s)} ${f2(-14 * s)} l${f2(16 * s)} 0 l${f2(8 * s)} ${f2(14 * s)}z" fill="${C.ink900}"/><circle cx="${f2(lx)}" cy="${f2(ly + 12 * s)}" r="${f2(6 * s)}" fill="#fff0c0"/>`;
    return o;
  }
  stalls += stall(870, 820, .5, false, C.signal700);
  stalls += stall(1330, 830, .46, true, C.covert700);
  stalls += stall(60, 950, .78, false, C.alarm700);
  stalls += stall(1240, 1010, .9, true, C.file700);

  // the gang's sign hanging from the nearest rib
  const sx = 520, sy = 300;
  front += `<g id="sign" transform="translate(${sx} ${sy})"><line x1="-70" y1="-260" x2="-70" y2="0" stroke="${C.ink900}" stroke-width="4"/><line x1="70" y1="-260" x2="70" y2="0" stroke="${C.ink900}" stroke-width="4"/>
    <rect x="-150" y="0" width="300" height="104" fill="${C.rust700}"/><rect x="-142" y="8" width="284" height="88" fill="none" stroke="${C.paper200}" stroke-width="3" opacity=".8"/>
    <text x="0" y="62" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="58" fill="${C.paper100}" letter-spacing="2">FLENSING YARD</text>
    <text x="0" y="86" text-anchor="middle" font-family="Space Mono" font-size="15" fill="${C.paper200}" letter-spacing="3">LIMMERFIELD · NO CREDIT</text></g>`;

  // ---------- people ----------
  const S = 0.255;
  const brack = L.fig(L.npc("brackley"), { id: "brackley", frames: [{}, { pose: { head: { yaw: -6, tilt: -1 } } }, { pose: { head: { yaw: -18, tilt: 1 } } }] });
  const skin = L.fig(L.npc("skinner"), { id: "skinner", lod: "lo", frames: [{}, { pose: { head: { tilt: 4, yaw: -2 } } }, { pose: { head: { tilt: -4, yaw: 4 } } }] });
  // porters in the haze: silhouettes carrying crates toward the mouth
  const porter = (id, x) => L.fig(Object.assign(L.pc("loader"), { id, props: [], body: {}, pose: { stance: "easy", arms: { R: "carry", L: "down" } } }), { id, silhouette: true, lod: "lo", shadow: false });
  const P1 = porter("porter1"), P2 = porter("porter2");
  let people = "";
  people += `<g class="porter" data-x0="${VX - 330}" data-x1="${VX - 60}" data-y="${fy0 + 62}" opacity=".55">${L.at(P1, 0, 0, 0.07)}<rect x="-30" y="-150" width="40" height="30" fill="${C.ink900}"/></g>`;
  people += `<g class="porter" data-x0="${VX + 280}" data-x1="${VX + 40}" data-y="${fy0 + 78}" opacity=".6">${L.at(P2, 0, 0, 0.08)}<rect x="-6" y="-170" width="46" height="34" fill="${C.ink900}"/></g>`;
  front += L.at(brack, 330, 1150, S);

  // ---------- gulls ----------
  const gull = (cls) => `<g class="${cls}"><path class="w1" d="M-34 0 Q-17 -16 0 0 Q17 -16 34 0 Q17 -6 0 4 Q-17 -6 -34 0z" fill="${C.ink900}"/><path class="w2" d="M-34 6 Q-17 10 0 0 Q17 10 34 6 Q17 4 0 4 Q-17 4 -34 6z" fill="${C.ink900}" style="display:none"/></g>`;
  let gulls = `<g id="gulls">${gull("gull")}${gull("gull")}${gull("gull")}</g>`;
  // perched gulls on the nearest arch top
  const perch = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="20" ry="11" fill="${C.paper200}"/><circle cx="16" cy="-12" r="8" fill="${C.paper200}"/><polygon points="23,-12 34,-10 23,-8" fill="${C.caution500}"/><path d="M-22 -2 L-6 -6 L2 4z" fill="${C.ink500}"/><line x1="-2" y1="10" x2="-2" y2="22" stroke="${C.signal700}" stroke-width="2"/><line x1="4" y1="10" x2="4" y2="22" stroke="${C.signal700}" stroke-width="2"/></g>`;

  // ---------- fog ----------
  let fog = `<g id="fog">`;
  for (let k = 0; k < 6; k++) fog += `<ellipse class="fogb" cx="${f2(r() * W)}" cy="${f2(fy0 - 60 + r() * 420)}" rx="${f2(380 + r() * 380)}" ry="${f2(60 + r() * 70)}" fill="url(#by-fog)" data-v="${f2(6 + r() * 10)}"/>`;
  fog += `</g>`;
  const dawn = `<rect id="dawnlift" width="${W}" height="${H}" fill="#ffd28c" opacity="0" style="mix-blend-mode:soft-light"/>`;

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>
  ${sky}${floor}${people}${ribs}${L.at(skin, 1150, 905, 0.2)}${stalls}${hooks}${fog}${gulls}
  ${perch(spine[spine.length - 1].x - 60, spine[spine.length - 1].y - 140, 1.1)}${perch(spine[spine.length - 2].x + 40, spine[spine.length - 2].y - 100, .9)}
  ${front}${dawn}</svg>`;

  const script = `
const hooks=[...document.querySelectorAll('.hook')].map(g=>({g,a:+g.dataset.a,b:+g.dataset.b,s:+g.dataset.s,ph:+g.dataset.ph}));
const lamps=[...document.querySelectorAll('.lamp')];const fogs=[...document.querySelectorAll('.fogb')].map(e=>({e,x:+e.getAttribute('cx'),v:+e.dataset.v}));
const shafts=[...document.querySelectorAll('.shaft')];const porters=[...document.querySelectorAll('.porter')].map(g=>({g,x0:+g.dataset.x0,x1:+g.dataset.x1,y:+g.dataset.y,t:Math.random()}));
const sign=$('sign');const dawn=$('dawnlift');
loop((dt,c)=>{
 for(const h of hooks){const a=Math.sin(c*h.s*.6+h.ph)*1.8+Math.sin(c*.23+h.ph)*1.2;h.g.setAttribute('transform','translate('+h.a+' '+h.b+') rotate('+a.toFixed(2)+')');}
 sign.setAttribute('transform','translate(520 300) rotate('+(Math.sin(c*.5)*1.1).toFixed(2)+')');
 for(let i=0;i<lamps.length;i++)lamps[i].setAttribute('opacity',(.85+Math.sin(c*7.3+i*2)*.04+(Math.random()<.01?-.25:0)).toFixed(2));
 for(const f of fogs){f.x+=f.v*dt;if(f.x>1900)f.x=-300;f.e.setAttribute('cx',f.x.toFixed(1));}
 for(let i=0;i<shafts.length;i++)shafts[i].setAttribute('opacity',(.55+Math.sin(c*.11+i*1.7)*.35).toFixed(2));
 for(const p of porters){p.t+=dt/46;if(p.t>1)p.t=0;const x=p.x0+(p.x1-p.x0)*p.t;const bob=Math.abs(Math.sin(p.t*90))*2;const s=1-p.t*.35;p.g.setAttribute('transform','translate('+x.toFixed(1)+' '+(p.y-bob).toFixed(1)+') scale('+s.toFixed(3)+')');p.g.style.opacity=(p.t<.08?p.t/.08:p.t>.9?(1-p.t)/.1:1)*.6;}
 // the dawn comes up over seven minutes, then holds
 dawn.setAttribute('opacity',Math.min(.5,c/840).toFixed(3));
});
// gulls cross the mouth now and then
const gs=[...document.querySelectorAll('.gull')];gs.forEach(g=>g.style.display='none');
function flight(g){g.style.display='';const y0=R(250,560),dir=Math.random()<.5?1:-1,x0=dir>0?-80:1680,sp=R(140,220),s=R(.5,1);let x=x0,t=0;const w1=g.querySelector('.w1'),w2=g.querySelector('.w2');
 const step=(dt)=>{if(!g.isConnected)return;t+=dt;x+=dir*sp*dt;const y=y0+Math.sin(t*1.3)*30;const up=Math.floor(t*5)%2===0;w1.style.display=up?'':'none';w2.style.display=up?'none':'';g.setAttribute('transform','translate('+x.toFixed(1)+' '+y.toFixed(1)+') scale('+(dir*s).toFixed(2)+' '+s.toFixed(2)+')');if(x<-120||x>1720){g.style.display='none';g._f=null;}};g._f=step;}
loop(dt=>{for(const g of gs)if(g._f)g._f(dt);});
every(6,16,()=>{const g=gs.find(g=>!g._f);if(g)flight(g);},2);
// Brackley looks round; Skinner nods along
every(9,20,()=>move('brackley',[[1,140],[2,2600],[1,160],[0,0]]));
every(7,15,()=>move('skinner',[[1,900],[0,1400],[2,1100],[0,0]]));
`;
  return L.build({ file: "boneyard-dawn.html", title: "The Boneyard at dawn", fonts: ["Archivo Compressed", "Space Mono"], body, script, grain: .16, vignette: .55, bg: C.rust900, fps: 24 });
};
if (require.main === module) module.exports();
