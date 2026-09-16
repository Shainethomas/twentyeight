/* Opponent brains. Each seat has a temperament that shifts how far it will push a bid
   and how readily it throws points at a partner's trick.

   Information discipline: only the caller knows the trump suit before it is
   turned up. Every other seat reasons about it the way a player at the table
   does — the card face down is one of the cards it cannot see, so a suit it
   already holds a lot of is the less likely trump. Nothing here reads the
   trump suit on behalf of a seat that has not earned the right to know it. */

(function () {
  const T28 = (typeof module === 'object' && module.exports)
    ? require('./engine.js')
    : window.T28;

  const { SUITS, RANKS, rankPower, cardPoints, teamOf, MIN_BID, MAX_BID } = T28;

  const PERSONAS = {
    0: { name: 'You',       nerve: 1.00, generosity: 0.80 }, // stand-in when the seat is automated
    1: { name: 'Kunjappan', nerve: 1.18, generosity: 0.85 }, // card shark, overbids on purpose
    2: { name: 'Colonel',   nerve: 0.86, generosity: 1.00 }, // your partner, disciplined
    3: { name: 'Rohan',     nerve: 1.08, generosity: 0.70 }  // college, chases jacks
  };
  const DEFAULT_PERSONA = { name: 'Player', nerve: 1.0, generosity: 0.8 };
  const persona = (seat) => PERSONAS[seat] || DEFAULT_PERSONA;

  const hasMarriageIn = (hand, s) =>
    hand.some((c) => c.s === s && c.r === 'K') && hand.some((c) => c.s === s && c.r === 'Q');
  const hasAnyMarriage = (hand) => SUITS.some((s) => hasMarriageIn(hand, s));

  /* Rough worth of a hand, expressed on the same 28-point scale as the bid. */
  function handStrength(hand) {
    const bySuit = {};
    for (const c of hand) (bySuit[c.s] = bySuit[c.s] || []).push(c);

    let score = 0;
    for (const s of SUITS) {
      const cards = bySuit[s] || [];
      let suitScore = 0;
      for (const c of cards) {
        suitScore += cardPoints(c) * 1.35;          // jacks and nines carry the hand
        if (c.r === 'J') suitScore += 1.6;
        else if (c.r === '9') suitScore += 1.1;
        else if (c.r === 'A') suitScore += 0.7;
      }
      if (cards.length >= 4) suitScore += 2.4;      // length is trump potential
      else if (cards.length === 3) suitScore += 1.0;
      score += suitScore;
    }
    // voids and singletons are good once trump is yours
    for (const s of SUITS) {
      const n = (bySuit[s] || []).length;
      if (n === 0) score += 1.4;
      else if (n === 1) score += 0.5;
    }
    return score;
  }

  /* What this seat is willing to call, given how many cards it has seen.
     Calibrated against the measured strength spread: a median eight-card hand
     scores about 15, the top tenth about 22. A ceiling below MIN_BID means the
     seat has nothing and should stay out of the auction entirely. */
  function bidCeiling(seat, hand, rules) {
    const p = persona(seat);
    const raw = handStrength(hand);
    const est = hand.length === 4 ? raw * 1.7 : raw;   // round one is guessing at four unseen cards
    let ceiling = 4.9 + 0.735 * est;
    if (hand.length === 4) ceiling = MIN_BID + (ceiling - MIN_BID) * 0.85;  // so temper it
    ceiling = MIN_BID + (ceiling - MIN_BID) * p.nerve;

    if (rules) {
      // a King and Queen together is four points off the call, if it can be declared
      if (rules.marriage && hasAnyMarriage(hand)) ceiling += 1.6;
      if (rules.lastTrick) ceiling += 0.4;            // one more point on the table
    }
    return Math.min(MAX_BID, Math.round(ceiling));
  }

  function decideBid(game, seat) {
    const hand = game.hands[seat];
    const ceiling = bidCeiling(seat, hand, game.rules);
    const need = game.minLegalBid;

    if (need > ceiling) return { action: 'pass' };

    // leave your partner's call standing unless you are clearly the stronger hand
    if (game.bid && teamOf(game.bid.player) === teamOf(seat) && need > ceiling - 3) {
      return { action: 'pass' };
    }

    // sometimes sit on a good hand rather than bidding it up
    if (game.bid && Math.random() < 0.18 && need > ceiling - 2) return { action: 'pass' };

    return { action: 'bid', value: need };
  }

  /* Name trump: the longest suit, then set aside its weakest card so the good
     ones stay playable. When marriage is live the King and Queen of that suit
     stay in hand — putting half a marriage face down throws four points away. */
  function chooseTrump(game, seat) {
    const hand = game.hands[seat];
    const bySuit = {};
    for (const c of hand) (bySuit[c.s] = bySuit[c.s] || []).push(c);

    let best = null, bestScore = -Infinity;
    for (const s of SUITS) {
      const cards = bySuit[s] || [];
      if (!cards.length) continue;
      const score = cards.length * 2.6 +
        cards.reduce((n, c) => n + cardPoints(c) + (c.r === 'J' ? 1.4 : 0), 0);
      if (score > bestScore) { bestScore = score; best = s; }
    }

    const cards = bySuit[best];
    const keepPair = game.rules.marriage && hasMarriageIn(hand, best);
    const pool = keepPair ? cards.filter((c) => c.r !== 'K' && c.r !== 'Q') : cards;
    const from = pool.length ? pool : cards;
    return from.reduce((lo, c) => (rankPower(c.r) < rankPower(lo.r) ? c : lo), from[0]);
  }

  // --------------------------------------------------------- what a seat knows

  /* The trump suit, but only for a seat entitled to it. */
  function knownTrump(game, seat) {
    if (game.trumpRevealed) return game.trumpSuit;
    if (game.bid && game.bid.player === seat) return game.trumpSuit;
    return null;
  }

  /* For a seat that does not know: how likely is each suit to be the one face
     down? The card under there is one of the cards this seat has not seen, so
     the odds run with how much of each suit is still unaccounted for. */
  function trumpOdds(game, seat) {
    const seen = {};
    for (const s of SUITS) seen[s] = 0;
    for (const c of game.hands[seat]) seen[c.s]++;
    for (const e of game.log) if (e.t === 'play') seen[e.card.s]++;

    const unseen = {};
    let total = 0;
    for (const s of SUITS) {
      unseen[s] = Math.max(0, RANKS.length - seen[s]);
      total += unseen[s];
    }
    const odds = {};
    for (const s of SUITS) odds[s] = total ? unseen[s] / total : 0.25;
    return odds;
  }

  /* Who is taking the trick right now, played out under `trump`. Pass null to
     ask the question with no trump in play. */
  function bestUnder(game, trump) {
    if (!game.trick.length) return null;
    const lead = game.trick[0].card.s;
    let best = game.trick[0];
    for (const t of game.trick.slice(1)) {
      const bt = trump && best.card.s === trump;
      const tt = trump && t.card.s === trump;
      if (tt && !bt) { best = t; continue; }
      if (bt && !tt) continue;
      const suit = bt ? trump : lead;
      if (t.card.s === suit && best.card.s === suit && rankPower(t.card.r) > rankPower(best.card.r)) best = t;
    }
    return best;
  }

  /* Would `card` take the trick as it stands, if `trump` were the trump suit? */
  function beatsWith(game, card, trump) {
    const best = bestUnder(game, trump);
    if (!best) return true;
    const lead = game.trick[0].card.s;
    const bt = trump && best.card.s === trump;
    const ct = trump && card.s === trump;
    if (ct && !bt) return true;
    if (bt && !ct) return false;
    const suit = bt ? trump : lead;
    if (card.s !== suit) return false;
    return rankPower(card.r) > rankPower(best.card.r);
  }

  // trump only bites once it is face up, so live evaluation uses that and nothing else
  const liveTrump = (game) => (game.trumpRevealed ? game.trumpSuit : null);
  const currentBestInTrick = (game) => bestUnder(game, liveTrump(game));
  const beatsCurrent = (game, card) => beatsWith(game, card, liveTrump(game));
  const potOf = (game) => game.trick.reduce((n, t) => n + cardPoints(t.card), 0);

  // ------------------------------------------------------------- the turn-up

  /* Should this seat call for the trump to be lifted?

     Asking costs something real: the suit goes public for everybody, and on
     most tables whoever asked owes that trick a trump. So it is worth doing
     only when there is a pot worth taking and a fair chance of taking it.

     The caller knows the suit and can answer exactly. Everyone else weighs the
     pot across the suits the trump might turn out to be. */
  function decideReveal(game, seat) {
    if (!game.canRequestReveal(seat)) return false;

    const p = persona(seat);
    const best = currentBestInTrick(game);
    if (best && teamOf(best.player) === teamOf(seat)) return false;  // partner has it already

    const pot = potOf(game);
    const lastToPlay = game.trick.length === 3;
    const tricksLeft = 8 - game.tricksPlayed;

    // how badly does this seat's side need to change the story?
    const bidTeam = teamOf(game.bid.player);
    const short = Math.max(0, game.target - game.points[bidTeam]);
    const urgency = teamOf(seat) === bidTeam
      ? (short > tricksLeft * 2 ? 1.5 : 1.0)     // the callers are behind the clock
      : (short <= 3 ? 1.4 : 1.0);                // the defenders have to start trumping

    let gain;
    if (game.bid.player === seat) {
      // the caller knows the suit, and asking hands their own card back
      const trump = game.trumpSuit;
      const canWin = game.hands[seat].some((c) => c.s === trump && beatsWith(game, c, trump)) ||
                     beatsWith(game, game.trumpCard, trump);
      gain = canWin ? pot + 1.2 : 0;
    } else {
      const odds = trumpOdds(game, seat);
      gain = 0;
      for (const s of SUITS) {
        if (!odds[s]) continue;
        if (game.hands[seat].some((c) => c.s === s && beatsWith(game, c, s))) gain += odds[s] * pot;
      }
    }

    // a trick with nothing in it is rarely worth going public for
    const bar = (lastToPlay ? 1.0 : 1.8) / (p.nerve * urgency);
    if (gain < bar) return false;

    // late in the hand there is less left to protect, so ask more readily
    return tricksLeft <= 3 || gain >= bar * 1.15 || Math.random() < 0.5;
  }

  /* Marriage is pure gain to whoever holds it — four off the call for the
     calling pair, four onto it from across the table — and sitting on it risks
     being forced to part with the King or Queen. Declare the moment it is legal. */
  function decideMarriage(game, seat) {
    return game.canDeclareMarriage(seat);
  }

  // ------------------------------------------------------------------- play

  const highest = (cards) => cards.reduce((hi, c) => (rankPower(c.r) > rankPower(hi.r) ? c : hi), cards[0]);
  const cheapest = (cards) => cards.reduce(
    (lo, c) => (cardPoints(c) < cardPoints(lo) || (cardPoints(c) === cardPoints(lo) && rankPower(c.r) < rankPower(lo.r)) ? c : lo),
    cards[0]
  );
  const richest = (cards) => cards.reduce((hi, c) => (cardPoints(c) > cardPoints(hi) ? c : hi), cards[0]);

  function decidePlay(game, seat) {
    const legal = game.legalCards(seat);
    if (legal.length === 1) return legal[0];
    const p = persona(seat);
    const trump = knownTrump(game, seat);

    // leading
    if (!game.trick.length) {
      // with trump up and length in it, the calling side draws the others out
      if (game.trumpRevealed && teamOf(seat) === teamOf(game.bid.player)) {
        const trumps = legal.filter((c) => c.s === game.trumpSuit);
        if (trumps.length >= 3) return highest(trumps);
      }
      // otherwise keep your own trumps back, including ones only you know about
      const plain = trump ? legal.filter((c) => c.s !== trump) : legal;
      const pool = plain.length ? plain : legal;
      const tops = pool.filter((c) => c.r === 'J' || c.r === '9');
      if (tops.length && Math.random() < 0.55) return highest(tops);
      return highest(pool);
    }

    const best = currentBestInTrick(game);
    const partnerWinning = best && teamOf(best.player) === teamOf(seat);
    const winners = legal.filter((c) => beatsCurrent(game, c));
    const lastToPlay = game.trick.length === 3;

    // partner already has it — feed the trick, more freely the more generous the seat
    if (partnerWinning) {
      if (lastToPlay || Math.random() < p.generosity) return richest(legal);
      return cheapest(legal);
    }

    if (winners.length) {
      const pot = potOf(game);
      // worth spending a big card only when there is something in the pot, or we are last
      if (pot > 0 || lastToPlay || Math.random() < 0.6) {
        return winners.reduce((lo, c) => (rankPower(c.r) < rankPower(lo.r) ? c : lo), winners[0]);
      }
    }

    return cheapest(legal);
  }

  const API = {
    PERSONAS, handStrength, bidCeiling, decideBid, chooseTrump,
    decideReveal, decideMarriage, decidePlay,
    knownTrump, trumpOdds, beatsWith
  };

  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.T28AI = API;
})();
