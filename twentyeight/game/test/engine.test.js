/* Rules engine tests. Run with `node test/engine.test.js` from game/.

   These check the parts of Twenty-Eight that are easy to get subtly wrong:
   what the pack is worth, who takes a trick, what the face-down trump does to
   the caller's hand, and how a marriage moves the call. */

const T28 = require('../js/engine.js');
const Rules = require('../js/rules.js');

const { Game, buildDeck, cardPoints, rankPower, RANKS, sameCard, teamOf } = T28;

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push({ name, message: e.message });
  }
}

function eq(a, b, what) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${what || 'value'}: expected ${sb}, got ${sa}`);
}
function ok(v, what) { if (!v) throw new Error(what || 'expected truthy'); }
function notOk(v, what) { if (v) throw new Error(what || 'expected falsy'); }

/* A deterministic deck so a hand can be set up by hand. `stack` is the order
   cards come off the top: seats 0-3 get four each, then four each again. */
function stacked(order, rules, dealer) {
  const g = new Game({ rules, dealer: dealer == null ? 3 : dealer });
  g.deck = order.slice();
  g.hands = [0, 1, 2, 3].map((p) => order.slice(p * 4, p * 4 + 4));
  g.rest = order.slice(16);
  return g;
}

const C = (s) => ({ r: s.slice(0, -1), s: s.slice(-1) });
const cards = (...xs) => xs.map(C);

/* Walk bidding so that `winner` ends up holding the call at `value`. */
function biddingTo(g, winner, value) {
  while (g.phase === 'bid1' || g.phase === 'bid2') {
    if (g.turn === winner && g.canBid(value)) g.placeBid(winner, value);
    else g.passBid(g.turn);
  }
}

// ------------------------------------------------------------------ the pack

check('pack is 32 cards, all distinct', () => {
  const d = buildDeck();
  eq(d.length, 32, 'deck size');
  eq(new Set(d.map((c) => c.r + c.s)).size, 32, 'distinct cards');
});

check('the pack is worth exactly 28', () => {
  eq(buildDeck().reduce((n, c) => n + cardPoints(c), 0), 28, 'total points');
});

check('card values match the table', () => {
  eq(cardPoints(C('Js')), 3, 'jack');
  eq(cardPoints(C('9s')), 2, 'nine');
  eq(cardPoints(C('As')), 1, 'ace');
  eq(cardPoints(C('10s')), 1, 'ten');
  for (const r of ['K', 'Q', '8', '7']) eq(cardPoints(C(r + 's')), 0, r);
});

check('ranking is J > 9 > A > 10 > K > Q > 8 > 7', () => {
  eq(RANKS, ['J', '9', 'A', '10', 'K', 'Q', '8', '7'], 'rank order');
  for (let i = 1; i < RANKS.length; i++) {
    ok(rankPower(RANKS[i - 1]) > rankPower(RANKS[i]), `${RANKS[i - 1]} beats ${RANKS[i]}`);
  }
});

// ------------------------------------------------------------------ the deal

check('first deal is four cards each, second deal brings it to eight', () => {
  const g = new Game({ dealer: 3 });
  for (let p = 0; p < 4; p++) eq(g.hands[p].length, 4, `seat ${p} after first deal`);
  eq(g.phase, 'bid1', 'phase');
  biddingTo(g, 0, 14);
  for (let p = 0; p < 4; p++) eq(g.hands[p].length, 8, `seat ${p} after second deal`);
});

check('bidding opens left of the dealer and runs 14 to 28', () => {
  const g = new Game({ dealer: 3 });
  eq(g.turn, 0, 'first to speak');
  eq(g.minLegalBid, 14, 'opening minimum');
  notOk(g.canBid(13), '13 is under the floor');
  notOk(g.canBid(29), '29 is over the ceiling');
  ok(g.placeBid(0, 14), 'open at 14');
  eq(g.minLegalBid, 15, 'next call must beat it');
  notOk(g.canBid(14), 'cannot match a standing call');
});

check('if everybody passes, the seat left of the dealer is stuck with 14', () => {
  const g = new Game({ dealer: 3 });
  for (let i = 0; i < 4; i++) if (g.phase === 'bid1') g.passBid(g.turn);
  eq(g.bid.player, 0, 'forced caller');
  eq(g.bid.value, 14, 'forced call');
});

check('highest bidder wins the auction and names trump', () => {
  const g = new Game({ dealer: 3 });
  biddingTo(g, 2, 20);
  eq(g.phase, 'trump', 'phase after bidding');
  eq(g.bid.player, 2, 'caller');
  eq(g.bid.value, 20, 'call');
  eq(g.turn, 2, 'caller is on turn');
});

// ------------------------------------------------------------- hidden trump

check('a hidden trump leaves the caller playing seven cards', () => {
  const g = new Game({ dealer: 3 });
  biddingTo(g, 0, 16);
  const pick = g.hands[0][0];
  ok(g.setTrump(0, pick), 'set trump');
  eq(g.hands[0].length, 7, 'caller hand');
  eq(g.hands[1].length, 8, 'other hands untouched');
  notOk(g.hands[0].some((c) => sameCard(c, pick)), 'trump card is out of hand');
  ok(g.trumpHeld, 'held face down');
  notOk(g.trumpRevealed, 'still secret');
  eq(g.trumpSuit, pick.s, 'suit recorded');
});

check('open trump keeps the card in hand and is live from the start', () => {
  const g = new Game({ dealer: 3, rules: { hiddenTrump: false } });
  biddingTo(g, 0, 16);
  const pick = g.hands[0][0];
  ok(g.setTrump(0, pick), 'set trump');
  eq(g.hands[0].length, 8, 'nothing set aside');
  ok(g.trumpRevealed, 'public at once');
  notOk(g.trumpHeld, 'nothing held');
});

check('trump does not bite until it is turned up', () => {
  // seat 0 leads a heart, seat 1 is void and throws a spade (the trump suit)
  const order = cards(
    'Ah', 'Kh', '7c', '8c',   // seat 0
    'Js', '9c', '10c', 'Qc',  // seat 1
    '7h', '8h', '9h', '10h',  // seat 2
    'Qh', 'Jh', 'Ac', 'Kc',   // seat 3
    '7s', '8s', '9s', '10s',
    'As', 'Ks', 'Qs', '7d',
    '8d', '9d', '10d', 'Jd',
    'Ad', 'Kd', 'Qd', 'Jc'
  );
  const g = stacked(order);
  biddingTo(g, 0, 14);
  g.setTrump(0, C('7s'));            // spades are trump, face down
  eq(g.leader, 0, 'lead');

  g.playCard(0, C('Ah'));
  g.playCard(1, C('Js'));            // a trump, but nobody has turned it up
  g.playCard(2, C('7h'));
  g.playCard(3, C('Qh'));
  eq(g.trickWinner(), 0, 'ace of the led suit still takes it');
});

// ------------------------------------------------------------------ turn-up

/* Seat 0 calls, sets the 7 of spades face down and leads a heart.
   Seat 1 is void in hearts and holds exactly one trump, the jack of spades.
   Seat 2 can follow hearts. Seat 3 is void in hearts with no trump. */
function revealSetup(rules) {
  const order = cards(
    'Ah', 'Kh', 'Qh', 'Jh',   // seat 0, first deal
    'Js', '7c', '9c', '10c',  // seat 1
    '7h', '8h', '9h', '10h',  // seat 2
    'As', 'Ks', 'Qs', 'Jc',   // seat 3
    '7s', '8s', '9s', '10s',  // seat 0, second deal
    'Qc', 'Ac', 'Kc', '8c',   // seat 1
    '7d', '8d', '9d', '10d',  // seat 2
    'Jd', 'Ad', 'Kd', 'Qd'    // seat 3
  );
  const g = stacked(order, rules);
  biddingTo(g, 0, 14);
  g.setTrump(0, C('7s'));
  g.playCard(0, C('Ah'));
  return g;
}

check('only a player out of the led suit may call for trump', () => {
  const g = revealSetup();
  notOk(g.canRequestReveal(2), 'seat 2 can follow hearts, so cannot ask');
  ok(g.canRequestReveal(1), 'seat 1 is void and may ask');
});

check('the player on lead may not call for trump unless the table allows it', () => {
  const g = new Game({ dealer: 3 });
  biddingTo(g, 0, 14);
  g.setTrump(0, g.hands[0][0]);
  notOk(g.canRequestReveal(g.turn), 'not on lead by default');

  const h = new Game({ dealer: 3, rules: { revealOnLead: true } });
  biddingTo(h, 0, 14);
  h.setTrump(0, h.hands[0][0]);
  ok(h.canRequestReveal(h.turn), 'allowed when the table says so');
});

check('turning trump up hands the card back to the caller', () => {
  const g = revealSetup();
  eq(g.hands[0].length, 6, 'caller set one aside and has played one');
  ok(g.requestReveal(1), 'seat 1 lifts it');
  ok(g.trumpRevealed, 'suit is public');
  eq(g.revealedBy, 1, 'credited to the asker, not the caller');
  eq(g.hands[0].length, 7, 'caller gets the card back');
  ok(g.hands[0].some((c) => sameCard(c, C('7s'))), 'and it is the right card');
  notOk(g.trumpHeld, 'nothing left face down');
});

check('whoever calls for trump owes that trick a trump', () => {
  const g = revealSetup();
  g.requestReveal(1);
  eq(g.legalCards(1), [C('Js')], 'seat 1 must play its only trump');
  g.playCard(1, C('Js'));
  g.playCard(2, C('7h'));
  g.playCard(3, C('Jc'));
  eq(g.trickWinner(), 1, 'the trump now takes it');
});

check('the obligation only binds the trick it was called on', () => {
  const g = revealSetup();
  g.requestReveal(1);
  g.playCard(1, C('Js'));
  g.playCard(2, C('7h'));
  g.playCard(3, C('Jc'));
  g.resolveTrick();
  eq(g.revealDebt(1), null, 'debt is settled once the trick is over');
});

check('a caller who lifts their own trump must play that very card', () => {
  // seat 0 holds only hearts and spades, so a club lead leaves them void
  const order = cards(
    'Ah', 'Kh', 'Qh', 'Jh',   // seat 0 — the caller
    '7c', '9c', '10c', 'Qc',  // seat 1 — leads clubs
    '7h', '8h', '9h', '10h',  // seat 2
    'Js', 'As', 'Ks', 'Qs',   // seat 3
    '7s', '8s', '9s', '10s',  // seat 0
    'Ac', 'Kc', 'Jc', '8c',   // seat 1
    '7d', '8d', '9d', '10d',  // seat 2
    'Jd', 'Ad', 'Kd', 'Qd'    // seat 3
  );
  const g = stacked(order, {}, 0);      // dealer 0 means seat 1 leads
  biddingTo(g, 0, 14);
  g.setTrump(0, C('7s'));
  eq(g.leader, 1, 'seat 1 leads');
  g.playCard(1, C('7c'));
  g.playCard(2, C('7h'));               // void in clubs, throws quietly
  g.playCard(3, C('Js'));               // void in clubs, throws a spade
  ok(g.canRequestReveal(0), 'caller is void in clubs and may lift it');
  g.requestReveal(0);
  eq(g.legalCards(0), [C('7s')], 'must play the card that was face down');
});

check('playing off-suit no longer turns the trump up by itself', () => {
  const g = revealSetup();
  g.playCard(1, C('9c'));               // void in hearts, discards a club
  notOk(g.trumpRevealed, 'trump stays secret when nobody asks');
});

check('a void player with no trump is free to throw anything', () => {
  // seat 1's eight cards are clubs and diamonds only — not a spade among them
  const order = cards(
    'Ah', 'Kh', 'Qh', 'Jh',   // seat 0 — caller, holds the spades
    '7c', '9c', '10c', 'Qc',  // seat 1
    '7h', '8h', '9h', '10h',  // seat 2
    'Js', 'As', 'Ks', 'Qs',   // seat 3
    '7s', '8s', '9s', '10s',  // seat 0
    '7d', '8d', '9d', '10d',  // seat 1
    'Ac', 'Kc', 'Jc', '8c',   // seat 2
    'Jd', 'Ad', 'Kd', 'Qd'    // seat 3
  );
  const g = stacked(order);
  biddingTo(g, 0, 14);
  g.setTrump(0, C('7s'));
  g.playCard(0, C('Ah'));
  notOk(g.hands[1].some((c) => c.s === 's'), 'seat 1 really has no trump');
  ok(g.canRequestReveal(1), 'may still ask');
  g.requestReveal(1);
  eq(g.legalCards(1).length, g.hands[1].length, 'no trump to owe, so no restriction');
});

check('an untouched trump comes back on its own before the last trick', () => {
  const g = new Game({ dealer: 3 });
  biddingTo(g, 0, 14);
  const held = g.hands[0][0];
  g.setTrump(0, held);
  eq(g.hands[0].length, 7, 'caller is a card short');

  // play it out without anyone ever asking for the turn-up
  while (g.phase === 'play') {
    if (g.trickComplete()) {
      const before = g.tricksPlayed;
      g.resolveTrick();
      if (before === 6) {   // the seventh trick has just been put away
        ok(g.trumpRevealed, 'the stranded card turns itself over');
        eq(g.revealedBy, null, 'nobody is credited with asking');
        eq(g.hands[0], [held], 'and it is back in the caller hand');
      }
      continue;
    }
    g.playCard(g.turn, g.legalCards(g.turn)[0]);
  }
  eq(g.tricksPlayed, 8, 'the hand still finishes');
  eq(g.points[0] + g.points[1], 28, 'every point accounted for');
});

check('an automatic turn-up carries no obligation', () => {
  const g = new Game({ dealer: 3 });
  biddingTo(g, 0, 14);
  g.setTrump(0, g.hands[0][0]);
  while (g.phase === 'play' && g.tricksPlayed < 7) {
    if (g.trickComplete()) { g.resolveTrick(); continue; }
    g.playCard(g.turn, g.legalCards(g.turn)[0]);
  }
  eq(g.revealDebt(0), null, 'no debt for the caller');
});

// ----------------------------------------------------------------- marriage

function marriageSetup(seat, rules) {
  // give `seat` the K and Q of spades, and make spades trump
  const hands = {
    0: cards('Ah', 'Kh', '7c', '8c', '9c', '10c', 'Qc', 'Jc'),
    1: cards('7h', '8h', '9h', '10h', 'Jh', 'Qh', 'Ac', 'Kc'),
    2: cards('7d', '8d', '9d', '10d', 'Jd', 'Qd', 'Kd', 'Ad'),
    3: cards('7s', '8s', '9s', '10s', 'Js', 'As', 'Ks', 'Qs')
  };
  // move K/Q of spades into the seat that should hold the marriage
  if (seat !== 3) {
    const donor = hands[3];
    const taker = hands[seat];
    for (const r of ['Ks', 'Qs']) {
      const i = donor.findIndex((c) => c.r + c.s === r);
      const j = taker.findIndex((c) => c.s !== 's');
      const swap = taker[j];
      taker[j] = donor[i];
      donor[i] = swap;
    }
  }
  const order = [];
  for (let p = 0; p < 4; p++) order.push(...hands[p].slice(0, 4));
  for (let p = 0; p < 4; p++) order.push(...hands[p].slice(4, 8));

  const g = stacked(order, rules);
  biddingTo(g, 0, 20);
  // the caller needs a spade to set as trump; seat 0 may not have one, so
  // force the suit directly
  g.trumpCard = C('7s');
  g.trumpSuit = 's';
  g.trumpHeld = false;
  g.trumpRevealed = true;
  g.phase = 'play';
  g.leader = 0;
  g.turn = 0;
  return g;
}

check('marriage needs both the King and Queen of trump', () => {
  const g = marriageSetup(0);
  ok(g.holdsMarriage(0), 'seat 0 holds K and Q of spades');
  notOk(g.holdsMarriage(1), 'seat 1 does not');
});

check('marriage cannot be declared before the trump is turned up', () => {
  const g = marriageSetup(0);
  g.trumpRevealed = false;
  notOk(g.canDeclareMarriage(0), 'suit is still secret');
  g.trumpRevealed = true;
  ok(g.canDeclareMarriage(0), 'fine once it is public');
});

check('the calling pair declaring brings the call down by four', () => {
  const g = marriageSetup(0);
  eq(g.target, 20, 'call before');
  ok(g.declareMarriage(0), 'declared');
  eq(g.target, 16, 'call after');
  eq(g.marriage.swing, -4, 'swing');
});

check('a marriage across the table pushes the call up by four', () => {
  const g = marriageSetup(1);
  g.turn = 1;
  eq(g.target, 20, 'call before');
  ok(g.declareMarriage(1), 'declared');
  eq(g.target, 24, 'call after');
});

check('defenders cannot declare when the table does not allow it', () => {
  const g = marriageSetup(1, { marriageDefenders: false });
  g.turn = 1;
  notOk(g.canDeclareMarriage(1), 'not permitted');
  eq(g.target, 20, 'call unmoved');
});

check('marriage can be switched off entirely', () => {
  const g = marriageSetup(0, { marriage: false });
  notOk(g.canDeclareMarriage(0), 'no marriage at this table');
});

check('a team only gets one declaration', () => {
  const g = marriageSetup(0);
  ok(g.declareMarriage(0), 'first');
  notOk(g.canDeclareMarriage(0), 'no second bite');
  ok(g.marriedTeams[0], 'team is marked');
});

check('a declared marriage moves what the callers have to find', () => {
  const g = marriageSetup(0);
  g.declareMarriage(0);
  g.points[0] = 16;
  eq(g.callLeft(), 0, 'nothing left to find');
  g.points[0] = 15;
  eq(g.callLeft(), 1, 'one short');
});

// --------------------------------------------------------------- last trick

check('the last trick point is off unless the table turns it on', () => {
  const plain = new Game({ dealer: 3 });
  eq(plain.maxPoints, 28, 'plain pack');
  const bonus = new Game({ dealer: 3, rules: { lastTrick: true } });
  eq(bonus.maxPoints, 29, 'pack plus the point');
});

check('the eighth trick pays an extra point when enabled', () => {
  const g = new Game({ dealer: 3, rules: { lastTrick: true } });
  biddingTo(g, 0, 14);
  g.setTrump(0, g.hands[0][0]);
  // run the hand out, always playing the first legal card
  while (g.phase === 'play') {
    if (g.trickComplete()) { g.resolveTrick(); continue; }
    g.playCard(g.turn, g.legalCards(g.turn)[0]);
  }
  eq(g.lastTrick.bonus, 1, 'bonus on the final trick');
  eq(g.points[0] + g.points[1], 29, 'total paid out');
});

check('without the option the pack still totals 28', () => {
  const g = new Game({ dealer: 3 });
  biddingTo(g, 0, 14);
  g.setTrump(0, g.hands[0][0]);
  while (g.phase === 'play') {
    if (g.trickComplete()) { g.resolveTrick(); continue; }
    g.playCard(g.turn, g.legalCards(g.turn)[0]);
  }
  eq(g.lastTrick.bonus, 0, 'no bonus');
  eq(g.points[0] + g.points[1], 28, 'total paid out');
});

// ------------------------------------------------------------- a whole hand

check('a full hand plays out to eight tricks and a verdict', () => {
  for (let seed = 0; seed < 60; seed++) {
    let s = seed + 1;
    const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const g = new Game({ dealer: seed % 4, rng, rules: { lastTrick: seed % 2 === 0 } });

    while (g.phase === 'bid1' || g.phase === 'bid2') {
      if (g.turn === (seed % 4) && g.canBid(16)) g.placeBid(g.turn, 16);
      else g.passBid(g.turn);
    }
    g.setTrump(g.bid.player, g.hands[g.bid.player][0]);

    while (g.phase === 'play') {
      if (g.trickComplete()) { g.resolveTrick(); continue; }
      const seat = g.turn;
      // ask for trump the moment it is legal, to exercise the turn-up path
      if (g.canRequestReveal(seat) && seat % 2 === 0) g.requestReveal(seat);
      if (g.canDeclareMarriage(seat)) g.declareMarriage(seat);
      const legal = g.legalCards(seat);
      ok(legal.length > 0, `seat ${seat} has a legal card`);
      g.playCard(seat, legal[legal.length - 1]);
    }

    eq(g.tricksPlayed, 8, `seed ${seed}: tricks played`);
    eq(g.tricksWon[0] + g.tricksWon[1], 8, `seed ${seed}: tricks shared out`);
    eq(g.points[0] + g.points[1], g.maxPoints, `seed ${seed}: every point accounted for`);
    eq(g.hands.map((h) => h.length), [0, 0, 0, 0], `seed ${seed}: hands empty`);
    ok(g.result, `seed ${seed}: result`);
    eq(g.result.made, g.points[g.result.bidTeam] >= g.result.target, `seed ${seed}: verdict`);
    eq(g.result.youWon, g.result.made ? g.result.bidTeam === 0 : g.result.bidTeam === 1,
      `seed ${seed}: who won`);
  }
});

check('following suit is enforced for every seat, every trick', () => {
  for (let seed = 0; seed < 40; seed++) {
    let s = seed + 991;
    const rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const g = new Game({ dealer: seed % 4, rng });
    while (g.phase === 'bid1' || g.phase === 'bid2') g.passBid(g.turn);
    g.setTrump(g.bid.player, g.hands[g.bid.player][0]);

    while (g.phase === 'play') {
      if (g.trickComplete()) { g.resolveTrick(); continue; }
      const seat = g.turn;
      const lead = g.leadSuit();
      const legal = g.legalCards(seat);
      if (lead && g.hands[seat].some((c) => c.s === lead)) {
        ok(legal.every((c) => c.s === lead), `seed ${seed}: must follow ${lead}`);
      }
      // an illegal card is refused outright
      const illegal = g.hands[seat].find((c) => !legal.some((l) => sameCard(l, c)));
      if (illegal) notOk(g.playCard(seat, illegal), `seed ${seed}: illegal play refused`);
      g.playCard(seat, legal[0]);
    }
  }
});

check('partners sit opposite and share a score', () => {
  eq([0, 1, 2, 3].map(teamOf), [0, 1, 0, 1], 'seat to team');
});

// -------------------------------------------------------------- rule config

check('rule options normalize to a full, clean set', () => {
  const r = Rules.normalize({ lastTrick: true });
  eq(Object.keys(r).sort(), Object.keys(Rules.DEFAULTS).sort(), 'keys');
  ok(r.lastTrick, 'kept what was asked for');
  ok(r.hiddenTrump, 'filled in the rest');
});

check('joker mode is pinned off', () => {
  notOk(Rules.normalize({ joker: true }).joker, 'cannot be switched on');
  ok(Rules.META.find((m) => m.key === 'joker').locked, 'shown as locked');
});

check('tournament mode fixes the rule set', () => {
  const r = Rules.normalize({ tournament: true, lastTrick: true, hiddenTrump: false });
  ok(r.tournament, 'tournament');
  ok(r.hiddenTrump, 'hidden trump is forced back on');
  notOk(r.lastTrick, 'no last-trick point in a draw');
  eq(r, Rules.preset('tournament'), 'matches the preset exactly');
});

check('a dependent option switches itself off with its parent', () => {
  const r = Rules.normalize({ marriage: false, marriageDefenders: true });
  notOk(r.marriageDefenders, 'no defenders rule without marriage');
  const o = Rules.normalize({ hiddenTrump: false, revealOnLead: true });
  notOk(o.revealOnLead, 'nothing to turn up at an open table');
});

check('an open-trump table never offers a turn-up', () => {
  const g = new Game({ dealer: 3, rules: { hiddenTrump: false } });
  biddingTo(g, 0, 14);
  g.setTrump(0, g.hands[0][0]);
  for (let p = 0; p < 4; p++) notOk(g.canRequestReveal(p), `seat ${p}`);
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
