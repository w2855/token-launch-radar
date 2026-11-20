// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs, the comparable evidence behind the number, and the protocol's farm plan. No network: every
// byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', confidence: 'all', scope: 'all', priority: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3);
  }

  // The valuation groups, the same folding main.ts applies: products a token would price the same way.
  var GROUPS = {
    lending: ['Lending', 'CDP', 'Collateral Markets', 'Collateralized Debt'],
    yield: ['Yield', 'Yield Aggregator', 'Leveraged Farming'],
    staking: ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Staking'],
    dex: ['Dexs', 'AMM', 'Liquidity Manager'],
    bridge: ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Interchain Bridge'],
    rwa: ['RWA', 'Real World Assets', 'Private Credit', 'Tokenized Private Credit'],
    basis: ['Basis Trading', 'Delta Neutral'],
    cex: ['CEX', 'CeDeFi'],
    curator: ['Onchain Capital Allocator', 'Risk Curators', 'Vault', 'Asset Manager'],
    infra: ['Chain', 'Infrastructure', 'Validator', 'Node Operator'],
    payments: ['Payments', 'Payments Infrastructure'],
    insurance: ['Insurance', 'Prediction Market']
  };
  function groupOf(category) {
    if (category === null || category === undefined) return null;
    for (var g in GROUPS) if (GROUPS[g].indexOf(category) >= 0) return g;
    return null;
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row) {
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    growth = Math.min(DATA.model.momentum_cap, Math.max(DATA.model.momentum_floor, growth));
    var momentum = 1 + (growth / 100) * DATA.model.momentum_weight;
    var group = groupOf(row.category);
    var stats = null;
    for (var i = 0; i < DATA.comparables.groups.length; i++) {
      var g = DATA.comparables.groups[i];
      if (g.group === group && g.used) { stats = g; break; }
    }
    var median = stats ? stats.median : DATA.comparables.global.median;
    return Math.max(1, Math.round(row.tvl_usd * median * momentum));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function badge(text, cls) { return el('span', { class: 'badge ' + (cls || ''), text: text }); }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function gasFor(p, capital) {
    var chain = chainOf(p).toLowerCase();
    var big = capital >= 150 ? 12 : 6;
    if (chain === 'solana' || chain === 'sui' || chain === 'tron') return 'about $' + (big <= 6 ? 2 : 4) + ' of fees';
    if (chain === 'arbitrum' || chain === 'base' || chain === 'optimism' || chain.indexOf('zk') >= 0 || chain === 'polygon') return 'about $' + (big <= 6 ? 2 : 3) + ' of gas';
    if (chain === 'ethereum') return 'about $' + big + ' of gas';
    return 'about $' + (big - 2) + ' of gas on ' + chainOf(p);
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0) return 'Deposit $' + capital + ' into one of ' + name + "'s curated vaults on " + chain + ' and keep the receipt token.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault or allocation on ' + chain + ' and keep the shares.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0 && c.indexOf('canonical') < 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s delta-neutral or margin product on " + chain + ' and keep the position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('private credit') >= 0 || c.indexOf('tokeniz') >= 0) return "Mint or subscribe $" + capital + " of " + name + "'s yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0 || c.indexOf('infrastructure') >= 0 || c.indexOf('validator') >= 0 || c.indexOf('node') >= 0) return 'Run or delegate to ' + name + "'s infrastructure on " + chain + ': stake $' + capital + ' through its own staking or node product.';
    if (c.indexOf('payment') >= 0) return 'Settle a real payment of $' + Math.max(1, Math.round(capital / 10)) + ' through ' + name + ' on ' + chain + ', then hold $' + capital + ' in its settlement asset.';
    if (c.indexOf('governance') >= 0) return 'Delegate $' + capital + ' of voting power and vote on one live proposal of ' + name + '.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gasFor(p, capital), time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('confidence')) state.confidence = params.get('confidence');
    if (params.get('scope')) state.scope = params.get('scope');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.confidence !== 'all') params.set('confidence', state.confidence);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.confidence !== 'all' && r.confidence !== state.confidence) return false;
      if (state.priority !== 'all' && r.farm_priority !== state.priority) return false;
      if (state.scope === 'watchlist' && !isWatchSlug(r)) return false;
      if (state.scope === 'early' && isWatchSlug(r)) return false;
      if (q) {
        var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      }
      return true;
    });
  }
  // The board carries each row's watchlist membership, so the page can scope the list without guessing.
  function isWatchSlug(r) {
    return r.in_watchlist === true;
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var classUsed = DATA.comparables.groups.filter(function (g) { return g.used; });
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' pre-token watchlist protocols, ranked by implied launch value' }),
        el('p', { text: 'Each price comes from the snapshot itself: the median market-cap-to-TVL of live-token protocols in the same valuation group prices the protocol that has no token yet, a seven-day momentum term tilts it, and every row carries the band, the confidence and the comparable evidence behind its number. The early radar adds ' + DATA.early_size + ' pre-token protocols below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. This is an estimate, not a promise: implied value says what a token would be worth if the protocol\'s record stayed as it is, never whether or when it launches.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Comparable groups in use' }), el('b', { text: classUsed.length + ' of ' + DATA.comparables.groups.length })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token comparables' }), el('b', { text: String(DATA.comparables.global.n) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function selectField(id, label, options, current, onpick) {
    var select = el('select', { id: id, 'aria-label': label });
    options.forEach(function (o) { select.appendChild(el('option', { value: o[0], text: o[1], selected: o[0] === current ? 'selected' : null })); });
    select.addEventListener('change', function () { onpick(select.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      selectField('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      selectField('confidence', 'Confidence', [['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], state.confidence, function (v) { state.confidence = v; }),
      selectField('scope', 'Scope', [['all', 'Whole board'], ['watchlist', 'Watchlist only'], ['early', 'Early radar only']], state.scope, function (v) { state.scope = v; }),
      selectField('priority', 'Farm priority', [['all', 'Any'], ['first', 'Farm first'], ['strong', 'Strong'], ['watch', 'Watch']], state.priority, function (v) { state.priority = v; }),
      el('span', { class: 'count', text: sortedRows(rows()).length + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function bandCell(r, max) {
    var lo = r.band.low_value_usd, hi = r.band.high_value_usd, mid = r.implied_value_usd;
    var loPct = Math.max(0, Math.min(100, (lo / max) * 100));
    var hiPct = Math.max(loPct + 2, Math.min(100, (hi / max) * 100));
    var midPct = Math.max(0, Math.min(100, (mid / max) * 100));
    return el('td', null, el('div', { class: 'bandcell' },
      el('div', { class: 'band', title: 'Comparable band $' + Math.round(lo) + ' to $' + Math.round(hi) },
        el('i', { class: 'band-range', style: 'left:' + loPct + '%;width:' + (hiPct - loPct) + '%' }),
        el('i', { class: 'band-mark', style: 'left:' + midPct + '%' })
      ),
      el('span', { class: 'num', text: fmtUsd(mid) })
    ));
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.confidence = 'all'; state.scope = 'all'; state.priority = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].band.high_value_usd || list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var confClass = { high: 'ok', medium: 'mid', low: 'warn' }[r.confidence] || '';
      var prioText = { first: 'farm first', strong: 'strong', watch: 'watch' }[r.farm_priority] || '';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'data-top': r.rank <= 3 ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('span', { class: 'rankchip' + (r.rank <= 3 ? ' podiumed' : ''), text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'badgeline' },
            badge(r.category || 'Other', 'cat'),
            (r.chains || []).length > 1 ? badge((r.chains.length) + ' chains', 'dim') : null,
            isWatchSlug(r) ? badge('watchlist', 'watch') : null
          )
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        bandCell(r, max),
        el('td', null, el('span', { class: 'badge ' + confClass, text: r.confidence + ' confidence' })),
        el('td', null, el('span', { class: 'sub', text: prioText }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied launch value first. The band is the comparable group\'s 25th to 75th percentile multiple on the same TVL; the mark is the model\'s number. Select a row for its evidence and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value (band)'),
            el('th', { scope: 'col', text: 'Confidence' }),
            el('th', { scope: 'col', text: 'Farm priority' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge ok', text: 'trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd !== null && r.tvl_usd > 0 ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-to-TVL ratios are the comparables the model prices with.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap/TVL' }))),
          tbody
        )
      )
    );
  }

  function groupTable() {
    var tbody = el('tbody');
    DATA.comparables.groups.forEach(function (g) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: g.group })),
        el('td', { class: 'num', text: String(g.n) }),
        el('td', { class: 'num', text: fmtMult(g.p25) }),
        el('td', { class: 'num', text: fmtMult(g.median) }),
        el('td', { class: 'num', text: fmtMult(g.p75) }),
        el('td', null, el('span', { class: 'badge ' + (g.used ? 'ok' : 'dim'), text: g.used ? 'in use' : 'global fallback' })),
        el('td', null, el('span', { class: 'sub', text: g.why }))
      ));
    });
    return el('div', { class: 'panel' },
      el('h2', { text: 'The comparable table' }),
      el('p', { class: 'sub', text: 'Every live-token protocol in the snapshot with a market cap and a TVL gives one ratio, listings under ' + fmtMult(DATA.model.dead_ratio_floor) + ' mcap/tvl excluded as deader than dead. A group prices its own rows when it has at least ' + DATA.model.group_min_samples + ' comparables and its 75th to 25th percentile span stays within ' + DATA.model.group_max_spread + 'x; otherwise the global median stands in and the row says so.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Group' }), el('th', { scope: 'col', text: 'Comparables' }), el('th', { scope: 'col', text: 'P25' }), el('th', { scope: 'col', text: 'Median' }), el('th', { scope: 'col', text: 'P75' }), el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Note' }))),
          tbody
        )
      )
    );
  }

  // The group overview: what each valuation group holds on the board, aggregated from the rows the
  // snapshot's own comparables priced. Every figure is summed from the rows, never hard-coded.
  // The podium: the board's three strongest claims, the first thing a reader sees. Every figure is
  // read straight off the board's own rows, never restated by hand.
  function podiumPanel() {
    var top = DATA.rows.slice(0, 3);
    var sumImplied = DATA.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    return el('section', { class: 'podium' },
      el('div', { class: 'podium-sum' },
        el('span', { class: 'sub', text: 'Implied value across all ' + DATA.board_size + ' pre-token rows' }),
        el('b', { class: 'num', text: fmtUsd(sumImplied) })
      ),
      el('div', { class: 'podium-grid' }, top.map(function (r) {
        return el('button', { class: 'podiumcard', type: 'button', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'podium-rank', text: '#' + r.rank }),
          el('b', { class: 'podium-name', text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtUsd(r.tvl_usd) + ' TVL' }),
          el('b', { class: 'podium-value num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: 'band ' + fmtUsd(r.band.low_value_usd) + ' – ' + fmtUsd(r.band.high_value_usd) }),
          el('span', { class: 'badge ' + (r.confidence === 'high' ? 'ok' : r.confidence === 'medium' ? 'mid' : 'warn'), text: r.confidence + ' confidence' })
        );
      }))
    );
  }

  function groupsPanel() {
    var byGroup = {};
    DATA.rows.forEach(function (r) {
      var g = r.comparable.group;
      if (!byGroup[g]) byGroup[g] = { count: 0, tvl: 0, implied: 0, top: [] };
      var b = byGroup[g];
      b.count += 1;
      b.tvl += r.tvl_usd;
      b.implied += r.implied_value_usd;
      b.top.push(r);
    });
    var stats = DATA.comparables.groups.slice().sort(function (a, b) { return b.n - a.n; });
    var cards = stats.map(function (g) {
      var b = byGroup[g.group] || { count: 0, tvl: 0, implied: 0, top: [] };
      b.top.sort(function (x, y) { return y.tvl_usd - x.tvl_usd; });
      var best = b.top.slice(0, 3).map(function (r) { return r.name; }).join(', ');
      return el('div', { class: 'groupcard' },
        el('div', { class: 'groupcard-head' },
          el('b', { text: g.group }),
          el('span', { class: 'badge ' + (g.used ? 'ok' : 'dim'), text: g.used ? 'own median ' + fmtMult(g.median) : 'global ' + fmtMult(DATA.comparables.global.median) })
        ),
        el('div', { class: 'groupcard-grid' },
          el('span', { text: 'Rows on board' }), el('b', { class: 'num', text: String(b.count) }),
          el('span', { text: 'TVL held' }), el('b', { class: 'num', text: fmtUsd(b.tvl) }),
          el('span', { text: 'Implied, summed' }), el('b', { class: 'num', text: fmtUsd(b.implied) }),
          el('span', { text: 'Live-token comparables' }), el('b', { class: 'num', text: String(g.n) })
        ),
        b.count > 0 ? el('p', { class: 'sub', text: 'Biggest on the board: ' + best + '.' }) : el('p', { class: 'sub', text: 'No pre-token protocol of this group made the board.' })
      );
    });
    return el('section', { class: 'panel groups' },
      el('h2', { text: 'The board by valuation group' }),
      el('p', { class: 'sub', text: 'What each comparable group holds: the pre-token rows it priced, the TVL they carry, the implied value summed over them, and the live-token protocols the median came from. A group that fell back to the global median says so on its card.' }),
      el('div', { class: 'groupgrid' }, cards)
    );
  }

  // The chain spread of the board: where the pre-token capital sits, from the rows' own chain lists.
  function chainPanel() {
    var byChain = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) {
        if (!byChain[c]) byChain[c] = { count: 0, tvl: 0 };
        byChain[c].count += 1;
        byChain[c].tvl += r.tvl_usd / Math.max(1, (r.chains || []).length);
      });
    });
    var chains = Object.keys(byChain).map(function (c) { return { chain: c, count: byChain[c].count, tvl: byChain[c].tvl }; })
      .sort(function (a, b) { return b.tvl - a.tvl; }).slice(0, 12);
    var max = chains.length > 0 ? chains[0].tvl : 1;
    var tbody = el('tbody');
    chains.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.chain })),
        el('td', { class: 'num', text: String(c.count) }),
        el('td', null, el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((c.tvl / max) * 100)) + '%' }))),
        el('td', { class: 'num', text: fmtUsd(c.tvl) })
      ));
    });
    return el('section', { class: 'panel chains' },
      el('h2', { text: 'Where the pre-token capital sits' }),
      el('p', { class: 'sub', text: 'The board\'s TVL spread over the chains the protocols name, a protocol shared over several chains counted once per chain in equal parts. The first twelve chains by that share are shown.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Chain' }), el('th', { scope: 'col', text: 'Rows' }), el('th', { scope: 'col', text: 'Share of TVL' }), el('th', { scope: 'col', text: 'TVL (split share)' }))),
        tbody
      ))
    );
  }

  // A CSV of the whole board, built in the page from the same data.js: no network, one download.
  function csvUrl() {
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'band_low_usd', 'band_high_usd', 'comparable_group', 'comparable_n', 'comparable_median', 'confidence', 'farm_priority'];
    var lines = [head.join(',')];
    DATA.rows.forEach(function (r) {
      var cells = [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', r.category || '', '"' + (r.chains || []).join(' ') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days, r.implied_value_usd, r.band.low_value_usd, r.band.high_value_usd, r.comparable.group, r.comparable.n, r.comparable.median, r.confidence, r.farm_priority];
      lines.push(cells.join(','));
    });
    return URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = max(1, round( tvl_usd x comparable_median x (1 + clamp(change_7d, ' + m.momentum_floor + ', ' + m.momentum_cap + ') / 100 x ' + m.momentum_weight + ') ))'
      ),
      el('p', { class: 'sub', text: 'The comparable_median is the ' + DATA.model_version + ' change from a flat multiple: instead of one number for every protocol, each valuation group is priced by the live-token protocols already in it — ' + DATA.comparables.global.n + ' of them across the snapshot — and a group too thin or too scattered falls back to the global median of ' + fmtMult(DATA.comparables.global.median) + ', with the row\'s confidence label reporting what backed it. The band is the same TVL priced at the group\'s 25th and 75th percentile. Farm priority orders effort, not a launch prediction.' }),
      el('div', { class: 'exportrow' },
        el('button', { class: 'button', type: 'button', text: 'Download the board as CSV', onclick: function () {
          var a = el('a', { href: csvUrl(), download: 'token-radar-board.csv' });
          document.body.appendChild(a);
          a.click();
          a.remove();
        } }),
        el('span', { class: 'sub', text: DATA.board_size + ' rows, the band, the comparable and the priority included.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var m = DATA.model;
    var growth = Math.min(m.momentum_cap, Math.max(m.momentum_floor, row.change_7d === null ? 0 : row.change_7d));
    var momentum = 1 + (growth / 100) * m.momentum_weight;
    var median = row.comparable.median;
    var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (isWatchSlug(row) ? ' · watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.listed_at ? ' · tracked since ' + row.listed_at : ' · no tracking date recorded') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied launch value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: row.comparable.group + ' comparable median (' + row.comparable.n + ' live-token rows)' }), el('b', { class: 'num', text: fmtMult(median) })),
        el('div', null, el('span', { text: 'Seven-day momentum term' }), el('b', { class: 'num', text: momentum.toFixed(4) + ' (' + fmtPct(row.change_7d) + ' 7d)' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Comparable band (p25 to p75 on the same TVL)' }), el('b', { class: 'num', text: fmtUsd(row.band.low_value_usd) + ' – ' + fmtUsd(row.band.high_value_usd) })),
        el('div', null, el('span', { text: 'Confidence' }), el('b', { class: 'num', text: row.confidence }))
      ),
      el('p', { class: 'sub', text: (row.comparable.quality === 'class' ? 'This row is priced by its own valuation group. ' : 'This row falls back to the global live-token median. ') + 'The page recomputes the row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price: it says what a token would be worth if this record stayed as it is.' })
    ));
    var peers = (DATA.peer_table || {})[row.comparable.group] || [];
    if (peers.length > 0) {
      var tbody = el('tbody');
      peers.forEach(function (p) {
        tbody.appendChild(el('tr', null,
          el('td', null, el('b', { text: p.name })),
          el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
          el('td', { class: 'num', text: fmtMult(p.ratio) })
        ));
      });
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'The comparables behind the multiple' }),
        el('p', { class: 'sub', text: 'The biggest live-token protocols of the ' + row.comparable.group + ' group, with the market cap their token trades at against the TVL they hold. Their median is the multiple this row was priced by.' }),
        el('div', { class: 'table-wrap' }, el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Comparable' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap/TVL' }))),
          tbody
        ))
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' + (row.farm_priority === 'first' ? ' — farm this one first' : row.farm_priority === 'strong' ? ' — a strong farm' : ' — watch this one') }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null, el('b', { text: s.text }), el('span', { class: 'cost', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(podiumPanel());
    shell.appendChild(controls());
    shell.appendChild(el('div', { class: 'tabsbar' },
      el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; render(); } }),
      el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; render(); } })
    ));
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(groupsPanel());
      shell.appendChild(modelPanel());
      shell.appendChild(groupTable());
      shell.appendChild(chainPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
