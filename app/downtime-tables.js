/* downtime-tables.js — the Downtime generator's tables (app/gm/downtime.js draws from them): scene prompts for personal
   business at the table. Original writing, no book text. Public content, like content.js: it carries the setting's
   names (districts, the watch, the purveyors), which is why it lives here and not in app/gm/, whose files hold logic
   only and are checked for names (checks/runtime/gm-nosecrets.test.mjs). The GM bundle loads it before gm/downtime.js.
   Plain script, UMD: window.B68DowntimeTables = { T, PLACES } in the browser, module.exports under Node.

   T       the tables (checked by B68GmDowntime.check(T)); a pack part `downtime` may replace any of them later.
   PLACES  the book's purveyors (content.js VICES, keyed by the line as printed) as [who you deal with, where], so that
           "at {place}" reads right; a line a player typed is read by the module's parser instead. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68DowntimeTables = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =================================================================================================================
     The tables. Slots: {host} {place} {district} {contact} {healer} {who} {cover} {project}; a capital first letter
     ({Host}) capitalises the value, {host's} makes it possessive. A line ending " || Name (6)" suggests a clock (size
     4 when the brackets are left off). Prompts speak to the PC ("you"); hosts are never given a gender.
     ================================================================================================================= */
  var T = {
    districts: ['Brightstone', 'Charhollow', 'Charterhall', 'Coalridge', 'Crowfoot', 'the Docks', 'Nightmarket', 'Silkshore',
      'Six Towers', 'Whitecrown', 'New Horizon', 'Barrowcleft'],

    /* the six ways an overindulgence goes: the mechanical line (in our words; the book has the rule). `lost` keeps its
       id from the first version, so a stored card still replays; the book calls it a bender */
    over: [
      { id: 'trouble', title: 'Attract trouble', mech: "Trouble follows you home: one more Crew or Local Trouble. Roll it, or use this one." },
      { id: 'decision', title: 'Bad decision', mech: "You made a bad call: the GM ticks a clock of their choice, a rival's, a faction's or the ticking timebomb." },
      { id: 'lost', title: 'Bender', mech: "Gone on a bender for weeks: play another character until this one surfaces. They come back with their harm healed." },
      { id: 'brag', title: 'Brag', mech: "You talked about the crew's business: +2 heat." },
      { id: 'brawl', title: 'Brawl', mech: "You fought people you shouldn't have: −1 status with their faction, or mark level 2 harm." },
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
          ],
          decision: [
            "You named someone in confession: a person the crew needs kept quiet. {Host} knows exactly who to pass it to.",
            "Carried away by the sermon, you promised the congregation the crew would deal with their landlord. The landlord has heard.",
            "You gave {host} the crew's address, for the prayer list."
          ],
          brawl: [
            "A heckler mocked the service, and you put him through the collection table. His friends wear colours.",
            "You took the lectern from a rival preacher by force, and {host} had to pull you off.",
            "Two congregations argued over the hall at {place}. You settled it, badly."
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
          ],
          decision: [
            "You staked the details of the crew's next job on a hand, and lost them to the table.",
            "To cover a marker, you told {host} when the crew will be out of the lair.",
            "You backed a fixed race with the wrong people's money. They'll want to know who placed the bet."
          ],
          brawl: [
            "You called the dealer a cheat, and the house answered for them, with its fists.",
            "A sore loser at {place} called you a cheat. You argued the point with a chair.",
            "You fought one of {host's} runners over a slip that wasn't worth the paper."
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
          ],
          decision: [
            "You took a table at a charity dinner under the crew's real name.",
            "To get the suite, you gave {host} a reference: the crew's fence, by name.",
            "You bid against someone dangerous at an auction, and won. They remember your face."
          ],
          brawl: [
            "Someone at {place} sat at your table. You explained whose table it was, with the wine bottle.",
            "A member blackballed you, so you blacked his eye in the cloakroom.",
            "You fought a society photographer for the film. The pictures of the fight came out better."
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
          ],
          decision: [
            "You promised the union the crew would stand with them on the picket line. The other side heard you say it.",
            "Your family needed money, so you told {host} where the crew keeps its own.",
            "You told the old neighbourhood who's really behind the sweeps. Some of them will repeat it."
          ],
          brawl: [
            "Someone insulted your family at {place}. You settled it the old way.",
            "The new crew on the block laughed at {host}. You stopped them laughing.",
            "A family argument became a fight in the stairwell, and the neighbours called it in."
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
          ],
          decision: [
            "You brought a new lover back to the lair. They saw everything.",
            "Showing off for {host}, you promised a favour the crew can't afford to give.",
            "You gave a stranger a lift home in a crew car, and they kept the keys."
          ],
          brawl: [
            "Someone cut in on your dance at {place}. You cut back.",
            "{Host's} other admirer took exception to you. The bouncers took exception to you both.",
            "A heckler talked through the whole set, so you stopped him with the microphone stand."
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
          ],
          decision: [
            "You fronted the crew's money to {host} for a shipment that is never coming.",
            "Out of your skull, you told the room who the crew's next target is.",
            "You let {host} keep something at the lair, just for one night. It's still there."
          ],
          brawl: [
            "You climbed into somebody else's fight at {place}, and finished it.",
            "The doorman wouldn't let you back in, so you went through him.",
            "You woke up with split knuckles and someone's teeth marks in your hand. Their crew remembers whose."
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
          ],
          decision: [
            "In the séance you asked the spirits about the crew's next job, out loud. Someone in the circle was taking notes.",
            "You lent {host} the strangest thing the crew owns, for an experiment.",
            "You signed {host's} register: your name, your address, and what you've seen."
          ],
          brawl: [
            "A sceptic at {place} called it all a fraud. You argued the point with your fists.",
            "You fought something in the dark at {place}. You won, but the members saw what it was.",
            "A rival circle broke up the meeting, and you led the charge that threw them out."
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

  var PLACES = {
    "Ankhuset, the Kethrys Lodge, Silkshore": ["Ankhuset", "the Kethrys Lodge"],
    "Supreme Director of Guidance, the New Dawn Center, Six Towers": ["the Supreme Director of Guidance", "the New Dawn Center"],
    "Preceptor Aldo, the Sanctorium grand cathedral, Brightstone": ["Preceptor Aldo", "the Sanctorium"],
    "Prichard, Librarian at Morlan Hall’s Restricted Collection, Charterhall": ["Prichard", "the Restricted Collection"],
    "Bug’s five-card braggart game, the Docks": ["Bug", "Bug's braggart game"],
    "Remira, wrestling, Charhollow": ["Remira", "the wrestling hall"],
    "Karter, the Sky High casino, above Doskvol": ["Karter", "the Sky High casino"],
    "Marek, the Iruvian Sands casino, Silkshore": ["Marek", "the Iruvian Sands"],
    "Vesper, bookmaker at the Vreen Autodrome, Nightmarket": ["Vesper", "the Vreen Autodrome"],
    "Sybil Bexley, Paddles private members’ club, Whitecrown": ["Sybil Bexley", "Paddles"],
    "Songbird, Sapphire Lounge, Silkshore": ["Songbird", "the Sapphire Lounge"],
    "Diamond, Diamond Palace, Nightmarket": ["Diamond", "the Diamond Palace"],
    "Dunridge & Sons old-fashioned tailoring, Nightmarket": ["old Dunridge", "Dunridge & Sons"],
    "Jeduin’s fashionable clothing boutique, Nightmarket": ["Jeduin", "Jeduin's boutique"],
    "Chef Kalani, Dagger Room restaurant, Brightstone": ["Chef Kalani", "the Dagger Room"],
    "Chef Lisanne, Golden Plum restaurant, Six Towers": ["Chef Lisanne", "the Golden Plum"],
    "Family members (heritage) or former co-workers (background)": ["your family", "home"],
    "Carro “Cake” Danfield, Iron Weightlifting gym, Crowfoot": ["Cake Danfield", "the Iron gym"],
    "Ms. Asta, Blackthorn Park controller, the Docks": ["Ms. Asta", "Blackthorn Park"],
    "Prichard, Palace handler, Charterhall": ["Prichard", "the Palace"],
    "Director of Success, the New Dawn Center, Six Towers": ["the Director of Success", "the New Dawn Center"],
    "Helda, Skovlander community leader, New Horizon": ["Helda", "the Skovlander community hall"],
    "Benson, the Black Goat tavern, the Docks": ["Benson", "the Black Goat"],
    "Rennie, the Eyrie underground lounge bar, Crowfoot": ["Rennie", "the Eyrie"],
    "Lemmy’s smoking room and kaff house, Charhollow": ["Lemmy", "Lemmy's smoking room"],
    "Amara, the Key Club, Silkshore": ["Amara", "the Key Club"],
    "Alfie’s Adult Plasmocinema, Crowfoot": ["Alfie", "the Plasmocinema"],
    "The Silver Echoes, Groove Factory, Crowfoot": ["the Silver Echoes' singer", "the Groove Factory"],
    "Harald Tipton, the House of Tomorrow black lotus den, New Horizon": ["Harald Tipton", "the House of Tomorrow"],
    "Rasp, powder dealer, New Horizon": ["Rasp", "Rasp's stairwell"],
    "Lorna, Xantara Pharm Pill Dispensary, Nightmarket": ["Lorna", "the Xantara Pharm dispensary"],
    "Milos, president of the Plasmovision Social Club, Charhollow": ["Milos", "the Plasmovision Social Club"],
    "Brainwave-60, a sparkmind construct and expert redcheck player, Charterhall": ["Brainwave-60", "the redcheck tables"],
    "Blargo the Goblin, Tycherosi airship pilot, Nightmarket": ["Blargo", "Blargo's airship"],
    "Maymuun, wayfarer and deathlands guide, Gaddoc Monorail Station": ["Maymuun", "Gaddoc Monorail Station"],
    "Mysticus, a cursed animatronic sideshow attraction, Silkshore": ["Mysticus", "Mysticus's booth"],
    "Wilka Eadon, the God Experience art installation, Silkshore": ["Wilka Eadon", "the God Experience"],
    "Captain Laudius Blanchet, Void Sea Aquarium, the Docks": ["Captain Blanchet", "the Void Sea Aquarium"]
  };

  return { T: T, PLACES: PLACES };
});
