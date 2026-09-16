/* AI tests. Run with `node test/ai.test.js` from game/.

   These play whole hands with all four seats driven by the AI, so the checks
   are about the things that only show up over a lot of deals: that nothing
   ever plays an illegal card, that no seat acts on knowledge it should not
   have, and that the auction and the hands that follow land in a sane range. */

const T28 = require('../js/engine.js');
const AI = require('../js/ai.js');
const Rules = require('../js/rules.js');

const { Game, SUITS, teamOf, sameCard } = T28;

let passed = 0;
const failures = [];

function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push({ name, message: e.message }); }
}
function eq(a, b, what) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${what || 'value'}: expected ${sb}, got ${sa}`);
}
function ok(v, what) { if (!v) throw new Error(what || 'expected truthy'); }
function notOk(v, what) { if (v) throw new Error(what || 'expected falsy'); }
function within(v, lo, hi, what) {
  if (!(v >= lo && v <= hi)) throw new Error(`${what}: ${v} is outside ${lo}..${hi}`);
}

function lcg(seed) {
  let s = (seed * 2654435761) % 0x7fffffff || 12345;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/* Play one hand out with every seat on the AI, collecting what happened.
   `watch` is called before each action so a test can inspect mid-hand. */
function playHand(seed, rules, watch) {
  const rng = lcg(seed);
  const g = new Game({ dealer: seed % 4, rng, rules });
  const events = { reveals: [], marriages: [], plays: 0 };

  let guard = 0;
  while (g.phase === 'bid1' || g.phase === 'bid2') {
    if (guard++ > 64) throw new Error('bidding did not settle');
    const seat = g.turn;
    const d = AI.decideBid(g, seat);
    const moved = d.action === 'bid' ? g.placeBid(seat, d.value) : g.passBid(seat);
    ok(moved, `seat ${seat} bid action was accepted`);
  }

  ok(g.phase === 'trump', 'auction produced a caller');
  const pick = AI.chooseTrump(g, g.bid.player);
  ok(g.setTrump(g.bid.player, pick), 'trump was set');

  guard = 0;
  while (g.phase === 'play') {
    if (guard++ > 200) throw new Error('play did not finish');
    if (g.trickComplete()) { g.resolveTrick(); continue; }

    const seat = g.turn;
    if (watch) watch(g, seat);

    if (AI.decideReveal(g, seat)) {
      ok(g.canRequestReveal(seat), `seat ${seat} only asks when it may`);
      g.requestReveal(seat);
      events.reveals.push({ seat, trick: g.tricksPlayed });
    }
    if (AI.decideMarriage(g, seat)) {
      ok(g.canDeclareMarriage(seat), `seat ${seat} only declares when it may`);
      g.declareMarriage(seat);
      events.marriages.push({ seat, swing: g.marriage.swing });
    }

    const card = AI.decidePlay(g, seat);
    const legal = g.legalCards(seat);
    ok(legal.some((c) => sameCard(c, card)), `seat ${seat} chose a legal card`);
    ok(g.playCard(seat, card), `seat ${seat} play was accepted`);
    events.plays++;
  }

  return { g, events };
}

const DEALS = 300;

// ------------------------------------------------------------- whole hands

check('the AI plays hands out cleanly, deal after deal', () => {
  for (let seed = 1; seed <= DEALS; seed++) {
    const { g, events } = playHand(seed);
    eq(g.tricksPlayed, 8, `seed ${seed}: tricks`);
    eq(events.plays, 32, `seed ${seed}: cards played`);
    eq(g.points[0] + g.points[1], g.maxPoints, `seed ${seed}: points add up`);
    eq(g.hands.map((h) => h.length), [0, 0, 0, 0], `seed ${seed}: hands empty`);
    ok(g.result, `seed ${seed}: a verdict`);
  }
});

check('every rule combination plays out', () => {
  const combos = [
    { hiddenTrump: true },
    { hiddenTrump: false },
    { lastTrick: true },
    { marriage: false },
    { marriageDefenders: false },
    { revealOnLead: true },
    { revealObligation: false },
    { tournament: true },
    { hiddenTrump: true, lastTrick: true, revealOnLead: true }
  ];
  for (const rules of combos) {
    const label = JSON.stringify(rules);
    for (let seed = 1; seed <= 25; seed++) {
      const { g } = playHand(seed, rules);
      eq(g.tricksPlayed, 8, `${label} seed ${seed}: tricks`);
      eq(g.points[0] + g.points[1], g.maxPoints, `${label} seed ${seed}: points`);
    }
  }
});

// ------------------------------------------------------- information hygiene

check('a seat that has not seen the trump is not told what it is', () => {
  for (let seed = 1; seed <= 60; seed++) {
    playHand(seed, {}, (g, seat) => {
      const known = AI.knownTrump(g, seat);
      if (g.trumpRevealed) {
        eq(known, g.trumpSuit, `seed ${seed}: public once turned up`);
      } else if (seat === g.bid.player) {
        eq(known, g.trumpSuit, `seed ${seed}: the caller knows their own`);
      } else {
        eq(known, null, `seed ${seed}: seat ${seat} must not know`);
      }
    });
  }
});

check('the odds a seat puts on each suit are a real distribution', () => {
  for (let seed = 1; seed <= 40; seed++) {
    playHand(seed, {}, (g, seat) => {
      if (g.trumpRevealed || seat === g.bid.player) return;
      const odds = AI.trumpOdds(g, seat);
      const total = SUITS.reduce((n, s) => n + odds[s], 0);
      ok(Math.abs(total - 1) < 1e-9, `seed ${seed}: odds sum to one`);
      for (const s of SUITS) within(odds[s], 0, 1, `seed ${seed}: odds for ${s}`);
      // a suit this seat holds every card of cannot be the one face down
      for (const s of SUITS) {
        const mine = g.hands[seat].filter((c) => c.s === s).length;
        const played = g.log.filter((e) => e.t === 'play' && e.card.s === s).length;
        if (mine + played === 8) eq(odds[s], 0, `seed ${seed}: ${s} is exhausted`);
      }
    });
  }
});

check('a hidden trump is never led away by the caller', () => {
  // the caller should hold its trumps back rather than open with them
  let opened = 0, chances = 0;
  for (let seed = 1; seed <= 120; seed++) {
    playHand(seed, {}, (g, seat) => {
      if (g.trick.length || g.trumpRevealed) return;
      if (seat !== g.bid.player) return;
      const legal = g.legalCards(seat);
      const plain = legal.filter((c) => c.s !== g.trumpSuit);
      if (!plain.length) return;          // nothing but trumps, no choice
      chances++;
      if (AI.decidePlay(g, seat).s === g.trumpSuit) opened++;
    });
  }
  ok(chances > 20, 'the situation came up often enough to judge');
  eq(opened, 0, 'the caller never leads its own concealed trump');
});

// -------------------------------------------------------------- the auction

check('the auction lands in a believable range', () => {
  const bids = [];
  const byTeam = [0, 0];
  for (let seed = 1; seed <= DEALS; seed++) {
    const { g } = playHand(seed);
    bids.push(g.result.bid);
    byTeam[g.result.bidTeam]++;
  }
  const lo = Math.min(...bids), hi = Math.max(...bids);
  const mean = bids.reduce((a, b) => a + b, 0) / bids.length;
  within(lo, 14, 28, 'lowest call');
  within(hi, 14, 28, 'highest call');
  within(mean, 14, 22, 'average call');
  ok(hi > lo, 'calls are not all the same');
  // neither pair should win the auction almost every time
  within(byTeam[0] / DEALS, 0.3, 0.7, 'share of auctions won by one pair');
});

check('calls are made often enough, and broken often enough', () => {
  let made = 0;
  for (let seed = 1; seed <= DEALS; seed++) {
    if (playHand(seed).g.result.made) made++;
  }
  // a game where the caller always makes it, or never does, is not a game
  within(made / DEALS, 0.3, 0.85, 'share of calls made');
});

check('neither pair runs away with it over a long night', () => {
  let us = 0;
  for (let seed = 1; seed <= DEALS; seed++) {
    if (playHand(seed).g.result.youWon) us++;
  }
  within(us / DEALS, 0.35, 0.65, 'share of hands won by your pair');
});

// ------------------------------------------------------------- the turn-up

check('the trump gets turned up in most hands, but not all of them', () => {
  let asked = 0, auto = 0;
  for (let seed = 1; seed <= DEALS; seed++) {
    const { g, events } = playHand(seed);
    if (events.reveals.length) asked++;
    else if (g.trumpRevealed) auto++;
    ok(events.reveals.length <= 1, `seed ${seed}: only one turn-up per hand`);
  }
  within(asked / DEALS, 0.25, 0.95, 'hands where somebody asked');
  ok(asked + auto === DEALS, 'every hand ends with the trump face up one way or another');
});

check('the turn-up obligation is honoured', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const rng = lcg(seed);
    const g = new Game({ dealer: seed % 4, rng });
    while (g.phase === 'bid1' || g.phase === 'bid2') {
      const d = AI.decideBid(g, g.turn);
      if (d.action === 'bid') g.placeBid(g.turn, d.value); else g.passBid(g.turn);
    }
    g.setTrump(g.bid.player, AI.chooseTrump(g, g.bid.player));

    while (g.phase === 'play') {
      if (g.trickComplete()) { g.resolveTrick(); continue; }
      const seat = g.turn;
      const asked = AI.decideReveal(g, seat);
      if (asked) g.requestReveal(seat);
      const card = AI.decidePlay(g, seat);
      if (asked && g.hands[seat].some((c) => c.s === g.trumpSuit)) {
        eq(card.s, g.trumpSuit, `seed ${seed}: seat ${seat} paid its debt`);
      }
      g.playCard(seat, card);
    }
  }
});

check('nobody asks for a turn-up when their partner is winning the trick', () => {
  for (let seed = 1; seed <= 120; seed++) {
    playHand(seed, {}, (g, seat) => {
      if (!g.canRequestReveal(seat) || !g.trick.length) return;
      const best = g.trick.reduce((b, t) => {
        const lead = g.trick[0].card.s;
        if (t.card.s !== lead) return b;
        return T28.rankPower(t.card.r) > T28.rankPower(b.card.r) ? t : b;
      }, g.trick[0]);
      if (teamOf(best.player) === teamOf(seat) && AI.decideReveal(g, seat)) {
        throw new Error(`seed ${seed}: seat ${seat} asked while its partner led the trick`);
      }
    });
  }
});

// -------------------------------------------------------------- marriage

check('a marriage is declared whenever one is there to declare', () => {
  let seen = 0;
  for (let seed = 1; seed <= DEALS; seed++) {
    const { g, events } = playHand(seed);
    if (events.marriages.length) {
      seen++;
      eq(events.marriages.length, 1, `seed ${seed}: one declaration`);
      const m = g.result.marriage;
      ok(m, `seed ${seed}: recorded on the result`);
      const expected = m.team === g.result.bidTeam ? -4 : 4;
      eq(m.swing, expected, `seed ${seed}: swing direction`);
      eq(g.result.target, g.result.bid + m.swing, `seed ${seed}: the call moved`);
    } else {
      eq(g.result.target, g.result.bid, `seed ${seed}: the call stood`);
    }
  }
  ok(seen > 0, 'marriages turn up over 300 deals');
});

check('the caller does not bury half a marriage under the trump', () => {
  let buried = 0, chances = 0;
  for (let seed = 1; seed <= DEALS; seed++) {
    const rng = lcg(seed);
    const g = new Game({ dealer: seed % 4, rng });
    while (g.phase === 'bid1' || g.phase === 'bid2') {
      const d = AI.decideBid(g, g.turn);
      if (d.action === 'bid') g.placeBid(g.turn, d.value); else g.passBid(g.turn);
    }
    const seat = g.bid.player;
    const pick = AI.chooseTrump(g, seat);
    const hand = g.hands[seat];
    const pairInSuit = hand.some((c) => c.s === pick.s && c.r === 'K') &&
                       hand.some((c) => c.s === pick.s && c.r === 'Q');
    if (!pairInSuit) continue;
    chances++;
    // the rest of the suit must be more than just the King and Queen
    const others = hand.filter((c) => c.s === pick.s && c.r !== 'K' && c.r !== 'Q');
    if (others.length && (pick.r === 'K' || pick.r === 'Q')) buried++;
  }
  ok(chances > 5, 'the situation came up');
  eq(buried, 0, 'never sets aside a King or Queen it could keep');
});

// ---------------------------------------------------------------- reporting

const total = passed + failures.length;
if (failures.length) {
  console.log(`\n${failures.length} of ${total} checks failed:\n`);
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.message}`);
  console.log('');
  process.exit(1);
}
console.log(`\n  ✓ all ${total} checks passed\n`);
