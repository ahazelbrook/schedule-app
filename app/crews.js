/* Blades '68 crew playbooks, transcribed from the six crew sheets (Dealers, Hit Squad, Militants, Racers, Shadows, Utopians).
   Sets window.B68Crews = { CREWS, byId, COMMON }. Text is verbatim from the sheets (bold/italic dropped); names printed in caps are title-cased.

   Shapes:
   - abilities: [name, text] or [name, text, circles, meta]. circles = printed checkbox circles when more than one (1 otherwise).
       meta (optional): { marked: n } circles printed pre-filled; { plus: n } the n-th circle is printed with a "+" inside it;
       { group: id } Utopians only, see abilityGroups.
   - claim/product/circle cells: { id, name, text, special, oneOff, oneOffLabel, outline, base, turf, pre, links }
       special     orange header with a square checkbox (instead of the usual round one)
       oneOff      orange-outlined, white-bodied "target" cell (always also special)
       oneOffLabel the cell prints "ONE-OFF OPPORTUNITY" (Hit Squad only)
       outline     'double' when the orange outline is a double ring (the crew's main big-score target), else 'single'; null if not oneOff
       pre         pre-held on the printed sheet (BASE cells; Dealers' first Distribution turf)
       links       ids of cells joined to this one by a grey connector bar (symmetric). Dealers' product uses arrows:
                   there links = arrow targets (outgoing) and linkedFrom = arrow sources, and product.directed = true.
   - upgrades: { name, boxes, pre, linked } — boxes = printed checkboxes, pre = boxes printed filled, linked = boxes joined by a bar (Mastery, +1 key/deadlock). */
