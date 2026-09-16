/* Twenty-Eight — the rule set a table is played under.

   Twenty-Eight is a house game: every district plays it a little differently.
   Rather than bake one reading of the rules into the engine, a table carries a
   plain object of options and the engine asks it questions. Everything here is
   a boolean, so a table's rules can be stored, compared and shown as a list of
   switches without any further translation.

   `joker` is listed but pinned off — this build has no joker and the option
   exists so the UI can show it greyed rather than pretend it is not a thing. */

(function () {
  const DEFAULTS = {
    hiddenTrump: true,        // the caller sets a card face down, suit unknown
    revealOnLead: false,      // may the player on lead call for the turn-up?
    revealObligation: true,   // whoever called for it must trump that trick
    marriage: true,           // K + Q of trump, declared for a swing of 4
    marriageDefenders: true,  // defenders may declare too, pushing the call up
    lastTrick: false,         // final trick carries one extra point
    joker: false,             // not in this build
    tournament: false         // locked rules, no house variations
  };

  /* Options the table may not change, whatever is asked for. */
  const LOCKED = { joker: false };

  /* Tournament play fixes the rules so every table in a draw plays the same
     game: hidden trump, marriage both ways, no last-trick point. */
  const TOURNAMENT = {
    hiddenTrump: true,
    revealOnLead: false,
    revealObligation: true,
    marriage: true,
    marriageDefenders: true,
    lastTrick: false,
    joker: false,
    tournament: true
  };

  /* Drives the settings list: order, wording, and which rows are frozen. */
  const META = [
    { key: 'hiddenTrump', label: 'Hidden trump',
      on: 'The call sets a card face down — nobody else knows the suit.',
      off: 'The caller names the suit out loud and it is live at once.' },
    { key: 'marriage', label: 'Marriage',
      on: 'King + Queen of trump, declared after the turn-up, swings the call by 4.',
      off: 'King and Queen of trump are ordinary cards.' },
    { key: 'marriageDefenders', label: 'Defenders may marry',
      on: 'A marriage across the table pushes the call up by 4 instead of down.',
      off: 'Only the calling pair can declare.',
      needs: 'marriage' },
    { key: 'lastTrick', label: 'Last trick point',
      on: 'Whoever takes the eighth trick scores one extra point.',
      off: 'The eighth trick is worth only the cards in it.' },
    { key: 'revealOnLead', label: 'Call trump on lead',
      on: 'The player on lead may turn the trump up before leading.',
      off: 'Only a player out of the led suit may turn it up.',
      needs: 'hiddenTrump' },
    { key: 'revealObligation', label: 'Turn-up obligation',
      on: 'Whoever turns the trump up must trump that trick if they can.',
      off: 'Turning the trump up carries no obligation.',
      needs: 'hiddenTrump' },
    { key: 'joker', label: 'Joker', locked: true,
      on: 'Not in this build.',
      off: 'Not in this build.' },
    { key: 'tournament', label: 'Tournament mode',
      on: 'Rules are fixed for the draw and cannot be changed at the table.',
      off: 'The table may set its own house rules.' }
  ];

  /* Fill in anything missing, drop anything unknown, and apply the locks.
     A tournament table is rebuilt from the tournament preset outright, so a
     stale option left over from a casual table cannot leak into a draw. */
  function normalize(opts) {
    const want = Object.assign({}, DEFAULTS, opts || {});
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = !!want[k];
    if (out.tournament) Object.assign(out, TOURNAMENT);
    Object.assign(out, LOCKED);

    // a dependent option means nothing once its parent is off
    for (const m of META) {
      if (m.needs && !out[m.needs]) out[m.key] = false;
    }
    return out;
  }

  function preset(name) {
    if (name === 'tournament') return normalize(TOURNAMENT);
    return normalize(DEFAULTS);
  }

  const same = (a, b) => Object.keys(DEFAULTS).every((k) => !!a[k] === !!b[k]);

  /* Short line for the table header — only what differs from a plain game. */
  function summary(rules) {
    const r = normalize(rules);
    const bits = [];
    if (r.tournament) bits.push('Tournament');
    if (!r.hiddenTrump) bits.push('Open trump');
    if (r.marriage) bits.push('Marriage');
    if (r.lastTrick) bits.push('Last trick');
    return bits.length ? bits.join(' · ') : 'Plain rules';
  }

  const API = { DEFAULTS, TOURNAMENT, LOCKED, META, normalize, preset, summary, same };

  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.T28Rules = API;
})();
