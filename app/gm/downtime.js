/* gm/downtime.js — personal business at the table (the downtime phase), as pure logic (no DOM, no storage, no network).
   One card per activity a PC takes: a scene prompt to frame it, a question for the player, and something to pull on
   later. Indulging a vice gives the scene at the PC's purveyor; an overindulgence adds what it costs (attract trouble,
   brag, lost, tapped: the mechanical line in bold) with a scene prompt under it, and a clock the GM can start.
   Everyone rolls physical dice: the page passes the result in (`res`), this file never rolls a die.

   The tables are this file's own writing (TABLES below: no book text), so the panel works with any pack. A pack part
   `downtime` may replace them later: any top-level key of its `T` replaces the table of that name, and a vice in
   `T.vice` replaces that vice's tables one by one (check(T) lists what a replacement leaves missing).

   Every draw comes from one seeded mulberry32 stream in a fixed order, and the repeat guard keeps INDICES (never the
   text), so { seed, mem, ui } redraws the same card and a stored memory stays small. The overindulgence's four
   options are drawn after everything else, whatever `res` and `pick` say, so ticking "Overindulged" or switching the
   option after a roll keeps the scene above it as it was.

   ---------------------------------------------------------------------------------------------------------------
   API
   ---------------------------------------------------------------------------------------------------------------
   const dt = B68GmDowntime.create({ T, mem, vices, districts })
       T          optional: a pack part's tables over the built-in ones (see above)
       mem        optional repeat-guard memory ({ key: [recent indices] }), kept by the instance between rolls
       vices      optional: B68Content.VICES ([{ name, purveyors: [line] }]): the book's purveyors, for Tapped's new source
       districts  optional: district names for {district} when nothing else gives one (default: TABLES.districts)
   dt.ACTS        [{ id, label, short, res }]  res: 'over' (indulge) | 'band' (1-3 / 4/5 / 6 / crit) | 'attr' | 'rel'
   dt.VICES       the vice names, in the book's order
   dt.defaults()  { act:'indulge', who:'', vice:'', purveyor:'', district:'', res:'', pick:'', attr:'', contact:'',
                    rel:'', project:'' }
   dt.roll(ui, { seed, mem }) -> { lines, meta, over, seed, replay }
       ui.act      'indulge' | 'recover' | 'project' | 'train' | 'contact' | 'heat' | 'acquire'
       ui.who      the PC's name ('' leaves it out)
       ui.vice     indulge: a vice name ('' = drawn); ui.purveyor the sheet's line ("Vesper, bookmaker at the Vreen
                   Autodrome, Nightmarket"; '' = a stock host and place for the vice)
       ui.district '' = the purveyor's district, else drawn
       ui.res      indulge: 'over' | '' · recover, project, heat, acquire: '13' | '45' | '6' | 'crit' ('' reads as 4/5,
                   with no ticks) · train: unused
       ui.pick     indulge: 'trouble' | 'brag' | 'lost' | 'tapped' ('' = drawn)
       ui.attr     train: 'Insight' | 'Prowess' | 'Resolve' | 'Playbook' ('' = drawn)
       ui.contact  contact: the sheet's line ("Vanden, a lazy Bluecoat"); ui.rel 'friend' | 'rival' ('' = drawn)
       ui.project  project: the clock's name on the sheet ('' = "the project")
       seed        uint32; omit for a fresh one
       mem         the repeat-guard memory to use and MUTATE (default: the instance's)
       lines   [{ kind:'want', id:'lead', md, small }, ({ kind:'want', id:'over', md, small }), { kind:'grid',
               id:'more', rows:[{ k, md }] }]   md is markdown (bold and italics only), never HTML
       over    indulge only: { pick, shown, options:[{ id, title, mech, md, clock, source }] }  shown: res is 'over'
       meta    { id:'downtime', act, title, sub, chips, text, all, label, actions:[{ label, intent:{ type:'clock',
               name, size } }] }   all: the card as plain lines (Pin / Copy)
       replay  { id:'downtime', seed, mem, ui }   mem is a deep copy BEFORE this roll; dt.replay(replay) redraws it
   dt.mem()       the instance's live repeat-guard memory
   Helpers: B68GmDowntime.seedRng(a) · plain(md) · purveyor(line) -> { host, place, district, near } · TABLES
   B68GmDowntime.check(T) -> [string]   the table keys a (merged) T lacks or has empty; [] for the built-in tables.
   --------------------------------------------------------------------------------------------------------------- */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68GmDowntime = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function seedRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var clone = function (o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); };
  var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var str = function (v) { return typeof v === 'string' ? v : v == null ? '' : String(v); };
  var cap = function (t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
  function plain(s) {
    return String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
  }

  /* =================================================================================================================
     The tables. Slots: {host} {place} {district} {contact} {healer} {who} {cover} {project}; a capital first letter
     ({Host}) capitalises the value, {host's} makes it possessive. A line ending " || Name (6)" suggests a clock (size
     4 when the brackets are left off). Prompts speak to the PC ("you"); hosts are never given a gender.
     ================================================================================================================= */
  var TABLES = {
    districts: ['Brightstone', 'Charhollow', 'Charterhall', 'Coalridge', 'Crowfoot', 'the Docks', 'Nightmarket', 'Silkshore',
      'Six Towers', 'Whitecrown', 'New Horizon', 'Barrowcleft'],

    /* the four ways an overindulgence goes: the mechanical line (in our words; the book has the rule) */
    over: [
      { id: 'trouble', title: 'Attract trouble', mech: "Trouble follows you home: one more entanglement. Roll it, or use this one." },
      { id: 'brag', title: 'Brag', mech: "You talked about the crew's business: +2 heat." },
      { id: 'lost', title: 'Lost', mech: "Gone on a bender for weeks: play another character until this one surfaces. They come back with their harm healed." },
      { id: 'tapped', title: 'Tapped', mech: "{Host} cuts you off: find a new source for your vice." }
    ],

    vice: {
      'Faith': {
        places: ['a storefront chapel', 'the cathedral', 'a meditation centre over a launderette', 'a candlelit basement temple'],
        hosts: ['the preacher', 'the guru', 'the old priest', 'the group leader'],
        lead: [
          "The service at {place} runs long. {Host} picks you out from the front and asks you to stand and say what you've given up.",
          "You sit at the back of {place} while {host} talks about the fire to come. For an hour, nothing you did this week has happened yet.",
          "{Host} takes both your hands and asks after the thing you confessed last time, by name.",
          "An all-night vigil at {place}: candles, a tape loop of chanting, and a stranger beside you who knows the words better than you do.",
          "{Host} has a new teaching, typed and stapled. Your name is in the acknowledgements.",
          "The encounter group at {place} goes round the circle. When it gets to you, everyone waits.",
          "{Host} asks you to carry the collection box through the crowd tonight. It's heavier than it should be.",
          "You light a candle at {place} for someone you've never told the crew about.",
          "The plasmovision in the vestry plays {host's} sermon on a loop. You catch yourself mouthing along."
        ],
        detail: ["Incense, floor polish and wet wool.", "A choir on a reel-to-reel, the tape slightly stretched.",
          "Folding chairs, a tea urn, a banner with half its letters peeled off.", "Candle wax on your cuffs for days after.",
          "A hymn book with notes in the margins in your own handwriting.", "The hum of electroplasmic lamps under the singing."],
        ask: ["What do you ask for, when nobody else can hear?", "Who here would be disappointed to learn what you do for a living?",
          "What do you put in the collection, and where did it come from?", "Which teaching can't you make yourself believe?",
          "Who first brought you here?", "What do you promise tonight, and do you mean it?"],
        hook: [
          "{Host} asks a small favour: carry a sealed letter to someone in {district}, and don't read it. || {Host's} letter (4)",
          "A believer recognises you from somewhere you shouldn't have been.",
          "The congregation is raising money, and {host} thinks you could raise a great deal of it.",
          "A Bluecoat sergeant sits two pews in front of you, crying. They look up and see you.",
          "{Host} has been asking the faithful about your crew.",
          "Someone at {place} is skimming the offering, and {host} wants you to find out who. || Who's skimming at {place} (4)"
        ],
        over: {
          trouble: [
            "You took a vow in front of everyone, against someone, by name. They've heard about it. || The vow you made at {place} (4)",
            "You lent the congregation's bail fund to cover a crew debt. Somebody is going to check the books. || The missing offering (4)",
            "You preached all night on a corner in {district} against a faction, by name. They were listening. || {District} remembers your sermon (4)"
          ],
          brag: [
            "Swept up in testimony, you told the whole hall how the crew's last job really went. With names.",
            "You told {host}, in confession, which house you emptied. {Host} believes in forgiveness, and in tithes.",
            "At the vigil you said the crew's name aloud as the thing you'd given your life to. Three people wrote it down."
          ],
          lost: [
            "You went into retreat at {place} and didn't come out. When the crew finds you, your head is shaved and you answer to another name.",
            "Weeks on a pilgrimage to a shrine outside the city. You come back calm, healed and sunburnt, and you've brought someone with you.",
            "Nobody can find you for a fortnight. Then {host} calls: you've been sleeping in the bell tower and fasting."
          ],
          tapped: [
            "{Host} reads your name from the front as one who has strayed. The doors of {place} are closed to you.",
            "{Host} says your money isn't clean enough for the plate any more, and won't take it.",
            "The congregation votes. You're not welcome until you've made amends, and they decide what amends means."
          ]
        }
      },

      'Gambling': {
        places: ['a back-room card game', 'the dog track', 'a dice game behind the bus depot', 'the casino'],
        hosts: ['the dealer', 'the bookie', 'the croupier', 'the one who runs the game'],
        lead: [
          "{Host} has a seat for you at the table before you ask. The pot is already bigger than your share of the last score.",
          "The odds board at {place} clacks over. {Host} leans in: there's a sure thing in the fourth, and you don't want to know how they know.",
          "You're up. Way up. The whole room at {place} has noticed, and so has the house.",
          "Three hands in, a stranger with a wedding ring on a chain buys in with a deed instead of cash.",
          "{Host} lets you run a tab tonight. They've never done that before.",
          "You lose five in a row, win the sixth, and the person you beat won't stop staring at you.",
          "Somebody at {place} is cheating, and you're almost sure it's {host}.",
          "The last bet of the night is about you: whether you'll take it. The table goes quiet.",
          "A dealer you've never seen shuffles like they're angry at the cards. {Host} is nowhere to be seen."
        ],
        detail: ["Cigarette smoke under green lamps, the clack of chips.", "The roar of the crowd arriving a second after the autopods.",
          "A sticky felt table and a radio calling the results.", "Brass fittings, thick carpet, a dealer who doesn't blink.",
          "The sour smell of a room that's losing.", "Your lucky coin, warm from your hand."],
        ask: ["What's your tell, and who at the table has noticed it?", "What do you bet that you can't afford to lose?",
          "Who taught you this game?", "When do you know it's time to walk away, and do you?", "What would you do with the big win?",
          "Who are you trying not to think about while you play?"],
        hook: [
          "A player who lost big to you is a clerk in {district} with keys to somewhere interesting.",
          "{Host} wants you to throw a game next week. || {Host's} fix (4)",
          "You won a marker from someone important. They want it back, quietly. || The marker you won (4)",
          "The house is looking for someone to collect from a deadbeat, and {host} thinks you have the face for it.",
          "Word at the tables: a faction is washing its money through {place}.",
          "A kid who runs slips for {host} wants out, and asks you how."
        ],
        over: {
          trouble: [
            "You lost a marker you never had to someone who doesn't forgive debts. || {Host's} collectors (4)",
            "You put up something of the crew's as a stake. They want it, or you, by the end of the month. || The crew's stake at {place} (4)",
            "You beat the wrong person at the wrong table, and they've decided you cheated. || A sore loser from {place} (4)"
          ],
          brag: [
            "To prove you could cover the bet, you told the table where the crew's money comes from.",
            "Flush with winnings, you bought the house a round and told everyone what the crew pulled off last week.",
            "You took bets on the crew's next job. Out loud. With odds."
          ],
          lost: [
            "Two weeks at a floating game that never closes. You come back in a new suit, with no money and somebody else's dog.",
            "You chase a winning streak out of the city to the provincial tracks. You come back healed, and you own part of a racing stable.",
            "Nobody sees you for weeks. {Host} says you've been sleeping in a back room at {place}."
          ],
          tapped: [
            "{Host} has your name on a list behind the bar. You're not welcome at {place}.",
            "{Host} calls in your tab, all of it, and closes your book.",
            "The house decides you count cards. Two very large people walk you out of {place} and tell you not to come back."
          ]
        }
      },

      'Luxury': {
        places: ['the best restaurant that will seat you', "a tailor's back room", 'a hotel suite', 'a members-only club'],
        hosts: ["the maître d'", 'the tailor', 'the concierge', 'the club secretary'],
        lead: [
          "{Host} has saved you the best table at {place}, the one where everyone sees you sit down.",
          "A fitting at {place}: {host} circles you with a mouthful of pins and says the cut is everything.",
          "Champagne, oysters and a bill you don't read. {Host} says it's on the house. It's never on the house.",
          "You take a suite for one night, just to look down from the window at the city you robbed.",
          "{Host} shows you something new and imported: there are only three in the city. You already know you'll buy it.",
          "The valet at {place} knows your name and your autopod. That was the point.",
          "The tasting menu at {place} runs to eleven courses. By the seventh you've forgotten what the job was like.",
          "You walk into {place} dressed better than the people who own it, and {host} notices."
        ],
        detail: ["Velvet, cologne and a quartet playing something you almost know.", "Starched linen, a hundred candles, the hush of money.",
          "Silk that feels like cold water.", "The pop of a society photographer's flashbulb.", "A bill folded on a silver plate.",
          "A doorman in white gloves holding the door a moment too long."],
        ask: ["What do you buy that you'll never use?", "Who are you dressing for?", "What did you go without, growing up?",
          "What do you tell people here you do?", "Who in this room would you most like to impress, and who do they think you are?",
          "What's the one thing you'd never sell?"],
        hook: [
          "A society photographer got a picture of you with someone you shouldn't be seen with.",
          "{Host} introduces you to a buyer who wants something stolen to order.",
          "A dowager at the next table is wearing a necklace you recognise from a job.",
          "{Host} is behind on rent to a faction, and asks whether you know anyone.",
          "The ledger at {place} holds the measurements, tastes and addresses of half the city's powerful.",
          "Someone at {place} paid your bill. They haven't said what they want yet. || Your secret benefactor (4)"
        ],
        over: {
          trouble: [
            "You bought it on credit from the wrong lender. || The lender from {place} (4)",
            "You spent money that was already promised to someone else. || Money you owed (4)",
            "You outbid a powerful collector for something they badly wanted. || A jealous collector (4)"
          ],
          brag: [
            "You told a society columnist where your money comes from, as a joke. It's in the morning edition.",
            "You paid in cash, a great deal of it, in front of people whose job is noticing cash.",
            "You boasted that the crew could steal anything in the city. Someone at {place} took you up on it, and told everyone."
          ],
          lost: [
            "A month at a coastal resort under a false name. You come back tanned, healed and carrying someone else's luggage.",
            "You vanish into Whitecrown society for weeks, invited to everything. The crew follows you in the society pages.",
            "Two weeks on a pleasure cruise down the coast. You come back healed, broke and engaged."
          ],
          tapped: [
            "{Host} returns your deposit with a note: not our sort of client.",
            "Your account at {place} is closed, and {host} won't say who asked.",
            "{Host} saw your picture in the wrong newspaper and doesn't want you seen at {place} again."
          ]
        }
      },

      'Obligation': {
        places: ["your family's flat", 'the union hall', 'the community centre', 'the old neighbourhood'],
        hosts: ['your family', 'your oldest friend', 'the community elder', 'your old foreman'],
        lead: [
          "Sunday dinner with {host}. Everybody asks what you do now, and the answer gets longer every time.",
          "{Host} needs hands: a roof to fix, a shift to cover, a cousin to collect. You don't ask why it's you.",
          "You spend the day at {place} doing the work nobody pays for, and for once your hands know exactly what to do.",
          "{Host} hands you an envelope of everyone's dues to deliver. You add some of your own.",
          "A wake at {place}. {Host} asks you to say a few words about the dead, whom you barely knew.",
          "You sit up with {host} through a long night of bad news. You say almost nothing, and it's enough.",
          "The meeting at {place} runs past midnight. {Host} keeps looking at you as if you might fix it.",
          "{Host} has kept your old room just as you left it. There's a box of your things on the bed."
        ],
        detail: ["Cabbage on the stove and the radio too loud.", "A gym that smells of chalk and liniment.",
          "Folding chairs, a tea urn, children underfoot.", "A photograph on the wall with you in it, younger.",
          "Calloused hands shaking yours.", "A union banner over the door, mended twice."],
        ask: ["Who do you send money to, and do they know where it comes from?", "What do they still call you here?",
          "What did you promise, a long time ago, that you're still keeping?", "Who here would you die for?",
          "What do they need that you can't give them?", "What's the lie you tell them about the crew?"],
        hook: [
          "{Host} is being leaned on by a faction and hasn't told you. || The squeeze on {host} (4)",
          "A cousin wants to join the crew.",
          "Someone from the old life saw you on a job.",
          "{Host} asks you to find someone who went missing in {district}. || Finding {host's} missing one (6)",
          "The community's money has gone, and people are looking at the newcomer.",
          "{Host} has kept something of yours that would hang you, if anyone found it."
        ],
        over: {
          trouble: [
            "You took on the community's fight yourself. Now the other side knows your face. || The other side of {host's} fight (4)",
            "You promised {host} a sum you don't have, by a date you can't make. || Your promise to {host} (4)",
            "You settled a family quarrel with your fists, and the other family has friends. || The other family (4)"
          ],
          brag: [
            "To win an argument at dinner, you told them what you really do, and who for.",
            "You told {host} the crew would protect everyone here. Now the whole street is saying it.",
            "Your little cousin repeats everything you said at dinner to everybody, including a Bluecoat."
          ],
          lost: [
            "You go home for a funeral and stay for weeks, back in the old life. The crew has to come and fetch you.",
            "A strike, a flood, a family crisis: you vanish into it for a month and come back healed and exhausted.",
            "{Host} needed you, so you went. Nobody in the crew knew where, for three weeks."
          ],
          tapped: [
            "{Host} tells you not to come back until you've stopped doing what you do.",
            "The family meets without you and decides: you're not to come to {place}.",
            "{Host} returns every bit of money you ever sent, with a note: we don't want it."
          ]
        }
      },

      'Pleasure': {
        places: ['a lounge bar', 'a jazz club', 'a supper club', 'a late-night picture house'],
        hosts: ['the bartender', 'the singer', 'your lover', 'the owner'],
        lead: [
          "The band at {place} plays your song before you've finished your first drink. {Host} pretends it's a coincidence.",
          "{Host} pours without asking and sits down across from you, which they never do.",
          "A long night at {place}: music, a stranger's laugh, a booth you don't remember sliding into.",
          "{Host} has something new for you to try, and wants to watch your face when you do.",
          "Somebody you used to love is at the bar of {place}. They've seen you.",
          "You dance until the floor of {place} feels like the deck of a ship.",
          "{Host} keeps the kitchen open late just for you. The plates arrive faster than you can name them.",
          "The double feature runs past two. You don't watch the second film."
        ],
        detail: ["Electric organ and spilled beer.", "A mirror ball throwing coins of light across the ceiling.",
          "Kaff so strong it tastes of smoke.", "Someone's perfume on your collar.", "A needle crackling on a record before the song.",
          "Red light, a low ceiling, the bass in your ribs."],
        ask: ["Who do you go home with, or who do you wish you had?", "What do you order, and what does it remind you of?",
          "What do you get to forget here, for a while?", "Who would be surprised to see you here?",
          "What song makes you leave the room?", "What's the best thing you've tasted this year?"],
        hook: [
          "Last night's lover has a sister in the Bluecoats.",
          "{Host} is selling up, and the buyer is a faction you know.",
          "The band needs protection for a run of shows in {district}. || The band's protection (4)",
          "The bartender at {place} hears everything, and is starting to sell it.",
          "Someone slipped something into a drink at the next table, and you saw who.",
          "{Host} asks you to keep a regular out of trouble, quietly."
        ],
        over: {
          trouble: [
            "You started something in the back room at {place} with someone who has friends. || A grudge from {place} (4)",
            "Your tab with {host} has become a debt, with interest. || What you owe {host} (4)",
            "You woke up beside someone with a jealous, well-connected spouse. || A jealous spouse (4)"
          ],
          brag: [
            "Pillow talk: you told someone everything about the last job, and they passed it on before breakfast.",
            "You toasted the crew's last score from the stage at {place}, with details.",
            "You traded a story about the crew for a free round. The bartender sells stories."
          ],
          lost: [
            "A whirlwind romance takes you out of the city for weeks. You come back healed, happy and wearing a ring you can't explain.",
            "You follow the band on tour. Postcards arrive from three districts and a seaside town.",
            "{Place} becomes your whole world for a month. The crew has to come and find you."
          ],
          tapped: [
            "{Host} has had enough of your scenes: you're barred from {place}.",
            "{Host} has fallen for someone who can't stand you. You're out.",
            "{Place} shuts its doors to you after you broke something expensive, or someone."
          ]
        }
      },

      "Gettin' Fucked Up": {
        places: ['a dive bar', 'the fight pits', 'a lotus den', "a dealer's flat"],
        hosts: ['the bartender', 'your dealer', 'the promoter', 'the doorman'],
        lead: [
          "{Host} sets out the first one. You don't remember the third.",
          "The fight pit under {place}: you're not watching, you're in it, and you're winning.",
          "Black lotus at {place}. The ceiling folds open and the city goes quiet for the first time in weeks.",
          "{Host} has something new, cut with something newer. \"You first,\" they say.",
          "A blur of three bars across {district}, ending somewhere with sawdust on the floor and a bird in a cage.",
          "{Host} counts out your usual, then a few more, \"for the weekend\".",
          "You wake at dawn on the roof of {place}, coat gone, knuckles split, grinning.",
          "Somebody at {place} bets you can't finish the bottle. Somebody loses."
        ],
        detail: ["Smoke so thick the lamps wear halos.", "Sawdust, blood and spilled spirits.", "The tick of a cooling radiator, the taste of metal.",
          "A pill bottle with someone else's name on it.", "Your ears ring for a day afterwards.", "The sweet, rotten smell of black lotus."],
        ask: ["What are you trying not to feel?", "Who usually gets you home?", "What's the last thing you remember?",
          "Who did you call, and what did you say?", "What's in your pockets when you wake up?", "Whose blood is it?"],
        hook: [
          "{Host's} supply is coming from somewhere new, and dangerous. || {Host's} new supplier (4)",
          "You wake up with a key you don't recognise and an address in {district}.",
          "Somebody at {place} saw you out cold, and took your picture.",
          "The pit's promoter wants you back, for real money.",
          "A kid who sold to you is about to get hurt by the people above them.",
          "You said yes to something last night. You don't know what. Someone else does. || What you agreed to (4)"
        ],
        over: {
          trouble: [
            "You picked a fight with someone you shouldn't have, and won. Their people want a rematch. || Payback from {place} (4)",
            "You owe {host} for what you took on credit, and {host} owes someone worse. || What you owe {host} (4)",
            "You broke in somewhere for more and left your coat behind. With your name in it. || The coat you left (4)"
          ],
          brag: [
            "Off your face, you told a room full of strangers exactly what the crew does. They laughed, all but one.",
            "You made a speech on top of a bar about the crew's last job. Someone had a camera.",
            "You told {host} where the crew keeps its stash, to get more on credit."
          ],
          lost: [
            "You vanish into the dens of {district} for weeks. You come out healed, without your coat, your watch or a month.",
            "A month in a drying-out ward under a false name. You come back clean, healed and shaking.",
            "A bender that crosses the city twice. People tell the crew stories about you for weeks."
          ],
          tapped: [
            "{Host} won't serve you any more: \"You'll die on my floor and bring the Bluecoats.\"",
            "{Host} has been picked up, bought out or scared off. Either way, your supply is gone.",
            "{Host} cuts you off after you threatened them. You don't remember threatening them."
          ]
        }
      },

      'Weird': {
        places: ['a fringe-science society', 'a séance parlour', 'an occult bookshop', 'the aquarium after hours'],
        hosts: ['the medium', 'the scientist', 'the bookseller', 'the keeper'],
        lead: [
          "{Host} switches off the lights at {place} and tunes the set to a channel that isn't there. Something on the screen looks back.",
          "A game with {host} that takes all night. You think you won. {Host} thinks so too, which is worse.",
          "{Host} takes you out past the last streetlight to hear the deathlands sing.",
          "At {place}, the thing in the glass tank turns to watch you pass. {Host} says it does that for very few.",
          "The room at {place} has no corners. You come out an hour later and it feels like a minute.",
          "{Host} asks you to hold a wire, and not let go whatever you hear.",
          "A séance in the back room at {place}, a tape recorder running. On playback there's an extra voice.",
          "You and {host} sit up till dawn arguing about whether the city is alive. You're winning, until you aren't."
        ],
        detail: ["Static, ozone and a hum you feel in your teeth.", "A tank of dark water, lit from below.",
          "Pages of diagrams in a hand that isn't quite human.", "A radio tuned between stations, almost speaking.",
          "Electroplasmic glow on everyone's faces.", "Clockwork ticking inside something that shouldn't have clockwork."],
        ask: ["What did you see that you haven't told anyone about?", "What are you hoping is true?", "What do you leave as an offering?",
          "What question do you keep coming back to?", "Who taught you not to be afraid of this, and were they right?",
          "What would make you stop?"],
        hook: [
          "{Host} has found something in the static that a faction wants badly. || Who's after {host's} signal (4)",
          "The thing in the tank has started turning up in your dreams.",
          "A Reality Warden has been asking at {place} about the regulars.",
          "{Host} needs a part for an experiment. It's in a vault in {district}.",
          "You came away with a phrase in a language nobody speaks.",
          "Something followed you home from {place}. || What followed you home (4)"
        ],
        over: {
          trouble: [
            "You opened something at {place} that should have stayed shut. It knows where you sleep. || The thing you opened (4)",
            "Reality Wardens took names after an incident at {place}. Yours is on the list. || The Wardens' list (4)",
            "You promised the entity something in exchange. It's back to collect. || What you promised it (4)"
          ],
          brag: [
            "You tried to impress {host's} circle with what the crew has done. One of them is an informer.",
            "You rang a late-night plasmovision show about the crew's last job. They put you on air.",
            "You boasted about the crew's strangest haul. Collectors and Wardens alike are interested."
          ],
          lost: [
            "You walk out with {host} into the deathlands, or somewhere stranger, for weeks. You come back healed, and different.",
            "Time slips: you went into {place} on a Tuesday and came out a month later, healed, in different clothes.",
            "You vanish into an experiment. The crew finds notes in your handwriting that none of them can read."
          ],
          tapped: [
            "{Host} says you've drawn too much attention, and stops answering the door.",
            "The Ministry shuts {place} overnight. {Host} is gone.",
            "{Host} says the thing you've been feeding doesn't want you any more."
          ]
        }
      }
    },

    /* Recover: who patches you up, and how it goes by the dice */
    recover: {
      /* "who — what they're like": the lead says who, the Healer row says both */
      healers: ['a back-alley sawbones — a cigarette in the corner of their mouth', 'a nun from the free clinic in {district} — prays under their breath while stitching',
        "a vet — doesn't ask what bit you", 'an army medic — steady until the second drink', 'a Xantara Pharm chemist — working after hours, off the books',
        'a Skovlander midwife — has seen worse, and says so', 'a sparktech surgeon — a drawer full of spare parts',
        'a hospital porter — steals the good supplies', 'whoever in the crew has the steadiest hands — and the strongest stomach',
        "a Tycherosi healer — methods you'd rather not watch"],
      band: {
        '13': ["The stitches hold, mostly. {Healer} says you're lucky, in a voice that means you aren't.",
          "It heals slowly and wrong. You'll feel it when it rains.",
          "{Healer} runs out of the good stuff halfway through. You stay awake for the rest."],
        '45': ["A clean job in a dirty room. {Healer} tells you to rest, knowing you won't.",
          "Two days flat on your back, listening to the city through the wall.",
          "{Healer} sets it, binds it and tells you a long story about the last patient who didn't listen."],
        '6': ["{Healer} is good, better than you can afford, and in a generous mood.",
          "A week of real rest: clean sheets, broth, and nobody looking for you.",
          "It knits fast. {Healer} looks at you a moment too long, as if they've seen luck like yours before."],
        'crit': ["{Healer} has something new from the labs, and it works like a miracle. They want to know how you'll pay for more.",
          "You wake up and it's simply better. {Healer} won't say what they gave you.",
          "One long sleep and you're whole again, almost too fast."]
      },
      cost: ['cash up front, and more than last time', 'a favour, to be named later', 'the name of whoever did this to you',
        'a look at whatever you stole', 'a package carried on your way out', 'nothing, which worries you',
        'that you sit still while they try something new', 'your silence about who else is in the back room'],
      detail: ['Carbolic soap and boiled instruments.', 'A ceiling fan that clicks on every turn.', "Somebody else's blood on the floor, older than yours.",
        'A plasmovision with the sound off, showing a quiz.', 'Iodine sting and a bottle of something for the pain.', 'The hum of a healing coil.'],
      ask: ['What does it look like now, and will it scar?', 'Who sits with you while you heal?', 'What do you dream under the anaesthetic?',
        'Who did this to you, and are you thinking about them?', 'What do you promise yourself while you are laid up?']
    },

    /* Long-term project: what this downtime's progress looks like, by the dice */
    project: {
      band: {
        '13': ['The person you need won\'t see you this week. You spend it waiting in corridors.',
          "A setback: the materials are wrong, or gone, or someone else's now.",
          'You learn one thing, and it\'s that this is harder than you thought.',
          "Someone else is working on the same thing, and they're ahead.",
          'The lead goes cold. Who could warm it up again?'],
        '45': ['Slow, honest progress: a page, a part, a promise.', 'A useful person agrees to help, for a price you can live with.',
          'You find the next step, and the one after it is clearer too.', 'You trade a favour for a shortcut. It mostly works.'],
        '6': ['A breakthrough: something falls into place at three in the morning.', 'Someone who owes you pays up, in exactly the right currency.',
          "You get through a door that's been shut for months.", 'The project takes on a life of its own: people talk about it.'],
        'crit': ["Everything goes right at once, and you're not sure you trust it.", 'A stroke of luck so big it feels arranged. By whom?',
          'You leap ahead, and somebody important notices what you are building.']
      },
      who: ['a clerk who keeps the files', 'an old rival who knows the subject better than you', 'a student who works for beer',
        'a retired expert with a grudge', 'a fence with the right catalogue', 'a contact of a contact, very nervous',
        'a Bluecoat who looks the other way, for now', 'a Skovlander engineer with time on their hands'],
      ask: ['What does progress look like this week?', 'Who is helping, and what do they think you are doing?',
        'What did you give up to find the time?', 'What will you do the day it is finished?', 'Who would stop you if they knew?',
        "What's the part you keep putting off?"]
    },

    /* Train: a short montage for the track the xp goes on */
    train: {
      attr: {
        'Insight': ['Nights in the stacks at Charterhall on a borrowed reader\'s card.', '{Who} sets you puzzles over kaff and endless arguments.',
          'You take a machine apart and put it back together twice, the second time without the manual.',
          'You shadow a detective for a week, learning to see what they see.', 'You sit in a café window and watch, and write everything down.'],
        'Prowess': ['Sparring at a boxing gym in {district} until your arms won\'t lift.', 'Rooftop runs at dawn with {who}.',
          'You practise with the knife until it stops being a thing you hold.', 'Lock after lock after lock, until your fingers learn them.',
          'A week running packages with the couriers, through the traffic.'],
        'Resolve': ['You haunt a debating society until you win.', 'You meditate with {who} until the noise stops.',
          'You learn to hold a room by watching a union organiser do it.', 'You sit with something paranormal and refuse to blink.',
          'Hours on the telephone with strangers, learning to talk anyone round.'],
        'Playbook': ["You do the thing you're known for, over and over, until it becomes who you are.", '{Who} shows you the old ways of your trade.',
          'You go back to where you learned it all, and find it changed.', 'You teach someone younger, and learn more than they do.']
      },
      who: ['an old pro', 'a rival who wants to beat you properly', 'a retired Bluecoat', 'a gym owner in Crowfoot', 'a Charterhall lecturer',
        'an Iruvian fencing master', 'a Skovlander veteran', "a kid who's better than you"],
      ask: ['Who are you training to beat?', 'When does it click?', 'Who taught you this first, and what would they say now?',
        'What hurts afterwards?', 'What do you practise when nobody is watching?']
    },

    /* A friend or rival from the sheet: what they bring this downtime */
    contact: {
      friend: {
        need: ["{Contact} needs a favour, the kind you can't refuse: tonight, in {district}.",
          '{Contact} is in trouble with a faction and asks you to make it go away. || {Contact\'s} trouble (4)',
          '{Contact} needs somewhere to hide someone for a week.'],
        offer: ['{Contact} has heard something about a job: a door left open, a guard paid off, a buyer waiting.',
          '{Contact} brings a gift: something useful, with a name scratched off it.', '{Contact} offers to vouch for you with someone you need.'],
        news: ["{Contact} warns you: someone's been asking about you by name.",
          '{Contact} is getting married, moving away or getting out, and wants you there.', '{Contact} has news about one of your rivals.']
      },
      rival: {
        move: ['{Contact} has been talking to your friends. Some of them listened. || {Contact\'s} whispers (4)',
          '{Contact} beats you to something you wanted, in public.', '{Contact} takes a grudge against you to someone who matters.'],
        truce: ['{Contact} wants a truce for a week, against someone you both hate.', '{Contact} needs your help, and hates asking.',
          '{Contact} offers information in exchange for being left alone.'],
        weak: ['{Contact} is in trouble, and you could make it much worse.', "You see {contact} somewhere they shouldn't be.",
          '{Contact} owes money to someone dangerous, and you know who.']
      },
      ask: ['How did you two meet?', 'What do you owe each other?', 'What would {contact} never forgive?',
        'What do you admire about {contact}, even now?', 'Who else knows about the two of you?']
    },

    /* Lay low: cooling things down (the scene only; the book says how much it takes off) */
    heat: {
      band: {
        '13': 'It barely helps.', '45': 'It helps.', '6': 'It works.', 'crit': 'It works beautifully.'
      },
      lead: ['You spend a week as someone else: new clothes, new hours, a job as a {cover}.',
        'A friendly clerk loses a file for you. You buy them a very good dinner.',
        'You plant a rumour that someone else did the job, and watch it spread.',
        'You keep your head down in a boarding house in {district} where nobody asks names.',
        "You pay the beat Bluecoat's bar tab for a month.",
        'The crew is seen doing something dull and legal, loudly, for a week.'],
      cover: ['night porter', 'dishwasher', 'cab driver', 'church volunteer', 'temp typist', 'bellhop'],
      cost: ['It costs more than it should.', 'Someone now knows you were hiding.', 'You had to lean on a friend to do it.',
        'The rumour points at someone who will be angry.'],
      ask: ['Where do you go to disappear?', 'Who did you have to lie to?', 'What is the hardest part of being nobody for a week?',
        'Who notices you are gone?']
    },

    /* Acquire: getting hold of something (the scene only; the book sets the quality) */
    acquire: {
      seller: ['a fence in {district} with a back room full of crates', 'a Ministry quartermaster selling off stock',
        "a collector who'd rather trade than sell", 'a gun dealer who works out of an autopod boot',
        'a pawnbroker who remembers every face', 'a sparktech hobbyist who builds to order', 'a dockside smuggler',
        "a widow clearing out her late husband's study"],
      band: {
        '13': ["It's worse than promised, and the seller knows it.", 'You get it, but someone saw you get it.',
          "It was stolen from someone who'll want it back."],
        '45': ["It's what you asked for, with one small flaw.", "It comes with a request: don't say where you got it.",
          'The price includes a favour, later.'],
        '6': ['Exactly right, and the seller has more where that came from.', 'Better than you hoped: the seller liked you.'],
        'crit': ['Better than you paid for, and the seller wants to keep you as a customer.', "It comes with something extra you didn't ask for, and a story."]
      },
      ask: ['What do you need it for, really?', 'How do you pay, and who notices?', 'What does the seller want to know about you?']
    }
  };

  /* the activities, in the order the panel shows them */
  var ACTS = [
    { id: 'indulge', label: 'Indulge vice', short: 'Vice', res: 'over' },
    { id: 'recover', label: 'Recover', short: 'Recover', res: 'band' },
    { id: 'project', label: 'Long-term project', short: 'Project', res: 'band' },
    { id: 'train', label: 'Train', short: 'Train', res: 'attr' },
    { id: 'contact', label: 'Friend or rival', short: 'Contact', res: 'rel' },
    { id: 'heat', label: 'Lay low', short: 'Lay low', res: 'band' },
    { id: 'acquire', label: 'Acquire', short: 'Acquire', res: 'band' }
  ];
  var ACT = {}; ACTS.forEach(function (a) { ACT[a.id] = a; });
  var BANDS = ['13', '45', '6', 'crit'];
  var BAND_LABEL = { '13': '1–3', '45': '4/5', '6': '6', 'crit': 'crit' };
  var TICKS = { '13': 1, '45': 2, '6': 3, 'crit': 5 };   /* the sheet's own: a downtime roll's clock ticks */
  var ATTRS = ['Insight', 'Prowess', 'Resolve', 'Playbook'];
  var KINDS = { friend: ['need', 'offer', 'news'], rival: ['move', 'truce', 'weak'] };
  var VICE_TABLES = ['places', 'hosts', 'lead', 'detail', 'ask', 'hook'];
  var OVER_IDS = ['trouble', 'brag', 'lost', 'tapped'];

  /* the book's purveyors (B68Content.VICES): who you deal with and where, so "at {place}" reads right. Anything else is
     read as "Name, place, district" with the role words taken off ("bookmaker at the Vreen Autodrome"). */
  var KNOWN = [
    [/^ankhuset/i, 'Ankhuset', 'the Kethrys Lodge'],
    [/^supreme director/i, 'the Supreme Director of Guidance', 'the New Dawn Center'],
    [/^preceptor aldo/i, 'Preceptor Aldo', 'the Sanctorium'],
    [/^prichard.*palace/i, 'Prichard', 'the Palace'],
    [/^prichard/i, 'Prichard', 'the Restricted Collection'],
    [/^bug\b/i, 'Bug', "Bug's braggart game"],
    [/^remira/i, 'Remira', 'the wrestling hall'],
    [/^karter/i, 'Karter', 'the Sky High casino'],
    [/^marek/i, 'Marek', 'the Iruvian Sands'],
    [/^vesper/i, 'Vesper', 'the Vreen Autodrome'],
    [/^sybil bexley/i, 'Sybil Bexley', 'Paddles'],
    [/^songbird/i, 'Songbird', 'the Sapphire Lounge'],
    [/^diamond/i, 'Diamond', 'the Diamond Palace'],
    [/^dunridge/i, 'old Dunridge', 'Dunridge & Sons'],
    [/^jeduin/i, 'Jeduin', "Jeduin's boutique"],
    [/^chef kalani/i, 'Chef Kalani', 'the Dagger Room'],
    [/^chef lisanne/i, 'Chef Lisanne', 'the Golden Plum'],
    [/^family/i, 'your family', 'home'],
    [/^carro|^cake/i, 'Cake Danfield', 'the Iron gym'],
    [/^ms\.? asta/i, 'Ms. Asta', viaRole],      /* the park, from the line itself: no setting name in this file (gm-nosecrets (a)) */
    [/^director of success/i, 'the Director of Success', 'the New Dawn Center'],
    [/^helda/i, 'Helda', 'the Skovlander community hall'],
    [/^benson/i, 'Benson', 'the Black Goat'],
    [/^rennie/i, 'Rennie', 'the Eyrie'],
    [/^lemmy/i, 'Lemmy', "Lemmy's smoking room"],
    [/^amara/i, 'Amara', 'the Key Club'],
    [/^alfie/i, 'Alfie', 'the Plasmocinema'],
    [/^the silver echoes/i, "the Silver Echoes' singer", 'the Groove Factory'],
    [/^harald tipton/i, 'Harald Tipton', 'the House of Tomorrow'],
    [/^rasp\b/i, 'Rasp', "Rasp's stairwell"],
    [/^lorna/i, 'Lorna', 'the Xantara Pharm dispensary'],
    [/^milos/i, 'Milos', 'the Plasmovision Social Club'],
    [/^brainwave/i, 'Brainwave-60', 'the redcheck tables'],
    [/^blargo/i, 'Blargo', "Blargo's airship"],
    [/^maymuun/i, 'Maymuun', 'Gaddoc Monorail Station'],
    [/^mysticus/i, 'Mysticus', "Mysticus's booth"],
    [/^wilka eadon/i, 'Wilka Eadon', 'the God Experience'],
    [/^captain laudius|^laudius|blanchet/i, 'Captain Blanchet', 'the Void Sea Aquarium']
  ];
  var ROLE = /^(?:a |an |the )?(?:[\w'’-]+ )*?(?:bookmaker|librarian|president|dealer|handler|controller|leader|pilot|guide|owner|manager|chef|keeper|host)\s+(?:at|of|in)\s+/i;
  var ROLE_TAIL = /\s+(?:controller|handler|leader|owner|manager|keeper|host)$/i;
  /* a KNOWN place that is the line's second part as written, its role word taken off ("X Park controller" -> "X Park") */
  function viaRole(parts) { return str(parts[1]).replace(ROLE_TAIL, '').trim(); }
  function normName(s) { return str(s).toLowerCase().replace(/[’`]/g, "'").replace(/^the\s+/, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function districtOf(s, districts) {
    var n = normName(s); if (!n) return '';
    for (var i = 0; i < districts.length; i++) if (normName(districts[i]) === n) return districts[i];
    return '';
  }
  /* "Vesper, bookmaker at the Vreen Autodrome, Nightmarket" -> { host: 'Vesper', place: 'the Vreen Autodrome', district: 'Nightmarket' } */
  function purveyor(line, districts) {
    var out = parsePurveyor(line, districts || TABLES.districts);
    if (out.near && normName(out.near) === normName(out.place)) out.near = '';
    return out;
  }
  function parsePurveyor(line, districts) {
    var parts = str(line).split(',').map(function (x) { return x.trim(); }).filter(Boolean), out = { host: '', place: '', district: '', near: '' };
    if (!parts.length) return out;
    if (parts.length > 1) { var d = districtOf(parts[parts.length - 1], districts); if (d) { out.district = d; parts.pop(); } }
    /* a third part that is not a district is still where it is ("above the city"): shown, never put into a sentence */
    if (!out.district && parts.length > 2) out.near = parts.pop();
    for (var k = 0; k < KNOWN.length; k++) if (KNOWN[k][0].test(parts.join(', '))) { out.host = KNOWN[k][1]; out.place = typeof KNOWN[k][2] === 'function' ? KNOWN[k][2](parts) : KNOWN[k][2]; return out; }
    var first = parts[0], at = /^(.+?)\s+at\s+(.+)$/i.exec(first);
    if (/[’']s\b/.test(first) && parts.length === 1) { out.host = first.split(/[’']s\b/)[0].trim(); out.place = first; return out; }
    if (at && parts.length === 1) { out.host = at[1].trim(); out.place = /^the\s/i.test(at[2]) || !/^[A-Z]/.test(at[2]) ? at[2].trim() : 'the ' + at[2].trim(); return out; }
    out.host = first;
    if (parts.length > 1) {
      var p = parts[1].replace(ROLE, '').replace(ROLE_TAIL, '').trim();
      if (p && !/^(?:a|an)\s/i.test(p) && /[A-Z]/.test(p.charAt(0))) out.place = /^the\s/i.test(p) || /[’']s\b/.test(p) ? p : 'the ' + p;
      else if (/^the\s/i.test(p)) out.place = p;
    }
    return out;
  }

  /* ---- the tables a roll reads, after a pack's replacements ---------------------------------------------------- */
  function merged(T) {
    var out = clone(TABLES);
    if (!isObj(T)) return out;
    Object.keys(T).forEach(function (k) {
      if (k === 'vice' && isObj(T.vice)) {
        Object.keys(T.vice).forEach(function (v) {
          if (!isObj(T.vice[v])) return;
          var cur = isObj(out.vice[v]) ? out.vice[v] : (out.vice[v] = {});
          Object.keys(T.vice[v]).forEach(function (t) { cur[t] = clone(T.vice[v][t]); });
        });
      } else out[k] = clone(T[k]);
    });
    return out;
  }
  function list(a) { return Array.isArray(a) && a.length > 0 && a.every(function (x) { return typeof x === 'string' && x.trim() !== ''; }); }
  /* the keys a roll reads, reported when missing or empty; `T` is checked as merged over the built-in tables */
  function check(T) {
    if (T != null && !isObj(T)) return ['T'];
    var M = merged(T), miss = [], need = function (k, ok) { if (!ok) miss.push(k); };
    need('districts', list(M.districts));
    need('over', Array.isArray(M.over) && OVER_IDS.every(function (id) { return M.over.some(function (o) { return isObj(o) && o.id === id && !!o.title && !!o.mech; }); }));
    need('vice', isObj(M.vice) && Object.keys(M.vice).length > 0);
    Object.keys(isObj(M.vice) ? M.vice : {}).forEach(function (v) {
      var V = M.vice[v];
      VICE_TABLES.forEach(function (t) { need('vice.' + v + '.' + t, list(V && V[t])); });
      OVER_IDS.forEach(function (o) { need('vice.' + v + '.over.' + o, isObj(V && V.over) && list(V.over[o])); });
    });
    var R = M.recover || {};
    need('recover.healers', list(R.healers)); need('recover.cost', list(R.cost)); need('recover.detail', list(R.detail)); need('recover.ask', list(R.ask));
    BANDS.forEach(function (b) { need('recover.band.' + b, isObj(R.band) && list(R.band[b])); });
    var Pj = M.project || {};
    need('project.who', list(Pj.who)); need('project.ask', list(Pj.ask));
    BANDS.forEach(function (b) { need('project.band.' + b, isObj(Pj.band) && list(Pj.band[b])); });
    var Tr = M.train || {};
    need('train.who', list(Tr.who)); need('train.ask', list(Tr.ask));
    ATTRS.forEach(function (a) { need('train.attr.' + a, isObj(Tr.attr) && list(Tr.attr[a])); });
    var C = M.contact || {};
    need('contact.ask', list(C.ask));
    Object.keys(KINDS).forEach(function (rel) { KINDS[rel].forEach(function (k) { need('contact.' + rel + '.' + k, isObj(C[rel]) && list(C[rel][k])); }); });
    var H = M.heat || {};
    ['lead', 'cover', 'cost', 'ask'].forEach(function (k) { need('heat.' + k, list(H[k])); });
    BANDS.forEach(function (b) { need('heat.band.' + b, isObj(H.band) && typeof H.band[b] === 'string' && !!H.band[b]); });
    var A = M.acquire || {};
    need('acquire.seller', list(A.seller)); need('acquire.ask', list(A.ask));
    BANDS.forEach(function (b) { need('acquire.band.' + b, isObj(A.band) && list(A.band[b])); });
    return miss;
  }

  /* ---- filling a line ------------------------------------------------------------------------------------------- */
  function poss(v) { return /s$/i.test(v) ? v + "'" : v + "'s"; }
  function fill(t, ctx) {
    return str(t).replace(/\{([A-Za-z]+)('s)?\}/g, function (m, k, s) {
      var v = str(ctx[k.toLowerCase()]);
      if (!v) return '';
      if (s) v = poss(v);
      return /^[A-Z]/.test(k) ? cap(v) : v;
    });
  }
  /* "text || Clock name (6)" -> { text, clock: { name, size } | null } */
  function split(line, ctx) {
    var at = str(line).indexOf(' || ');
    var text = at < 0 ? line : line.slice(0, at), c = at < 0 ? '' : line.slice(at + 4).trim(), clock = null;
    if (c) {
      var m = /\((\d+)\)\s*$/.exec(c), size = m ? +m[1] : 4;
      if ([4, 6, 8].indexOf(size) < 0) size = 4;
      var name = fill(c.replace(/\s*\(\d+\)\s*$/, ''), ctx).trim();
      if (name) clock = { name: cap(name).slice(0, 80), size: size };
    }
    return { text: fill(text, ctx).trim(), clock: clock };
  }

  /* ---- the draws --------------------------------------------------------------------------------------------- */
  function drawer(rnd, MEM) {
    return {
      pick: function (a) { return a[Math.floor(rnd() * a.length)]; },
      /* a fresh entry of `a` under the repeat guard `key`: the last half of the list (at most 20) is kept out */
      fresh: function (key, a) {
        var used = Array.isArray(MEM[key]) ? MEM[key] : (MEM[key] = []);
        var pool = []; for (var i = 0; i < a.length; i++) if (used.indexOf(i) < 0) pool.push(i);
        var from = pool.length ? pool : a.map(function (x, j) { return j; });
        var idx = from[Math.floor(rnd() * from.length)];
        var win = Math.max(1, Math.min(20, Math.floor(a.length / 2)));
        used.push(idx); while (used.length > win) used.shift();
        return a[idx];
      }
    };
  }

  /* ---- create() ----------------------------------------------------------------------------------------------- */
  function create(cfg) {
    cfg = cfg || {};
    var T = merged(cfg.T);
    var miss = check(cfg.T);
    if (miss.length) throw new Error('B68GmDowntime.create: the tables lack ' + miss.slice(0, 5).join(', ') + (miss.length > 5 ? ' and ' + (miss.length - 5) + ' more' : ''));
    var MEM = isObj(cfg.mem) ? cfg.mem : {};
    var districts = list(cfg.districts) ? cfg.districts.slice() : T.districts.slice();
    var allDistricts = districts.concat(T.districts.filter(function (d) { return districts.indexOf(d) < 0; }));
    var VNAMES = Object.keys(T.vice);
    var books = (Array.isArray(cfg.vices) ? cfg.vices : []).filter(function (v) { return isObj(v) && v.name; });
    function viceKey(v) {
      var n = normName(v); if (!n) return '';
      for (var i = 0; i < VNAMES.length; i++) if (normName(VNAMES[i]) === n) return VNAMES[i];
      return '';
    }
    function bookPurveyors(vice) {
      var n = normName(vice), b = books.filter(function (x) { return normName(x.name) === n; })[0];
      return b && Array.isArray(b.purveyors) ? b.purveyors.filter(function (p) { return typeof p === 'string' && p.trim(); }) : [];
    }
    function defaults() { return { act: 'indulge', who: '', vice: '', purveyor: '', district: '', res: '', pick: '', attr: '', contact: '', rel: '', project: '' }; }
    function norm(ui) {
      var u = defaults(), x = isObj(ui) ? ui : {};
      Object.keys(u).forEach(function (k) { u[k] = str(x[k]).trim().slice(0, 200); });
      if (!ACT[u.act]) u.act = 'indulge';
      var r = ACT[u.act].res;
      if (r === 'over') { u.res = u.res === 'over' ? 'over' : ''; if (OVER_IDS.indexOf(u.pick) < 0) u.pick = ''; }
      else if (r === 'band') { if (BANDS.indexOf(u.res) < 0) u.res = ''; u.pick = ''; }
      else { u.res = ''; u.pick = ''; }
      if (ATTRS.indexOf(u.attr) < 0) u.attr = '';
      if (u.rel !== 'friend' && u.rel !== 'rival') u.rel = '';
      u.vice = viceKey(u.vice);   /* a vice the tables do not know reads as none: the roll draws one */
      return u;
    }

    /* ---- the activities ---- */
    function indulge(ui, R) {
      var vice = ui.vice || R.pick(VNAMES), V = T.vice[vice];
      var p = purveyor(ui.purveyor, allDistricts);
      var host = p.host || R.fresh(vice + '.hosts', V.hosts), place = p.place || R.fresh(vice + '.places', V.places);
      var district = p.district || ui.district || R.pick(districts), near = p.district || p.near || district;
      var ctx = { host: host, place: place, district: district };
      var lead = split(R.fresh(vice + '.lead', V.lead), ctx), detail = fill(R.fresh(vice + '.detail', V.detail), ctx);
      var ask = fill(R.fresh(vice + '.ask', V.ask), ctx), hook = split(R.fresh(vice + '.hook', V.hook), ctx);
      /* the four options, always drawn and in this order (see the header) */
      var options = OVER_IDS.map(function (id) {
        var O = T.over.filter(function (o) { return o.id === id; })[0];
        var s = split(R.fresh(vice + '.over.' + id, V.over[id]), ctx), o = { id: id, title: O.title, mech: fill(O.mech, ctx), md: s.text, clock: s.clock, source: '' };
        if (id === 'tapped') {
          var mine = normName(ui.purveyor), others = bookPurveyors(vice).filter(function (x) { return normName(x) !== mine && purveyor(x, allDistricts).host !== host; });
          if (others.length) o.source = R.pick(others);
        }
        return o;
      });
      var drawn = R.pick(OVER_IDS);
      var pick = ui.pick || drawn, shown = ui.res === 'over', opt = options.filter(function (o) { return o.id === pick; })[0];
      var where = '**' + cap(place) + '**' + (host && host !== place ? ' · ' + host : '') + (near ? ' · ' + near : '');
      var lines = [{ kind: 'want', id: 'lead', md: lead.text, small: detail }];
      if (shown) lines.push({ kind: 'want', id: 'over', md: '**Overindulged: ' + opt.title + '.** ' + opt.mech, small: opt.md + (opt.source ? ' *A new source to find: ' + opt.source + '.*' : '') });
      var rows = [{ k: 'Where', md: where }, { k: 'Ask', md: ask }, { k: 'Hook', md: hook.text }];
      lines.push({ kind: 'grid', id: 'more', rows: rows });
      var acts = [];
      if (shown && opt.clock) acts.push(opt.clock);
      if (hook.clock) acts.push(hook.clock);
      var chips = [shown ? 'Overindulged' : 'Indulged', vice];
      return {
        lines: lines, chips: chips, clocks: acts,
        title: (ui.who ? ui.who + ' · ' : '') + 'Indulge vice', sub: vice + ' · ' + cap(host === place ? place : host + ', ' + place) + (near ? ' · ' + near : ''),
        label: (ui.who ? ui.who + ' · ' : '') + vice + (shown ? ' · over: ' + opt.title : ''),
        over: { pick: pick, shown: shown, options: options }
      };
    }
    function band(ui) { return ui.res || '45'; }
    function bandChips(ui, extra) {
      var c = [ui.res ? BAND_LABEL[ui.res] : 'before the dice'];
      if (ui.res && extra) c.push(extra(TICKS[ui.res]));
      return c;
    }
    function recover(ui, R) {
      var X = T.recover, b = band(ui), district = ui.district || R.pick(districts);
      var hl = fill(R.fresh('recover.healers', X.healers), { district: district }), healer = hl.split(' — ')[0].trim();
      var ctx = { healer: healer, district: district };
      var lead = fill(R.fresh('recover.band.' + b, X.band[b]), ctx), detail = fill(R.fresh('recover.detail', X.detail), ctx);
      var cost = fill(R.fresh('recover.cost', X.cost), ctx), ask = fill(R.fresh('recover.ask', X.ask), ctx);
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead, small: detail }, { kind: 'grid', id: 'more', rows: [{ k: 'Healer', md: cap(hl.replace(' — ', ': ')) }, { k: 'They want', md: cap(cost) + '.' }, { k: 'Ask', md: ask }] }],
        chips: bandChips(ui, function (n) { return 'healing +' + n; }), clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Recover', sub: cap(healer), label: (ui.who ? ui.who + ' · ' : '') + 'Recover' + (ui.res ? ' ' + BAND_LABEL[ui.res] : '')
      };
    }
    function project(ui, R) {
      var X = T.project, b = band(ui), name = ui.project || 'the project';
      var who = R.fresh('project.who', X.who), lead = fill(R.fresh('project.band.' + b, X.band[b]), { project: name }), ask = R.fresh('project.ask', X.ask);
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead, small: '' }, { kind: 'grid', id: 'more', rows: [{ k: 'Who', md: cap(who) }, { k: 'Ask', md: ask }] }],
        chips: bandChips(ui, function (n) { return '+' + n + ' on the clock'; }), clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Project' + (ui.project ? ': ' + ui.project : ''), sub: ui.project ? 'Long-term project' : 'Long-term project · name it on the sheet',
        label: (ui.who ? ui.who + ' · ' : '') + 'Project' + (ui.res ? ' ' + BAND_LABEL[ui.res] : '')
      };
    }
    function train(ui, R) {
      var X = T.train, attr = ui.attr || R.pick(ATTRS), district = ui.district || R.pick(districts);
      var who = R.fresh('train.who', X.who), ctx = { who: who, district: district };
      var lead = fill(R.fresh('train.attr.' + attr, X.attr[attr]), ctx), ask = fill(R.fresh('train.ask', X.ask), ctx);
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead, small: '' }, { kind: 'grid', id: 'more', rows: [{ k: 'Ask', md: ask }] }],
        chips: [attr, '+1 xp'], clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Train', sub: 'With ' + who, label: (ui.who ? ui.who + ' · ' : '') + 'Train ' + attr
      };
    }
    function contact(ui, R) {
      var X = T.contact, rel = ui.rel || R.pick(['friend', 'rival']), kind = R.pick(KINDS[rel]);
      var line = ui.contact, name = str(line).split(',')[0].trim(), what = str(line).split(',').slice(1).join(',').trim();
      if (!name) name = rel === 'friend' ? 'an old friend' : 'an old rival';
      var district = ui.district || R.pick(districts), ctx = { contact: name, district: district };
      var lead = split(R.fresh('contact.' + rel + '.' + kind, X[rel][kind]), ctx), ask = fill(R.fresh('contact.ask', X.ask), ctx);
      var rows = [{ k: 'Ask', md: ask }];
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead.text, small: '' }, { kind: 'grid', id: 'more', rows: rows }],
        chips: [rel === 'friend' ? 'Friend' : 'Rival'], clocks: lead.clock ? [lead.clock] : [],
        title: (ui.who ? ui.who + ' · ' : '') + (rel === 'friend' ? 'Friend' : 'Rival') + ': ' + cap(name), sub: what ? cap(what) : (rel === 'friend' ? 'A friend' : 'A rival') + ' calls',
        label: (ui.who ? ui.who + ' · ' : '') + cap(name)
      };
    }
    function heat(ui, R) {
      var X = T.heat, b = band(ui), district = ui.district || R.pick(districts);
      var ctx = { cover: R.fresh('heat.cover', X.cover), district: district };
      var lead = fill(R.fresh('heat.lead', X.lead), ctx), cost = fill(R.fresh('heat.cost', X.cost), ctx), ask = fill(R.fresh('heat.ask', X.ask), ctx);
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead, small: ui.res ? X.band[b] : '' }, { kind: 'grid', id: 'more', rows: [{ k: 'Cost', md: cost }, { k: 'Ask', md: ask }] }],
        chips: bandChips(ui), clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Lay low', sub: 'Cooling things down', label: (ui.who ? ui.who + ' · ' : '') + 'Lay low' + (ui.res ? ' ' + BAND_LABEL[ui.res] : '')
      };
    }
    function acquire(ui, R) {
      var X = T.acquire, b = band(ui), district = ui.district || R.pick(districts);
      var seller = fill(R.fresh('acquire.seller', X.seller), { district: district });
      var how = R.fresh('acquire.band.' + b, X.band[b]), ask = R.fresh('acquire.ask', X.ask);
      return {
        lines: [{ kind: 'want', id: 'lead', md: 'From ' + seller + '.', small: ui.res ? how : 'Roll, then tap the result for how it goes.' }, { kind: 'grid', id: 'more', rows: [{ k: 'Ask', md: ask }] }],
        chips: bandChips(ui), clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Acquire', sub: 'Getting hold of something', label: (ui.who ? ui.who + ' · ' : '') + 'Acquire' + (ui.res ? ' ' + BAND_LABEL[ui.res] : '')
      };
    }
    var BUILD = { indulge: indulge, recover: recover, project: project, train: train, contact: contact, heat: heat, acquire: acquire };

    function roll(ui, run) {
      run = run || {};
      ui = norm(ui);
      var seed = run.seed != null ? run.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
      var mem = isObj(run.mem) ? run.mem : MEM;
      var before = clone(mem);
      var c = BUILD[ui.act](ui, drawer(seedRng(seed), mem));
      var actions = c.clocks.map(function (k) { return { label: 'Start a clock: ' + k.name + ' (' + k.size + ')', intent: { type: 'clock', name: k.name, size: k.size } }; });
      var all = [c.title, c.sub, c.chips.join(' · ')];
      c.lines.forEach(function (l) {
        if (l.kind === 'grid') l.rows.forEach(function (r) { all.push(r.k + ': ' + plain(r.md)); });
        else { all.push(plain(l.md)); if (l.small) all.push(plain(l.small)); }
      });
      var meta = { id: 'downtime', act: ui.act, title: c.title, sub: c.sub, chips: c.chips, text: plain(c.lines[0].md), all: all, label: c.label.slice(0, 80), actions: actions };
      var out = { lines: c.lines, meta: meta, seed: seed, replay: { id: 'downtime', seed: seed, mem: before, ui: ui } };
      if (c.over) out.over = c.over;
      return out;
    }
    return {
      ACTS: ACTS.map(function (a) { return { id: a.id, label: a.label, short: a.short, res: a.res }; }),
      VICES: VNAMES.slice(),
      ATTRS: ATTRS.slice(),
      defaults: defaults,
      roll: roll,
      replay: function (r) { return roll(r.ui, { seed: r.seed, mem: clone(r.mem) }); },
      mem: function () { return MEM; }
    };
  }

  return { create: create, check: check, seedRng: seedRng, plain: plain, purveyor: purveyor, TABLES: TABLES, ID: 'downtime',
    BANDS: BANDS.slice(), BAND_LABEL: clone(BAND_LABEL), TICKS: clone(TICKS) };
});
