/* Twenty-Eight — rules engine.
   Seats: 0 = You (south), 1 = Left (west), 2 = Top (north), 3 = Right (east).
   Teams: {0,2} "us" and {1,3} "them". Play passes anti-clockwise 0 -> 1 -> 2 -> 3.

   The table's rule set lives in `game.rules` (see rules.js). The engine never
   assumes a variation — it asks. */

(function () {
  const Rules = (typeof module === 'object' && module.exports)
    ? require('./rules.js')
    : window.T28Rules;

  const SUITS = ['s', 'h', 'c', 'd'];
  const SUIT_NAME = { s: 'spades', h: 'hearts', c: 'clubs', d: 'diamonds' };

  // high to low
  const RANKS = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
  const POINTS = { J: 3, '9': 2, A: 1, '10': 1, K: 0, Q: 0, '8': 0, '7': 0 };

  const MIN_BID = 14;
  const MAX_BID = 28;
  const DECK_POINTS = 28;
  const MARRIAGE_SWING = 4;

  const rankPower = (r) => RANKS.length - RANKS.indexOf(r); // higher is stronger
  const cardPoints = (c) => POINTS[c.r];
  const sameCard = (a, b) => a.r === b.r && a.s === b.s;

  function buildDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
    return deck;
  }

  function shuffle(deck, rng) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  const teamOf = (p) => (p % 2 === 0 ? 0 : 1); // 0 = us (you + top), 1 = them
  const nextSeat = (p) => (p + 1) % 4;

  /* Sort a hand by suit then strength, so the fan stays readable between tricks. */
  function sortHand(hand) {
    return hand.slice().sort((a, b) => {
      if (a.s !== b.s) return SUITS.indexOf(a.s) - SUITS.indexOf(b.s);
      return rankPower(b.r) - rankPower(a.r);
    });
  }

  class Game {
    constructor(opts = {}) {
      this.rng = opts.rng || Math.random;
      this.dealer = opts.dealer == null ? 3 : opts.dealer;
      this.rules = Rules.normalize(opts.rules);
      this.log = [];
      this.reset();
    }

    reset() {
      const deck = shuffle(buildDeck(), this.rng);
      this.deck = deck;
      this.hands = [[], [], [], []];
      for (let p = 0; p < 4; p++) this.hands[p] = sortHand(deck.slice(p * 4, p * 4 + 4));
      this.rest = deck.slice(16);

      this.phase = 'bid1';
      this.bid = null;                 // { value, player }
      this.passed = [false, false, false, false];
      this.turn = nextSeat(this.dealer);

      this.trumpCard = null;           // the card itself, whether held or in hand
      this.trumpSuit = null;
      this.trumpHeld = false;          // face down, out of the caller's hand
      this.trumpRevealed = false;
      this.revealedBy = null;
      this.revealTrick = null;         // which trick the turn-up happened on

      this.marriage = null;            // { player, team, swing }
      this.marriedTeams = [false, false];

      this.trick = [];                 // [{ player, card }]
      this.leader = null;
      this.tricksPlayed = 0;
      this.tricksWon = [0, 0];
      this.points = [0, 0];            // captured card points, by team
      this.lastTrick = null;
      this.result = null;
      this.log = [];
    }

    // ---------------------------------------------------------------- bidding

    get minLegalBid() {
      return this.bid ? this.bid.value + 1 : MIN_BID;
    }

    canBid(value) {
      return value >= this.minLegalBid && value <= MAX_BID;
    }

    /* Everyone except the standing high bidder still gets a say. */
    activeBidders() {
      const out = [];
      for (let p = 0; p < 4; p++) {
        if (this.passed[p]) continue;
        if (this.bid && this.bid.player === p) continue;
        out.push(p);
      }
      return out;
    }

    placeBid(player, value) {
      if (this.phase !== 'bid1' && this.phase !== 'bid2') return false;
      if (player !== this.turn || !this.canBid(value)) return false;
      this.bid = { value, player };
      this.log.push({ t: 'bid', player, value });
      this.advanceBidding();
      return true;
    }

    passBid(player) {
      if (this.phase !== 'bid1' && this.phase !== 'bid2') return false;
      if (player !== this.turn) return false;
      this.passed[player] = true;
      this.log.push({ t: 'pass', player });
      this.advanceBidding();
      return true;
    }

    advanceBidding() {
      if (this.activeBidders().length === 0) return this.closeBidding();

      let p = this.turn;
      for (let i = 0; i < 4; i++) {
        p = nextSeat(p);
        if (!this.passed[p] && !(this.bid && this.bid.player === p)) {
          this.turn = p;
          return;
        }
      }
      this.closeBidding();
    }

    closeBidding() {
      if (this.phase === 'bid1') {
        // nobody opened: the seat left of the dealer is forced to the minimum
        if (!this.bid) {
          const forced = nextSeat(this.dealer);
          this.bid = { value: MIN_BID, player: forced };
          this.log.push({ t: 'forced', player: forced, value: MIN_BID });
        }
        // deal the remaining four to each player
        for (let p = 0; p < 4; p++) {
          this.hands[p] = sortHand(this.hands[p].concat(this.rest.slice(p * 4, p * 4 + 4)));
        }
        this.rest = [];
        this.phase = 'bid2';
        this.passed = [false, false, false, false];
        // the standing bidder sits out round two; everyone else may raise
        this.turn = nextSeat(this.bid.player);
        if (this.activeBidders().length === 0) return this.closeBidding();
        return;
      }

      // bid2 done — the high bidder names trump
      this.phase = 'trump';
      this.turn = this.bid.player;
    }

    // ------------------------------------------------------------------ trump

    /* The caller commits a card. Under hidden trump it leaves their hand and
       sits face down until somebody calls for it — so the caller plays the
       hand a card short, and cannot use that card to follow suit. Under open
       trump the card only names the suit and stays where it is. */
    setTrump(player, card) {
      if (this.phase !== 'trump' || player !== this.bid.player) return false;
      const idx = this.hands[player].findIndex((c) => sameCard(c, card));
      if (idx === -1) return false;

      this.trumpCard = this.hands[player][idx];
      this.trumpSuit = this.trumpCard.s;

      if (this.rules.hiddenTrump) {
        this.hands[player].splice(idx, 1);
        this.trumpHeld = true;
        this.trumpRevealed = false;
      } else {
        this.trumpHeld = false;
        this.trumpRevealed = true;    // everybody can see it from the off
        this.revealedBy = null;
      }

      this.log.push({ t: 'trump', player, hidden: this.rules.hiddenTrump });
      this.phase = 'play';
      this.leader = nextSeat(this.dealer);
      this.turn = this.leader;
      return true;
    }

    /* Open-trump tables can name a suit directly rather than pointing at a card. */
    setTrumpSuit(player, suit) {
      if (this.rules.hiddenTrump) return false;
      const card = this.hands[player] && this.hands[player].find((c) => c.s === suit);
      if (!card) return false;
      return this.setTrump(player, card);
    }

    // ------------------------------------------------------------- turn-up

    /* Anyone at the table may call for the trump, but not from nowhere: you
       have to be on turn and out of the suit that was led. Some tables also
       let the player on lead turn it up before choosing — that is `revealOnLead`. */
    canRequestReveal(player) {
      if (this.phase !== 'play') return false;
      if (!this.rules.hiddenTrump || this.trumpRevealed) return false;
      if (player !== this.turn || this.trickComplete()) return false;
      const lead = this.leadSuit();
      if (!lead) return !!this.rules.revealOnLead;
      return !this.hands[player].some((c) => c.s === lead);
    }

    /* Lift the face-down card. Whoever asks does the lifting — the caller does
       not have to out themselves. The card goes back to the caller's hand,
       which is what makes turning it up a real decision: it hands the calling
       pair a card they could not otherwise use. */
    requestReveal(player) {
      if (!this.canRequestReveal(player)) return false;

      this.trumpRevealed = true;
      this.revealedBy = player;
      this.revealTrick = this.tricksPlayed;

      const caller = this.bid.player;
      this.hands[caller] = sortHand(this.hands[caller].concat([this.trumpCard]));
      this.trumpHeld = false;

      this.log.push({ t: 'reveal', player, suit: this.trumpSuit });
      return true;
    }

    /* If nobody ever asks, the caller eventually runs out of the seven cards
       they kept and the face-down card is all they have left. At that point it
       goes back to their hand and turns over on its own — they have to play it,
       so there is nothing left to hide. No obligation attaches to a turn-up
       that nobody called for. */
    settleHeldTrump() {
      if (!this.trumpHeld || !this.bid) return false;
      if (this.hands[this.bid.player].length > 0) return false;

      this.hands[this.bid.player] = [this.trumpCard];
      this.trumpHeld = false;
      this.trumpRevealed = true;
      this.revealedBy = null;
      this.revealTrick = null;
      this.log.push({ t: 'reveal', player: null, suit: this.trumpSuit, auto: true });
      return true;
    }

    /* True while the seat that called for the turn-up still owes this trick a
       trump. The caller owes the actual card they had put down. */
    revealDebt(player) {
      if (!this.rules.revealObligation) return null;
      if (!this.trumpRevealed || this.revealedBy !== player) return null;
      if (this.revealTrick !== this.tricksPlayed) return null;

      const hand = this.hands[player];
      if (player === this.bid.player && hand.some((c) => sameCard(c, this.trumpCard))) {
        return [this.trumpCard];
      }
      const trumps = hand.filter((c) => c.s === this.trumpSuit);
      return trumps.length ? trumps : null;
    }

    // ---------------------------------------------------------------- marriage

    /* A marriage is the King and Queen of trump in one hand. It can only be
       claimed once the suit is public, which is what stops it from leaking the
       trump before anybody has turned it up. */
    holdsMarriage(player) {
      if (!this.trumpSuit) return false;
      const hand = this.hands[player];
      return hand.some((c) => c.s === this.trumpSuit && c.r === 'K') &&
             hand.some((c) => c.s === this.trumpSuit && c.r === 'Q');
    }

    canDeclareMarriage(player) {
      if (!this.rules.marriage) return false;
      if (this.phase !== 'play' || !this.trumpRevealed) return false;
      if (player !== this.turn || this.trickComplete()) return false;
      if (this.marriage) return false;
      if (this.marriedTeams[teamOf(player)]) return false;
      if (teamOf(player) !== teamOf(this.bid.player) && !this.rules.marriageDefenders) return false;
      return this.holdsMarriage(player);
    }

    /* Declared by the calling pair the call comes down by four; declared from
       across the table it goes up by four, and the callers have that much more
       to find. */
    declareMarriage(player) {
      if (!this.canDeclareMarriage(player)) return false;
      const team = teamOf(player);
      const swing = team === teamOf(this.bid.player) ? -MARRIAGE_SWING : MARRIAGE_SWING;
      this.marriage = { player, team, swing, suit: this.trumpSuit };
      this.marriedTeams[team] = true;
      this.log.push({ t: 'marriage', player, swing });
      return true;
    }

    // ------------------------------------------------------------------ target

    /* Every point on the table this hand — the pack, plus the last-trick point
       if this table plays one. */
    get maxPoints() {
      return DECK_POINTS + (this.rules.lastTrick ? 1 : 0);
    }

    /* What the calling pair actually has to find, once a marriage is counted. */
    get target() {
      if (!this.bid) return null;
      const swing = this.marriage ? this.marriage.swing : 0;
      return Math.max(1, this.bid.value + swing);
    }

    /* Points the bidding team still needs. */
    callLeft() {
      if (!this.bid) return null;
      return Math.max(0, this.target - this.points[teamOf(this.bid.player)]);
    }

    // ------------------------------------------------------------------- play

    leadSuit() {
      return this.trick.length ? this.trick[0].card.s : null;
    }

    /* Follow suit if you can. If you cannot, and you are the one who just
       turned the trump up, you owe this trick a trump. Otherwise anything goes. */
    legalCards(player) {
      const hand = this.hands[player];
      const lead = this.leadSuit();
      if (lead) {
        const follow = hand.filter((c) => c.s === lead);
        if (follow.length) return follow;
      }
      const debt = this.revealDebt(player);
      if (debt) return debt.slice();
      return hand.slice();
    }

    /* True when this player has nothing in the suit that was led. */
    isVoidInLead(player) {
      const lead = this.leadSuit();
      if (!lead) return false;
      return !this.hands[player].some((c) => c.s === lead);
    }

    playCard(player, card) {
      if (this.phase !== 'play' || player !== this.turn) return false;
      const legal = this.legalCards(player);
      if (!legal.some((c) => sameCard(c, card))) return false;

      const idx = this.hands[player].findIndex((c) => sameCard(c, card));
      this.hands[player].splice(idx, 1);
      this.trick.push({ player, card });
      this.log.push({ t: 'play', player, card });

      if (this.trick.length === 4) return true;   // caller resolves after a beat
      this.turn = nextSeat(player);
      return true;
    }

    trickComplete() {
      return this.trick.length === 4;
    }

    /* Trump only bites once it is face up. A trump played into a trick before
       the turn-up still counts as a trump — the suit was always trump, it was
       just nobody's business yet. */
    trickWinner() {
      const lead = this.trick[0].card.s;
      const trump = this.trumpRevealed ? this.trumpSuit : null;
      let best = this.trick[0];
      for (const t of this.trick.slice(1)) {
        const bestTrump = trump && best.card.s === trump;
        const thisTrump = trump && t.card.s === trump;
        if (thisTrump && !bestTrump) { best = t; continue; }
        if (bestTrump && !thisTrump) continue;
        const suit = bestTrump ? trump : lead;
        if (t.card.s === suit && best.card.s === suit && rankPower(t.card.r) > rankPower(best.card.r)) best = t;
      }
      return best.player;
    }

    resolveTrick() {
      const winner = this.trickWinner();
      const team = teamOf(winner);
      const cards = this.trick.slice();
      let pts = cards.reduce((n, t) => n + cardPoints(t.card), 0);

      this.tricksWon[team] += 1;
      this.tricksPlayed += 1;

      const bonus = (this.rules.lastTrick && this.tricksPlayed === 8) ? 1 : 0;
      pts += bonus;
      this.points[team] += pts;

      this.lastTrick = { winner, team, pts, bonus, cards };
      this.trick = [];
      this.leader = winner;
      this.turn = winner;

      const stranded = this.settleHeldTrump();
      this.lastTrick.autoReveal = stranded;

      if (this.tricksPlayed === 8) this.finish();
      return this.lastTrick;
    }

    finish() {
      const bidTeam = teamOf(this.bid.player);
      const target = this.target;
      const made = this.points[bidTeam] >= target;
      this.result = {
        made,
        bidTeam,
        bid: this.bid.value,
        target,
        bidder: this.bid.player,
        points: this.points.slice(),
        tricks: this.tricksWon.slice(),
        marriage: this.marriage ? Object.assign({}, this.marriage) : null,
        lastTrickBonus: this.rules.lastTrick ? (this.lastTrick ? this.lastTrick.bonus : 0) : 0,
        lastTrickWinner: this.lastTrick ? this.lastTrick.winner : null,
        trumpSuit: this.trumpSuit,
        trumpRevealed: this.trumpRevealed,
        youWon: made ? bidTeam === 0 : bidTeam === 1
      };
      this.phase = 'over';
    }
  }

  const API = {
    Game, SUITS, SUIT_NAME, RANKS, POINTS, MIN_BID, MAX_BID, DECK_POINTS, MARRIAGE_SWING,
    rankPower, cardPoints, sameCard, teamOf, nextSeat, sortHand, buildDeck, shuffle
  };

  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.T28 = API;
})();
