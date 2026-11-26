// The crew at a glance (RK20): the INVENTED fixtures its unit test and its e2e block share. The Dovetail Crew (Nell Arbuthnot, Ray Okonjo, Tam Petrakis), the Pelican Rooms.
// Anything the players must not see carries a GM-ONLY- marker. Nothing here is campaign text.

export const CREW = {
  name: 'The Dovetail Crew', playbook: 'shadows', type: 'shadows', lair: 'A loft over the ferry office', notes: 'NOTES-MARKER', tier: 1, hold: 'strong',
  rep: 5, heat: 3, wanted: 1, stacks: 6, vault: 6, preferred: ['The ferry quays'],
  upgrades: { Hidden: 1, Vault: 1, Insight: 1, 'Multifaceted (+1 key/deadlock)': 2 },
  cohorts: [{ name: 'The Lamplighters', type: 'gang', edges: '', flaws: '', harm: 'weak', armor: true }, { name: 'Ada Vell', type: 'Forger', edges: '', flaws: '', harm: null, armor: false }],
  claims: { base: true, turf: true, 'turf-2': true, informants: true, 'lounge-bar': true },
  factions: [{ name: 'The Kestrel Club', status: 1 }, { name: 'The Tidewater Watch', status: -1 }]
};

export const CLOCKS = [
  { id: 'c-ferry', name: 'Buy the ferry office', size: 8, filled: 3, kind: 'project', hidden: false },
  { id: 'c-marker', name: 'Win back the marker', size: 8, filled: 3, kind: 'progress', hidden: false },
  { id: 'c-hid', name: 'GM-ONLY-PROJECT: the quiet ledger', size: 6, filled: 1, kind: 'project', hidden: true }
];

// the raw character documents (what a player files): play.stress, harm, keys, xp, stacks
export const RAW = [
  { id: 'char_gl1', name: 'Nell Arbuthnot', alias: 'Nettle', playbook: 'hound', playbookName: 'Hound',
    play: { session: 4, stress: 5, harm: { l1: ['Bruised ribs', ''], l2: ['Cracked jaw', ''], l3: 'Broken arm', l4: '' }, xp: { playbook: 4 }, stacks: 2,
      keys: [{ name: 'KEY-1', hits: 3, deadlock: 'down', down: 'Takes the long way round', up: 'Never lets go of a scent' }, { name: 'KEY-2', hits: 1, deadlock: null }] } },
  { id: 'char_gl2', name: 'Ray Okonjo', alias: '', playbook: 'operative', playbookName: 'Operative',
    play: { session: 4, stress: 2, harm: { l1: ['', ''], l2: ['Cut hand', ''], l3: '', l4: '' }, xp: { playbook: 6 }, stacks: 0, keys: [{ name: 'KEY-1', hits: 2, deadlock: null }] } },
  { id: 'char_gl3', name: 'Tam Petrakis', alias: 'Tink', playbook: 'swinger', playbookName: 'Swinger',
    play: { session: 4, stress: 9, harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' }, xp: { playbook: 2 }, stacks: 5, keys: [] } }
];

// the slim copy app/boot.js hands the GM page (slimCharacter + its lazy `glance`), as far as the panel reads it
export function slim(raw, over) {
  const p = raw.play;
  return { id: raw.id, owner: '', name: raw.name, alias: raw.alias, playbook: raw.playbook, playbookName: raw.playbookName,
    glance: { play: p, facts: Object.assign({ fresh: false, stressName: 'Stress', stressMax: 9, stress: p.stress, xp: p.xp ? p.xp.playbook : null, stacks: p.stacks || 0 }, over || {}) } };
}
export const PCS = RAW.map((r) => slim(r));
