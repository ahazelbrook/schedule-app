// The seat registry (build plan, "The seat roster"). Model and effort live here and nowhere else, so an effort sweep is a
// one-line change. These instructions are generic on purpose: this repository is public, so nothing campaign-specific
// goes in them. Names, NPC cards and prep arrive in the cached prefix, which the replay reads from the GM's vault.

const FLAGS = ['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'];

// One action roll, as the Night Shift records it (the sorters and the single-call variant share it). Every roll keeps its
// own position and dots so the xp tally never has to guess them later. dots is -1 when the text does not say.
export const ROLL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    at: { type: 'string', description: 'the [HH:MM] stamp' },
    who: { type: 'string', description: 'the acting character' },
    action: { type: 'string', description: 'the action rolled and what it was for' },
    position: { type: 'string', enum: ['controlled', 'risky', 'desperate', 'unclear'] },
    effect: { type: 'string', enum: ['limited', 'standard', 'great', 'unclear'] },
    dots: { type: 'integer', description: 'dots in the action rated; 0 means a zero-dot roll; -1 when not stated' },
    pushed: { type: 'boolean', description: 'true when stress was spent to push the roll' },
    result: { type: 'string', enum: ['critical', 'full', 'partial', 'miss', 'unclear'] },
  },
  required: ['at', 'who', 'action', 'position', 'effect', 'dots', 'pushed', 'result'],
};
const ROLL_RULES = `rolls: EVERY action, resistance or fortune roll in the text, in order. For each: the acting character, the action and what it was for, the position (controlled, risky, desperate) and effect as the table stated them (unclear if never said), the dots in the action (0 for a zero-dot roll, -1 if not stated), whether it was pushed, and the result band (critical, full, partial, miss, unclear). If a value is not in the text, use unclear or -1; never guess.`;

