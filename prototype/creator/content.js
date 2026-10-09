/* Blades '68 character creation content, transcribed from the rulebook's Characters chapter (pp. 10–85).
   Sets window.B68Content. Rule text is the printed rule line of each ability; the commentary is left to the book. */
(function (root) {
  var ACTIONS = [
    ["Insight", ["Hunt", "Study", "Survey", "Tinker"]],
    ["Prowess", ["Finesse", "Prowl", "Skirmish", "Wreck"]],
    ["Resolve", ["Attune", "Command", "Consort", "Sway"]]
  ];

  var HERITAGES = [
    { name: "Akoros", blurb: "Formerly the heart of the Imperium; now the Imperium consists of little else. A conglomeration of cultures grown together for centuries, with many immigrant communities.", examples: "Government civil servants · Union-strong factory workers in Coalridge · Farmers in Barrowcleft · Clergy within the Church of Ecstasy · Academics at Charterhall University · A proud line of Rail Jacks, fallen on hard times · Office workers, the model Age of Consensus family" },
    { name: "The Dagger Isles", blurb: "A tropical archipelago of small nation-states known as banyans, where the Imperium and the USC fight their proxy wars.", examples: "Bonewalkers · Lhan Lhaban merchants · Biringan revolutionaries · Refugees · Melamatine shadow puppeteers · Fishing trawler crew · Members of an island commune · Couriers" },
    { name: "Iruvia", blurb: "A major world power in the desert to the south, the first to secede from the Imperium, now isolationist.", examples: "City Guardians · Political exiles · Diplomats · Business magnates · Couriers · Water Bearers · Performers · Restaurant owners · Teachers" },
    { name: "Severos", blurb: "Windswept plains, an “independent protectorate” with Akorosi tendrils deeply embedded, and a movement for radical egalitarianism in the south.", examples: "Bastion Elders · Irondale factory workers · Railworkers · Butchers · Tailors · Taxi drivers · Dry cleaners · Severosi government bureaucrats · Refugees" },
    { name: "Tycheros", blurb: "Connected by a Void Gate. Tycherosi are rudely called “Visitors.” If you choose this heritage, also create an alien telltale that marks your character.", examples: "Scientists · Confessors · Paranormal scholars · Steelhands · Diplomats · Political exiles · Bookstore owners · Translators" },
    { name: "The United Skov Covenant", blurb: "Skovlan, independent since Unity War III and quickly a world power. Doskvol’s Skovs struggle with oppression, distrust, and conflicting loyalties.", examples: "Midwives · Whispers · Blackvale Coven · Revolutionaries · Exiled Imperial collaborators · Dockhands · Shipbreakers · Miners · Laundry workers · Musicians" }
  ];

  var BACKGROUNDS = [
    { name: "Learned", examples: "A professor or student, journalist, priest, librarian, experimental psychologist." },
    { name: "Underworld", examples: "A street kid, gang member, hustler, pickpocket, cultist, dealer, fence." },
    { name: "Performer", examples: "An artist, poet, lounge singer, racer, painter, guitarist, filmmaker, dancer, model, stage magician, playwright." },
    { name: "Trade", examples: "A sparktech, plumber, autopod mechanic, record shop owner, tattooist, salesperson, street vendor, projectionist." },
    { name: "Professional", examples: "A lawyer, office clerk, accountant, architect, terminal programmer, advertising executive, claims adjuster, civil servant, PR agent." },
    { name: "Aristocrat", examples: "Old money, nobility, dilettante, scion of a fallen house, new money with aspirations, socialite." },
    { name: "Military", examples: "A soldier, officer, mercenary, intelligence operative, strategist, radar operator, medic, R&D scientist, engineer." },
    { name: "Labor", examples: "A factory worker, janitor, dock worker, cab driver, bellhop, waiter, short order cook, farmhand, garbage collector." }
  ];

  var VICES = [
    { name: "Faith", blurb: "Dedication to the church, a new age cult, etc.", purveyors: ["Ankhuset, the Kethrys Lodge, Silkshore", "Supreme Director of Guidance, the New Dawn Center, Six Towers", "Preceptor Aldo, the Sanctorium grand cathedral, Brightstone", "Prichard, Librarian at Morlan Hall’s Restricted Collection, Charterhall"] },
    { name: "Gambling", blurb: "Games of chance, sports betting, casinos.", purveyors: ["Bug’s five-card braggart game, the Docks", "Remira, wrestling, Charhollow", "Karter, the Sky High casino, above Doskvol", "Marek, the Iruvian Sands casino, Silkshore", "Vesper, bookmaker at the Vreen Autodrome, Nightmarket", "Sybil Bexley, Paddles private members’ club, Whitecrown"] },
    { name: "Luxury", blurb: "Expensive or ostentatious displays of opulence.", purveyors: ["Songbird, Sapphire Lounge, Silkshore", "Diamond, Diamond Palace, Nightmarket", "Dunridge & Sons old-fashioned tailoring, Nightmarket", "Jeduin’s fashionable clothing boutique, Nightmarket", "Sybil Bexley, Paddles private members’ club, Whitecrown", "Chef Kalani, Dagger Room restaurant, Brightstone", "Chef Lisanne, Golden Plum restaurant, Six Towers"] },
    { name: "Obligation", blurb: "Devotion to a family, cause, organization, charity.", purveyors: ["Family members (heritage) or former co-workers (background)", "Carro “Cake” Danfield, Iron Weightlifting gym, Crowfoot", "Ms. Asta, Blackthorn Park controller, the Docks", "Prichard, Palace handler, Charterhall", "Director of Success, the New Dawn Center, Six Towers", "Helda, Skovlander community leader, New Horizon"] },
    { name: "Pleasure", blurb: "Gratification from lovers, food, drink, drugs, art, music.", purveyors: ["Songbird, Sapphire Lounge, Silkshore", "Diamond, Diamond Palace, Nightmarket", "Chef Kalani, Dagger Room restaurant, Brightstone", "Benson, the Black Goat tavern, the Docks", "Rennie, the Eyrie underground lounge bar, Crowfoot", "Lemmy’s smoking room and kaff house, Charhollow", "Amara, the Key Club, Silkshore", "Alfie’s Adult Plasmocinema, Crowfoot", "The Silver Echoes, Groove Factory, Crowfoot"] },
    { name: "Gettin’ Fucked Up", blurb: "Oblivion in drugs, drinking to excess, the fighting pits.", purveyors: ["Benson, the Black Goat tavern, the Docks", "Rennie, the Eyrie underground lounge bar, Crowfoot", "Harald Tipton, the House of Tomorrow black lotus den, New Horizon", "Lemmy’s smoking room and kaff house, Charhollow", "Rasp, powder dealer, New Horizon", "Lorna, Xantara Pharm Pill Dispensary, Nightmarket"] },
    { name: "Weird", blurb: "Fringe science, strange entities, bizarre rituals or taboos.", purveyors: ["Milos, president of the Plasmovision Social Club, Charhollow", "Brainwave-60, a sparkmind construct and expert redcheck player, Charterhall", "Blargo the Goblin, Tycherosi airship pilot, Nightmarket", "Maymuun, wayfarer and deathlands guide, Gaddoc Monorail Station", "Mysticus, a cursed animatronic sideshow attraction, Silkshore", "Wilka Eadon, the God Experience art installation, Silkshore", "Captain Laudius Blanchet, Void Sea Aquarium, the Docks"] }
  ];

  var STANDARD_ITEMS = [
    ["A Blade or Two", 1], ["Silenced Shooter", 1], ["Handcannon", 1], ["Electro-Blade", 2], ["Pump-Action Scattergun", 2], ["Armor", 3],
    ["Burglary Gear", 1], ["Climbing Gear", 2], ["Paranormal Implements", 1], ["Documents", 1], ["Subterfuge Supplies", 1], ["Demolition Tools", 2], ["Tinkering Tools", 1], ["Arclighter", 1]
  ];

  var NAMES = {
    first: "Afton Alcott Archie Arnest Azad Bashir Benson Buck Bud Cannon Cecil Ciro Colman Con Darrick Darry Davit Digby Gene Grigor Hakob Hutton Karter Ken Kenton Kleon Konrad Largo Len Manuk Merl Morris Patrik Penn Rashan Shaw Silas Tevran Wayland Winstone Zoltan Aida Althea Alva Amara Anara Aniya Belkis Brielle Cyra Demelza Eartha Edda Elesha Eva Farra Hadwig Hattie Hellebore Hollie Ishara Jara Jaya Josslin Klara Kyra Lorna Luella Maida Midge Nasreen Peggy Sa’ana Sakina Suranna Tova Trudie Twiggy Una Zuleika Ackley Ari Brax Burgess Cade Corliss Crab Dell Edwin Fandy Frank Gage Goose Hoagie Hollace Ives Jag Jett Kace Kaede Kamryn Kavi Kay Kyran Lane Mack Makepeace Myka Niko Pick Rumi Sahir Sezar Slade Sylas Tye Veda Zig".split(" "),
    family: "Adair Annan Ariss Arundel Avrathi Baine Barston Beldon Blodgett Blossom Booker Bowman Bray Breakiron Bromston Burne Cairn Carver Caul Coleburn Cooper Croker Daralis Darrow Dorston Drexler Eadon Fanchon Fane Fearnought Fillburn Fisher Gaunt Haig Harland Jeduin Kael Kalbert Killick Kipp Klevanu Kobb Krabston Krumb Litton Lomond Malvern Mandrake Marburn Mead Morriston Morsey Morven Newcombe Nox Noyle Om Orman Perriston Preston Prichard Rannoch Ransom Reedy Sang Scapa Slyde Stanmont Starr Stett Stromberg Tep Torrin Utley Varden Vass Vong Zau Zorin".split(" "),
    alias: "Ace Anvil Ashtray Axe B-Train Bankshot Beans Beast Bell Bird Bolt Brick Broom Bull Buzz Cage Cannon Captain Chips Cipher Clockwise Coal Colonel Crooner Cyclone Dagger Daisy Dart Domino Dove Ember Falcon Filch Fox Frost Goldy Hammer Hardware Hatchet Hawk Haywire Heel Highbinder Hooch Howler Jackal Knockout Lucky Lullaby Midnight Moth Mule Nail Needle Nemesis Peaches Peepers Pest Rasp Razor Recursion Riot River Sage Salt Savvy Scarlet Serpent Shimmer Shiv Silhouette Sky Slim Smoke Snow Song Sparrow Specter Spinner Stud Surge Tempest Trace Turbo Velocity Vermin Vex Viper Vortex Wheels".split(" ").concat(["Dead Drop", "Dimmer 51"]),
    hull: ["Echo-5", "Unit 9-K", "Dot", "Labor Frame 6", "Hull No. 517", "Series 4-A “Courier”", "Voidwork Loader C", "Object 12", "THOUGHTFORM-3", "Project: DAISY"]
  };

  var LOOK = {
    build: "Athletic Plump Chiseled Bony Delicate Big Slim Sturdy Stout Wiry Barrel-chested Lean Gaunt".split(" "),
    manner: "Affable Calm Bright Brooding Cold Fierce Hunched Languid Graceful Twitchy Radiant Dapper Flamboyant Mellow".split(" "),
    features: "Grimy Fair Handsome Delicate Lovely Rough Scarred Soft Stern Striking Weathered Pockmarked".split(" "),
    hair: ["Beehive", "Braided", "Crimped", "Long and straight", "Pixie cut", "Buzz cut", "Pageboy", "Shag cut", "Afro", "Feathered", "Unkempt", "Pompadour", "Slicked back", "Neat beard", "Big beard", "Moustache", "Wavy", "Tidy", "Just amazing"],
    hullLook: "Sleek, chrome, racing stripe, polished, chipped paint, pastel paint, geometric, utilitarian, elegant, boxy, bulky, heavy, delicate, high-tech, clunky, wood paneling, friendly, inhuman, bulbous, hard-edged, intimidating, exposed wires, curly cord, antennae, painted unit designation number, blinking light, graffiti, rust".split(", "),
    wearing: [
      ["Utilitarian", ["Jumpsuit", "Fingerless gloves", "Heavy coat", "Knit cap", "Overalls"]],
      ["Professional", ["Tailored suit", "Pencil skirt", "Fedora", "Suspenders", "Pocket square"]],
      ["Square", ["Pocket protector", "Big black shoes", "Awkward suit", "Bowtie", "Plaid pants"]],
      ["Ex-military", ["Military jacket", "Combat boots", "Parka jacket", "Bomber jacket"]],
      ["Mod", ["Miniskirt", "Nehru suit", "Beret", "A-line dress", "Turtleneck", "Slim-fit suit", "Ankle boots", "Big sunglasses"]],
      ["Suave", ["Tuxedo", "Evening dress", "Catsuit (fashion)", "Fur coat"]],
      ["Unusual", ["Hooded cloak", "Veil", "Mask", "Leathers"]],
      ["Peacock", ["Flared pants", "Neckerchief", "Ruffled shirt", "Velvet suit", "Paisley shirt", "Feather boa", "Long swishy dress", "Fez"]],
      ["Street", ["Denim jeans", "White T-shirt", "Leather jacket", "Denim jacket", "Cheap suit", "Bowling shirt", "Flatcap"]],
      ["Collegiate", ["Sweater-vest", "Dress boots", "Capri pants", "Sports coat", "Cardigan", "Loafers", "Tweed suit"]],
      ["Space age", ["Goggles", "Go-go boots", "Helmet", "Angular dress", "Foil jumpsuit", "Foil puffer jacket"]],
      ["Covert", ["Catsuit (stealth)", "Black turtleneck", "Dark suit", "Trench coat", "Gloves"]],
      ["Alternative", ["Poncho", "Medallion", "Frayed jeans", "Headband", "Trouser suit", "Thick glasses", "Goatskin vest", "Robes", "Linen tunic"]]
    ]
  };

  var RESIST = function (res, what, push) { return "Twice per score, you may use your " + res + " to resist a consequence of " + what + ", or to push yourself " + push + "."; };
  var PUSH = function (a, b) { return "When you push yourself, you can also do one of the following: " + a + "—" + b + "."; };

  var PLAYBOOKS = [
    { id: "hound", name: "Hound", ordinal: "ONE", prefix: "HND", scheme: "hound", halo: "slate-500", duo: ["#d9736e", "#6e8a8c"],
      descriptor: "A hard-bitten fixer who follows their instincts",
      blurb: "Hounds find what others want to keep hidden, and find a fix for a bad situation. They know how to take a punch and they’re good at asking questions until they get the right answers.",
      xp: "address a challenge with talking or determination", resource: "tenacity", dots: 7, printed: { Survey: 1, Consort: 2 },
      cohort: { label: "Loyal, clever pet", text: "You start with a playbook cohort, a loyal and clever pet (Expert: Hunter). Give them a name, edges, and flaws.", types: ["hound dog", "mastiff", "lap dog", "rat dog", "cat", "crow", "falcon", "owl", "snake", "ferret", "eel", "monkey", "fox", "goat", "pigeon", "pig", "rooster", "rabbit", "large beetle", "large moth"] },
      friendsRule: "Choose two close friends (instead of one as usual), and one rival.", friendsNeeded: 2,
      keys: ["Sardonic (▼ Grim ▲ Witty)", "Cynical (▼ Optimistic ▲ Nihilist)", "Romantic (▼ Cynical ▲ Lovestruck)", "Bitter (▼ Affable ▲ Vindictive)", "Lonely (▼ Social ▲ Loner)", "Determined (▼ Laid-Back ▲ Obsessed)", "Suspicious (▼ Trusting ▲ Paranoid)", "Tired (▼ Rejuvenated ▲ Defeated)", "Sharp (▼ Dulled ▲ Searing)", "Cool (▼ Jittery ▲ Cold)", "Stubborn (▼ Flexible ▲ Pigheaded)", "Confident (▼ Insecure ▲ Arrogant)", "Blunt (▼ Diplomatic ▲ Caustic)", "Brooding (▼ Untroubled ▲ Morose)", "Laid-Back (▼ Tense ▲ Indifferent)"],
      contacts: [["Vanden", "a lazy Bluecoat"], ["Mira", "a nightclub owner"], ["Hendrik", "a veterinarian"], ["Chatterley", "a secret agent"], ["Zam", "a street kid"]],
      items: [["Fine snub-nosed handcannon", 1], ["A loyal, clever pet", 0], ["Binoculars", 1], ["Hipflask of the good stuff", 0], ["Pocketful of focus pills", 0], ["RF radio handset", 0]],
      abilities: [
        ["Hound’s Instincts", PUSH("figure out where to go next, even with zero leads", "make someone stop and listen to you for a few moments, no matter how unlikely it is")],
        ["Learn the Hard Way", "Whenever you take harm, clear an amount of Stress equal to the harm level, and it counts as a successful gather information roll (with a level of detail equal to the harm level). The GM will tell you what you learn."],
        ["Just a Scratch", "Harm doesn’t slow you down during a score, and never factors into effect (level 4 harm is still fatal). You gain potency when you Consort with someone who has caused you to mark harm."],
        ["Fixer", "During downtime, you get +1 result level when you Acquire Asset or Reduce Heat. When incarcerated, take +1d to all real time prison rolls, or +2d to a prison time skip roll."],
        ["In Too Deep", "Once per score, you can Consort with an NPC to form an intimate bond. If you have such a bond with someone involved in a score, you get +1d and potency to any actions dealing with them."],
        ["Echo Pet", "Your pet is imbued with anomalous resonance. It gains potency when tracking or fighting the paranormal, and gains a paranormal ability: time-glitching, mind-link, or mirror-field."],
        ["Dogged Persistence", RESIST("tenacity", "exhaustion or mental harm (fear, confusion, losing track of someone)", "for influencing someone or searching for clues")]
      ],
      questions: ["Which of you is an old friend?", "Which of you carried me home, unconscious?", "Which of you once came to me as a client, with a case?", "Which of you does my pet like more than it likes me?", "Which of you shares my taste in music?", "Which of you poured out your sorrows to me at the bar last week?"] },

    { id: "hull", name: "Hull", ordinal: "TWO", prefix: "HUL", scheme: "crews", halo: "file-700", duo: ["#36536c", "#1e2633"],
      descriptor: "The soul of a condemned criminal trapped in a robot body",
      blurb: "You are the product of the “Lusk Reform Technique”: a criminal’s resonance echo powering a hull to work off their debt to society. But you are defective, recidivist. You’re starting to remember.",
      xp: "obey orders, or address a challenge with cold simplicity", resource: "Drain (10 boxes, instead of Stress)", dots: 6, printed: { Skirmish: 1, Attune: 1 },
      hull: true, roboticDeadlocks: ["Brutal", "Detached", "Ruthless", "Unstable"],
      memories: ["What was my name and heritage?", "What did I leave unfinished?", "What was my background? Who or what did I love most in life?", "What crime was I sentenced to be Reformed for?"],
      owning: ["Bluecoats: street patrols, traffic monitoring", "City Council: street cleaning, garbage detail, roadworks, sewer detail", "Ministry of Stability: nutriwafer delivery, crowd control, rail security, Gaddoc Station duties", "Corporation: cleaning windows, moving cargo, data entry, office security", "Criminal gang: smash and grabs, stealing autopods, intimidating rivals"],
      frame: [["Advanced Visual Sensors", "Night vision, heat vision, ultra-zoom, and resonance vision."], ["Lifelike Appearance", "Super-realistic latex; you pass for a living being unless closely scrutinized."], ["Hidden Compartment", "A lead-lined secret compartment that escapes even the most thorough search."], ["Smokescreen Emitter", "Exude a dark, acrid cloud of smoke, enough to fill a large room."], ["Surveillance Hardware", "Long-range microphone, tape-feed, and a secure resonance field radio."], ["Jet Propulsion", "Jet boosters that provide a limited form of flight (slow or temporary)."]],
      friendsRule: "You do not start with friends or rivals. You have one contact: your controller from your owning faction.", friendsNeeded: 0,
      keys: [],
      contacts: [["Your controller", "someone from your owning faction who manages your work while On Program"]],
      items: [["Built-in frame armor", 0], ["RF radio handset", 0]],
      abilities: [
        ["A Room of Your Own", "You have your own secret little den. You can now put stacks into bank. You have a pet; spend a downtime action to look after it and mark 3 xp in a memory clock of your choice."],
        ["Powerhouse", "Take 1 Drain to perform a feat of extreme strength or speed (run faster than an autopod, rend metal with your hands). This factors into effect."],
        ["Retractable Arsenal", "Your items are built into your frame and may recess beneath panels out of sight. Your frame can now carry +2 load."],
        ["Energy Beam", "Release some of your energy as an electric shock around you or as a directed beam, or a lightning barrier to repel or trap a resonance entity. Take 1 Drain for each level of magnitude."],
        ["Interface", "You may Attune to the local electroplasmic power field to control it or something connected to it (including another hull)."],
        ["Frame Upgrade", "Choose two additional frame features. You can take this trait twice."]
      ],
      questions: ["Which of you found me when I was malfunctioning and took me in?", "Which of you finds me useful, but like how a forklift is useful?", "Which of you finds me easy to talk to?", "Which of you has a bad history with my owning faction?", "Which of you still doesn’t trust me?", "Which of you has shown me what’s good in life?"] },

    { id: "intellectual", name: "Intellectual", ordinal: "THREE", prefix: "INT", scheme: "intellectual", halo: "rust-500", duo: ["#90491a", "#341805"],
      descriptor: "A brilliant engineer, scientist, and philosopher",
      blurb: "Cultural critics, academic theorists, scholars, inventors, and polymaths. Doskvol is a city of the future, full of spark-craft technology, automaton hulls, and electronic systems for you to bend to your purposes.",
      xp: "address a challenge with technical skill or cleverness", resource: "research", dots: 7, printed: { Tinker: 2, Study: 1 },
      altBackground: { label: "Fields of study", text: "Instead of a background, decide what fields of study you have experience in. Choose a few.", multi: true, options: ["History", "Biology", "Philosophy", "Spark-Craft", "Paranormal", "Political Science", "School of Hard Knocks"] },
      cohort: { label: "Sparkmind assistant", text: "You start with a sparkmind assistant (Expert, by type). Choose a type and housing.", types: ["Research", "Analysis", "Ingress"], housing: ["Small (wristwatch, orb, tiny hull)", "Large (room-sized, immobile)"] },
      friendsNeeded: 1,
      keys: ["Arrogant (▼ Humbled ▲ Self-Obsessed)", "Sophisticated (▼ Modest ▲ Pretentious)", "Insecure (▼ Confident ▲ Anxious)", "Enigmatic (▼ Open ▲ Reclusive)", "Lonely (▼ Social ▲ Loner)", "Determined (▼ Laid-Back ▲ Obsessed)", "Enthusiastic (▼ Apathetic ▲ Reckless)", "Eccentric (▼ Ordinary ▲ Erratic)", "Idealistic (▼ Cynical ▲ Zealous)", "Cold (▼ Friendly ▲ Brutal)", "Witty (▼ Serious ▲ Goofy)", "Curious (▼ Disinterested ▲ Possessed)", "Shy (▼ Brash ▲ Withdrawn)", "Talkative (▼ Quiet ▲ Long-Winded)", "Rational (▼ Irregular ▲ Uncaring)"],
      contacts: [["Faden", "an innovative doctor"], ["Penny", "a debauched theorist"], ["Jarris", "an escaped test subject"], ["Ackhurst", "a professor (fired)"], ["OLEK", "a rogue sparkmind"]],
      items: [["Fine tinkering tools", 1], ["Experimental laser cannon", 2], ["Sparkmind assistant", 0], ["Gadgets", 1], ["Pocketful of focus pills", 0], ["RF radio handset", 0]],
      abilities: [
        ["Unalloyed Genius", "When you craft an invention, take +1 result level to your roll. Invention clocks start with one segment already filled."],
        ["Mentalist", "You can deduce trivial details about anyone. Study them to reveal their current intentions and a deep desire they’re keeping secret; gain +1d and potency when acting on this information."],
        ["High-Functioning Insomniac", "During downtime, you get two ticks to distribute among any long-term project clocks that involve research, investigation, or crafting."],
        ["Try Not to Break It This Time", "Flashbacks to give another crew member just the right gadget before the score cost 0 Stress. Gain one free downtime action to craft such a gadget in a flashback."],
        ["Researcher", RESIST("research", "fatigue, weakness, or resonance effects", "when working with technical skill or handling resonance objects")],
        ["Anatomist", "You can Tinker the human body to treat wounds or stabilize the dying. You may Study a sickness or corpse. Everyone in your crew gets +1d to their healing treatment rolls."],
        ["Encyclopedic Knowledge", PUSH("instantly find a weak point or exploitable pattern in an obstacle", "dazzle an audience with your intellect, leaving them confused and distracted")],
        ["Advanced Sparkmind", "Choose an additional type, or add an edge, or remove a flaw. This ability can be taken twice."]
      ],
      questions: ["Which of you finds me pretentious?", "Which of you is learning something from me?", "Which of you likes to wind me up?", "Which of you also loves my favorite restaurant?", "Which of you is friends with my sparkmind assistant?", "Which of you shared a deep conversation with me the other night?"] },

    { id: "operative", name: "Operative", ordinal: "FOUR", prefix: "OPR", scheme: "shadows", halo: "file-500", duo: null,
      descriptor: "A stealthy and clandestine professional",
      blurb: "Doskvol is a hotbed of espionage. Operatives are the agents and assassins who do the dirty work; their knowledge of spycraft and expertise in infiltration and deception suit them to many criminal endeavors.",
      xp: "address a challenge with stealth or subterfuge", resource: "precision", dots: 7, printed: { Hunt: 1, Prowl: 2 },
      backing: ["The Palace (Tier 5), the Imperial Intelligence Agency", "Section 6 (Tier 5), enforcing Reality Constancy Law", "The Strelai (Tier 4), counter-paranormal secret agents", "Blackthorn Park (Tier 3), the USC’s foreign intelligence service", "Anixis Field Unit (Tier 2), Iruvian intelligence", "The Burn Corps (Tier 2), the militant arm of Burning Orange"],
      friendsNeeded: 1,
      keys: ["Disciplined (▼ Loose ▲ Uptight)", "Enigmatic (▼ Open ▲ Reclusive)", "Haunted (▼ Self-Assured ▲ Tormented)", "Sharp (▼ Dulled ▲ Searing)", "Fearless (▼ Nervous ▲ Turbulent)", "Cold (▼ Friendly ▲ Brutal)", "Confident (▼ Insecure ▲ Arrogant)", "Blunt (▼ Diplomatic ▲ Caustic)", "Bitter (▼ Affable ▲ Vindictive)", "Meticulous (▼ Sloppy ▲ Obsessive)", "Calculating (▼ Apathetic ▲ Paranoid)", "Professional (▼ Casual ▲ Heartless)", "Dedicated (▼ Cynical ▲ Obsessed)", "Brooding (▼ Untroubled ▲ Morose)", "Witty (▼ Serious ▲ Goofy)"],
      contacts: [["Harani Ankhayat", "a diplomat"], ["Tailor", "a handler"], ["Karla", "a field agent"], ["Percy", "a cat burglar"], ["Bowman", "an undersecretary"]],
      items: [["Truth serum syringe", 0], ["Fine sniper rifle", 2], ["Tiny tracking device", 0], ["Fine silenced shooter", 1], ["Fine disguise", 1], ["RF radio handset", 0]],
      abilities: [
        ["Clean", RESIST("precision", "detection or security measures", "for a feat of athletics or stealth")],
        ["Double Agent", "You gain a second backing faction of your choice immediately. You get +2d when working on long-term projects to influence either of your backing factions."],
        ["Dead Drop", "A bound resonance entity will leave up to 2 load of items anywhere you need them. The flashback to requesting them is free. You can also flashback to an Acquire Asset roll for the items as a free downtime activity."],
        ["Echo Walker", "Pay 2 Stress to step into the resonance field and disappear. Reappear at a moment of your choice, wherever you want (you have to be able to move there physically). When you reappear, you are so cold (level 1 harm, can be resisted)."],
        ["Wetwork", PUSH("make an improbable shot at extreme distance or with extreme speed", "perform a feat of athletics that verges on the superhuman")],
        ["Cipher", "You have a deep cover identity. Using it, +1d to rolls to confuse or deflect suspicion. Revealing your true identity gives you the initiative, +1d and potency. If blown, create a new one with a 4-segment long-term project."],
        ["Sleeper Agents", "Once per score, pay 2 Stress and nominate a minor NPC. They’ve been working for you this whole time."],
        ["Control", "Choose one action rating. When you lead a group action with it, you suffer only 1 Stress at most regardless of failed rolls, and may count multiple 6s from different rolls as a critical."]
      ],
      questions: ["Which of you doesn’t trust me?", "Which of you has my affiliated faction asked me to monitor?", "Which of you will always have my back?", "Which of you has had secret contact with a faction that rivals mine?", "Which of you tested the truth serum together with me, that one night?", "Which of you asked me to train you?"] },

    { id: "paranormalist", name: "Paranormalist", ordinal: "FIVE", prefix: "PNL", scheme: "paranormal", halo: "file-300", duo: ["#cce0f6", "#3c4b90"],
      descriptor: "A maverick thinker and visionary",
      blurb: "Other scientists are afraid to leave the safe waters of conventional science; the Paranormalist dives into that Void Sea with curiosity and passion. Untold power lies within reach for those with the right tools and an open mind.",
      xp: "address a challenge with knowledge or paranormal power", resource: "sixth sense", dots: 7, printed: { Study: 1, Attune: 2 },
      cohort: { label: "Loyal resonance entity", text: "You start with a loyal resonance entity (Expert: Paranormal Assistant). Give them a name, edges, and flaws.", types: ["Former lover", "Old enemy", "Fallen mentor", "Parent or ancestor", "Accidental victim", "Antiquated stranger", "Polite butler", "Whispering wraith", "Just a rude dude", "Slime entity", "Mirror shards", "Cloud of dark smoke", "Insect swarm", "Floating orb", "Hypnotic lights", "Weird goblin"] },
      friendsNeeded: 1,
      keys: ["Flamboyant (▼ Demure ▲ Self-Obsessed)", "Enigmatic (▼ Open ▲ Reclusive)", "Haunted (▼ Self-Assured ▲ Tormented)", "Bold (▼ Nervous ▲ Reckless)", "Charismatic (▼ Quiet ▲ Manipulative)", "Comical (▼ Serious ▲ Unhinged)", "Curious (▼ Disinterested ▲ Possessed)", "Distant (▼ Warm ▲ Cold)", "Eccentric (▼ Ordinary ▲ Erratic)", "Passionate (▼ Apathetic ▲ Furious)", "Fearless (▼ Nervous ▲ Turbulent)", "Idealistic (▼ Cynical ▲ Zealous)", "Shy (▼ Brash ▲ Withdrawn)", "Open-Minded (▼ Rigid ▲ Reckless)", "Spiritual (▼ Cynical ▲ Obsessed)"],
      contacts: [["Goodridge", "an archivist"], ["Scurlock", "a recluse"], ["Padeen", "a Strelai operative"], ["Warley", "a mind traveler"], ["Chime", "an old whisper"]],
      items: [["Fine resonance gauge", 1], ["Resonance accelerator pack", 2], ["Fine echo containment unit", 1], ["Psychic amplification device", 0], ["Loyal resonance entity", 0], ["RF radio handset", 0]],
      abilities: [
        ["Third Eye Opened", "You’re always aware of resonance entities in your vicinity. You can Attune to the resonance field to force a nearby entity to appear and obey a command you give it."],
        ["Precognition", "Two times per score, you can assist a teammate without paying Stress. Tell us how you prepared for this in advance."],
        ["Psychokinesis", PUSH("levitate for a short time", "violently push or pull objects through the air")],
        ["Extrasensory Perception", RESIST("sixth sense", "a paranormal consequence", "when you deal with paranormal forces")],
        ["Forbidden Science", "You can use a downtime action to perform a paranormal experiment to manifest a supernatural effect or being. Gain one free downtime action to perform such experiments."],
        ["Echo Projection", "Pay 2 Stress to become a radiant being of crackling energy: you count as wearing armor, your physical attacks gain potency, and you can push yourself to shoot arcs of lightning. When you drop it, take level 2 harm Drained and the GM ticks a clock."],
        ["Medium", "You can communicate with all paranormal entities, even those not present in the physical realm. Take +1d and potency when you do."],
        ["Parapsychology", "You’re immune to the terror that paranormal entities inflict on sight. Take +1d to resistance rolls with Resolve. Take +1d when you gather info about the paranormal."]
      ],
      questions: ["Which of you helped me with a paranormal experiment?", "Which of you is skeptical of the paranormal?", "Which of you led me to an interesting insight?", "Which of you have I seen in a terrible vision of the future?", "Which of you asked me to read your fortune?", "Which of you tripped on mushrooms with me?"] },

    { id: "radical", name: "Radical", ordinal: "SIX", prefix: "RAD", scheme: "militants", halo: "alarm-500", duo: null,
      descriptor: "An agitator, incendiary in every sense",
      blurb: "Radicals are dedicated to overthrowing existing power structures, and the underworld is the perfect place to do it from. Spread the truth, and fight the man by any means necessary.",
      xp: "address a challenge with persuasion or mayhem", resource: "conviction", dots: 7, printed: { Wreck: 1, Command: 1, Sway: 1 },
      explosives: ["Grenade", "Placed explosive", "Stun grenade", "Smoke bomb", "Psychedelic mist", "Gravity anomaly bomb", "Resonance nullifier", "Resonance amplifier", "Anti-sparktech pulse grenade", "Fire bomb", "Proximity mine", "Euphoric mist", "Coolant gel grenade"],
      altBackground: { label: "Radicalized by", text: "Instead of a background, decide what radicalized you. Make your grievance specific.", multi: false, options: ["Bluecoats", "Labor conditions", "Bigotry", "Inequality", "Horrors of war", "Discrimination"] },
      friendsNeeded: 1,
      keys: ["Idealistic (▼ Skeptical ▲ Zealous)", "Determined (▼ Laid-Back ▲ Obsessed)", "Protective (▼ Careless ▲ Vengeful)", "Romantic (▼ Cynical ▲ In Love)", "Suspicious (▼ Trusting ▲ Paranoid)", "Violent (▼ Merciful ▲ Vicious)", "Stubborn (▼ Flexible ▲ Pigheaded)", "Reckless (▼ Careful ▲ Chaotic)", "Kind (▼ Harsh ▲ Selfless)", "Cool (▼ Jittery ▲ Cold)", "Commanding (▼ Deferential ▲ Controlling)", "Passionate (▼ Apathetic ▲ Furious)", "Defiant (▼ Compliant ▲ Wild)", "Charismatic (▼ Cold ▲ Manipulative)", "Fearless (▼ Nervous ▲ Turbulent)"],
      contacts: [["Vuko", "a union rep"], ["Delyan", "a fireworks technician"], ["Russo", "a maverick artist"], ["Plundell", "a surgeon (and terrible poet)"], ["Stoker", "a fearless journalist"]],
      items: [["Provocative manifesto", 0], ["Nondescript change of clothes", 1], ["Bandolier (3 uses)", 1], ["Second bandolier (3 uses)", 1], ["Pocketful of go-go pills", 0], ["RF radio handset", 0]],
      abilities: [
        ["True Believer", RESIST("conviction", "law-breaking (being arrested or hassled by Bluecoats)", "when fighting for your ideology")],
        ["Direct Action", "When you make a desperate roll with either Wreck or Command, you gain both potency and scale."],
        ["Echo Chamber", "Whenever you loudly recite poetry, a crowd gathers to listen (if possible). When you use poetry as a means to an end, take +1d and gain potency dealing with the paranormal."],
        ["Fellow Travelers", "In any scene with more than one NPC, ask the GM which of them are sympathetic to your cause. It’s always at least one."],
        ["Polemicist", PUSH("whip a crowd into a righteous fury", "shame a powerful figure into silence or retreat")],
        ["Praxis", "If you loudly and visibly destroy a symbolic target during a score, gain +2 result levels to any long-term project rolls related to your revolutionary work during the following personal business phase."],
        ["Pamphleteer", "Publish revolutionary literature as a 4-segment long-term project. Once complete, a work can tick another revolution clock once per downtime (max four works in circulation). If you die or are imprisoned, each work adds two ticks."],
        ["Total Dedication", "When you roll a desperate action, you get +1d to your roll if you also take −1d to any resistance rolls against consequences from your action."]
      ],
      questions: ["Which of you is dismissive of my convictions?", "Which of you fears what I’ll do one day?", "Which of you enjoys debating my ideas?", "Which of you quietly shares my convictions?", "Which of you helps me restock my explosives?", "Which of you asked for my feedback on a poem you wrote?"] },

    { id: "swinger", name: "Swinger", ordinal: "SEVEN", prefix: "SWG", scheme: "swinger", halo: "swing-500", duo: ["#e8c33c", "#cb6a85"],
      descriptor: "A wheeler and dealer, the life of the party",
      blurb: "The underworld is a web of factions, politics, and secrets. Navigating it takes charisma, audacity, and panache. Move fast, think on your feet, dazzle your enemies and make it look easy.",
      xp: "address a challenge with charm or quick thinking", resource: "mojo", dots: 7, printed: { Sway: 2, Finesse: 1 },
      cohort: { label: "Fine two-seat autopod", text: "You start with your own two-seat autopod (Expert, by type). Give it a name, edges, and flaws.", types: ["Racing", "Impressing", "Surprising"] },
      friendsNeeded: 1,
      keys: ["Charismatic (▼ Quiet ▲ Manipulative)", "Flamboyant (▼ Demure ▲ Egomaniacal)", "Confident (▼ Insecure ▲ Arrogant)", "Witty (▼ Gloomy ▲ Goofy)", "Reckless (▼ Careful ▲ Sloppy)", "Kind (▼ Harsh ▲ Selfless)", "Soft (▼ Hard ▲ Passive)", "Sharp (▼ Dulled ▲ Searing)", "Talkative (▼ Quiet ▲ Long-Winded)", "Laid-Back (▼ Tense ▲ Indifferent)", "Enthusiastic (▼ Apathetic ▲ Chaotic)", "Eccentric (▼ Ordinary ▲ Erratic)", "Arrogant (▼ Humbled ▲ Self-Obsessed)", "Playful (▼ Serious ▲ Unhinged)", "Loyal (▼ Selfish ▲ Self-Sacrificing)"],
      contacts: [["Revel", "a drug dealer"], ["Three-Fingers", "a lounge singer"], ["Noleburn", "a politician"], ["Una Bell", "a socialite"], ["Honest Stev", "an autopod mechanic"]],
      items: [["Fine clothes & jewelry", 0], ["Fine two-seat autopod", 0], ["An invitation to the party", 0], ["Fine concealed shooter", 1], ["Pocketful of sleeping pills", 0], ["RF radio handset", 0]],
      abilities: [
        ["Here Goes Nothing", "Take 2 Stress to roll your Sway or Consort rating while performing a different action. Use a free flashback to reveal who you convinced to teach you this particular technique or approach."],
        ["Yeah, Baby", "When you agree to an NPC’s proposal, even though it complicates the crew’s goals, everyone else on the crew marks 1 xp while you clear 3 Stress."],
        ["Groove Machine", "You always know where the nearest music is playing and when you start dancing, others feel compelled to join. When you take action while moving it on the dance floor, take +1d and potency."],
        ["Improviser", PUSH("claim to be anyone and others will consider the possibility, no matter how outlandish", "plunge blindly in an unexpected direction and find a new path")],
        ["Always Hustling", "Every personal business phase, mark +1 bank, and you may give yourself or another crew member +1 downtime action. What’s your side hustle?"],
        ["Party Animal", "When you Indulge Vice, you can invite an ally to join you. They lose the same Stress that you do without spending a downtime action, and can assist you once for free during the next score."],
        ["Echo Twin", "There’s an alternate version of you in the resonance field, ghostly and glitched out. Take 2 Stress to summon them for a few moments, plus 1 Stress per extra feature: a whole scene, completely solid, obeys you to the letter."],
        ["Smooth", RESIST("mojo", "suspicion or social faux pas", "when talking your way out of a tight spot or driving under pressure")]
      ],
      questions: ["Which of you went to that big party with me the other night?", "Which of you saved my life when I did something stupid?", "Which of you thinks I’m not a serious person?", "Which of you is my competition on the dance floor?", "Which of you comes to me for fashion advice?", "Which of you trusts me as a true professional?"] },

    { id: "veteran", name: "Veteran", ordinal: "EIGHT", prefix: "VET", scheme: "veteran", halo: "caution-700", duo: ["#837872", "#48342a"],
      descriptor: "A battered soldier returned from the front",
      blurb: "Whether you volunteered or got drafted, you did your time on the front lines. You learned discipline, and you learned how to do violence. Now you’re back on the streets with deep scars and lethal abilities.",
      xp: "address a challenge with violence or discipline", resource: "training", dots: 8, printed: { Hunt: 2, Skirmish: 1, Command: 1 },
      veteran: true,
      altBackground: { label: "Tours of duty", text: "Instead of a background, decide what tours of duty you completed.", multi: true, options: ["The Irondale Action (two years ago)", "The Sevrin Invasion (ten years ago)", "Unity War III (twenty years ago)", "Dagger Isles Peacekeeping (ongoing)"] },
      friendsNeeded: 1,
      keys: ["Protective (▼ Careless ▲ Vengeful)", "Hopeful (▼ Cynical ▲ Content)", "Erratic (▼ Calm ▲ Chaotic)", "Commanding (▼ Deferential ▲ Controlling)", "Lonely (▼ Social ▲ Loner)", "Distant (▼ Warm ▲ Cold)", "Violent (▼ Merciful ▲ Vicious)", "Reckless (▼ Careful ▲ Sloppy)", "Methodical (▼ Loose ▲ Uptight)", "Comical (▼ Serious ▲ Unhinged)", "Suspicious (▼ Trusting ▲ Paranoid)", "Tired (▼ Rejuvenated ▲ Defeated)", "Arrogant (▼ Humbled ▲ Self-Obsessed)", "Bold (▼ Nervous ▲ Reckless)", "Kind (▼ Harsh ▲ Selfless)", "Haunted (▼ Self-Assured ▲ Tormented)"],
      contacts: [["Brackley", "a deserter"], ["Fellows", "an army officer"], ["Tiptree", "a hitwoman"], ["Professor", "a rough sleeper"], ["Grunt", "a back-alley doctor"]],
      items: [["Submachine Coilgun (SMC)", 1], ["Heavy Assault Coilgun (HAC50)", 2], ["Heat blade", 1], ["A few grenades", 1], ["Pocketful of go-go pills", 0], ["RF radio handset", 0]],
      fixedAbility: ["Military Discipline", RESIST("training", "harm from an attack in combat", "during a fight")],
      abilities: [
        ["Got Your Back", "When you protect a teammate, clear 1 Stress and take +1d to any resistance rolls."],
        ["Echo Fighter", "Thanks to special training, you may engage enemies in combat with nothing but your mind. You gain potency in combat vs. the paranormal. You can attempt to read people’s next intentions."],
        ["Leadership", "When you Command a cohort in combat, they continue to fight when they would otherwise break (they’re not taken out when they suffer level 3 harm). They gain increased effect and 1 armor."],
        ["Walking Arsenal", "Your load limit is always 2 higher than normal (5 for a Quiet approach, 8 for Loud). Pull out another 1-load gun at any time, no matter how many you’ve already used. Each additional gun of its type (after the first) is 0-load."],
        ["War Machine", PUSH("sweep and secure a large area single-handedly and without pausing", "engage an improbable number of enemies in a ballet of violence")],
        ["Get Back In There", "You were subject to experimental procedures designed to increase the shelf-life of front-line soldiers. Permanently fill in one of your healing clock segments. Take +1d to healing treatment rolls."],
        ["Creative Community", "You gain a second vice: learning a new creative hobby. When you indulge it by going to class, add +2 to the result, then create a new friend or rival (classmate or teacher) or develop an existing one. When you overindulge, one of these friends is put in danger."]
      ],
      questions: [] }
  ];

  var LOCKED = [
    { id: "ghost", name: "Ghost/Echo", descriptor: "A resonance echo adrift without a body", printed: { Hunt: 1, Prowl: 1, Attune: 1 } },
    { id: "vampire", name: "Vampire", descriptor: "A resonance echo animating an undying body", printed: { Hunt: 1, Prowl: 1, Attune: 1, Sway: 1 } },
    { id: "timetraveler", name: "Time Traveler", descriptor: "A voyager visiting this era on an important mission", printed: {} }
  ];

  var byId = {};
  PLAYBOOKS.forEach(function (p) { byId[p.id] = p; });

  root.B68Content = { LOCKED: LOCKED, ACTIONS: ACTIONS, HERITAGES: HERITAGES, BACKGROUNDS: BACKGROUNDS, VICES: VICES, STANDARD_ITEMS: STANDARD_ITEMS, NAMES: NAMES, LOOK: LOOK, PLAYBOOKS: PLAYBOOKS, byId: byId };
})(typeof window !== "undefined" ? window : globalThis);
