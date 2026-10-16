/* downtime-tables.js — the Downtime generator's tables (app/gm/downtime.js draws from them): scene prompts for personal
   business at the table. Original writing, no book text. Public content, like content.js: it carries the setting's
   names (districts, the watch, the purveyors), which is why it lives here and not in app/gm/, whose files hold logic
   only and are checked for names (checks/runtime/gm-nosecrets.test.mjs). The GM bundle loads it before gm/downtime.js.
   Plain script, UMD: window.B68DowntimeTables = { T, PLACES } in the browser, module.exports under Node.

   T       the tables (checked by B68GmDowntime.check(T)); a pack part `downtime` may replace any of them later. The
           Morning After's Benefits and Mishaps (T.benefit, T.mishap) are never here: they come from a zine for personal
           use, so only the private pack part carries them.
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
     4 when the brackets are left off). Prompts speak to the PC ("you"); hosts are never given a gender. A line in
     *"quotes"* is what someone says to the PC: the GM reads it aloud, and stops.
     ================================================================================================================= */
  var T = {
    districts: ['Brightstone', 'Charhollow', 'Charterhall', 'Coalridge', 'Crowfoot', 'the Docks', 'Nightmarket', 'Silkshore',
      'Six Towers', 'Whitecrown', 'New Horizon', 'Barrowcleft'],

    /* the six ways an overindulgence goes: the mechanical line (in our words; the book has the rule), shown beside the
       Mishap that names it. `lost` keeps its id from the first version; the book calls it a bender */
    over: [
      { id: 'trouble', title: 'Attract trouble', mech: "Trouble follows you home: one more Crew or Local Trouble, the one the card names or the GM's pick." },
      { id: 'decision', title: 'Bad decision', mech: "You made a bad call: the GM ticks a clock of their choice, the one the card names or the ticking timebomb." },
      { id: 'lost', title: 'Bender', mech: "Gone on a bender for weeks: play another character until this one surfaces. They come back with their harm healed." },
      { id: 'brag', title: 'Brag', mech: "You talked about the crew's business: +2 heat." },
      { id: 'brawl', title: 'Brawl', mech: "You fought people you shouldn't have: −1 status with their faction, or mark level 2 harm." },
      { id: 'tapped', title: 'Tapped', mech: "{Host} cuts you off: find a new source for your vice." }
    ],

    /* each vice: where it happens and who supplies it (when the sheet doesn't say), the night (a picture, then the line
       someone says to the PC: the GM reads it and the scene has started), a sense detail, a question for the player, and
       a thread to pull later. What the night costs or leaves is the Morning After's (the pack's Benefits and Mishaps). */
    vice: {
      'Faith': {
        places: ['a storefront chapel', 'the cathedral', 'a meditation centre over a launderette', 'a candlelit basement temple'],
        hosts: ['the preacher', 'the guru', 'the old priest', 'the group leader'],
        lead: [
          "The service at {place} runs long. {Host} picks you out from the front. *\"Stand up. Tell them what you gave up this week.\"*",
          "{Host} takes both your hands at the door and asks after what you confessed last time. *\"Did you make it right? Tell me you made it right.\"*",
          "An all-night vigil at {place}, and the stranger beside you knows every word. Near dawn she leans over. *\"You've been away a long time, haven't you?\"*",
          "{Host} has a new teaching, typed and stapled, and your name is in the thanks. *\"Chapter three is about you. Don't be modest.\"*",
          "The circle at {place} goes round one by one. When it reaches you, everyone waits, and {host} smiles. *\"Take your time. We have all night.\"*",
          "{Host} hands you the collection box, and it's heavier than it should be. *\"Carry it to the back room. Don't stop for anyone.\"*",
          "You light a candle at {place} for someone the crew has never heard of. {Host} lights one beside it. *\"I pray for them too, you know.\"*",
          "A Bluecoat sergeant is crying two rows in front of you. Afterwards {host} steers you both to the tea urn. *\"You two should talk.\"*"
        ],
        detail: ["Incense, floor polish and wet wool.", "A choir on a reel-to-reel, the tape slightly stretched.",
          "Folding chairs, a tea urn, a banner with half its letters peeled off.", "Candle wax on your cuffs for days after.",
          "A hymn book with notes in the margins in your own handwriting.", "The hum of electroplasmic lamps under the singing."],
        ask: ["What do you ask for, when nobody else can hear?", "Who here would be disappointed to learn what you do for a living?",
          "What do you put in the collection, and where did it come from?", "Which teaching can't you make yourself believe?",
          "Who first brought you here?", "What do you promise tonight, and do you mean it?"],
        hook: [
          "{Host} asks you to carry a sealed letter to someone in {district}, unread. *\"It's a blessing. Mostly.\"* || {Host's} letter (4)",
          "A believer recognises you from somewhere you shouldn't have been, and smiles all through the hymn.",
          "New Dawn recruiters were at the back of {place} tonight, taking names, and {host} is frightened of them. || New Dawn at {place} (4)",
          "{Host} has been asking the faithful about your crew, and writing the answers down.",
          "Someone is skimming the offering. {Host} wants you to find out who. *\"Better you than the Bluecoats.\"* || Who's skimming at {place} (4)",
          "Foundation surveyors are measuring the street, and {host} has turned down their offer for {place} twice. || The Foundation wants {place} (6)"
        ]
      },

      'Gambling': {
        places: ['a back-room card game', 'the dog track', 'a dice game behind the bus depot', 'the casino'],
        hosts: ['the dealer', 'the bookie', 'the croupier', 'the one who runs the game'],
        lead: [
          "{Host} has a seat for you before you ask, and the pot is bigger than your cut of the last score. *\"You're good for it. Aren't you?\"*",
          "The board at {place} clacks over and {host} leans in close. *\"Fourth race. The grey. Don't ask me how I know.\"*",
          "You're up, way up, and the house has noticed. A drink you didn't order arrives. *\"Compliments of the management. They'd like you to stay.\"*",
          "Three hands in, a stranger buys in with a house deed instead of cash, and pushes it at you. *\"It's a good house. Play me for it.\"*",
          "{Host} lets you run a tab tonight, which they have never done before. *\"Don't worry about it. Worry about it later.\"*",
          "You lose five in a row and win the sixth, and the man you beat won't stop staring. *\"Again. Double. Unless you're scared.\"*",
          "You're nearly sure {host} is cheating, and {host} knows you know. They deal you a winner anyway. *\"There. Now we're friends.\"*",
          "The last bet of the night is about you: whether you'll take it. {Host} slides the dice across. *\"Your call. Everybody's waiting.\"*"
        ],
        detail: ["Cigarette smoke under green lamps, the clack of chips.", "The roar of the crowd arriving a second after the autopods.",
          "A sticky felt table and a radio calling the results.", "Brass fittings, thick carpet, a dealer who doesn't blink.",
          "The sour smell of a room that's losing.", "Your lucky coin, warm from your hand."],
        ask: ["What's your tell, and who at the table has noticed it?", "What do you bet that you can't afford to lose?",
          "Who taught you this game?", "When do you know it's time to walk away, and do you?", "What would you do with the big win?",
          "Who are you trying not to think about while you play?"],
        hook: [
          "A Ministry of Stability clerk lost big to you, and he'd like to pay in nutriwafer depot keys.",
          "{Host} wants you to throw a game next week. *\"You lose, I win, we both eat.\"* || {Host's} fix (4)",
          "You won a marker off someone in the Keel Twins' crowd, and they want it back, quietly. || The Keel marker (4)",
          "A Gallo collector has watched you win all night. *\"The family likes a winner. Come and meet them.\"*",
          "Word at the tables: Strangford-Michter money is washing through {place}.",
          "A kid who runs slips for {host} wants out, and asks you how. *\"You got out. Didn't you?\"*"
        ]
      },

      'Luxury': {
        places: ['the best restaurant that will seat you', "a tailor's back room", 'a hotel suite', 'a members-only club'],
        hosts: ["the maître d'", 'the tailor', 'the concierge', 'the club secretary'],
        lead: [
          "{Host} has saved you the table where everyone sees you sit down. *\"They've all been asking who you are. I said I couldn't possibly say.\"*",
          "A fitting at {place}: {host} circles you with a mouthful of pins. *\"Stand still. The cut is everything. The cut is who you are.\"*",
          "Champagne, oysters and a bill you don't read. {Host} folds it away. *\"On the house. It's never on the house. You know that.\"*",
          "You take a suite just to look down at the city you robbed. The concierge lingers. *\"Lovely view. Some guests find it gives them ideas.\"*",
          "{Host} shows you something imported, one of three in the city. *\"A Council member has another. You'd be in good company.\"*",
          "The valet at {place} knows your name and your autopod. *\"Evening. Same spot as usual? I keep it clear for you.\"*",
          "By the seventh course at {place} you've forgotten the job. {Host} bends down. *\"The gentleman at table nine has paid for your dessert.\"*",
          "You walk into {place} dressed better than the people who own it, and they notice. *\"Wherever did you get that? No, don't tell me. Tell me.\"*"
        ],
        detail: ["Velvet, cologne and a quartet playing something you almost know.", "Starched linen, a hundred candles, the hush of money.",
          "Silk that feels like cold water.", "The pop of a society photographer's flashbulb.", "A bill folded on a silver plate.",
          "A doorman in white gloves holding the door a moment too long."],
        ask: ["What do you buy that you'll never use?", "Who are you dressing for?", "What did you go without, growing up?",
          "What do you tell people here you do?", "Who in this room would you most like to impress, and who do they think you are?",
          "What's the one thing you'd never sell?"],
        hook: [
          "A society photographer got you with someone you shouldn't be seen with, and the Evening Whisper would pay for it.",
          "{Host} introduces you to a buyer who wants something stolen to order. *\"Discretion. Taste. A Whitecrown address.\"*",
          "A dowager at the next table is wearing a necklace you recognise from a job.",
          "{Host} is behind on rent to the Foundation, and asks whether you know anyone. *\"Anyone at all.\"* || {Host's} rent (4)",
          "The ledger at {place} holds the measurements, tastes and addresses of half the City Council.",
          "Someone at {place} paid your bill. They haven't said what they want yet. || Your secret benefactor (4)"
        ]
      },

      'Obligation': {
        places: ["your family's flat", 'the union hall', 'the community centre', 'the old neighbourhood'],
        hosts: ['your family', 'your oldest friend', 'the community elder', 'your old foreman'],
        lead: [
          "Sunday dinner with {host}, and everybody asks what you do now. *\"And you're eating properly? You're not. Look at you.\"*",
          "{Host} needs hands: a roof, a shift, a cousin to collect. *\"I wouldn't ask. You know I wouldn't ask. I'm asking.\"*",
          "A day at {place} doing the work nobody pays for, and your hands know exactly what to do. *\"You've still got it. Admit you miss it.\"*",
          "{Host} sits you down and looks at you properly for the first time in weeks. *\"Show me where it hurts. No, where it really hurts.\"*",
          "A wake at {place}, and {host} wants you to say a few words about the dead. *\"You knew her best. Don't pull that face.\"*",
          "You sit up with {host} through a night of bad news. Near dawn, they say it. *\"I need you to stop. For a while. Can you do that for me?\"*",
          "The meeting at {place} runs past midnight, and {host} keeps looking at you. *\"Well? You're the one who knows people.\"*",
          "{Host} has your parcel ready, the same as always, and a list of reasons you shouldn't need it. *\"Next time we talk about it. Properly.\"*"
        ],
        detail: ["Cabbage on the stove and the radio too loud.", "A gym that smells of chalk and liniment.",
          "Folding chairs, a tea urn, children underfoot.", "A photograph on the wall with you in it, younger.",
          "Calloused hands shaking yours.", "A union banner over the door, mended twice."],
        ask: ["Who do you send money to, and do they know where it comes from?", "What do they still call you here?",
          "What did you promise, a long time ago, that you're still keeping?", "Who here would you die for?",
          "What do they need that you can't give them?", "What's the lie you tell them about the crew?"],
        hook: [
          "{Host} is being leaned on by the Keel Twins, and hasn't told you. || The squeeze on {host} (4)",
          "A cousin wants to join the crew. *\"I can drive. I can lie. I can do both at once.\"*",
          "Someone from the old life saw you on a job, and they've told {host}.",
          "{Host} asks you to find someone who went missing in {district}. *\"The Bluecoats won't look. You will.\"* || Finding {host's} missing one (6)",
          "The community's money has gone, and everyone is looking at the newcomer.",
          "{Host} has kept something of yours that would hang you, if anyone ever found it."
        ]
      },

      'Pleasure': {
        places: ['a lounge bar', 'a jazz club', 'a supper club', 'a late-night picture house'],
        hosts: ['the bartender', 'the singer', 'your lover', 'the owner'],
        lead: [
          "The band at {place} plays your song before your first drink is done. {Host} shrugs. *\"What? They take requests. Somebody requested it.\"*",
          "{Host} pours without asking and sits down across from you, which they never do. *\"Go on, then. Tell me what's wrong. You've got the face.\"*",
          "A long night at {place}, and a booth you don't remember sliding into. The stranger beside you raises a glass. *\"To whatever you're running from.\"*",
          "{Host} has something new for you to try, and wants to watch your face when you do. *\"Close your eyes. No peeking. Trust me.\"*",
          "Somebody you used to love is at the bar of {place}, and they've seen you. *\"Of course you're here. Where else would you be?\"*",
          "The lights go down at {place}, and for once nobody knows what you do for a living. *\"No names in here. House rules. Even yours.\"*",
          "{Host} keeps the kitchen open late just for you. *\"Eat. You look like a ghost. Don't tell me you're not hungry.\"*",
          "The double feature runs past two, and you don't watch the second film. A whisper, close. *\"We'll have to come back and see how it ends.\"*"
        ],
        detail: ["Electric organ and spilled beer.", "A mirror ball throwing coins of light across the ceiling.",
          "Kaff so strong it tastes of smoke.", "Someone's perfume on your collar.", "A needle crackling on a record before the song.",
          "Red light, a low ceiling, the bass in your ribs."],
        ask: ["Who do you go home with, or who do you wish you had?", "What do you order, and what does it remind you of?",
          "What do you get to forget here, for a while?", "Who would be surprised to see you here?",
          "What song makes you leave the room?", "What's the best thing you've tasted this year?"],
        hook: [
          "Last night's company has a sister in the Bluecoats, and she has been asking about you.",
          "{Host} is selling up, and the buyer is the Lounge Rats. *\"It's a good offer. That's what frightens me.\"*",
          "The band needs protection for a run of shows in {district}. || The band's protection (4)",
          "The bartender at {place} hears everything, and has started selling it to Ink Lane.",
          "Someone slipped something into a drink at the next table, and you saw who.",
          "{Host} asks you to keep a regular out of trouble, quietly. *\"He runs for the Keels. He doesn't know I know.\"*"
        ]
      },

      "Gettin' Fucked Up": {
        places: ['a dive bar', 'the fight pits', 'a lotus den', "a dealer's flat"],
        hosts: ['the bartender', 'your dealer', 'the promoter', 'the doorman'],
        lead: [
          "{Host} sets out the first one, and you don't remember the third. *\"Slow down. No, I'm joking. Keep up.\"*",
          "The fight pit under {place}: you're not watching, you're in it, and you're winning. The promoter lifts your wrist. *\"Who's next? Who wants a go?\"*",
          "Black lotus at {place}. The ceiling folds open and the city goes quiet. Somebody far away is saying your name. *\"Stay with us. Hey. Stay with us.\"*",
          "{Host} has something new, cut with something newer, and pushes it across. *\"You first. I want to see what it does.\"*",
          "Three bars across {district}, ending somewhere with sawdust on the floor and a bird in a cage. The bird talks. *\"Last orders! Last orders!\"*",
          "{Host} counts out your usual, then a few more. *\"For the weekend. You won't thank me, but you should.\"*",
          "You wake on the roof of {place}, coat gone, knuckles split, grinning. Someone sits beside you. *\"You said you'd explain when bluetime came on. It's on.\"*",
          "Somebody at {place} bets you can't finish the bottle, and the whole room is counting. *\"Ten! Nine! Eight!\"*"
        ],
        detail: ["Smoke so thick the lamps wear halos.", "Sawdust, blood and spilled spirits.", "The tick of a cooling radiator, the taste of metal.",
          "A pill bottle with someone else's name on it.", "Your ears ring for a day afterwards.", "The sweet, rotten smell of black lotus."],
        ask: ["What are you trying not to feel?", "Who usually gets you home?", "What's the last thing you remember?",
          "Who did you call, and what did you say?", "What's in your pockets when you wake up?", "Whose blood is it?"],
        hook: [
          "{Host's} supply is coming from somewhere new: SCORPION black lotus, and dangerous. || {Host's} new supplier (4)",
          "You wake up with a key you don't recognise and an address in {district}.",
          "Somebody at {place} saw you out cold, and took your picture.",
          "The pit's promoter wants you back, for real money. *\"Friday. You, a D-13 boy, and a crowd.\"*",
          "A kid who sold to you is about to get hurt by the people above them.",
          "You said yes to something last night. You don't know what. Someone else does. || What you agreed to (4)"
        ]
      },

      'Weird': {
        places: ['a fringe-science society', 'a séance parlour', 'an occult bookshop', 'the aquarium after hours'],
        hosts: ['the medium', 'the scientist', 'the bookseller', 'the keeper'],
        lead: [
          "{Host} kills the lights and tunes the set to a channel that isn't there. Something on the screen looks back. *\"Don't wave. It hates it when you wave.\"*",
          "A game with {host} that takes all night. You think you won. *\"You did win. That's the worrying part.\"*",
          "{Host} takes you past the last streetlight to hear the deathlands sing. *\"Hear that? That's them. They know your name now.\"*",
          "The thing in the glass tank at {place} turns to watch you pass, and {host} goes very still. *\"It does that for very few people.\"*",
          "The room at {place} has no corners. An hour passes like a minute, and {host} checks your pulse. *\"You were gone a long time. Where did you go?\"*",
          "{Host} asks you to hold a wire and not let go, whatever you hear. *\"Whatever you hear. Even if it's someone you know.\"*",
          "A séance at {place}, a tape running. On playback there's an extra voice, and it's talking to you. *\"You were there. You know what they did.\"*",
          "Tonight the dead are close at {place}, close enough to whisper, and one of them leans in. *\"You're not from here either. Are you?\"*"
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
          "A Section 6 car has been parked outside {place} three nights running.",
          "{Host} needs a part for an experiment, and it's in a Mirror House lab in {district}. *\"They won't miss it for weeks.\"*",
          "You came away with a phrase in a language nobody speaks, and the Kethrys Lodge would love to hear it.",
          "Something followed you home from {place}. || What followed you home (4)"
        ]
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