(function (root) {
  function cell(id, name, text, o) {
    var c = { id: id, name: name, text: text, special: false, oneOff: false, oneOffLabel: false, outline: null, base: false, turf: false, pre: false, links: [] };
    if (o) for (var k in o) c[k] = o[k];
    if (c.oneOff) { c.special = true; if (!c.outline) c.outline = "single"; }
    return c;
  }
  function sp(id, name, text) { return cell(id, name, text, { special: true }); }
  function target(id, name, text, outline, label) { return cell(id, name, text, { oneOff: true, outline: outline || "single", oneOffLabel: !!label }); }
  function turf(id, text, o) { var c = cell(id, "Turf", text, o); c.turf = true; return c; }
  function base() { return cell("base", "Base", "", { base: true, pre: true }); }
  // edges: [[a, b], ...]; undirected unless directed (then a -> b)
  function link(cells, edges, directed) {
    var by = {};
    cells.forEach(function (c) { by[c.id] = c; if (directed) c.linkedFrom = []; });
    edges.forEach(function (e) {
      var a = by[e[0]], b = by[e[1]];
      if (!a || !b) throw new Error("B68Crews: bad link " + e[0] + " - " + e[1]);
      a.links.push(b.id);
      if (directed) b.linkedFrom.push(a.id); else b.links.push(a.id);
    });
    return cells;
  }
  // Standard grid: 4 rows x 5 cols, row-major; h = horizontal bars "r:c" joins (r,c)-(r,c+1); v = vertical bars "r:c" joins (r,c)-(r+1,c)
  function grid(cells, h, v) {
    var at = function (r, c) { return cells[(r - 1) * 5 + (c - 1)].id; }, edges = [];
    h.forEach(function (s) { var p = s.split(":"); edges.push([at(+p[0], +p[1]), at(+p[0], +p[1] + 1)]); });
    v.forEach(function (s) { var p = s.split(":"); edges.push([at(+p[0], +p[1]), at(+p[0] + 1, +p[1])]); });
    return { rows: 4, cols: 5, cells: link(cells, edges) };
  }
  function up(name, boxes, pre, linked) { return { name: name, boxes: boxes || 1, pre: pre || 0, linked: !!linked }; }
  function training(pre) { pre = pre || {}; return ["Insight", "Prowess", "Resolve", "Personal"].map(function (n) { return up(n, 1, pre[n]); }).concat([up("Mastery", 4, 0, true)]); }
  function baseUps(pre) {
    pre = pre || {};
    return [up("Van", 2, pre.Van), up("Vault", 2, pre.Vault), up("Boat", 2, pre.Boat), up("Hidden", 1, pre.Hidden), up("Secure", 2, pre.Secure), up("Workshop", 1, pre.Workshop), up("Lounge and quarters", 1, pre["Lounge and quarters"])];
  }
  var ITEMS = ["Documents", "Gear", "Paranormal", "Supplies", "Tools", "Weapons"];
  function items() { return ITEMS.map(function (n) { return up(n); }); }
  var COSTS = { newCohort: 2, addType: 2 };

  var BENEFACTOR = "When you take this ability, the crew immediately receives 4 stacks. Whenever you advance your Tier, it costs half the stacks it normally would. Who’s backing you? Why do they help you?";
  var VERSATILE = ["Versatile", "Choose a special ability from another crew.", 3, { plus: 3 }];

  var COMMON = {
    headerFields: ["Name", "Reputation", "Base", "Ward boss"], // plus the "Crew’s mark" drawing box
    anger: { label: "Anger", segments: 4 }, // round clock in a rounded square, divided by a cross into 4
    rep: { label: "Rep", pips: 12, accentedPips: 6, turfLabel: "Turf" },
    // accentedPips: the first 6 Rep pips are drawn with yellow tops, the last 6 grey; no rule printed for it. // unclear: meaning of the 6/6 split
    // Turf: the Rep track ends in a "Turf" label; held turf is marked from the right end (Dealers print the 12th pip pre-filled for their starting turf). No rule text is printed.
    hold: { label: "Hold", options: [{ label: "Weak", pips: 1 }, { label: "Strong", pips: 1 }] },
    tier: { label: "Tier", pips: 4 },
    heat: { label: "Heat", pips: 9 },
    wantedLevel: { label: "Wanted Level", pips: 4 }, // printed as faint grey pips
    stacks: { label: "Stacks", pips: 4 },
    vaults: { label: "Vaults", groups: [4, 8] }, // two greyed groups (4, then 8) unlocked by the 2-box Vault upgrade
    xpIntro: "At the end of each session, mark 1 xp (or 2 xp if you really smashed it) if:",
    footer: "Upon crew xp advance, each PC marks bank = Tier+2",
    upgradeCosts: COSTS
  };

  var CREWS = [
    /* ---------------------------------------------------------------- DEALERS */
    { id: "dealers", name: "Dealers", tagline: "Pushers who acquire and sell illegal product",
      repLabel: "Reputation", extraHeader: [], repTurfPre: 1,
      preferred: { label: "Preferred operations", writeIns: 0, opsPrefix: null,
        ops: ["Show Of Force", "Social Intrigue", "Bulk Acquisition", "Bulk Sale"],
        rule: "Get +1d to gather information rolls and a free downtime activity for preferred operations on your turf.",
        extra: "You start with one turf (instead of hunting grounds)." },
      abilities: [
        ["First Rate", "Your merchandise is exquisite. Gain potency when you Sway or Consort with those hooked on your product. When you deal with a crew or faction, the GM will tell you who among them is already hooked (one, a few, many, or all)."],
        ["On Retainer", "You have an expert lawyer representing your crew. Their Quality is equal to crew Tier + 2. When you take the Reduce Heat downtime action, you can have your lawyer roll their Quality instead. When you take the rap, your Wanted Level counts as one lower for the purposes of sentencing."],
        ["Payment in Kind", "You can use units to purchase crew upgrades. 1 crew upgrade costs 5 units (so a new cohort would cost 10 units)."],
        ["First One’s Free", "You can give away your product to build Rep during downtime. 1 Rep costs 1 unit."],
        ["Field Testing", "You can prepare a special cut of your product for use during a score. Choose an effect: healing (clear level 1 harm), exhilarating (clear 1 Stress), calming (social potency), enlightening (increase result level on gather information). Each costs 1 unit of product, takes 1 load, and is consumed after use."],
        ["Cat and Mouse", "The GM will tell you about any special Mandates investigating your crew, and put their clocks on the table from now on. You get +2d to the engagement roll against any raids (Mandates or otherwise)."],
        ["Benefactor", BENEFACTOR],
        VERSATILE
      ],
      xpMax: 10,
      contacts: [["Sevoy", "a magistrate"], ["Blodgett", "a Bluecoat"], ["Marlyn", "a party animal"], ["Vera", "an airship pilot"], ["Sloan", "a gang boss"], ["Crimson", "a fixer"]],
      xpTriggers: [
        "You completed a successful show of force, social intrigue, bulk acquisition, or bulk sale operation.",
        "You contended with challenges above your current station.",
        "You bolstered your crew’s reputation or developed a new one.",
        "You expressed the goals, drives, or inner conflict of the crew."
      ],
      claims: null, // Dealers have The Product instead, see special.product
      upgrades: {
        crew: [up("Dealer rigging (1 carried item is concealed, 0 load)"), up("Elite Hustlers"), up("Elite Muscle"), up("Intriguing (+1 key/deadlock)", 3, 0, true)],
        training: training(),
        base: baseUps({ Secure: 1 }),
        items: items(),
        cohorts: [up("Hustlers cohort", 1, 1)]
      },
      upgradeCosts: COSTS,
      cohortStart: "Hustlers cohort",
      special: {
        product: (function () {
          var SUP = function (n, h, u) { return "Once per personal business, take 1 " + h + " to gain " + u; };
          var MOVE = "All turf generates +1 stack when moving units";
          var LAUNDER = "Take -3 Heat from gaining/moving units, every personal business";
          var DIST = "1 unit can be moved for 1 stack in personal business (take 1 Heat)";
          var rows = [
            { label: "Supply", cells: [
              cell("local-supplier", "Local Supplier", SUP(0, "Heat", "1 unit")),
              cell("local-supplier-2", "Local Supplier", SUP(0, "Heat", "1 unit")),
              cell("smuggler", "Smuggler", SUP(0, "Heat", "2 units")),
              cell("manufacturer", "Manufacturer", SUP(0, "Heat", "2 units")),
              cell("airship", "Airship", SUP(0, "heat", "3 units")) // lower-case "heat" as printed
            ] },
            { label: "Demand", cells: [
              cell("local-fiends", "Local Fiends", MOVE),
              cell("city-wide", "City-Wide", MOVE),
              cell("luxury-venue", "Luxury Venue", "+1d to Consort and Sway on-site, +2 stacks for social intrigue"),
              cell("key-influencer", "Key Influencer", MOVE),
              cell("vip-clients", "VIP Clients", MOVE)
            ] },
            { label: "Competitive advantages", cells: [
              cell("branding", "Branding", "+1d engagement roll for social plans, +2 stacks for bulk sale or supply"),
              cell("money-laundering", "Money Laundering", LAUNDER),
              sp("top-secret-intel", "Top Secret Intel", "+2d engagement for Monopoly score"),
              cell("money-laundering-2", "Money Laundering", LAUNDER),
              target("monopoly", "Monopoly", "Tier 5 target, all Turf can move 2 units per downtime for the same Heat", "single") // no ONE-OFF OPPORTUNITY label printed
            ] },
            { label: "Distribution", cells: [
              turf("turf", DIST, { pre: true }), // circle printed filled: the starting turf
              turf("turf-2", DIST), turf("turf-3", DIST), turf("turf-4", DIST), turf("turf-5", DIST)
            ] }
          ];
          var all = [].concat(rows[0].cells, rows[1].cells, rows[2].cells, rows[3].cells);
          // Arrows (direction as printed). No arrows join Local Fiends to anything, nor the Distribution turfs to each other or to other rows.
          link(all, [
            ["local-supplier", "local-supplier-2"], ["local-supplier-2", "smuggler"], ["smuggler", "manufacturer"], ["manufacturer", "airship"],
            ["local-supplier-2", "city-wide"], // down arrow
            ["city-wide", "luxury-venue"], ["luxury-venue", "key-influencer"], ["key-influencer", "vip-clients"],
            ["money-laundering", "city-wide"], // up arrow
            ["branding", "money-laundering"], ["money-laundering", "top-secret-intel"], ["top-secret-intel", "money-laundering-2"], ["money-laundering-2", "monopoly"]
          ], true);
          return { label: "The product", kinds: ["Narcotics", "Black-Market Goods", "Restricted Items"], unitsMax: 30, directed: true, rows: rows };
        })()
      } },

    /* ---------------------------------------------------------------- HIT SQUAD */
    { id: "hit-squad", name: "Hit Squad", tagline: "Contract killers, discreet and skilled assassins",
      repLabel: "Reputation", extraHeader: [], repTurfPre: 0,
      preferred: { label: "Hunting grounds", writeIns: 1, opsPrefix: "Preferred Operations:",
        ops: ["Accident", "Disappearance", "Murder", "Ransom"],
        rule: "Get +1d to gather information rolls and free downtime activity for preferred operations in your hunting grounds",
        extra: null },
      abilities: [
        ["Take the Shot", "When any PC takes the decisive action to eliminate a key target, they get +1d."],
        ["Under the Radar", "When you kill someone during a score, you can take 2 Stress so that it doesn’t count towards Heat afterwards. How does your crew avoid the Death Radar?"],
        ["Chameleons", "Take +1d to the engagement roll for stealth or deception approaches. When you subdue someone and don their outfit, the disguise has increased effect."],
        ["Cold Storage", "Every crew member can always find a convenient place to hide a body near to hand. Take 1 Stress to hide the body in the resonance field instead (it will rematerialize after a few hours)."],
        ["Benefactor", "When you take this ability, the crew immediately receives 4 stacks. Whenever you advance your Tier, it costs half the stacks it normally would. Who’s backing you?"],
        ["Loopers", "Your crew is caught in an anomaly, and regularly experiences time loops where events are replayed. Usually you don’t retain memory between loops, but you can jump loops with some effort. Take 4 Stress after any action roll to roll it again, and take the best result between the two rolls. The second roll uses the exact same number of dice (pushes, assists, etc.). You can choose to do this after the GM has announced the consequences, but not after any resistance rolls."],
        ["Professionals", "When you keep an operation quiet or make it look like an accident, you get half the Rep value of the target (round up) instead of zero. When you end downtime with zero Heat, take +1 Rep."],
        VERSATILE
      ],
      xpMax: 10,
      contacts: [["Vestine Keel", "a crime boss"], ["Tilton", "a vengeful aristocrat"], ["Hush", "a Reality Warden"], ["Beesby", "a deal broker"], ["Mowsley", "a cult leader"], ["Yugo Xantara", "a powerful CEO"]],
      xpTriggers: [
        "You executed a successful accident, disappearance, murder, or ransom operation.",
        "You contended with challenges above your current station.",
        "You bolstered your crew’s reputation or developed a new one.",
        "You expressed the goals, drives, or inner conflict of the crew."
      ],
      claims: grid([
        cell("friendly-ink-rake", "Friendly Ink Rake", "+1 rep per score"),
        cell("city-records", "City Records", "+1d engagement for stealth approaches"),
        target("legendary-target", "Legendary Target", "Tier V target, 15 rep, 10 stacks", "double", true),
        sp("double-contract", "Double Contract", "Legendary Target includes second hit, for +10 bonus stacks"),
        cell("cover-identities", "Cover Identities", "+1d engagement for deception and social approaches"),

        cell("protection-racket", "Protection Racket", "(Tier roll) - Heat = stacks in downtime"),
        cell("shady-hotel", "Shady Hotel", "+1 scale for your Skulk cohorts"),
        sp("detailed-map", "Detailed Map", "+2d engagement for legendary target score"),
        cell("cover-operation", "Cover Operation", "-2 heat per score"),
        cell("hagfish-farm", "Hagfish Farm", "Body disposal, +1d to reduce heat after killing"),

        target("elusive-target", "Elusive Target", "Tier IV target, +5 bonus rep", "single", true),
        cell("gambling-hall", "Gambling Hall", "(Tier roll) - Heat = stacks in downtime"),
        cell("vip-lounge", "VIP Lounge", "+2 stacks for high-class targets"),
        cell("dispensary", "Dispensary", "+1d to healing rolls"),
        cell("informants", "Informants", "+1d gather info for scores"),

        cell("dive-bar", "Dive Bar", "+2 stacks for low-class targets"),
        turf("turf", "Expand hunting grounds and add new preferred operation"),
        base(),
        turf("turf-2", "Expand hunting grounds and add new preferred operation"),
        sp("clock-the-routine", "Clock the Routine", "2 free flashbacks during Legendary Target score")
      ],
        ["1:1", "1:2", "1:3", "1:4", "2:1", "2:2", "2:3", "2:4", "3:1", "3:2", "3:3", "3:4", "4:1", "4:2", "4:3"],
        ["1:1", "1:2", "1:5", "2:1", "2:3", "2:5", "3:1", "3:3", "3:4", "3:5"]),
      upgrades: {
        crew: [up("Assassin rigging (2 free load of weapons or gear)"), up("Elite Muscle"), up("Elite Infiltrators"), up("Deep (+1 key/deadlock)", 3, 0, true)],
        training: training({ Prowess: 1 }),
        base: baseUps(),
        items: items(),
        cohorts: [up("Muscle cohort", 1, 1)]
      },
      upgradeCosts: COSTS,
      cohortStart: "Muscle cohort",
      special: {} },

    /* ---------------------------------------------------------------- MILITANTS */
    { id: "militants", name: "Militants", tagline: "Activists pushing for revolutionary change",
      repLabel: null, // the header prints THE CAUSE where the other sheets print REPUTATION
      extraHeader: [{ key: "cause", label: "The cause" }], repTurfPre: 0,
      preferred: { label: "Enemies of the cause (x2)", writeIns: 2, opsPrefix: "Preferred Operations:",
        ops: ["Assassination", "Demonstration", "Sabotage", "Battle"],
        rule: "Get +1d to gather information rolls and free downtime activity for preferred operations against Enemies of the Cause",
        extra: null },
      abilities: [
        ["Sympathizers", "The common citizenry of your home ground, and any turf you hold, are sympathetic to you and your cause. You can consider them allies (status +3). When asked, they will: give you shelter or a place to hide, redirect Bluecoats or other enemies, or give you other aid if they can."],
        ["Mutual Aid", "You can lend support to one allied faction, and their Tier counts as one higher as long as you do. Your crew gets one free downtime action to work one of that faction’s long-term project clocks, if you wish. You can switch support once per downtime."],
        ["Guerrillas", "When the target of a score is two or more Tier higher than you, take no penalty to the engagement roll, and gain +2 Rep after the score (whether you were successful or not)."],
        ["On the Side of the Oppressed", "You loudly and openly oppose the Bluecoats and their authoritarianism. You may count each Wanted Level as if it were turf."],
        ["Absolute Commitment", "You have all sworn solemn vows of service to the cause. You get +1d to resistance rolls."],
        ["Benefactor", BENEFACTOR],
        ["Revolutionaries", "When you’re at war (-3 faction status), your crew does not suffer -1 hold and PCs still get two downtime activities, instead of just one."],
        VERSATILE
      ],
      xpMax: 10,
      contacts: [["Davran", "a foreign diplomat"], ["Eaves", "a Palace handler"], ["Sovata", "a student leader"], ["Hickling", "a union organizer"], ["Kannick", "a Blackthorn Park handler"], ["Kastor", "a weapons dealer"]],
      xpTriggers: [
        "You executed a successful assassination, demonstration, sabotage, or battle operation.",
        "You contended with challenges above your current station.",
        "You completed meaningful work for the cause, or found a new cause.",
        "You expressed the goals, drives, or inner conflict of the crew."
      ],
      claims: grid([
        cell("secret-caches", "Secret Caches", "Stockpiles give you +1d to Acquire Asset rolls"),
        cell("popular-support", "Popular Support", "+1d engagement for stealth approaches"),
        target("critical-strike", "Critical Strike", "Tier 5 target, target drops 2 Tiers", "double"),
        sp("expropriation", "Expropriation", "Critical Strike score includes +10 bonus stacks"),
        cell("hostel", "Hostel", "+1 scale for your Muscle cohorts"),

        target("catalyst-action", "Catalyst Action", "Tier 4 target, creates new Tier 2 faction (+2 status)", "single"),
        turf("turf", "Add new preferred operation"),
        sp("key-conspirator", "Key Conspirator", "+2d engagement for Critical Strike score"),
        turf("turf-2", "Add new preferred operation"),
        cell("interview-room", "“Interview Room”", "+1d to Command and Sway on-site"),

        cell("informants", "Informants", "+1d to gather info for scores"),
        sp("grassroot-support", "Grassroot Support", "New faction from Catalyst Action score will be +3 status"),
        cell("donations", "Donations", "+2 stacks for battle or demonstration"),
        cell("dispensary", "Dispensary", "+1d to healing rolls"),
        cell("social-clubs", "Social Clubs", "(Tier roll) - Heat = stacks in downtime"),

        cell("covert-funding", "Covert Funding", "+2 stacks for sabotage or assassination"),
        turf("turf-3", "Add new preferred operation"),
        base(),
        turf("turf-4", "Add new preferred operation"),
        cell("meeting-hall", "Meeting Hall", "+1d to Consort and Sway on-site")
      ],
        ["1:1", "1:2", "1:3", "1:4", "2:1", "2:2", "2:3", "3:2", "3:3", "3:4", "4:1", "4:2", "4:3", "4:4"],
        ["1:1", "1:2", "1:4", "1:5", "2:1", "2:2", "2:3", "2:4", "2:5", "3:1", "3:3", "3:5"]),
      upgrades: {
        crew: [up("Militant rigging (2 free load of weapons or armor)"), up("Elite Muscle"), up("Elite Runners"), up("Complicated (+1 key/deadlock)", 3, 0, true)],
        training: training({ Resolve: 1 }),
        base: baseUps(),
        items: items(),
        cohorts: [up("Muscle cohort", 1, 1)]
      },
      upgradeCosts: COSTS,
      cohortStart: "Muscle cohort",
      special: {} },

    /* ---------------------------------------------------------------- RACERS */
    { id: "racers", name: "Racers", tagline: "Thrill-seekers, smugglers, daredevils, and family",
      repLabel: "Reputation", extraHeader: [], repTurfPre: 0,
      preferred: { label: "Local circuit", writeIns: 1, opsPrefix: "Preferred Operations:",
        ops: ["Smuggling", "Hijacking", "Racing", "Smash-and-Grab"],
        rule: "Get +1d to gather information rolls and free downtime activity for preferred operations that start in your local circuit",
        extra: null },
      abilities: [
        // "these these" is printed so on the sheet
        ["Stunt Riders", "The first time one of the crew’s signature stunts is performed during a score, take +2d and increased effect. Choose one to start with. The crew masters an additional signature stunt each time you take this ability. You can do any of these these stunts even if they’re not a signature, but don’t get bonus dice etc.", 3, { marked: 1 }],
        ["Custom Ride", "Create one of your vehicles (autopod, autocycle, boat, etc.) as a cohort (use 1–2 vehicle edges and an equal number of flaws). Its Quality is equal to your Tier +1. It includes a driver, if needed."],
        // "during the score ." (space before the full stop) is printed so
        ["Escape Velocity", "One of the crew’s vehicles is fitted with a device that activates at a specific speed. This requires filling an 8-segment acceleration clock during the score . When the clock is filled and the vehicle hits the target speed, choose an effect: break the laws of gravity—create a tear in reality—travel into the resonance field—travel backward or forward through time."],
        ["The Family Takes a Cut", "Before payout for a smuggling or hijacking score, the crew can skim the goods for +4 stacks. The GM will tick a clock."],
        ["Bring Them In", "As long as you’re not currently fighting them (e.g. you’re at war), you can turn even the most bitter of enemies into family. This requires a long-term project—6 segments to turn them into a crew contact, 10 segments to turn them into a cohort or PC (your choice). If they become a PC, create them as normal, with bonus action dots and abilities each equal to their Tier, and any deadlocks at the GM’s discretion. Their faction’s relationship to your crew does not change."],
        ["Speed Demons", "When you go into conflict aboard a vehicle, you gain increased effect for vehicle damage and speed. If the vehicle has armor, you can use it for your own protection."],
        VERSATILE
      ],
      xpMax: 10,
      contacts: [["Karson", "a bookmaker"], ["Ivory", "an arms dealer"], ["Buddy", "a mechanic"], ["Rinse", "a drug dealer"], ["Baine", "a Palace spy"], ["Vreen", "owns the autodrome"]],
      xpTriggers: [
        "You executed a successful smuggling, hijacking, racing, or smash-and-grab operation", // no full stop printed
        "You contended with challenges above your current station.",
        "You bolstered your crew’s reputation or developed a new one.",
        "You expressed the goals, drives, or inner conflict of the crew."
      ],
      // The Racers grid is shorter (Signature Stunts box below it) but still 4 x 5
      claims: grid([
        cell("weird-old-gate", "Weird Old Gate", "Safe passage out of the Bubble"),
        sp("weird-old-maps", "Weird Old Maps", "+2d engagement for Deathlands Race score"),
        target("deathlands-race", "Deathlands Race", "Tier 4 opponents, 10 Rep, 15 stacks", "double"),
        sp("secret-hit", "Secret Hit", "Take out a target during Deathlands Race score for +10 bonus stacks"),
        cell("gambling-den", "Gambling Den", "(Tier roll) - Heat = stacks in downtime"),

        cell("secret-routes", "Secret Routes", "+1d engagement for speed approaches"),
        turf("turf", "Expand local circuit and add new preferred operation"),
        turf("turf-2", "Expand local circuit and add new preferred operation"),
        cell("chop-shop", "Chop Shop", "(Tier roll) - Heat = stacks in downtime"),
        cell("warehouse", "Warehouse", "Stockpiles give you +1d to Acquire Asset rolls"),

        target("big-street-race", "Big Street Race", "Tier 3 opponents, 15 stacks", "single"),
        cell("lounge-bar", "Lounge Bar", "+1d to Consort and Sway on-site"),
        turf("turf-3", "Expand local circuit and add new preferred operation"),
        cell("informants", "Informants", "+1d gather info for scores"),
        cell("cover-operation", "Cover Operation", "-2 Heat per score"),

        turf("turf-4", "Expand local circuit and add new preferred operation"),
        cell("loyal-fence", "Loyal Fence", "+2 stacks for smuggling or hijacking"),
        base(),
        cell("convoy", "Convoy", "Your cohorts have their own vehicles"),
        sp("bets-placed", "Bets Placed", "+5 bonus stacks for Deathlands Race score")
      ],
        ["1:1", "1:2", "1:3", "1:4", "2:1", "2:2", "2:3", "2:4", "3:2", "3:4", "4:1", "4:2", "4:3", "4:4"],
        ["1:1", "1:5", "2:1", "2:2", "2:3", "2:5", "3:1", "3:2", "3:3", "3:4", "3:5"]),
      upgrades: {
        crew: [up("Racer rigging (2 items perfectly concealed)"), up("Elite Runners"), up("Airship (+mobility for base)"), up("Complicated (+1 key/deadlock)", 3, 0, true)],
        training: training(),
        // Racers replace Van/Boat with Vehicles/Heavy Vehicles; Vehicles 1 of 2 and Workshop printed filled
        base: [up("Vehicles", 2, 1), up("Vault", 2), up("Heavy Vehicles", 2), up("Hidden"), up("Secure", 2), up("Workshop", 1, 1), up("Lounge and quarters")],
        items: items(),
        cohorts: [] // the Cohorts column is printed empty
      },
      upgradeCosts: COSTS,
      cohortStart: null,
      special: {
        stunts: { label: "Signature stunts", rule: "Choose one to start with",
          list: [
            ["Smuggler’s Turn", "A controlled skid and turn before speeding off in the opposite direction."],
            ["Reverse 180", "Spinning 180 degrees and continuing in the same direction but facing backward."],
            ["Shell Game", "Launching decoy vehicles (may need to acquire an assset) to confuse and surprise."], // "assset" is printed so
            ["Outside Ride", "Riding the roof, side, or hood of a moving vehicle, and leaping from vehicle to vehicle."],
            ["Big Air", "Launching a vehicle into the air across a surprising distance with any improvised ramp."],
            ["Ramming Speed", "Putting your foot down and meeting obstacles head-on."]
          ] },
        vehicleEdges: [
          ["Nimble", "The vehicle handles easily. Consider this an assist for tricky maneuvers."],
          ["Simple", "The vehicle is easy to repair. Remove all of its harm during downtime."],
          ["Sturdy", "The vehicle keeps operating even when broken."]
        ],
        vehicleFlaws: [
          ["Distinct", "The vehicle has memorable features. Take +1 Heat when you use it on a score."],
          ["Finicky", "When operated without the one person who understands it, the vehicle has -1 Quality."],
          // unclear: layout glitch on the sheet. The "Guzzler:" heading sits orphaned under Finicky's text, and this text sits headless in the third column; paired here as obviously intended.
          ["Guzzler", "The vehicle costs 1 stack per downtime to keep in operation."]
        ]
      } },

    /* ---------------------------------------------------------------- SHADOWS */
    { id: "shadows", name: "Shadows", tagline: "Covert specialists, experts in heists and espionage",
      repLabel: "Reputation", extraHeader: [], repTurfPre: 0,
      preferred: { label: "Hunting grounds", writeIns: 1, opsPrefix: "Preferred Operations:",
        ops: ["Surveillance", "Heists", "Subterfuge", "Cleanup"],
        rule: "Get +1d to gather information rolls and free downtime activity for preferred operations in your hunting grounds",
        extra: null },
      abilities: [
        ["Synchronized Watches", "You may use assists or setup actions with any crew member, regardless of the distance separating you. When you perform a group action, you may count multiple 6s from different rolls as a critical success."],
        ["Thieves with a Code", "When you complete a score with no deaths having occurred, gain +1 faction status with the local citizenry."],
        ["Sleepy Time", "Everyone on the crew adds tranquilizer rounds (0 load, compatible with any firearm) to their playbook items."],
        ["Don’t Forget the Duffel Bag", "Once per score, the crew can flashback to an Acquire Asset roll with +2d. Both the flashback and the downtime activity are free."],
        ["Benefactor", BENEFACTOR],
        ["Echo Safe House", "The crew has access to a safe house in the resonance field. It can be accessed once per score, from anywhere. The door always returns to the same place it was entered from. Use it as a hiding place, to reequip, repair, or just take a breather. Any PCs who enter gain +1 load. One PC may clear all level 1 harm via emergency medical supplies there. Note that time still passes in the outside world."],
        ["Black Bag Operations", "When you execute a clandestine infiltration, you get +1d to the engagement roll. You may attempt to install surveillance equipment during a score on any faction’s turf. So long as the wire remains in place, take +1d on any future gather information rolls related to that faction. The GM may make a fortune roll with the faction’s Tier to see if they notice the bug and remove it during personal business."],
        VERSATILE
      ],
      xpMax: 10,
      contacts: [["Malloy", "a Ministry clerk"], ["Bloom", "a collector"], ["Catton", "a hotel concierge"], ["Caldwell", "an art forger"], ["Vera", "switchboard operator"], ["Tarnish", "an information broker"]],
      xpTriggers: [
        "You executed a surveillance, heist, subterfuge, or cleanup operation.",
        "You contended with challenges above your current station.",
        "You bolstered your crew’s reputation or developed a new one.",
        "You expressed the goals, drives, or inner conflict of the crew."
      ],
      claims: grid([
        cell("cover-identities", "Cover Identities", "+1d engagement for deception and social plans"),
        turf("turf", "Expand hunting grounds and add new preferred operation"),
        target("checkmate", "Checkmate", "Tier 5 target, 30 stacks, complete any clock", "double"),
        sp("inside-mark", "Inside Mark", "Target for Checkmate counts as -1 Tier for that score"),
        cell("secret-pathways", "Secret Pathways", "+1d engagement for stealth plans"),

        cell("paid-off-bluecoats", "Paid-Off Bluecoats", "-2 Heat per score"),
        sp("interested-party", "Interested Party", "Checkmate score earns +10 bonus stacks"),
        cell("slush-fund", "Slush Fund", "+1d to Acquire Asset rolls"),
        sp("cover-story", "Cover Story", "+2d engagement for Checkmate score"),
        cell("luxury-venue", "Luxury Venue", "+1d to Consort and Sway on-site"),

        target("critical-move", "Critical Move", "Tier 4 target, 15 stacks, +4 ticks on any clock", "single"),
        cell("high-stakes-game", "High-Stakes Game", "(Tier roll) - Heat = stacks in downtime"),
        cell("informants", "Informants", "+1d gather info for scores"),
        turf("turf-2", "Expand hunting grounds and add new preferred operation"),
        cell("dispensary", "Dispensary", "+1d to healing rolls"),

        turf("turf-3", "Expand hunting grounds and add new preferred operation"),
        cell("specialist-fence", "Specialist Fence", "+2 stacks for heists or paranormal acquisitions"),
        base(),
        cell("covert-fixer", "Covert Fixer", "+2 stacks for spycraft or industrial espionage"),
        cell("lounge-bar", "Lounge Bar", "(Tier roll) - Heat = stacks in downtime")
      ],
        ["1:1", "1:2", "1:3", "1:4", "2:2", "2:3", "2:4", "3:1", "3:2", "3:3", "3:4", "4:1", "4:2", "4:3", "4:4"],
        ["1:1", "1:2", "1:4", "1:5", "2:1", "2:2", "2:3", "2:5", "3:1", "3:3", "3:5"]),
      upgrades: {
        crew: [up("Secret maps, and various keys and passcards"), up("Elite Hustlers"), up("Elite Infiltrators"), up("Multifaceted (+1 key/deadlock)", 3, 0, true)],
        training: training(), // Prowess box is drawn in a slightly lighter outline, but unfilled
        base: baseUps({ Hidden: 1 }),
        items: items(),
        cohorts: [up("Infiltrators cohort", 1, 1)]
      },
      upgradeCosts: COSTS,
      cohortStart: "Infiltrators cohort",
      special: {} },

    /* ---------------------------------------------------------------- UTOPIANS */
    { id: "utopians", name: "Utopians", tagline: "A new age cult dedicated to an unsettling vision of the future",
      repLabel: "Reputation", extraHeader: [], repTurfPre: 0,
      preferred: { label: "Anomalies", writeIns: 0, opsPrefix: null,
        ops: ["Discovery", "Stabilization", "Experimentation"],
        rule: "Get +1d to gather information rolls and free downtime activity for operations that involve any of the above",
        extra: null },
      abilityGroups: [
        { id: "second", label: "Once you have descended to the second circle, you may choose:" },
        { id: "third", label: "Once you have descended to the third circle, you may choose:" },
        { id: "final", label: "Once you have descended to the final circle, you may choose:" }
      ],
      abilities: [
        ["Enlightened", "You get +1d to resistance rolls against paranormal threats and consequences. You get +1d to healing rolls when you have paranormal harm."],
        ["Commune", "You may use teamwork with any crew member, regardless of the distance separating you. By taking 1 Stress, your projected thoughts are heard by every crew member as telepathic communication."],
        ["Best Intentions", "If every PC vows not to kill anyone before a score, take +1d to the engagement roll. The first time each PC takes an action that might kill someone if it’s successful (whether intentional by the PC or not), they take +1d and potency. If you all keep the vow, the crew marks 1 xp."],
        ["Zeal", "Every PC gets +1d and potency when they evangelize about the Utopian Vision."],
        VERSATILE,
        ["True Believers", "Your cohorts will undertake any service, no matter how dangerous or strange. They gain +1d to rolls against enemies of the Utopian Vision.", 1, { group: "second" }],
        ["Altered States", "Each PC gains an additional vice: Ritual Hedonism. When you indulge this vice, you don’t overindulge if you clear excess Stress. In addition, your ecstatic visions of the future mean you can perform one flashback for free.", 1, { group: "second" }],
        ["For the Greater Good", "A human sacrifice removes the Stress cost for any paranormal experiment you perform, and such sacrifices performed in your base do not trigger the Death Radar or generate Heat.", 1, { group: "third" }],
        ["This Is Fine", "If every PC works together (group action), you can summon a denizen of your Utopian Vision into this reality: a Class V Resonance Entity.", 1, { group: "third" }],
        ["Remember the Forgotten", "You can now communicate with the entity who created your Utopian Vision (a “god”?). Tread carefully.", 1, { group: "final" }],
        ["Paradise Manifest", "When you take this advance, your base and the area around transforms into a small fragment of your utopia, manifest in this reality. Take +2d to the engagement roll for any raids. All crew members gain potency when acting in the base and its surrounds, and all downtime actions conducted in the base get +1 result level. This will attract significant attention from Section 6 and other high-Tier factions.", 1, { group: "final" }],
        ["We No Longer Play by Your Rules", "When you take this advance, immediately pick two more advances.", 1, { group: "final" }]
      ],
      xpMax: 10,
      contacts: [["Evangeline", "a spiritual sage"], ["Netherley", "a psychedelic artist"], ["Lockmore Wend", "a celebrity"], ["Friswell", "an aristocrat"], ["Tarn", "a paranormal experimentalist"], ["Om", "a deathlands dropout"]],
      xpTriggers: [
        "You advanced the realization of your Utopian Vision.",
        "You contended with challenges above your current station.",
        "You bolstered your crew’s reputation or developed a new one.",
        "You expressed the goals, drives, or inner conflict of the crew."
      ],
      claims: null, // Utopians have four circles instead, see special.circles. No connector bars are printed between cells.
      upgrades: {
        crew: [up("Utopian rigging (2 free load documents or paranormal)"), up("Elite Muscle"), up("Elite Eggheads"), up("Awakened (+1 key/deadlock)", 3, 0, true)],
        training: training({ Resolve: 1 }),
        base: baseUps(),
        items: items(),
        cohorts: [up("Eggheads cohort", 1, 1)]
      },
      upgradeCosts: COSTS,
      cohortStart: "Eggheads cohort",
      special: {
        // Each circle has a round checkbox by its name (First circle printed filled). Turf cells in the first two circles print no text.
        circles: [
          { id: "first", name: "First circle", marked: true, threshold: null, tally: null,
            truths: { rule: "Choose two truths of the Vision", count: 2, words: ["Free", "Egalitarian", "Abundant", "Beautiful", "Serene", "Radiant", "Natural"] },
            cells: [
              cell("wellness-class", "Wellness Class", "(Tier roll) - Heat = stacks in downtime"),
              turf("turf", ""),
              base(),
              turf("turf-2", ""),
              cell("luxury-retreat", "Luxury Retreat", "+1 scale for your Egghead cohorts")
            ] },
          { id: "second", name: "Second circle", marked: false,
            threshold: "Threshold of Gold: Circle unlocks when the crew has earned 20 stacks total",
            tally: "Stacks", // a small write-in box labelled STACKS
            truths: { rule: "Learn a new truth of the Vision", count: 1, words: ["Shifting", "Sweltering", "Lustful", "Unsettling", "Future", "Past", "Alien"] },
            cells: [
              cell("donations", "Donations", "+2 stacks for paranormal operations"),
              turf("turf-3", ""),
              cell("temple", "Temple", "+1d to Command and Sway on-site"),
              turf("turf-4", ""),
              cell("natural-healer", "Natural Healer", "+1d to healing rolls")
            ] },
          { id: "third", name: "Third circle", marked: false,
            threshold: "Threshold of Blood: Circle unlocks when the crew has also ended at least 10 lives",
            tally: "Lives", // a small write-in box labelled LIVES
            truths: { rule: "Learn a new truth of the Vision", count: 1, words: ["Psychedelic", "Inhuman", "Violent", "Future", "Past", "Tempestuous"] }, // only six words printed
            cells: [
              cell("abandoned-lab", "Abandoned Lab", "+1d to Attune on-site"),
              cell("ancient-altar", "Ancient Altar", "+1d engagement for paranormal approaches"),
              target("reality-shift", "Reality Shift", "Tier 4 target, creates new major anomaly", "single"),
              cell("ancient-tower", "Ancient Tower", "+1d to Consort w/ resonance entities on-site"),
              cell("ancient-gate", "Ancient Gate", "Safe passage out of the Bubble")
            ] },
          { id: "final", name: "Final circle", marked: false,
            threshold: "Threshold of Power: Unlocks when the crew has also reached Tier 3 and created a major anomaly.",
            tally: null,
            truths: { rule: "Learn a new truth of the Vision", count: 1, words: ["Fiery", "Frozen", "Terrifying", "Cruel", "Monstrous", "Capricious", "Inhuman"] },
            cells: [
              sp("ancient-tomes", "Ancient Tomes", "+2d engagement for Reality Tear score"),
              sp("notable-skeptic", "Notable Skeptic", "Successful Reality Tear score includes +4 Rep"),
              target("reality-tear", "Reality Tear", "Tier 5 target, creates new mega anomaly", "single"),
              sp("interested-party", "Interested Party", "Reality Tear score includes +6 bonus stacks"),
              cell("figurehead", "Figurehead", "NPC can take the fall to remove 3 Wanted Levels")
            ] }
        ]
      } }
  ];

  var byId = {};
  CREWS.forEach(function (c) { byId[c.id] = c; });

  root.B68Crews = { CREWS: CREWS, byId: byId, COMMON: COMMON };
})(typeof window !== "undefined" ? window : globalThis);
