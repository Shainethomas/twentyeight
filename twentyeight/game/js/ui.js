/* Screen wiring: turns engine state into the table, and taps back into engine calls. */

(function () {
  const { Game, SUIT_NAME, cardPoints, sameCard, teamOf, MAX_BID } = window.T28;
  const AI = window.T28AI;
  const Rules = window.T28Rules;

  const AI_BID_MS = 720;
  const AI_TRUMP_MS = 620;
  const AI_PLAY_MS = 760;
  const AI_REVEAL_MS = 520;   // a beat before a bot reaches for the trump
  const TRICK_HOLD_MS = 1150;

  const REVEAL_FX_MS = 2500;  // the full turn-up cinematic
  const MARRY_FX_MS = 2100;

  const SHUFFLE_MS = 820;   // riffle before the first four
  const DEAL_STEP = 150;    // one card to each seat, in turn
  const DEAL_FALL = 520;    // how long a card is in the air
  const FLY_MS = 720;       // a card on its way to the trump corner

  // stage coordinates, so animations can run between fixed points
  const DECK = { x: 195, y: 352 };
  const TRUMP_SLOT = { x: 351, y: 482 };
  const HAND_CY = 664;      // middle of a card sitting in your fan
  const SEAT_AT = { 1: { x: 35, y: 373 }, 2: { x: 195, y: 231 }, 3: { x: 355, y: 373 } };

  const SEAT_NAME = { 0: 'You', 1: 'Kunjappan', 2: 'Colonel', 3: 'Rohan' };
  const SEAT_LABEL = { 1: 'Left', 2: 'Top', 3: 'Right' };

  // where each seat's card lands inside .trick, and which way it flies in from
  const SLOT = {
    0: { l: 57,  t: 62, rot: 2,   fx: 0,    fy: 70 },
    1: { l: 1,   t: 32, rot: -9,  fx: -90,  fy: 0 },
    2: { l: 57,  t: 1,  rot: 4,   fx: 0,    fy: -80 },
    3: { l: 113, t: 32, rot: 10,  fx: 90,   fy: 0 }
  };

  const $ = (id) => document.getElementById(id);
  const el = {};
  let g = null;
  let match = null;         // the series this hand belongs to
  let lastConfig = null;    // what to build a rematch from
  let timer = null;
  let selected = null;      // index into the human hand, awaiting confirm
  let bidDraft = 0;
  let shownBids = {};       // seat -> text shown over the portrait during round one
  let resultShown = false;  // the sheet folds the hand into the match exactly once
  let dealing = false;      // cards are in the air; the table waits
  let cinematic = false;    // a turn-up or a marriage is playing; the table waits
  let dealBase = 0;         // when the first fresh card leaves the stock
  let dealt = new Set();    // cards already fanned out, so a second deal only moves the new ones
  let trumpLanded = false;  // the corner slot appears once the card gets there
  let trumpShownUp = false; // the corner swaps to the suit once the cinematic is done
  let returnedKey = null;   // the card handed back to the caller, so it can fly in
  let anim = [];            // animation timers, cleared with the hand

  // ------------------------------------------------------------------ setup

  function cacheDom() {
    ['lobby','table','result','rules','hand','trick','trump','trump-face','trump-card','trump-suit',
     'trump-suit-use','trumplbl','deck','status','hint','marrychip',
     'acts','act-reveal','act-marry','act-marry-txt',
     'revealfx','rvx-face','rvx-suit-use','rvx-suit-txt','rvx-by','rvx-burst','rvx-card',
     'marryfx','mfx-k','mfx-q','mfx-line','mfx-by','mfx-burst',
     'bidbar','bid-minus','bid-plus','bid-pass','bid-call','v-call','v-us','v-them','dealer',
     'r-verdict','r-kicker','r-line','r-us','r-them','r-bid','r-notes','stage',
     't-mode','t-fmt','matchbar','mb-us','mb-them','mb-hand','mb-target',
     'r-match','rm-us','rm-them','rm-gp','rm-goal','r-hist','btn-again',
     'rules-active','rules-active-list'].forEach((id) => { el[id] = $(id); });
    el.seats = {};
    document.querySelectorAll('.seat').forEach((s) => { el.seats[+s.dataset.seat] = s; });
  }

  function fitStage() {
    const pad = 24;
    const sx = (window.innerWidth - pad) / 390;
    const sy = (window.innerHeight - pad) / 844;
    const s = Math.min(sx, sy, 1.25);
    el.stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }

  // ------------------------------------------------------------- card views

  function cardMarkup(card) {
    const red = card.s === 'h' || card.s === 'd';
    const color = red ? '#C8323E' : '#1A1512';
    const ten = card.r === '10' ? ' ten' : '';
    const pip = `<svg viewBox="0 0 24 24" fill="${color}"><use href="#sp-${card.s}"/></svg>`;
    return `<span class="idx"><span class="r${ten}" style="color:${color}">${card.r}</span>${pip}</span>` +
           `<svg class="big" viewBox="0 0 24 24" fill="${color}"><use href="#sp-${card.s}"/></svg>` +
           `<span class="idx-b"><span class="r${ten}" style="color:${color}">${card.r}</span>${pip}</span>`;
    }

  function makeCard(card, cls) {
    const d = document.createElement('div');
    d.className = 'card' + (cls ? ' ' + cls : '');
    d.innerHTML = cardMarkup(card);
    return d;
  }

  const cardKey = (c) => c.r + c.s;
  const suitWord = (s) => SUIT_NAME[s].toUpperCase();

  // ------------------------------------------------------------- the deal

  function clearAnim() { anim.forEach(clearTimeout); anim = []; }
  function later(fn, ms) { anim.push(setTimeout(fn, ms)); }

  /* Four cards to every seat, one round at a time, out of the stock in the
     middle. Your own cards are animated by renderHand — it knows where each
     one lands — so all this does is the stock, the other three seats, and the
     hold that keeps the table quiet until the cards are down. */
  function beginDeal(count, shuffleFirst, done) {
    dealing = true;
    dealBase = shuffleFirst ? SHUFFLE_MS : 120;

    const deck = el.deck;
    deck.classList.add('on');
    if (shuffleFirst) {
      deck.classList.remove('shuffling'); void deck.offsetWidth;
      deck.classList.add('shuffling');
    }

    for (let i = 0; i < count; i++) {
      for (const seat of [1, 2, 3]) {
        later(() => dealFly(seat), dealBase + i * DEAL_STEP + seat * 26);
      }
    }

    const total = dealBase + (count - 1) * DEAL_STEP + DEAL_FALL;
    later(() => {
      deck.classList.remove('on', 'shuffling');
      dealing = false;
      if (done) done();
    }, total);
    return total;
  }

  /* One face-down card skimming from the stock to another seat. */
  function dealFly(seat) {
    const at = SEAT_AT[seat];
    const n = document.createElement('div');
    n.className = 'dealfly back';
    n.style.left = DECK.x + 'px';
    n.style.top = DECK.y + 'px';
    n.style.setProperty('--tx', (at.x - DECK.x) + 'px');
    n.style.setProperty('--ty', (at.y - DECK.y) + 'px');
    n.style.setProperty('--r', (seat === 1 ? -14 : seat === 3 ? 14 : 6) + 'deg');
    n.style.setProperty('--dur', (DEAL_FALL / 1000).toFixed(2) + 's');
    el.table.appendChild(n);
    later(() => n.remove(), DEAL_FALL + 60);
  }

  /* The card a player keeps as trump, travelling to the corner. Yours leaves
     face up and turns over on the way, so you see exactly what you put down. */
  function flyToTrump(seat, card, from, done) {
    const n = document.createElement('div');
    n.className = 'flycard ' + (seat === 0 ? 'mine' : 'blind');
    n.style.left = from.x + 'px';
    n.style.top = from.y + 'px';
    n.style.setProperty('--tx', (TRUMP_SLOT.x - from.x).toFixed(1) + 'px');
    n.style.setProperty('--ty', (TRUMP_SLOT.y - from.y).toFixed(1) + 'px');
    n.style.setProperty('--dur', (FLY_MS / 1000).toFixed(2) + 's');
    n.innerHTML = '<div class="fc-in"><div class="card fc-face"></div><div class="fc-back back"></div></div>';
    if (seat === 0) n.querySelector('.fc-face').innerHTML = cardMarkup(card);
    el.table.appendChild(n);
    later(() => {
      n.remove();
      trumpLanded = true;
      render();
      el.trump.classList.remove('land'); void el.trump.offsetWidth;
      el.trump.classList.add('land');
      if (done) done();
    }, FLY_MS);
  }

  function sparks(host, count, tones, spread) {
    host.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = spread + Math.random() * spread;
      const size = 2.6 + Math.random() * 5.2;
      const tone = tones[i % tones.length];
      const n = document.createElement('i');
      n.style.cssText =
        `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;background:${tone};` +
        `box-shadow:0 0 ${(size * 3).toFixed(1)}px ${tone};` +
        `--dx:${(Math.cos(a) * dist).toFixed(1)}px;--dy:${(Math.sin(a) * dist).toFixed(1)}px;` +
        `animation-delay:${(Math.random() * 0.18).toFixed(2)}s`;
      host.appendChild(n);
    }
  }

  const GOLD = ['#FFF3D0', '#E9B94E', '#F0BE4C', '#FFE9B4'];

  /* The trump goes up. This is the loudest thing that happens at the table, so
     it gets the whole screen: the card turns over big in the middle, the suit
     lands under it, and the felt takes a flash. */
  function revealCinematic(bySeat, done) {
    cinematic = true;
    const suit = g.trumpSuit;

    el['rvx-face'].innerHTML = cardMarkup(g.trumpCard);
    el['rvx-suit-use'].setAttribute('href', '#sp-' + suit);
    el['rvx-suit-txt'].textContent = suitWord(suit);
    el['rvx-by'].textContent = bySeat == null
      ? 'Nobody called for it — the last card turns itself over'
      : (bySeat === 0 ? 'You called for it' : `${SEAT_NAME[bySeat]} called for it`);

    sparks(el['rvx-burst'], 34, GOLD, 90);

    const fx = el.revealfx;
    fx.classList.remove('hidden');
    fx.querySelectorAll('.rvx-dim, .rvx-rays, .rvx-rings i, .rvx-card, .rvx-in, .rvx-banner')
      .forEach((n) => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });

    const felt = document.querySelector('.felt');
    felt.classList.remove('flash'); void felt.offsetWidth; felt.classList.add('flash');

    later(() => {
      fx.classList.add('hidden');
      trumpShownUp = true;
      cinematic = false;
      render();
      if (done) done();
    }, REVEAL_FX_MS);
  }

  /* King and Queen of trump, and what it does to the call. */
  function marriageCinematic(m, done) {
    cinematic = true;
    const suit = m.suit;
    el['mfx-k'].innerHTML = cardMarkup({ r: 'K', s: suit });
    el['mfx-q'].innerHTML = cardMarkup({ r: 'Q', s: suit });

    const down = m.swing < 0;
    el['mfx-line'].textContent = down
      ? `The call comes down to ${g.target}`
      : `The call goes up to ${g.target}`;
    el['mfx-by'].textContent = m.player === 0
      ? `You hold the King and Queen of ${SUIT_NAME[suit]}`
      : `${SEAT_NAME[m.player]} holds the King and Queen of ${SUIT_NAME[suit]}`;

    sparks(el['mfx-burst'], 24, down ? GOLD : ['#FFC9C2', '#E4525C', '#F08A80'], 76);

    const fx = el.marryfx;
    fx.classList.remove('hidden');
    fx.querySelectorAll('.mfx-dim, .mfx-body, #mfx-k, #mfx-q')
      .forEach((n) => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });

    later(() => {
      fx.classList.add('hidden');
      cinematic = false;
      render();
      if (done) done();
    }, MARRY_FX_MS);
  }

  function toast(text, big, ms) {
    const t = document.createElement('div');
    t.className = 'toast' + (big ? ' big' : '');
    t.textContent = text;
    el.table.appendChild(t);
    setTimeout(() => t.remove(), ms || 1400);
  }

  // ---------------------------------------------------------------- render

  function render() {
    renderScore();
    renderMatch();
    renderSeats();
    renderTrick();
    renderTrump();
    renderHand();
    renderStatus();
    renderActions();
  }

  /* The strip in the corner: game points so far, and what it takes to close it out. */
  function renderMatch() {
    if (!match) return;
    el['t-mode'].textContent = match.sourceLabel;
    el['t-fmt'].textContent = match.formatLabel;

    el.matchbar.classList.toggle('hidden', !match.multi);
    if (!match.multi) return;

    el['mb-hand'].textContent = 'HAND ' + match.handNo;
    el['mb-us'].textContent = match.score[0];
    el['mb-them'].textContent = match.score[1];
    el['mb-target'].textContent = match.target;
    el['mb-us'].classList.toggle('lead', match.score[0] > match.score[1]);
    el['mb-them'].classList.toggle('lead', match.score[1] > match.score[0]);
  }

  function renderScore() {
    const left = g.callLeft();
    el['v-call'].textContent = left == null ? '—' : left;
    el['v-us'].textContent = g.points[0];
    el['v-them'].textContent = g.points[1];

    // a declared marriage sits under the score, since it moved the call
    const m = g.marriage;
    const chip = el.marrychip;
    chip.classList.toggle('hidden', !m);
    if (m) {
      const up = m.swing > 0;
      chip.innerHTML =
        `<svg viewBox="0 0 24 24"><use href="#sp-${m.suit}"/></svg>` +
        `MARRIAGE <em class="${up ? 'up' : ''}">${up ? '+' : '−'}4</em>` +
        `<span style="opacity:.55">CALL ${g.target}</span>`;
    }
  }

  function renderSeats() {
    for (const seat of [1, 2, 3]) {
      const node = el.seats[seat];
      if (!node) continue;
      const av = node.querySelector('.av');
      const over = node.querySelector('.bidover');
      const chip = node.querySelector('.passchip');
      const badge = node.querySelector('.callbadge');
      const caller = node.querySelector('.caller');

      av.classList.toggle('turn', g.phase !== 'over' && g.turn === seat && !g.trickComplete());
      av.classList.toggle('out', (g.phase === 'bid1' || g.phase === 'bid2') && g.passed[seat]);

      // round one: a number sits over the portrait, a pass hangs under it
      const said = g.phase === 'bid1' ? shownBids[seat] : null;
      const passed = said === 'Pass';
      over.classList.toggle('hidden', !(said && !passed));
      if (said && !passed) over.textContent = said;
      chip.classList.toggle('hidden', !passed);

      // later: only the standing high call, pinned under its caller
      const showBadge = g.phase !== 'bid1' && g.bid && g.bid.player === seat && g.phase !== 'over';
      badge.classList.toggle('hidden', !showBadge);
      if (showBadge) badge.textContent = g.bid.value;

      // the suit badge only appears once the table is entitled to know it
      const isCaller = g.bid && g.bid.player === seat && g.trumpSuit && g.trumpRevealed;
      caller.classList.toggle('hidden', !isCaller);
      if (isCaller) {
        caller.innerHTML = `<svg viewBox="0 0 24 24" fill="#2C1705"><use href="#sp-${g.trumpSuit}"/></svg>`;
      }
    }
    el.dealer.style.display = 'flex';
  }

  /* Append only what is new. Rebuilding the pile every render made every card
     replay its toss animation each time somebody else played. */
  function renderTrick() {
    const shown = el.trick.children.length;
    if (g.trick.length < shown) el.trick.innerHTML = '';
    const from = g.trick.length < shown ? 0 : shown;

    for (let i = from; i < g.trick.length; i++) {
      const t = g.trick[i];
      const s = SLOT[t.player];
      const c = makeCard(t.card);
      c.style.left = s.l + 'px';
      c.style.top = s.t + 'px';
      c.style.transform = `rotate(${s.rot}deg)`;
      c.style.setProperty('--fx', s.fx + 'px');
      c.style.setProperty('--fy', s.fy + 'px');
      el.trick.appendChild(c);
    }
  }

  /* The corner holds the actual card while it is face down. Once it is turned
     up the card goes back to the caller's hand, so the corner keeps the suit
     instead — the card itself is in play now. */
  function renderTrump() {
    const show = !!g.trumpCard && trumpLanded;
    el.trump.classList.toggle('hidden', !show);
    if (!show) return;

    const faceUp = trumpShownUp || !g.rules.hiddenTrump;

    const face = el['trump-face'];
    const key = cardKey(g.trumpCard);
    if (face.dataset.key !== key) {
      face.innerHTML = cardMarkup(g.trumpCard);
      face.dataset.key = key;
    }

    el['trump-card'].classList.toggle('hidden', faceUp);
    el['trump-suit'].classList.toggle('hidden', !faceUp);
    if (faceUp) el['trump-suit-use'].setAttribute('href', '#sp-' + g.trumpSuit);
    el.trumplbl.textContent = faceUp ? 'Trump' : 'Trump';
  }

  function renderHand() {
    const hand = g.hands[0];
    const n = hand.length;
    const width = 374, cw = 80;
    // fan tight when the hand is full, spread out when only four are dealt
    const stride = n > 1 ? Math.min(cw + 6, (width - cw) / (n - 1)) : 0;
    const total = cw + stride * (n - 1);
    const x0 = (width - total) / 2;

    const pickingTrump = g.phase === 'trump' && g.bid.player === 0;
    const myTurn = g.phase === 'play' && g.turn === 0 && !g.trickComplete() && !cinematic;
    const legal = myTurn ? g.legalCards(0) : [];

    el.hand.innerHTML = '';
    let fresh = 0;   // only cards that just left the stock fly in
    hand.forEach((card, i) => {
      const playable = myTurn && legal.some((c) => sameCard(c, card));
      const isTrumpSuit = g.trumpRevealed && card.s === g.trumpSuit;
      const wasTheCard = g.trumpRevealed && g.rules.hiddenTrump &&
                         g.trumpCard && sameCard(card, g.trumpCard);

      let cls = '';
      if (pickingTrump || playable) cls += ' play';
      if (myTurn && !playable) cls += ' dim';
      if (selected === i) cls += ' sel';
      if (isTrumpSuit) cls += ' trumpmark';

      const left = x0 + i * stride;
      const c = makeCard(card, cls.trim());
      c.style.left = left + 'px';
      c.style.zIndex = i + 1;
      if (wasTheCard) c.insertAdjacentHTML('beforeend', '<span class="ribbon">TRUMP</span>');

      if (pickingTrump) c.onclick = () => chooseTrump(i, card);
      else if (playable) c.onclick = () => tapCard(i, card);

      const key = cardKey(card);
      if (dealing && !dealt.has(key)) {
        c.classList.add('dealt');
        c.style.setProperty('--dx', (DECK.x - (8 + left + cw / 2)).toFixed(1) + 'px');
        c.style.setProperty('--dy', (DECK.y - HAND_CY) + 'px');
        c.style.setProperty('--dr', (-18 + fresh * 5) + 'deg');
        c.style.animationDelay = ((dealBase + fresh * DEAL_STEP) / 1000).toFixed(3) + 's';
        fresh++;
      } else if (key === returnedKey) {
        c.classList.add('returned');   // the trump, handed back after the turn-up
      }
      dealt.add(key);
      el.hand.appendChild(c);
    });
    returnedKey = null;
  }

  /* Where a card in your fan is sitting, in stage coordinates. */
  function handCardAt(i) {
    const n = el.hand.children[i];
    const left = n ? parseFloat(n.style.left) : 155;
    return { x: 8 + left + 40, y: HAND_CY };
  }

  /* Calling for trump and declaring a marriage both happen on your turn, so
     they share the strip above the fan. */
  function renderActions() {
    const busy = dealing || cinematic;
    const canReveal = !busy && g.canRequestReveal(0);
    const canMarry = !busy && g.canDeclareMarriage(0);

    el.acts.classList.toggle('hidden', !(canReveal || canMarry));
    el['act-reveal'].classList.toggle('hidden', !canReveal);
    el['act-marry'].classList.toggle('hidden', !canMarry);

    if (canMarry) {
      const down = teamOf(0) === teamOf(g.bid.player);
      el['act-marry-txt'].textContent = down ? 'Marriage −4' : 'Marriage +4';
    }
  }

  function renderStatus() {
    const s = el.status;
    const bidding = (g.phase === 'bid1' || g.phase === 'bid2') && !dealing;
    el.bidbar.classList.toggle('hidden', !(bidding && g.turn === 0 && !g.passed[0]));

    if (dealing) {
      s.classList.remove('hidden');
      s.textContent = g.phase === 'bid2' ? 'Four more each…' : 'Dealing…';
      s.classList.add('quiet');
      s.classList.remove('win');
      el.hint.textContent = '';
      return;
    }

    if (bidding && g.turn === 0 && !g.passed[0]) {
      s.classList.add('hidden');
      const min = g.minLegalBid;
      if (bidDraft < min) bidDraft = min;
      el['bid-call'].textContent = bidDraft;
      el['bid-minus'].disabled = bidDraft <= min;
      el['bid-plus'].disabled = bidDraft >= MAX_BID;
      el['bid-call'].disabled = min > MAX_BID;
      el.hint.textContent = g.phase === 'bid1'
        ? 'Call what your pair will take out of 28'
        : `Raise above ${g.bid ? g.bid.value : min - 1} or pass`;
      return;
    }

    el.hint.textContent = hintText();
    const label = statusText();
    s.classList.toggle('hidden', !label);
    if (label) {
      s.textContent = label;
      s.classList.toggle('quiet', !(g.phase === 'play' && g.turn === 0));
      s.classList.remove('win');
    }
  }

  function statusText() {
    if (g.phase === 'bid1' || g.phase === 'bid2') {
      return g.turn === 0 ? '' : `${SEAT_NAME[g.turn]} is calling…`;
    }
    if (g.phase === 'trump') {
      if (!g.rules.hiddenTrump) return g.bid.player === 0 ? 'Name trump' : `${SEAT_NAME[g.bid.player]} names trump…`;
      return g.bid.player === 0 ? 'Keep a trump' : `${SEAT_NAME[g.bid.player]} keeps trump…`;
    }
    if (g.phase === 'play') {
      if (g.trickComplete() || cinematic) return '';
      return g.turn === 0 ? 'Your Turn' : `${SEAT_NAME[g.turn]} plays…`;
    }
    return '';
  }

  function hintText() {
    if (g.phase === 'trump') {
      if (g.bid.player !== 0) return `${SEAT_NAME[g.bid.player]} called ${g.bid.value} and is choosing trump`;
      return g.rules.hiddenTrump
        ? 'Tap a card to keep face down as trump — it leaves your hand'
        : 'Tap a card to name its suit as trump';
    }
    if (g.phase === 'play') {
      if (g.turn !== 0 || g.trickComplete() || cinematic) return '';
      if (selected != null) return 'Tap again to play it';
      if (g.canDeclareMarriage(0)) {
        return teamOf(0) === teamOf(g.bid.player)
          ? 'You hold the marriage — declaring takes 4 off your call'
          : 'You hold the marriage — declaring puts 4 onto their call';
      }
      const lead = g.leadSuit();
      if (!lead) {
        return g.canRequestReveal(0) ? 'You lead — or call for the trump first' : 'You lead — tap a card, then tap again to play';
      }
      const canFollow = g.hands[0].some((c) => c.s === lead);
      if (canFollow) return `Follow ${SUIT_NAME[lead]}`;
      if (g.canRequestReveal(0)) {
        return g.rules.revealObligation
          ? 'Out of suit — call for trump, but then you must play one'
          : 'Out of suit — you may call for the trump';
      }
      return 'You are out of that suit';
    }
    return '';
  }

  // ------------------------------------------------------------ human input

  function tapCard(i, card) {
    if (selected === i) {
      selected = null;
      g.playCard(0, card);
      afterPlay();
    } else {
      selected = i;
      render();
    }
  }

  function chooseTrump(i, card) {
    const from = handCardAt(i);
    const hidden = g.rules.hiddenTrump;
    g.setTrump(0, card);
    selected = null;
    trumpLanded = false;
    trumpShownUp = !hidden;
    render();

    if (!hidden) {
      trumpLanded = true;
      render();
      toast(`Trump is ${SUIT_NAME[g.trumpSuit]}`, true, 1600);
      later(tick, 700);
      return;
    }
    flyToTrump(0, card, from, () => {
      toast('Trump set face down', false, 1500);
      tick();
    });
  }

  function doReveal() {
    if (!g.canRequestReveal(0)) return;
    const before = g.hands[0].length;
    g.requestReveal(0);
    // if that was your own card coming back, let it fly into the fan
    if (g.hands[0].length > before) returnedKey = cardKey(g.trumpCard);
    selected = null;
    render();
    revealCinematic(0, tick);
  }

  function doMarriage() {
    if (!g.canDeclareMarriage(0)) return;
    g.declareMarriage(0);
    render();
    marriageCinematic(g.marriage, tick);
  }

  function afterPlay() {
    render();
    tick();
  }

  function bindControls() {
    const on = (id, fn) => { const n = $(id); if (n) n.onclick = fn; };

    on('btn-again', () => {
      el.result.classList.add('hidden');
      if (match && match.multi && !match.over) startHand();
      else startMatch(lastConfig);
    });
    on('btn-lobby', () => { el.result.classList.add('hidden'); toLobby(); });
    on('btn-back', () => toLobby());
    on('btn-settings', () => { paintActiveRules(); el.rules.classList.remove('hidden'); });
    on('btn-rules-close', () => el.rules.classList.add('hidden'));
    on('act-reveal', doReveal);
    on('act-marry', doMarriage);

    el['bid-minus'].onclick = () => { bidDraft = Math.max(g.minLegalBid, bidDraft - 1); renderStatus(); };
    el['bid-plus'].onclick = () => { bidDraft = Math.min(MAX_BID, bidDraft + 1); renderStatus(); };
    el['bid-call'].onclick = () => {
      const phase = g.phase;
      if (!g.placeBid(0, bidDraft)) return;
      if (phase === 'bid1') shownBids[0] = String(bidDraft);
      if (phase === 'bid1' && g.phase === 'bid2') onRoundOneClosed();
      render(); tick();
    };
    el['bid-pass'].onclick = () => {
      const phase = g.phase;
      if (!g.passBid(0)) return;
      if (phase === 'bid1') shownBids[0] = 'Pass';
      if (phase === 'bid1' && g.phase === 'bid2') onRoundOneClosed();
      render(); tick();
    };

    window.addEventListener('resize', fitStage);
  }

  /* The rules sheet grows a list of what this particular table is playing. */
  function paintActiveRules() {
    const host = el['rules-active-list'];
    if (!host) return;
    const rules = (g && g.rules) || (lastConfig && lastConfig.rules) || Rules.preset('casual');
    el['rules-active'].classList.remove('hidden');
    host.innerHTML = '';
    for (const m of Rules.META) {
      const on = !!rules[m.key];
      const d = document.createElement('div');
      d.className = 'ra-row ' + (on ? 'on' : 'off');
      d.innerHTML = `<b>${on ? '✓' : '·'}</b><span><i>${m.label}.</i> ${on ? m.on : m.off}</span>`;
      host.appendChild(d);
    }
  }

  // ----------------------------------------------------------- turn driver

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function tick() {
    clearTimer();
    if (!g) return;

    // nobody acts while cards are in the air or the table is watching something
    if (dealing || cinematic) { timer = setTimeout(tick, 120); return; }

    if (g.phase === 'over') { timer = setTimeout(showResult, 700); return; }

    if (g.trickComplete()) { timer = setTimeout(finishTrick, TRICK_HOLD_MS); return; }

    if (g.phase === 'bid1' || g.phase === 'bid2') {
      if (g.turn === 0) { render(); return; }
      timer = setTimeout(aiBid, AI_BID_MS);
      render();
      return;
    }

    if (g.phase === 'trump') {
      if (g.bid.player === 0) { render(); return; }
      timer = setTimeout(aiTrump, AI_TRUMP_MS);
      render();
      return;
    }

    if (g.phase === 'play') {
      if (g.turn === 0) { render(); return; }
      timer = setTimeout(aiPlay, AI_PLAY_MS);
      render();
    }
  }

  function aiBid() {
    const seat = g.turn;
    const phase = g.phase;
    const d = AI.decideBid(g, seat);
    if (d.action === 'bid') {
      g.placeBid(seat, d.value);
      if (phase === 'bid1') shownBids[seat] = String(d.value);
    } else {
      g.passBid(seat);
      if (phase === 'bid1') shownBids[seat] = 'Pass';
    }
    if (phase === 'bid1' && g.phase === 'bid2') onRoundOneClosed();
    render();
    tick();
  }

  function aiTrump() {
    const seat = g.bid.player;
    const card = AI.chooseTrump(g, seat);
    const hidden = g.rules.hiddenTrump;
    g.setTrump(seat, card);
    trumpLanded = false;
    trumpShownUp = !hidden;
    render();

    if (!hidden) {
      trumpLanded = true;
      render();
      toast(`${SEAT_NAME[seat]} names ${SUIT_NAME[g.trumpSuit]}`, true, 1600);
      later(tick, 800);
      return;
    }
    flyToTrump(seat, card, SEAT_AT[seat], () => {
      toast(`${SEAT_NAME[seat]} keeps a trump`, false, 1500);
      tick();
    });
  }

  /* A bot's turn: it may call for the trump, it may declare a marriage, and
     then it plays. Each of those is its own beat so the table can follow. */
  function aiPlay() {
    const seat = g.turn;

    if (AI.decideReveal(g, seat)) {
      g.requestReveal(seat);
      render();
      revealCinematic(seat, () => later(aiPlay, AI_REVEAL_MS));
      return;
    }
    if (AI.decideMarriage(g, seat)) {
      g.declareMarriage(seat);
      render();
      marriageCinematic(g.marriage, () => later(aiPlay, AI_REVEAL_MS));
      return;
    }

    const card = AI.decidePlay(g, seat);
    g.playCard(seat, card);
    render();
    tick();
  }

  function finishTrick() {
    const res = g.resolveTrick();
    const mine = res.team === 0;

    if (res.pts > 0) {
      const felt = document.querySelector('.felt');
      felt.classList.remove('flash'); void felt.offsetWidth; felt.classList.add('flash');
      const who = mine ? 'YOU TAKE IT' : SEAT_NAME[res.winner].toUpperCase() + ' TAKES IT';
      trickBurst(res.pts, res.bonus ? who + ' · LAST TRICK' : who);
    } else {
      toast(`${mine ? 'You take it' : SEAT_NAME[res.winner] + ' takes it'}`, false, 1100);
    }
    selected = null;
    render();

    // nobody ever asked, so the last card turned itself over
    if (res.autoReveal) {
      if (g.bid.player === 0) returnedKey = cardKey(g.trumpCard);
      render();
      later(() => revealCinematic(null, tick), 700);
      return;
    }
    tick();
  }

  /* Gold burst over the table when a trick carries points. */
  function trickBurst(pts, who) {
    const tw = $('trickwin');
    if (!tw) return;
    $('tw-pts').textContent = '+' + pts;
    $('tw-who').textContent = who;
    sparks($('tw-sparks'), 28, GOLD, 80);

    tw.classList.remove('hidden');
    // restart the keyframes cleanly on every trick
    tw.querySelectorAll('.tw-rings i, .tw-body').forEach((n) => {
      n.style.animation = 'none'; void n.offsetWidth; n.style.animation = '';
    });
    clearTimeout(trickBurst._t);
    trickBurst._t = setTimeout(() => tw.classList.add('hidden'), 1150);
  }

  /* Round one closes by dealing the other four cards. */
  function onRoundOneClosed() {
    shownBids = {};
    toast(`${SEAT_NAME[g.bid.player]} leads with ${g.bid.value}`, false, 1600);
    beginDeal(4, false, () => { render(); tick(); });
  }

  // -------------------------------------------------------------- results

  const STATS_KEY = 't28.stats';
  function loadStats() {
    try { return Object.assign({ played: 0, wins: 0, bigCalls: 0, bestPoints: 0 }, JSON.parse(localStorage.getItem(STATS_KEY) || '{}')); }
    catch (e) { return { played: 0, wins: 0, bigCalls: 0, bestPoints: 0 }; }
  }
  function saveStats(st) { try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch (e) {} }

  function showResult() {
    if (resultShown) return;   // tick can land here more than once on a slow frame
    resultShown = true;

    const r = g.result;
    const hand = match.applyHand(r);      // pays this hand's game points to one pair
    const done = match.over;
    const matchWon = match.winner === 0;

    const st = loadStats();
    st.played += 1;
    if (r.youWon) st.wins += 1;
    if (r.bidder === 0 && r.bid >= 20) st.bigCalls += 1;
    st.bestPoints = Math.max(st.bestPoints, r.points[0]);
    saveStats(st);

    // every hand pays out; closing a multi round match pays a purse on top
    let coins = r.youWon ? 400 + r.points[0] * 30 : 60;
    let xp = r.youWon ? 120 : 40;
    if (match.multi && done) {
      coins += matchWon ? 900 + match.target * 150 : 120;
      xp += matchWon ? 200 : 60;
    }
    if (window.T28Screens) { window.T28Screens.addCoins(coins); window.T28Screens.addXp(xp); }

    const won = done ? matchWon : r.youWon;
    el['r-verdict'].textContent = paintVerdict(done, won);
    el['r-verdict'].classList.toggle('lost', !won);

    const callerPts = r.points[r.bidTeam];
    el['r-line'].textContent = r.made
      ? `${SEAT_NAME[r.bidder]} called ${r.bid} and took ${callerPts}.`
      : `${SEAT_NAME[r.bidder]} called ${r.bid} but took only ${callerPts}.`;
    el['r-line'].textContent += `  +${coins} coins · +${xp} XP`;

    el['r-us'].textContent = r.points[0];
    el['r-them'].textContent = r.points[1];
    // when a marriage moved the call, show what actually had to be found
    el['r-bid'].innerHTML = r.target === r.bid
      ? String(r.bid)
      : `<s>${r.bid}</s>${r.target}`;

    paintNotes(r);
    paintMatchBlock(hand, done);
    el['btn-again'].textContent = match.multi && !done ? 'NEXT HAND' : done && match.multi ? 'REMATCH' : 'PLAY AGAIN';
    el.result.classList.remove('hidden');
  }

  /* The things that were not just cards: the trump, a marriage, the last trick. */
  function paintNotes(r) {
    const host = el['r-notes'];
    const rows = [];

    if (r.trumpSuit) {
      rows.push(`<svg viewBox="0 0 24 24"><use href="#sp-${r.trumpSuit}"/></svg>` +
        `Trump was <em>${SUIT_NAME[r.trumpSuit]}</em>`);
    }
    if (r.marriage) {
      const m = r.marriage;
      const who = m.player === 0 ? 'You' : SEAT_NAME[m.player];
      rows.push(`<svg viewBox="0 0 24 24"><use href="#sp-${m.suit}"/></svg>` +
        `${who} declared marriage — the call ${m.swing < 0 ? 'came down' : 'went up'} to <em>${r.target}</em>`);
    }
    if (r.lastTrickBonus) {
      const w = r.lastTrickWinner;
      rows.push(`<svg viewBox="0 0 24 24"><use href="#sp-${r.trumpSuit}"/></svg>` +
        `${w === 0 ? 'You' : SEAT_NAME[w]} took the last trick — <em>+1</em>`);
    }

    host.classList.toggle('hidden', !rows.length);
    host.innerHTML = rows.map((t) => `<div class="rn-row">${t}</div>`).join('');
  }

  function paintVerdict(done, won) {
    if (!match.multi) return won ? 'YOU WIN' : 'THEY WIN';
    if (!done) return won ? 'HAND WON' : 'HAND LOST';
    return won ? 'MATCH WON' : 'MATCH LOST';
  }

  /* Running game points under the verdict, and the ledger once the match closes. */
  function paintMatchBlock(hand, done) {
    const bidTeamIsYours = hand.bidTeam === 0;

    if (!match.multi) {
      el['r-kicker'].textContent = bidTeamIsYours ? 'YOUR PAIR CALLED IT' : 'THEY CALLED IT';
      el['r-match'].classList.add('hidden');
      el['r-hist'].classList.add('hidden');
      return;
    }

    el['r-kicker'].textContent = done
      ? `MATCH OVER · ${match.hands.length} HAND${match.hands.length === 1 ? '' : 'S'}`
      : `HAND ${hand.no} · ${bidTeamIsYours ? 'YOUR PAIR CALLED IT' : 'THEY CALLED IT'}`;

    el['r-match'].classList.remove('hidden');
    el['rm-us'].textContent = match.score[0];
    el['rm-them'].textContent = match.score[1];
    el['rm-gp'].textContent = (hand.team === 0 ? '+' : '−') + hand.gp +
      (hand.gp === 1 ? ' point' : ' points');
    el['rm-gp'].classList.toggle('theirs', hand.team !== 0);

    const needs = match.needs;
    el['rm-goal'].textContent = done
      ? 'FIRST TO ' + match.target
      : `${Math.min(needs[0], needs[1])} MORE TO WIN`;

    el['r-hist'].classList.toggle('hidden', !done);
    if (done) paintLedger();
  }

  function paintLedger() {
    const host = el['r-hist'];
    host.innerHTML = '';
    match.hands.forEach((h, i) => {
      const mine = h.team === 0;
      const d = document.createElement('div');
      d.className = 'rh-row' + (i === match.hands.length - 1 ? ' last' : '');
      d.innerHTML =
        `<span class="rh-n num">${h.no}</span>` +
        `<span class="rh-txt">${SEAT_NAME[h.bidder]} called ${h.bid} · ${h.made ? 'made it' : 'went down'}</span>` +
        `<span class="rh-d num ${mine ? '' : 'theirs'}">${mine ? '+' : '−'}${h.gp}</span>`;
      host.appendChild(d);
    });
    host.scrollTop = host.scrollHeight;
  }

  // ----------------------------------------------------------------- flow

  let dealerSeat = 3;

  /* Open a series — one hand in single round, as many as it takes in multi. */
  function startMatch(cfg) {
    lastConfig = Object.assign({ mode: 'single', source: 'offline' }, cfg || {});
    lastConfig.rules = Rules.normalize(lastConfig.rules);
    match = new window.T28Match.Match(lastConfig);
    dealerSeat = 3;
    startHand();
  }

  function startHand() {
    clearTimer();
    clearAnim();
    const tw = $('trickwin'); if (tw) tw.classList.add('hidden');
    el.revealfx.classList.add('hidden');
    el.marryfx.classList.add('hidden');
    cinematic = false;
    dealerSeat = (dealerSeat + 1) % 4;
    g = new Game({ dealer: dealerSeat, rules: lastConfig.rules });
    match.nextHand();
    selected = null;
    shownBids = {};
    resultShown = false;
    dealt = new Set();
    trumpLanded = false;
    trumpShownUp = false;
    returnedKey = null;
    el['trump-card'].classList.remove('up', 'turning');
    el['trump-face'].dataset.key = '';
    el.trick.innerHTML = '';
    bidDraft = g.minLegalBid;

    el.result.classList.add('hidden');

    if (match.multi && match.handNo > 1) {
      const needs = match.needs;
      later(() => toast(`Hand ${match.handNo} · ${needs[0]} to win, ${needs[1]} to lose`, false, 1600), 260);
    }

    // shuffle, then four each; the driver picks up when the cards are down
    beginDeal(4, true, () => { render(); tick(); });
    render();
  }

  function toLobby() {
    clearTimer();
    clearAnim();
    dealing = false;
    cinematic = false;
    document.querySelectorAll('.dealfly, .flycard').forEach((n) => n.remove());
    el.deck.classList.remove('on', 'shuffling');
    g = null;
    match = null;
    el.result.classList.add('hidden');
    el.matchbar.classList.add('hidden');
    el.revealfx.classList.add('hidden');
    el.marryfx.classList.add('hidden');
    el.acts.classList.add('hidden');
    el.marrychip.classList.add('hidden');
    const tw = $('trickwin'); if (tw) tw.classList.add('hidden');
    if (window.T28Screens) window.T28Screens.show('lobby');
    else { el.table.classList.add('hidden'); el.lobby.classList.remove('hidden'); }
  }

  // ------------------------------------------------------------------ boot

  document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    bindControls();
    fitStage();
  });

  // `game` is the live deal — handy in the console, and what the tests drive
  window.T28Table = { start: startMatch, stats: loadStats, current: () => match, game: () => g };
})();
