/* Twenty-Eight — the match layer that sits above a single deal.

   A match is one or more hands. "Single round" is one hand and done. A
   "multi round" match keeps dealing until a pair reaches the target.

   Game points follow the call: the bigger the call, the more it is worth to
   make it and the more it costs to fall short. Every hand pays its game
   points to exactly one pair — the callers if they made it, the other pair if
   they broke it — so a match always ends on a call won or a call lost. */

(function () {
  // what a hand is worth, by the call that was standing when it was played
  const TIERS = [
    { upto: 19, gp: 1 },
    { upto: 24, gp: 2 },
    { upto: 28, gp: 3 }
  ];
  const TARGETS = [4, 6, 8];
  const DEFAULT_TARGET = 6;

  const SOURCE_LABEL = { offline: 'Offline', online: 'Online', room: 'Private', tournament: 'Tournament' };

  function handGamePoints(bid) {
    for (const t of TIERS) if (bid <= t.upto) return t.gp;
    return TIERS[TIERS.length - 1].gp;
  }

  function clampTarget(n) {
    const t = Math.round(+n);
    return TARGETS.includes(t) ? t : DEFAULT_TARGET;
  }

  /* One line of plain English for the game-point ladder, used in the rules
     sheet and under the format picker so the table never has to be guessed at. */
  function ladderText() {
    return TIERS.map((t, i) => {
      const from = i === 0 ? 14 : TIERS[i - 1].upto + 1;
      return `${from}–${t.upto} pays ${t.gp}`;
    }).join(' · ');
  }

  class Match {
    constructor(cfg = {}) {
      this.mode = cfg.mode === 'multi' ? 'multi' : 'single';
      this.target = this.mode === 'multi' ? clampTarget(cfg.target) : 1;
      this.source = SOURCE_LABEL[cfg.source] ? cfg.source : 'offline';
      this.tournament = !!cfg.tournament;
      this.rules = cfg.rules || null;    // the rule set every hand is played under
      this.code = cfg.code || null;      // room code, when a private table
      this.score = [0, 0];               // game points, by team
      this.hands = [];
      this.handNo = 0;
    }

    get multi() { return this.mode === 'multi'; }
    get sourceLabel() { return SOURCE_LABEL[this.source]; }
    get formatLabel() {
      if (!this.multi) return 'Single Round';
      return this.tournament ? `Draw to ${this.target}` : `Match to ${this.target}`;
    }

    /* Points each side still needs to take the match. */
    get needs() {
      return [Math.max(0, this.target - this.score[0]), Math.max(0, this.target - this.score[1])];
    }

    get over() {
      if (!this.multi) return this.hands.length > 0;
      return this.score[0] >= this.target || this.score[1] >= this.target;
    }

    /* Team index that took the match, or null while it is still running. */
    get winner() {
      if (!this.over) return null;
      if (!this.multi) {
        const last = this.hands[this.hands.length - 1];
        return last ? last.team : null;
      }
      return this.score[0] >= this.target ? 0 : 1;
    }

    /* Called as each deal begins, so the table can show "Hand 3". */
    nextHand() {
      this.handNo += 1;
      return this.handNo;
    }

    /* Fold a finished deal into the running score. Returns what that hand paid. */
    applyHand(result) {
      const gp = handGamePoints(result.bid);
      const team = result.made ? result.bidTeam : 1 - result.bidTeam;
      this.score[team] += gp;
      const entry = {
        no: this.handNo || this.hands.length + 1,
        bid: result.bid,
        bidder: result.bidder,
        bidTeam: result.bidTeam,
        made: result.made,
        points: result.points.slice(),
        gp,
        team,
        score: this.score.slice()
      };
      this.hands.push(entry);
      return entry;
    }
  }

  window.T28Match = { Match, handGamePoints, ladderText, TARGETS, DEFAULT_TARGET, TIERS };
})();
