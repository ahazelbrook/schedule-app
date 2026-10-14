# Invented engagement roll page (test fixture: every name and line here is made up)

```dataviewjs
const T = {};

T.approach = [
  ["Smash",  "the weak hinge"],
  ["Charm",  "the friendly face"],
  ["Slip",   "the unwatched door"]
];

T.factor = [
  { id: "bold",   plus: "The plan is neat",
                  minus: "It leans on too many people" },
  { id: "tier",   plus: "The target is smaller than the crew",
                  minus: "The target is bigger than the crew" }
];

// --- Machinery ---------------------------------------------------------------
const d6 = () => 1 + Math.floor(Math.random() * 6);

function roll(n) {
  const zero = n <= 0, dice = [];
  for (let i = 0; i < (zero ? 2 : n); i++) dice.push(d6());
  const sixes = dice.filter(x => x === 6).length;
  return { dice, zero, pool: n, crit: !zero && sixes >= 2, best: zero ? Math.min(...dice) : Math.max(...dice) };
}

function outcome(r) {
  if (r.crit) return ["Ahead of the game — and through the first door",
    "Start the scene on the far side of the first door."];
  if (r.best === 6) return ["Ahead",
    "They hold the advantage. Open on that."];
  if (r.best >= 4) return ["Level",
    "The default. Open mid-problem."];
  return ["Behind",
    "Trouble from the first breath. The other side is good at this."];
}

const wrap = dv.container.createEl("div");
const loadSel = wrap.createEl("select");
loadSel.createEl("option", { text: "Quiet — load 3", value: "Quiet" });
loadSel.createEl("option", { text: "Loud — load 6", value: "Loud" });

function draw(doRoll) {
  const app = T.approach[0];
  card.createEl("div", { cls: "b68-role",
    text: `opening gambit is ${app[1]} · ${loadSel.value} loadout, load ${loadSel.value === "Quiet" ? 3 : 6} · '68 p.1–2` });
  if (doRoll === true) {
    const r = roll(1);
    dv.el("div", "Now **cut to the middle of it** — and ask someone " +
      "what they are doing about it.", { container: card, cls: "b68-read" });
  } else {
    dv.el("div", "Set the factors, then roll.", { container: card, cls: "b68-read" });
  }
}
```
