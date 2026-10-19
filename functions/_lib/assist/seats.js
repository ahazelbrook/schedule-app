// The seat registry (build plan, "The seat roster"). Model and effort live here and nowhere else, so an effort sweep is a
// one-line change. These instructions are generic on purpose: this repository is public, so nothing campaign-specific
// goes in them. Names, NPC cards and prep arrive in the cached prefix, which the replay reads from the GM's vault.

const FLAGS = ['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'];

export const SEATS = {
  tripwire: {
    model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1500,
    instructions: `You listen to a live tabletop RPG game (Blades '68) as speech-to-text, one minute at a time. Speaker labels and spellings are unreliable. Set a flag only for what is plainly in THIS minute's text.
Flags: roll_talk (ONLY when a roll is being set up or resolved right now: dice picked up or thrown, a result read out, or position/effect called for a specific roll. Talking about rules, past rolls or what a character might do is false), harm (harm is being given, marked, resisted or its effects ruled on right now. Mere mentions of injury in the story are false), npc_change (a different NPC starts speaking or is introduced), new_name (a made-up in-fiction character's name is spoken that is not in the cast list in your context. Real people, actors, film characters and the players' own names are false), clue_mention (a clue, secret or theory about the mystery is said), xp_trigger (xp, desperate or zero-dot rolls, the close of the score or session), scene_change (the scene or location changes), stall (the table is idle, off-topic or searching for what to do).
Prefer false: most minutes have no flags at all. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: Object.fromEntries(FLAGS.map(f => [f, { type: 'boolean' }])),
      required: FLAGS,
    },
  },

  ref: {
    model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 3000,
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

  fixer: {
    model: 'claude-opus-5-5', effort: 'medium', maxTokens: 4000,
    instructions: `You are the GM's fixer for a Blades '68 game. A roll is about to be made. From the last few minutes of the live transcript and the cast and rules in your context, work out who is acting, where, what is at stake, and the position (controlled, risky, desperate) and effect the table has set. Then write what could happen, as lines the GM could say aloud in one breath each, plain and concrete, no stage directions. one_three: a minor complication on a 1-3. four_five: a success with a cost on a 4-5. six: the clean success on a 6, vivid but not over-explained. crit: the better-than-clean result on a critical. bargain: a Devil's Bargain the GM could offer before the roll. Tie each to the named people, places and running clocks of the scene. Never decide what a player character does or feels. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        read: { type: 'string', description: 'one line: who, where, position, effect' },
        one_three: { type: 'string' }, four_five: { type: 'string' }, six: { type: 'string' }, crit: { type: 'string' }, bargain: { type: 'string' },
      },
      required: ['read', 'one_three', 'four_five', 'six', 'crit', 'bargain'],
    },
  },

  closer: {
    model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 4000,
    instructions: `You are the GM's closing checklist for a Blades '68 game. Read the score's transcript (from the start of the score to now) and prepare what the close needs. xp: for each player character, list every xp trigger actually seen (desperate rolls, zero-dot rolls, the playbook and crew triggers, a key or deadlock) with its [HH:MM] stamp, and a total; do not invent triggers. checklist: for each close step (xp walked, heat, wanted level, harm complications, question cards, downtime unwind) say done, skipped or unclear, from the transcript only. Reply with JSON only.`,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        xp: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { who: { type: 'string' }, triggers: { type: 'array', items: { type: 'string' } }, total: { type: 'number' } }, required: ['who', 'triggers', 'total'] } },
        checklist: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { step: { type: 'string' }, state: { type: 'string', enum: ['done', 'skipped', 'unclear'] } }, required: ['step', 'state'] } },
      },
      required: ['xp', 'checklist'],
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
    model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 2500,
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
};

// Which flags wake which seats (the Conductor's table).
export const WAKES = {
  ref: ['roll_talk', 'harm'],
  clerk: ['new_name', 'clue_mention'],
  ledger: ['harm', 'xp_trigger', 'roll_talk'],
};
