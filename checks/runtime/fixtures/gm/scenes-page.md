# Invented district scenes page (test fixture: every name and line here is made up)

```dataviewjs
const Math = Object.create(globalThis.Math);
let __rng = () => globalThis.Math.random();
Math.random = () => __rng();
const STICKY = { key: "x", load() { return null; }, save(s) {} };

const T = {};

T.district = [
  {
    n: "Alder Quay", p: "p.1",
    r: ["High", "Low", "Moderate", "Very low"],
    streets: "Wet stone and tied-up boats.",
    named: ["Rope Walk", "Kettle Steps", "Moon Slip"],
    buildings: "Net lofts and a smokehouse.",
    scene: ["A cat walks the rail.", "Two gulls argue over a hat.", "A bell rings once."],
    landmarks: ["The Leaning Crane", "Fish Hall"],
    notables: [["Ota Pell", "Runs the ferry and a quiet book.", "Dry, Patient"], ["Wick Amory", "Sells maps of rivers that moved.", "Vague, Cheerful"]],
    factions: "The Lamp Guild, Reed Row",
    special: "Boats make a good getaway: take +1d to escape by water."
  },
  {
    n: "Brindle Row", p: "p.2",
    r: ["Low", "High", "High", "Low"],
    streets: "Brick, narrow, always shaded.",
    named: ["Tin Lane", "Saddle Street"],
    buildings: "Terraces with shared yards.",
    scene: ["A child chalks a door."],
    landmarks: ["The Orange Gate", "Mill Chapel", "Pump Square"],
    notables: [["Dara Voss", "Landlady with a ledger.", "Sharp, Fair"], ["Hobb Lund", "Retired courier who sees all.", "Slow, Kind"], ["Ivy Crane", "Organises the stair committee.", "Loud, Right"]],
    factions: "Reed Row",
    special: ""
  },
  {
    n: "Cobb Hill", p: "p.3",
    r: ["Very high", "Very high", "Low", "Moderate"],
    streets: "Wide and swept.",
    named: ["Hill Road", "Cedar Crescent", "Garden Walk", "Almond Mews"],
    buildings: "Tall houses with iron gates.",
    scene: ["A gardener clips a hedge.", "A tutor walks three pupils.", "A car idles, engine off."],
    landmarks: ["The Glass House"],
    notables: [["Sir Marl", "Owns half the lamps.", "Pompous, Lonely"]],
    factions: "The Lamp Guild",
    special: "Anyone loud is noticed at once."
  }
];

T.weather = {
  Bluetime: ["a high pale sky", "a light breeze", "thin cloud", "a warm gust"],
  Night: ["a low mist", "steady rain", "a clear cold", "a rising wind"]
};
T.streetType = ["a stepped lane", "a covered passage", "a tram street", "a yard path", "a sunken way", "a quiet square"];
T.streetSound = ["a distant whistle", "someone sweeping", "a gate swinging", "a radio through a wall", "boots on stone", "a dog barking twice"];
T.streetSmell = ["coal smoke", "river mud", "fried onions", "wet wool", "warm bread", "paint thinner"];
T.streetObstacle = ["A queue for something", "A stuck cart", "A stretch of fresh paint", "A crowd round a card game", "Scaffolding", "A burst pipe"];
T.buildingCommon = ["a bakery", "a tailor's", "a boarding house", "a tea room", "a laundry", "a locksmith"];
T.buildingRare = ["a private bank", "a shuttered cinema", "a small embassy", "a clockmaker's"];
T.rumour = ["%F%'s newest recruit", "%F%'s debt", "%F%'s favourite bar", "a quarrel inside %F%", "a rival of %F%", "%F%'s missing ledger"];
T.faction = ["The Lamp Guild", "Reed Row", "The Ferry Union", "The Night Post", "Salt & Sons", "The Quiet Choir"];

// --- Machinery ---------------------------------------------------------------

const pick = a => a[Math.floor(Math.random() * a.length)];
const oneIn = n => Math.floor(Math.random() * n) === 0;
const MEM = {};
function fresh(key, list, keyFn = x => x) {
  const used = (MEM[key] ||= []);
  const pool = list.filter(x => !used.includes(keyFn(x)));
  const from = pool.length ? pool : list;
  const choice = from[Math.floor(Math.random() * from.length)];
  const winSize = Math.max(1, Math.min(20, Math.floor(list.length / 2)));
  used.push(keyFn(choice));
  if (used.length > winSize) used.shift();
  return choice;
}
function pickN(a, n) {
  const c = a.slice(), out = [];
  n = Math.min(n, c.length);
  while (out.length < n) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
  return out;
}
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

function generate(forced) {
  const d = forced || pick(T.district);
  const o = { d };
  o.timeOfDay = oneIn(2) ? "Bluetime" : "Night";
  o.weather = fresh("weather-" + o.timeOfDay, T.weather[o.timeOfDay]);
  o.street = fresh("street-" + d.n, d.named);
  o.streetType = fresh("streetType", T.streetType);
  o.sound = fresh("sound", T.streetSound);
  o.smell = fresh("smell", T.streetSmell);
  o.obstacle = fresh("obstacle", T.streetObstacle);
  o.neighbour = oneIn(3) ? fresh("bldgRare", T.buildingRare)
                         : fresh("bldgCommon", T.buildingCommon);
  o.beats = pickN(d.scene, Math.min(2, d.scene.length));
  o.landmark = fresh("landmark-" + d.n, d.landmarks);
  o.who = fresh("notable-" + d.n, d.notables);
  o.rumour = fresh("rumour", T.rumour).replace("%F%", fresh("faction", T.faction));
  return o;
}

function ratings(o) {
  const r = o.d.r;
  return [`Wealth ${r[0]}`, `Security ${r[1]}`, `Criminal ${r[2]}`, `Paranormal ${r[3]}`];
}
```
