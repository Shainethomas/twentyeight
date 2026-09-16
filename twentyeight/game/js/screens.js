/* Meta screens: routing, player wallet, and the list/grid content for
   lobby, room, invite, leaderboard, shop and rewards. */

(function () {
  const $ = (id) => document.getElementById(id);
  const SCREENS = ['lobby', 'room', 'invite', 'ranks', 'shop', 'rewards', 'table'];
  const NAV_SCREENS = ['lobby', 'ranks', 'shop', 'rewards', 'invite'];

  // ------------------------------------------------------------------ state

  const DEFAULTS = { coins: 12480, xp: 0, level: 1, streak: 1, claimedOn: null, owned: ['classic'], rating: 11240 };
  let P = load();

  function load() {
    try {
      const raw = localStorage.getItem('t28.player');
      return raw ? Object.assign({}, DEFAULTS, JSON.parse(raw)) : Object.assign({}, DEFAULTS);
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save() {
    try { localStorage.setItem('t28.player', JSON.stringify(P)); } catch (e) { /* private mode */ }
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const fmt = (n) => n.toLocaleString('en-IN');

  function addCoins(n) { P.coins = Math.max(0, P.coins + n); save(); paintWallet(); }
  function addXp(n) {
    P.xp += n;
    while (P.xp >= P.level * 250) { P.xp -= P.level * 250; P.level += 1; }
    save(); paintWallet();
  }

  function paintWallet() {
    document.querySelectorAll('.coin-val, #coin-val').forEach((n) => { n.textContent = fmt(P.coins); });
    const lv = $('lv-num'); if (lv) lv.textContent = 'LV ' + P.level;
    const xp = $('xp-fill'); if (xp) xp.style.width = Math.round((P.xp / (P.level * 250)) * 100) + '%';
    const dot = $('reward-dot');
    if (dot) dot.classList.toggle('hidden', P.claimedOn === today());
  }

  // ---------------------------------------------------------------- routing

  let current = 'lobby';

  function show(name) {
    if (name === 'play') { window.T28Table.start({ mode: 'single', source: 'offline' }); name = 'table'; }
    SCREENS.forEach((s) => { const n = $(s); if (n) n.classList.toggle('hidden', s !== name); });
    $('bottomnav').classList.toggle('hidden', !NAV_SCREENS.includes(name));
    document.querySelectorAll('.nb').forEach((b) => b.classList.toggle('on', b.dataset.nav === name));
    current = name;
    if (name === 'ranks') paintRanks();
    if (name === 'shop') paintShop();
    if (name === 'rewards') paintRewards();
    if (name === 'invite') paintFriends();
    window.scrollTo(0, 0);
    const body = $(name) && $(name).querySelector('.mbody');
    if (body) body.scrollTop = 0;
  }

  function toast(text) {
    const host = $(current) || $('stage');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    host.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  // ------------------------------------------------------------------ lobby

  function bindLobby() {
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.onclick = () => {
        const go = b.dataset.go;
        if (go === 'soon') return toast('Not part of this build');
        show(go);
      };
    });
    document.querySelectorAll('[data-back]').forEach((b) => { b.onclick = () => show(b.dataset.back); });
    document.querySelectorAll('.nb').forEach((b) => { b.onclick = () => show(b.dataset.nav); });
    document.querySelectorAll('.nav-rules').forEach((b) => { b.onclick = () => $('rules').classList.remove('hidden'); });

    // segmented controls behave the same everywhere
    document.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          if (seg.dataset.seg === 'invtab') paintFriends();
          if (seg.dataset.seg === 'len') paintLenNote();
        };
      });
    });

    // every way into a table asks for a format first
    document.querySelectorAll('[data-play]').forEach((b) => {
      b.onclick = () => {
        const src = b.dataset.play;
        if (src === 'room') return launch(roomConfig());   // the room screen already asked
        openFormat(src);
      };
    });
    bindFormat();
    paintLenNote();

    buildRules('fmt-rules', 'fmt-rules-tag');
    buildRules('room-rules', 'room-rules-tag');

    // the rule list is long, so it stays folded away behind its heading
    document.querySelectorAll('.disclose').forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        const panel = $(b.dataset.panel);
        if (!panel) return;
        const open = panel.classList.toggle('hidden');
        b.classList.toggle('open', !open);
      };
    });

    const code = () => Array.from({ length: 5 }, () =>
      '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 34)]).join('');
    $('room-reroll').onclick = () => {
      const c = code();
      $('room-code').textContent = c;
      $('inv-code').textContent = c;
    };
    $('room-copy').onclick = () => {
      const c = $('room-code').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(c).catch(() => {});
      toast('Room code copied');
    };
    $('inv-search').oninput = paintFriends;
  }

  // ------------------------------------------------------------ house rules

  /* Both the format sheet and the room screen let a table set its own rules,
     off the same list, so there is one place that knows what the switches are.
     Tournament tables get the same list with everything frozen — a player can
     read what they are playing under, but not change it. */

  const Rules = window.T28Rules;
  const RULE_STORE = 't28.rules';

  function savedRules() {
    try { return Rules.normalize(JSON.parse(localStorage.getItem(RULE_STORE) || '{}')); }
    catch (e) { return Rules.preset('casual'); }
  }
  function storeRules(r) {
    try { localStorage.setItem(RULE_STORE, JSON.stringify(r)); } catch (e) { /* private mode */ }
  }

  const rulePanels = [];

  function buildRules(hostId, tagId) {
    const host = $(hostId);
    if (!host) return;
    const panel = { host, tag: $(tagId), locked: false, rules: savedRules() };
    rulePanels.push(panel);

    for (const m of Rules.META) {
      const row = document.createElement('label');
      row.className = 'rule';
      row.dataset.key = m.key;
      row.innerHTML = `<span><b>${m.label}</b><i data-note></i></span><span class="sw"><i></i></span>`;
      row.onclick = (e) => {
        e.preventDefault();
        if (panel.locked || m.locked) return;
        panel.rules = Rules.normalize(Object.assign({}, panel.rules, { [m.key]: !panel.rules[m.key] }));
        if (!panel.locked) storeRules(panel.rules);
        paintRules(panel);
      };
      host.appendChild(row);
    }
    paintRules(panel);
  }

  /* Repaint every switch from the normalized rule set, so an option that has
     been switched off by its parent shows as off and reads as unavailable. */
  function paintRules(panel) {
    const r = panel.rules;
    panel.host.querySelectorAll('.rule').forEach((row) => {
      const m = Rules.META.find((x) => x.key === row.dataset.key);
      const on = !!r[m.key];
      const frozen = panel.locked || m.locked || (m.needs && !r[m.needs]);
      row.classList.toggle('locked', !!(panel.locked || m.locked));
      row.classList.toggle('dim', !!(m.needs && !r[m.needs]));
      row.querySelector('[data-note]').textContent = on ? m.on : m.off;
      const sw = row.querySelector('.sw');
      sw.classList.toggle('on', on);
      sw.classList.toggle('locked', !!frozen);
    });
    if (panel.tag) {
      panel.tag.textContent = panel.locked ? 'FIXED FOR THE DRAW' : Rules.summary(r);
    }
  }

  /* Freeze or release a panel — tournament tables cannot be tinkered with. */
  function setRuleLock(panel, locked) {
    panel.locked = locked;
    panel.rules = locked ? Rules.preset('tournament') : savedRules();
    paintRules(panel);
  }

  const panelFor = (hostId) => rulePanels.find((p) => p.host.id === hostId);

  // ------------------------------------------------------------ table setup

  /* Single round or multi round, asked the same way for every mode. The room
     screen carries its own copy of the question in the GAME LENGTH control. */

  let fmtSource = 'offline';

  function launch(cfg) {
    window.T28Table.start(cfg);
    show('table');
  }

  function segPick(name) {
    return document.querySelector(`[data-seg="${name}"] .on`);
  }

  function readFormat(btn, source) {
    const multi = btn && btn.dataset.mode === 'multi';
    return {
      mode: multi ? 'multi' : 'single',
      target: btn && btn.dataset.t ? +btn.dataset.t : undefined,
      source
    };
  }

  function roomConfig() {
    const cfg = readFormat(segPick('len'), 'room');
    cfg.code = $('room-code').textContent;
    const panel = panelFor('room-rules');
    cfg.rules = panel ? panel.rules : undefined;
    return cfg;
  }

  function paintLenNote() {
    const note = $('len-note');
    if (!note) return;
    const cfg = readFormat(segPick('len'), 'room');
    note.innerHTML = cfg.mode === 'multi'
      ? `Hands keep dealing until a pair reaches <b>${cfg.target}</b> game points.`
      : 'One hand at this table — the call settles it.';
  }

  const KICKER = { online: 'ONLINE MATCH', tournament: 'TOURNAMENT', offline: 'OFFLINE TABLE' };

  function openFormat(source) {
    fmtSource = source;
    $('fmt-kicker').textContent = KICKER[source] || KICKER.offline;
    $('fmt-note').innerHTML =
      `A hand pays by the call — <b>${window.T28Match.ladderText()}</b>. ` +
      'Make the call and those points are yours; break it and they go across the table.';
    // a tournament is match play by definition, so the sheet opens on it
    pickFormat(source === 'tournament' ? 'tournament' : 'single');
    $('format').classList.remove('hidden');
  }

  function pickFormat(which) {
    document.querySelectorAll('#format .fmt').forEach((x) => {
      x.classList.toggle('on', x.dataset.fmt === which);
    });
    $('fmt-target').classList.toggle('hidden', which === 'single');
    const panel = panelFor('fmt-rules');
    if (panel) setRuleLock(panel, which === 'tournament');
  }

  function formatConfig() {
    const opt = document.querySelector('#format .fmt.on');
    const which = opt ? opt.dataset.fmt : 'single';
    const t = segPick('target');
    const panel = panelFor('fmt-rules');
    return {
      mode: which === 'single' ? 'single' : 'multi',
      target: t ? +t.dataset.t : undefined,
      tournament: which === 'tournament',
      source: which === 'tournament' ? 'tournament' : fmtSource,
      rules: panel ? panel.rules : undefined
    };
  }

  function bindFormat() {
    document.querySelectorAll('#format .fmt').forEach((b) => {
      b.onclick = () => pickFormat(b.dataset.fmt);
    });
    $('fmt-cancel').onclick = () => $('format').classList.add('hidden');
    $('fmt-start').onclick = () => {
      const cfg = formatConfig();
      $('format').classList.add('hidden');
      if (cfg.source === 'online') findTable(cfg);
      else launch(cfg);
    };
    $('mm-cancel').onclick = () => { clearSearch(); $('matchmake').classList.add('hidden'); };
  }

  /* No servers in this build: the search is staged, the seats are the bots. */
  const TABLE_MATES = ['Kunjappan', 'Colonel', 'Rohan'];
  let mmTimers = [];

  function clearSearch() { mmTimers.forEach(clearTimeout); mmTimers = []; }

  function findTable(cfg) {
    clearSearch();
    const ov = $('matchmake');
    const seats = Array.from(ov.querySelectorAll('.mm-s'));
    seats.forEach((s, i) => {
      if (!i) return;
      s.classList.remove('in');
      s.querySelector('span').textContent = '';
    });
    $('mm-title').textContent = 'Finding a table…';
    $('mm-fmt').textContent = cfg.mode === 'multi' ? `Multi round · first to ${cfg.target}` : 'Single round';
    $('mm-fill').style.width = '6%';
    ov.classList.remove('hidden');

    const step = 540;
    TABLE_MATES.forEach((name, i) => {
      mmTimers.push(setTimeout(() => {
        const s = seats[i + 1];
        s.classList.add('in');
        s.querySelector('span').textContent = name;
        $('mm-fill').style.width = (26 + i * 26) + '%';
      }, 460 + i * step));
    });
    mmTimers.push(setTimeout(() => {
      $('mm-title').textContent = 'Table is set';
      $('mm-fill').style.width = '100%';
    }, 460 + TABLE_MATES.length * step));
    mmTimers.push(setTimeout(() => {
      ov.classList.add('hidden');
      launch(cfg);
    }, 460 + TABLE_MATES.length * step + 620));
  }

  // ----------------------------------------------------------------- people

  const FRIENDS = [
    { name: 'The Colonel', lv: 31, sym: 'ch-colonel', state: 'online' },
    { name: 'Kavya',       lv: 19, sym: 'ch-seth',    state: 'online' },
    { name: 'Kunjappan',   lv: 44, sym: 'ch-shark',   state: 'ingame' },
    { name: 'Sana Iqbal',  lv: 12, sym: 'ch-colonel', state: 'online' },
    { name: 'Rohan',       lv: 27, sym: 'ch-hotshot', state: 'online' },
    { name: 'Devan P.',    lv: 38, sym: 'ch-seth',    state: 'offline' }
  ];
  const STATE_TXT = { online: 'Online now', ingame: 'In a game', offline: 'Offline' };
  const STATE_COL = { online: '#4FD483', ingame: '#E0A94C', offline: 'rgba(255,238,206,.24)' };
  const invited = {};

  function avatar(sym, cls) {
    return `<div class="av ${cls || 'av-sm'}"><div class="av-ring"></div>` +
           `<div class="av-in"><svg viewBox="0 0 100 100"><use href="#${sym}"/></svg></div></div>`;
  }

  function paintFriends() {
    const tab = document.querySelector('[data-seg="invtab"] .on');
    const which = tab ? tab.textContent.split(' ')[0] : 'Online';
    const q = ($('inv-search').value || '').trim().toLowerCase();

    let rows = FRIENDS.slice();
    if (which === 'Online') rows = rows.filter((f) => f.state !== 'offline');
    if (which === 'Recent') rows = rows.slice(0, 3);
    if (q) rows = rows.filter((f) => f.name.toLowerCase().includes(q));

    const host = $('inv-list');
    host.innerHTML = '';
    if (!rows.length) {
      host.innerHTML = '<div class="row"><div class="row-main"><b>Nobody matches that</b>' +
                       '<div class="row-sub">Try another name</div></div></div>';
      return;
    }
    rows.forEach((f) => {
      const sent = invited[f.name];
      const off = f.state === 'offline';
      const d = document.createElement('div');
      d.className = 'row';
      d.innerHTML =
        avatar(f.sym, 'av-xs') +
        `<div class="row-main"><b>${f.name}</b><div class="row-sub">` +
        `<span class="pdot" style="background:${STATE_COL[f.state]};${off ? '' : 'box-shadow:0 0 7px ' + STATE_COL[f.state]}"></span>` +
        `${STATE_TXT[f.state]} · LV ${f.lv}</div></div>` +
        `<button class="pill ${sent ? 'sent' : off ? 'ghost' : ''}">${sent ? 'SENT' : off ? 'NOTIFY' : 'INVITE'}</button>`;
      d.querySelector('button').onclick = () => {
        invited[f.name] = !invited[f.name];
        paintFriends();
        toast(invited[f.name] ? `Invite sent to ${f.name}` : 'Invite withdrawn');
      };
      host.appendChild(d);
    });
  }

  // ------------------------------------------------------------ leaderboard

  const LADDER = [
    { rank: 4, name: 'Sana Iqbal',   pts: 16410, games: 428, wr: 58, d: 3,  up: true,  sym: 'ch-colonel' },
    { rank: 5, name: 'Vikram Rao',   pts: 15970, games: 511, wr: 55, d: 1,  up: false, sym: 'ch-seth' },
    { rank: 6, name: 'Meera Nair',   pts: 15120, games: 390, wr: 57, d: 4,  up: true,  sym: 'ch-hotshot' },
    { rank: 7, name: 'Kavya Menon',  pts: 14880, games: 302, wr: 60, d: 2,  up: true,  sym: 'ch-shark' },
    { rank: 8, name: 'Imran Sheikh', pts: 13760, games: 344, wr: 54, d: 1,  up: true,  sym: 'ch-colonel' }
  ];

  function paintRanks() {
    const host = $('rank-list');
    host.innerHTML = '';
    LADDER.forEach((r) => {
      const d = document.createElement('div');
      d.className = 'row';
      d.innerHTML =
        `<span class="rk">${r.rank}</span>` + avatar(r.sym, 'av-xs') +
        `<div class="row-main"><b>${r.name}</b><div class="row-sub">${r.games} games · ${r.wr}% win rate</div></div>` +
        `<div class="row-r"><b>${fmt(r.pts)}</b><div class="delta ${r.up ? 'up' : 'down'}">` +
        `<span>${r.up ? '▲' : '▼'}</span><span>${r.d}</span></div></div>`;
      host.appendChild(d);
    });

    $('rank-self').innerHTML =
      `<span class="rk gold">24</span>` + avatar('ch-seth', 'av-xs') +
      `<div class="row-main"><b>You</b><div class="row-sub">Level ${P.level} · ${fmt(P.coins)} coins</div></div>` +
      `<div class="row-r"><b class="gold">${fmt(P.rating)}</b><div class="delta up"><span>▲</span><span>6</span></div></div>`;
  }

  // ------------------------------------------------------------------- shop

  const PACKS = [
    { id: 'p1', amount: 5000,  price: '₹79',  art: 'ic-coin',  tag: null },
    { id: 'p2', amount: 30000, price: '₹349', art: 'ic-stack', tag: 'BEST', note: '+15% BONUS' },
    { id: 'p3', amount: 90000, price: '₹899', art: 'ic-stack', tag: null }
  ];
  const BACKS = [
    { id: 'classic', name: 'Classic Red', cost: 0,    css: 'repeating-linear-gradient(45deg, rgba(255,235,190,.1) 0 3px, rgba(0,0,0,0) 3px 6px), radial-gradient(75% 65% at 50% 30%, #8E2233, #56121F 60%, #310A12)' },
    { id: 'peacock', name: 'Peacock',     cost: 4500, tag: 'NEW', css: 'repeating-linear-gradient(0deg, rgba(255,235,190,.12) 0 2px, rgba(0,0,0,0) 2px 7px), radial-gradient(75% 65% at 50% 30%, #1E6B4D, #124834 60%, #07231A)' },
    { id: 'gold',    name: 'Gold Leaf',   cost: 9000, css: 'repeating-linear-gradient(45deg, rgba(255,235,190,.16) 0 2px, rgba(0,0,0,0) 2px 8px), radial-gradient(75% 65% at 50% 30%, #7A5A22, #46320F 60%, #221706)' }
  ];

  function paintShop() {
    const packs = $('coin-packs');
    packs.innerHTML = '';
    PACKS.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'tile' + (p.tag ? ' hot' : '');
      d.innerHTML =
        (p.tag ? `<span class="ribbon-tag">${p.tag}</span>` : '') +
        `<svg class="art" viewBox="0 0 24 24"><use href="#${p.art}"/></svg>` +
        `<div><b class="${p.tag ? 'gold' : ''}">${fmt(p.amount)}</b><br><small>${p.note || 'COINS'}</small></div>` +
        `<button class="buy cash">${p.price}</button>`;
      d.querySelector('button').onclick = () => {
        addCoins(p.amount);
        toast(`+${fmt(p.amount)} coins added`);
      };
      packs.appendChild(d);
    });

    const backs = $('card-backs');
    backs.innerHTML = '';
    BACKS.forEach((b) => {
      const owned = P.owned.includes(b.id);
      const afford = P.coins >= b.cost;
      const d = document.createElement('div');
      d.className = 'tile' + (b.tag && !owned ? ' hot' : '');
      d.innerHTML =
        (b.tag && !owned ? `<span class="ribbon-tag red">${b.tag}</span>` : '') +
        `<div class="cardback" style="background:${b.css}"></div>` +
        `<b style="font-size:11px">${b.name}</b>` +
        (owned
          ? '<button class="buy owned">OWNED</button>'
          : `<button class="buy" ${afford ? '' : 'disabled'}><svg viewBox="0 0 24 24"><use href="#ic-coin"/></svg>${fmt(b.cost)}</button>`);
      if (!owned) {
        d.querySelector('button').onclick = () => {
          if (P.coins < b.cost) return toast('Not enough coins');
          addCoins(-b.cost);
          P.owned.push(b.id); save();
          paintShop();
          toast(`${b.name} unlocked`);
        };
      }
      backs.appendChild(d);
    });
    $('owned-count').textContent = P.owned.length + ' owned';
  }

  // ---------------------------------------------------------------- rewards

  const DAYS = [200, 400, 700, 1500, 2000, 3000];

  function paintRewards() {
    const claimed = P.claimedOn === today();
    const day = Math.min(P.streak, 7);
    $('streak-lbl').textContent = `DAY ${day} STREAK`;
    $('days-left').textContent = Math.max(0, 7 - day);

    const grid = $('day-grid');
    grid.innerHTML = '';
    DAYS.forEach((amt, i) => {
      const n = i + 1;
      const done = n < day || (n === day && claimed);
      const live = n === day && !claimed;
      const d = document.createElement('div');
      d.className = 'day' + (done ? ' done' : live ? ' live' : '');
      d.innerHTML =
        (done ? '<span class="tick"><svg viewBox="0 0 24 24"><use href="#ic-tick"/></svg></span>' : '') +
        `<small>${live ? 'TODAY' : 'DAY ' + n}</small>` +
        `<svg viewBox="0 0 24 24"><use href="#ic-coin"/></svg>` +
        `<b>${fmt(amt)}</b>`;
      grid.appendChild(d);
    });

    const btn = $('claim-btn');
    const amt = DAYS[Math.min(day, DAYS.length) - 1];
    btn.disabled = claimed;
    btn.textContent = claimed ? 'COME BACK TOMORROW' : `CLAIM ${fmt(amt)} COINS`;
    btn.onclick = () => {
      if (P.claimedOn === today()) return;
      P.claimedOn = today();
      P.streak = Math.min(7, P.streak);
      save();
      addCoins(amt);
      paintRewards();
      toast(`+${fmt(amt)} coins claimed`);
    };

    paintQuests();
    paintWallet();
  }

  function paintQuests() {
    const st = window.T28Table.stats();
    const QUESTS = [
      { name: 'Win a round', have: Math.min(st.wins, 1), need: 1, reward: 500,
        icon: '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 5.2H4.4V7a3.4 3.4 0 0 0 3 3.4M17 5.2h2.6V7a3.4 3.4 0 0 1-3 3.4"/><path d="M12 13v3.4M8.4 20h7.2l-.8-3.6H9.2z"/>' },
      { name: 'Play 3 rounds', have: Math.min(st.played, 3), need: 3, reward: 300,
        icon: '<rect x="3.4" y="5.6" width="11" height="14" rx="2"/><path d="M8.4 3.4h9a2 2 0 0 1 2 2v11"/>' },
      { name: 'Call 20 or more', have: Math.min(st.bigCalls, 1), need: 1, reward: 250,
        icon: '<path d="M4.6 8.4 12 4l7.4 4.4v7.2L12 20l-7.4-4.4z"/><path d="M12 4v16M4.6 8.4 12 12.6l7.4-4.2"/>' },
      { name: 'Take 20 points in one round', have: Math.min(st.bestPoints, 20), need: 20, reward: 750,
        icon: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>' }
    ];

    const host = $('quest-list');
    host.innerHTML = '';
    QUESTS.forEach((q) => {
      const full = q.have >= q.need;
      const done = P['q_' + q.name] === true;
      const pct = Math.round((q.have / q.need) * 100);
      const d = document.createElement('div');
      d.className = 'row';
      d.innerHTML =
        `<div class="qico"><svg viewBox="0 0 24 24" fill="none" stroke="#E6CE97" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${q.icon}</svg></div>` +
        `<div class="row-main"><b>${q.name}</b><div class="row-sub" style="gap:8px">` +
        `<span class="qbar"><i class="${full ? 'full' : ''}" style="width:${pct}%"></i></span>` +
        `<span>${q.have}/${q.need}</span></div></div>` +
        `<button class="pill ${full && !done ? '' : 'sent'}" ${full && !done ? '' : 'disabled'}>` +
        `${done ? 'DONE' : full ? 'CLAIM' : fmt(q.reward)}</button>`;
      if (full && !done) {
        d.querySelector('button').onclick = () => {
          P['q_' + q.name] = true; save();
          addCoins(q.reward);
          paintQuests();
          toast(`+${fmt(q.reward)} coins`);
        };
      }
      host.appendChild(d);
    });
  }

  function tickClock() {
    const now = new Date();
    const end = new Date(now); end.setHours(24, 0, 0, 0);
    let s = Math.floor((end - now) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    const n = $('reward-clock');
    if (n) n.textContent = `${h}:${m}:${ss}`;
  }

  // ------------------------------------------------------------------- boot

  document.addEventListener('DOMContentLoaded', () => {
    bindLobby();
    paintWallet();
    const ladder = $('rules-ladder');
    if (ladder) ladder.textContent = window.T28Match.ladderText();
    // deep link: #shop, #ranks, #rewards, #room, #invite, #play
    const want = (location.hash || '').replace('#', '');
    show(SCREENS.includes(want) || want === 'play' ? want : 'lobby');
    window.addEventListener('hashchange', () => {
      const w = (location.hash || '').replace('#', '');
      if (SCREENS.includes(w) || w === 'play') show(w);
    });
    tickClock();
    setInterval(tickClock, 1000);
  });

  window.T28Screens = { show, toast, addCoins, addXp, player: () => P };
})();