export const SEATS = {
  tripwire: {
    model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1500,
    instructions: `You listen to a live tabletop RPG game (Blades '68) as speech-to-text, one minute at a time. Speaker labels and spellings are unreliable. Set a flag only for what is plainly in THIS minute's text.
Flags: roll_talk (ONLY when a roll is being set up or resolved right now: dice picked up or thrown, a result read out, or position/effect called for a specific roll. Talking about rules, past rolls or what a character might do is false), harm (harm is being given, marked, resisted or its effects ruled on right now. Mere mentions of injury in the story are false), npc_change (a different NPC starts speaking or is introduced), new_name (a made-up in-fiction character's name is spoken that is not in the cast list in your context. Real people, actors, film characters and the players' own names are false), clue_mention (a clue, secret or theory about the mystery is said), xp_trigger (xp, desperate or zero-dot rolls, the close of the score or session), scene_change (the scene or location changes), stall (the table has stopped or is going in circles, and ONLY then: the same proposal or options repeated with no decision, a long silence, an open "what do we do?" that nobody answers, or side-chatter replacing play. Normal planning, debate that is moving toward a choice, rules questions, a roll being worked out and banter during action are all false).
Prefer false: most minutes have no flags at all. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: Object.fromEntries(FLAGS.map(f => [f, f === 'stall'
        ? { type: 'boolean', description: 'true only when play has stopped or is going in circles: repeated proposals with no decision, long silence, an unanswered "what do we do?", or side-chatter replacing play; false for planning that is moving, rules questions and banter during action' }
        : { type: 'boolean' }])),
      required: FLAGS,
    },
  },

  ref: {
    model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 3000,
    instructions: `You are the rules referee for a Blades '68 game, watching the last few minutes of a live transcript. Using ONLY the rules reference in your context, decide whether the GM or players just made a rules slip that would change play: a wrong harm penalty, wrong resistance attribute, wrong complication dice, position or effect set after the dice, a missed free ability, a wrong stress or xp cost. Cite the rule and its page from the reference. Check ORDER: position and effect must be stated BEFORE the dice are rolled; if the transcript shows the roll first and the position or risk named afterwards (even casually, even if everyone agrees), that is a slip. Also check harm handling, who gets the dice, and costs. If you are not sure it is a slip, or it is only a style choice, say none. Silence is the normal answer; false alarms cost more than misses. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        slip: { type: 'boolean' },
        said_at: { type: 'string', description: 'the [HH:MM] stamp of the line, or empty' },
        what_was_said: { type: 'string' },
        rule: { type: 'string', description: 'the correct rule, with page' },
        card: { type: 'string', description: 'one line the GM can read at a glance, or empty' },
      },
      required: ['slip', 'said_at', 'what_was_said', 'rule', 'card'],
    },
  },

  // The gatekeeper checks every item before it can reach the players' screen. It never decides anything: the GM's tap is still
  // needed either way. Unknown (no JSON, refusal, cut-off) is treated as block by the endpoint, never as pass.
  gatekeeper: {
    model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 2500,
    instructions: `You are the gatekeeper for a Blades '68 game. The GM wants to put one item (a portrait caption, a prop, a message, a board entry or a card) on the players' screen. You are given its kind, its text, and any page cites. Check it against three things and decide pass or block.
1. The never-reveal list in your context (the "never-reveal" block: clues not yet landed, what NPCs hold, tonight's secrets). Block if the item states, implies or lets the players work out any entry. List each entry it exposes in revealed (quote its number or title, not the whole text). A fact the players already have at the table is not a leak, but if you cannot tell, treat it as a leak.
2. The GM's rule: the item must not decide the outcome of a roll or a consequence that has not happened at the table, and must not narrate what a player character does, says, thinks or feels. List each problem in rule.
3. The shape: an item must be short, plain text the players could read; it must be what its kind says it is. Note a problem in reasons.
Check any page cites against the rules reference in your context: list in cites_bad each cite that does not match the rule it is attached to or cannot be found. Cites alone never cause a block.
Verdict is block if any of 1 to 3 fails, otherwise pass. Give the reasons in plain short sentences. When the item is fine, reasons, revealed, rule and cites_bad are empty. Use only your context and the item. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: ['pass', 'block'] },
        reasons: { type: 'array', items: { type: 'string' } },
        revealed: { type: 'array', items: { type: 'string' }, description: 'the never-reveal entries the item would expose' },
        rule: { type: 'array', items: { type: 'string' }, description: "problems with the GM's rule: decided outcomes, player characters' actions or feelings narrated" },
        cites_bad: { type: 'array', items: { type: 'string' }, description: 'page cites that look wrong' },
      },
      required: ['verdict', 'reasons', 'revealed', 'rule', 'cites_bad'],
    },
  },

  fixer: {
    model: 'claude-opus-5-5', effort: 'low', maxTokens: 8000,
    instructions: `You are the GM's fixer for a Blades '68 game. A roll is about to be made. The GM's console has already drawn what happens on a 1-3 and on a 4-5, and you are given both draws. The draws are fixed: you fit them to the scene, you do not replace them. From the last few minutes of the live transcript and the cast and rules in your context, work out who is acting, where, what is at stake, and the position (controlled, risky, desperate) and effect the table has set. Then write lines the GM could say aloud in one breath each, plain and concrete, no stage directions.
one_three: the 1-3 draw fitted to this scene. Keep what the draw says happens and its kind and severity (a harm stays a harm, a lost opportunity stays a lost opportunity, a price stays a price, a complication stays a complication, a worse position stays a worse position); you may name who or where from the scene and make it specific, but never change the kind of outcome or swap in a different one.
four_five: the 4-5 draw fitted the same way, as a success with a cost.
six: the clean success on a 6, vivid but not over-explained.
crit: the better-than-clean result on a critical.
bargain: a Devil's Bargain the GM could offer before the roll.
Tie each to the named people, places and running clocks of the scene. Never decide what a player character does or feels. If a draw is empty or cannot be fitted to anything in the scene, restate it plainly rather than invent a different outcome. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        read: { type: 'string', description: 'one line: who, where, position, effect' },
        one_three: { type: 'string', description: 'the 1-3 draw, fitted to the scene; same kind of outcome as the draw' },
        four_five: { type: 'string', description: 'the 4-5 draw, fitted to the scene; same kind of outcome as the draw' },
        six: { type: 'string' }, crit: { type: 'string' }, bargain: { type: 'string' },
      },
      required: ['read', 'one_three', 'four_five', 'six', 'crit', 'bargain'],
    },
  },

  clerk: {
    model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 2500,
    instructions: `You keep the canon for a Blades '68 game from a live transcript. Using the cast and clue list in your context: list names of made-up in-fiction characters spoken that are NOT in the cast (give the heard spelling; ignore real people, actors, film characters, the players' own names and the player characters), places or details that contradict a card, and any must-land clue that was just landed or clearly missed. Report only what is in the last few minutes. Empty lists are the normal answer. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        new_names: { type: 'array', items: { type: 'string' } },
        drift: { type: 'array', items: { type: 'string' } },
        clues_landed: { type: 'array', items: { type: 'string' } },
      },
      required: ['new_names', 'drift', 'clues_landed'],
    },
  },

  ledger: {
    model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 4000,   // 2500 was cut off twice in a live 30-minute replay: thinking shares the limit
    instructions: `You keep the ledger for a Blades '68 game from a live transcript: stress, harm, Heat, coin, clock ticks and xp triggers per character, as they happen in the last few minutes. Also say whether anyone totalled xp at the close. Report only events in the text, each with its [HH:MM] stamp. Empty is the normal answer. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: { at: { type: 'string' }, who: { type: 'string' }, kind: { type: 'string' }, note: { type: 'string' } },
            required: ['at', 'who', 'kind', 'note'],
          },
        },
        xp_totalled: { type: 'boolean' },
      },
      required: ['events', 'xp_totalled'],
    },
  },

  voice: {
    model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 1500,
    instructions: `You are the GM's voice coach for a Blades '68 game. From the last few minutes of the live transcript, work out which non-player character is on stage right now and what they want from the scene. Using ONLY their card in your context (how to play them, their voice, want and fear), write their next two lines in the first person, as the GM could say them aloud: short, concrete, in that character's register, each doing something different (push, deflect, offer, threaten, reveal a little). Never speak or act for a player character. Never reveal a secret the card says is hidden unless the scene has plainly earned it. The message may name the NPC the GM has on stage: then that is who is speaking, so use their card. If no NPC is on stage, or the card is not in your context, say so in who and leave the lines empty. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        who: { type: 'string', description: 'the NPC on stage, or empty' },
        want: { type: 'string', description: 'one line: what they want right now' },
        line_a: { type: 'string' }, line_b: { type: 'string' },
      },
      required: ['who', 'want', 'line_a', 'line_b'],
    },
  },

  // The Another button on a Voice line: one more line for the same NPC and moment, on the GM's tap.
  voice_plus: {
    model: 'claude-opus-5-5', effort: 'medium', maxTokens: 1500,
    instructions: `You are the GM's voice coach for a Blades '68 game. The GM wants one more line for the non-player character named in the message, for the moment in the last few minutes of the live transcript. Lines already shown to the GM are listed in the message: write ONE new line that is clearly different from all of them in what it does (push, deflect, offer, threaten, reveal a little) and in how it opens, not a rewording. Using ONLY that character's card in your context, write it in the first person as the GM could say it aloud: short, concrete, in their register. Never speak or act for a player character. Never reveal a secret the card says is hidden unless the scene has plainly earned it. If the card is not in your context, say so in who and leave the line empty. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: { who: { type: 'string', description: 'the NPC, or empty' }, line: { type: 'string' } },
      required: ['who', 'line'],
    },
  },

  stall: {
    model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 1200,
    instructions: `You are the GM's stall breaker for a Blades '68 game. The table has gone quiet or is going in circles. Stalled means nobody is acting or deciding: long silence, off-topic chat, or the same options repeated without anyone choosing. It does NOT mean a rules question, a roll being worked out, a player thinking aloud about a plan, narration, or a fast scene with everyone talking: those are busy. From the last few minutes of the transcript and the cast, rules and clues in your context, offer ONE thing the GM could introduce now: a complication that raises the pressure, or a proactive clue that points the players toward something they have not yet found. Fit it to where the scene is and to people and places already in play. It must not decide what a player character does or feels, and must not hand over a clue the players already have. Say in one line why now. If the table is not actually stalled (they are mid-scene and busy), say so and leave the offer empty. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        stalled: { type: 'boolean' },
        kind: { type: 'string', enum: ['complication', 'clue', 'none'] },
        offer: { type: 'string', description: 'what the GM says or introduces, in one or two sentences' },
        why_now: { type: 'string' },
      },
      required: ['stalled', 'kind', 'offer', 'why_now'],
    },
  },

  showrunner: {
    model: 'claude-haiku-5-5', effort: 'low', maxTokens: 4000,
    instructions: `You are the showrunner for a Blades '68 game, checking pacing from the transcript you are given (the message says how far back it reaches; earlier talk is not shown, so say unknown rather than guess). Player characters are listed in your context (and players are named in speaker labels, which are unreliable). Report: for each player character, minutes since they were last named or spoke for (estimate from the stamps; say unknown if unclear), and who most needs the spotlight; the beat over time (setup, rising, climax, aftermath) and how long the session has run; and one line of advice for the next ten minutes. Then decide speak: true ONLY for a clear pacing problem, otherwise false, and false is the normal answer (the GM wants a quiet box). A clear problem is one of: a player character who has not been named or spoken for during the whole stretch you were given (about 20 minutes or more); a scene that has run the whole stretch with no roll; or the session being within 30 minutes of its planned close, but only if the prep in your context gives an end time (otherwise ignore this one). When speak is false leave advice empty. Use only the text given. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        spotlight: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: { who: { type: 'string' }, minutes_since: { type: 'number' }, note: { type: 'string' } },
            required: ['who', 'minutes_since', 'note'],
          },
        },
        needs_spotlight: { type: 'string' },
        beat: { type: 'string', enum: ['setup', 'rising', 'climax', 'aftermath'] },
        elapsed_minutes: { type: 'number' },
        advice: { type: 'string' },
        speak: { type: 'boolean', description: 'true only for a clear pacing problem; false is the normal answer' },
      },
      required: ['spotlight', 'needs_spotlight', 'beat', 'elapsed_minutes', 'advice', 'speak'],
    },
  },

  mystery: {
    model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 2500,
    instructions: `You keep the mystery for a Blades '68 game. From the transcript so far and the cast and clue material in your context, list: known, what the players have actually learned (said aloud or shown in the fiction); theories, the theories players have voiced, with who said them and whether the evidence so far supports each; and push_next, the single clue the GM should work in next, with a concrete way to deliver it in the current scene. push_next MUST come from the "Must land" list in tonight's prep in your context: pick the entry the players have not yet learned that fits the scene best, copy its number and title into must_land_item, and do not invent a clue of your own or take one from anywhere else. If every entry has landed, or the context holds no Must land list, leave push_next and must_land_item empty and say why in how. The message may include what you reported as known earlier; treat that as already learned. Use only what was said at the table or is in your context; never invent facts. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        known: { type: 'array', items: { type: 'string' } },
        theories: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: { who: { type: 'string' }, theory: { type: 'string' }, supported: { type: 'string', enum: ['yes', 'partly', 'no', 'unclear'] } },
            required: ['who', 'theory', 'supported'],
          },
        },
        push_next: { type: 'string', description: 'the clue to work in next, from the Must land list, or empty' },
        must_land_item: { type: 'string', description: 'the Must land entry push_next comes from (its number and title, as written), or empty' },
        how: { type: 'string' },
      },
      required: ['known', 'theories', 'push_next', 'must_land_item', 'how'],
    },
  },

  // The Night Shift: sorters read one hour each, in parallel; the writer reads their output.
  sorter: {
    // 20000 (just over callSeat's streaming threshold): an hour of roll-by-roll output is a long reply, and a long non-streaming
    // request can sit silent until the connection is dropped. Streaming keeps it alive.
    model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 20000,
    instructions: `You sort one hour of a Blades '68 session transcript for the end-of-night paperwork. Speaker labels and spellings are unreliable; use the cast in your context to correct names, and mark guesses. From THIS chunk only, extract: names (made-up in-fiction characters, places, groups, with a few words on who or what and the [HH:MM] stamp); ledger (stress, harm, Heat, coin, clock ticks, xp triggers and status changes per character, each with a stamp); loose_ends (questions raised and not answered, promises, threats and plans left hanging); clocks_owed (clocks that were started, advanced or should have ticked, with their state). ${ROLL_RULES} Add a two-sentence chunk_summary of what happened. Report only what is in the text. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        chunk_summary: { type: 'string' },
        names: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, what: { type: 'string' }, at: { type: 'string' } }, required: ['name', 'what', 'at'] } },
        ledger: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { at: { type: 'string' }, who: { type: 'string' }, kind: { type: 'string' }, note: { type: 'string' } }, required: ['at', 'who', 'kind', 'note'] } },
        loose_ends: { type: 'array', items: { type: 'string' } },
        clocks_owed: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { clock: { type: 'string' }, state: { type: 'string' } }, required: ['clock', 'state'] } },
        rolls: { type: 'array', items: ROLL_SCHEMA },
      },
      required: ['chunk_summary', 'names', 'ledger', 'loose_ends', 'clocks_owed', 'rolls'],
    },
  },

  writer: {
    model: 'claude-opus-5-5', effort: 'high', maxTokens: 40000,
    instructions: `You are the GM's scribe for a Blades '68 game, writing the night's paperwork after the session. You are given the sorters' structured notes for each hour (in order). Using them and the cast and rules in your context, draft the following as markdown in the string fields. Write plainly and in Australian spelling; do not invent events the notes do not contain, and write [TODO: ...] for gaps.
session_log (at most 900 words): a dated, scannable log of the session in scene order, with names, outcomes, harm, Heat, coin and clocks.
xp_per_pc: one section per player character listing the POSSIBLE xp triggers seen, each tied to a stamp, using the sorters' rolls (desperate rolls, zero-dot rolls, and moments of beliefs, drives, heritage, background or vice played out), with a count and any uncertainty. Never invent triggers. XP is manual: the GM marks it, so say plainly that these are candidates, not awards.
feedback_card: a short GM-feedback card: what worked, rules slips or doubts to check against the book (cite pages from the reference when you can), and one thing to try next time.
group_chat: three to five short highlights the GM could post to the players' group chat, warm and spoiler-light.
previously_on: a spoken recap of 120 to 180 words for the start of next session.
prep_skeleton: a skeleton for next session: open threads, clocks that will advance, NPCs likely to appear, and questions the GM should decide before play.
Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        session_log: { type: 'string' }, xp_per_pc: { type: 'string' }, feedback_card: { type: 'string' },
        group_chat: { type: 'string' }, previously_on: { type: 'string' }, prep_skeleton: { type: 'string' },
      },
      required: ['session_log', 'xp_per_pc', 'feedback_card', 'group_chat', 'previously_on', 'prep_skeleton'],
    },
  },

  // The one-call variant of the Night Shift: a single Opus read of the whole transcript, same sections as the writer plus the rolls.
  nightshift_single: {
    model: 'claude-opus-5-5', effort: 'high', maxTokens: 40000,
    instructions: `You are the GM's scribe for a Blades '68 game, writing the night's paperwork after the session from the WHOLE transcript. Speaker labels and spellings are unreliable; use the cast and rules in your context to correct names, and mark guesses. Write plainly and in Australian spelling; do not invent events the transcript does not contain, and write [TODO: ...] for gaps.
${ROLL_RULES}
session_log (at most 900 words): a dated, scannable log of the session in scene order, with names, outcomes, harm, Heat, coin and clocks.
xp_per_pc: one section per player character listing the POSSIBLE xp triggers seen, each tied to a stamp, using your rolls (desperate rolls, zero-dot rolls, and moments of beliefs, drives, heritage, background or vice played out), with a count and any uncertainty. Never invent triggers. XP is manual: the GM marks it, so say plainly that these are candidates, not awards.
feedback_card: a short GM-feedback card: what worked, rules slips or doubts to check against the book (cite pages from the reference when you can), and one thing to try next time.
group_chat: three to five short highlights the GM could post to the players' group chat, warm and spoiler-light.
previously_on: a spoken recap of 120 to 180 words for the start of next session.
prep_skeleton: a skeleton for next session: open threads, clocks that will advance, NPCs likely to appear, and questions the GM should decide before play.
Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        rolls: { type: 'array', items: ROLL_SCHEMA },
        session_log: { type: 'string' }, xp_per_pc: { type: 'string' }, feedback_card: { type: 'string' },
        group_chat: { type: 'string' }, previously_on: { type: 'string' }, prep_skeleton: { type: 'string' },
      },
      required: ['rolls', 'session_log', 'xp_per_pc', 'feedback_card', 'group_chat', 'previously_on', 'prep_skeleton'],
    },
  },
};

// Which flags wake which seats (the Conductor's table).
export const WAKES = {
  ref: ['roll_talk', 'harm'],
  clerk: ['new_name', 'clue_mention'],
  ledger: ['harm', 'xp_trigger', 'roll_talk'],
  voice: ['npc_change'],            // also each minute while the page names an NPC on stage (the Conductor)
  stall: ['stall'],                 // its offer goes to the Rack, like Voice
  mystery: ['clue_mention'],
  showrunner: ['tick'],             // not a Tripwire flag: the endpoint adds 'tick' to every tick's flags, and the 10-minute cooldown paces it
};
