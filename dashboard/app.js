// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, compare: [] };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // The category's token value per TVL dollar, first match wins on the lowercased category.
  var CATEGORY_MULT = [
    ['dex', 1.25], ['derivative', 1.25], ['perpetual', 1.25], ['rwa', 1.1],
    ['curator', 1.05], ['allocator', 1.05], ['liquid staking', 0.7], ['liquid restaking', 0.7],
    ['restak', 0.75], ['bridge', 0.6], ['staking', 0.7], ['stable', 0.9], ['insurance', 0.9]
  ];
  function categoryMultiplier(category) {
    var c = (category || '').toLowerCase();
    for (var i = 0; i < CATEGORY_MULT.length; i++) {
      if (c.indexOf(CATEGORY_MULT[i][0]) >= 0) return CATEGORY_MULT[i][1];
    }
    return 1.0;
  }
  function chainsMultiplier(row, model) {
    var n = Math.max(0, (row.chains ? row.chains.length : 0) - 1);
    return Math.min(1 + model.chain_weight * n, model.chain_cap);
  }
  // The launch window: rises to full value over 18 months, holds to 2 years, eases 15% by 3 years.
  function maturityMultiplier(age, model) {
    var a = age === null || age === undefined ? model.unknown_age_days : age;
    if (a <= 0) return model.maturity_floor;
    if (a < 540) return model.maturity_floor + (a / 540) * model.maturity_range;
    if (a <= 730) return model.maturity_floor + model.maturity_range;
    var over = Math.min(a - 730, 365);
    return model.maturity_floor + model.maturity_range - 0.15 * (over / 365);
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * categoryMultiplier(row.category) * chainsMultiplier(row, model) * growthMult * maturityMultiplier(row.age_days, model)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
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
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var half = Math.max(10, Math.round(capital / 2));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + half + ' against the supplied collateral, hold it a week, then repay half of it.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + half + " through " + name + "'s pool on " + chain + ' and add a second, smaller liquidity position.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + half + ' back to the origin chain so the wallet shows a round trip.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Delegate $' + half + ' more to a different validator or pool through ' + name + '.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the first hedge and open a fresh one in the opposite direction.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first position and place a second one on a different market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + half + ' into a second ' + name + ' vault with a different risk profile.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + half + ' more of the stable asset and redeem half of it a week later.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + half + ' more of the yield asset and hold it beside the first mint.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + half + ' of cover for a second, different risk on ' + chain + '.';
    return 'Make a second, smaller deposit of $' + half + ' into a different pool or vault on ' + chain + '.';
  }
  // A protocol's risk band, read the same way the model reads it: a wild week, a very young
  // listing, or a very long wait with no token is Elevated; a gentle move on a protocol in its
  // middle years is Lower; anything between the two is Moderate.
  function riskBandOf(p) {
    var weekly = p.change_7d === null || p.change_7d === undefined || !isFinite(p.change_7d) ? 0 : p.change_7d;
    var age = p.age_days === null || p.age_days === undefined ? null : p.age_days;
    if (weekly > 50 || weekly < -30) return 'Elevated';
    if (age !== null && age < 90) return 'Elevated';
    if (age !== null && age > 730) return 'Elevated';
    if (weekly > 20 || weekly < -10) return 'Moderate';
    if (age !== null && age < 180) return 'Moderate';
    return 'Lower';
  }
  // The closing review step, worded for the position's risk: a hot, fast-moving protocol gets a
  // prompt to bank some of the position if the move reverses, while a calm one gets a prompt to
  // leave it alone and let the snapshots accumulate.
  function reviewStep(risk) {
    if (risk === 'Elevated') {
      return { text: 'Review the position every week while the move is hot, and take some of it off the table if the growth reverses sharply.', cost: 'about $3 of gas to unwind part of the position', time: '10 minutes a week' };
    }
    return { text: 'Review the position once a month, check the protocol\'s points page, and leave the position alone between reviews.', cost: 'nothing to review', time: '10 minutes a month' };
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = secondChainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var spread = second !== null
      ? { text: 'Repeat the same deposit on ' + second + " so the wallet's activity is counted on two chains, not one.", cost: 'another $' + capital + ' of capital and about $4 of gas', time: '15 minutes' }
      : { text: 'Vote on one open governance proposal, or verify the wallet in the protocol\'s community forum.', cost: 'about $1 of gas, or nothing to verify', time: '10 minutes' };
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + Math.max(10, Math.round(capital / 2)) + ' of capital and about $3 of gas', time: '10 minutes' },
      spread,
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      reviewStep(riskBandOf(p))
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
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
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more genuine launch candidates the watchlist leaves out, above and below that floor. Wrapped, staked and bridged products are set aside: their token already trades. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Launch candidates added' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
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

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
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
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x category(category) x min(1 + ' + m.chain_weight + ' x (chains - 1), ' + m.chain_cap + ') x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x launchWindow(age_days) )'
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth and age come from the snapshot. Category is the token value a dollar of TVL supports: DEXes and derivatives capture fees, so they carry 1.25; bridges and staking are thin infrastructure, so they carry 0.60 to 0.70. Chains is reach: each chain past the first adds ' + (m.chain_weight * 100) + '%, capped at ' + m.chain_cap + '. launchWindow rises from ' + m.maturity_floor + ' at listing to 1.00 over 18 months, holds to 2 years, then eases 15% by 3 years; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every genuine launch candidate the watchlist leaves out, above and below the floor, and the live-token protocols are set aside with their market caps shown.' })
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
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Category multiplier' }), el('b', { class: 'num', text: String(row.category_multiplier) })),
        el('div', null, el('span', { text: 'Chains multiplier' }), el('b', { class: 'num', text: String(row.chains_multiplier) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // Where the implied value sits: the board grouped by category, strongest total first. A few
  // categories hold most of the value, and the panel names the strongest protocol in each group so
  // a reader can see whether the top of the board is one category's story or many.
  function categoryPanel() {
    var slices = DATA.categories || [];
    if (slices.length === 0) return null;
    var rows = slices.map(function (s) {
      return el('div', { class: 'slice' },
        el('div', { class: 'slice-head' },
          el('b', { text: s.category }),
          el('span', { class: 'num', text: fmtUsd(s.totalImplied) + ' · ' + s.sharePct + '%' })
        ),
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round(s.sharePct)) + '%' })),
        el('p', { class: 'sub', text: s.rows + ' rows · ' + s.watchlistRows + ' from the watchlist · strongest: ' + s.topName + ' (' + fmtUsd(s.topImplied) + ')' })
      );
    });
    return el('section', { class: 'panel categories' },
      el('h2', { text: 'Where the implied value sits' }),
      el('p', { class: 'sub', text: 'The board grouped by category, strongest total first. A few categories hold most of the value.' }),
      el('div', { class: 'slice-list' }, rows)
    );
  }

  // Two protocols, side by side. A reader picks any two rows from the board and the panel lays
  // their model inputs next to each other: TVL, growth, age, every multiplier, the implied value,
  // the momentum score and the risk band. The point is not to crown a winner but to make the
  // difference visible: two protocols can carry a similar implied value for opposite reasons, and
  // the comparison is what shows which reason is doing the work.
  function comparePanel() {
    var first = state.compare[0] || '';
    var second = state.compare[1] || '';
    function picker(slot, current) {
      var select = el('select', { 'aria-label': 'Compare protocol ' + (slot + 1) },
        el('option', { value: '', text: 'Pick a protocol' }),
        DATA.rows.map(function (r) {
          return el('option', { value: r.slug, text: '#' + r.rank + ' ' + r.name, selected: r.slug === current ? 'selected' : null });
        })
      );
      select.addEventListener('change', function () {
        var next = [state.compare[0] || '', state.compare[1] || ''];
        next[slot] = select.value;
        state.compare = next.filter(function (s) { return !!s; });
        render();
      });
      return el('div', { class: 'field' }, el('label', { text: 'Protocol ' + (slot + 1) }), select);
    }
    var picked = state.compare.map(function (slug) {
      return DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    }).filter(function (r) { return !!r; });
    var fields = [
      ['Implied value', function (r) { return fmtUsd(r.implied_value_usd); }],
      ['TVL', function (r) { return fmtUsd(r.tvl_usd); }],
      ['Seven-day growth', function (r) { return fmtPct(r.change_7d); }],
      ['Age with no token', function (r) { return fmtAge(r.age_days); }],
      ['Category multiplier', function (r) { return String(r.category_multiplier); }],
      ['Chains multiplier', function (r) { return String(r.chains_multiplier); }],
      ['Growth multiplier', function (r) { return String(r.growth_multiplier); }],
      ['Maturity multiplier', function (r) { return String(r.maturity_multiplier); }],
      ['Momentum score', function (r) { return r.velocity_score === undefined ? 'n/a' : r.velocity_score + ' (' + (r.velocity_label || '') + ')'; }],
      ['Risk band', function (r) { return r.risk_band || 'n/a'; }]
    ];
    var body;
    if (picked.length === 0) {
      body = el('p', { class: 'sub', text: 'Nothing picked yet. Choose two protocols above and their model inputs will appear side by side.' });
    } else {
      var head = el('tr', null, el('th', { scope: 'col', text: 'Measure' }));
      picked.forEach(function (r) {
        head.appendChild(el('th', { scope: 'col' }, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: 'Rank ' + r.rank }))));
      });
      var tbody = el('tbody');
      fields.forEach(function (f) {
        var tr = el('tr', null, el('td', { text: f[0] }));
        picked.forEach(function (r) { tr.appendChild(el('td', { class: 'num', text: f[1](r) })); });
        tbody.appendChild(tr);
      });
      body = el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, head), tbody));
    }
    var clear = el('button', { class: 'button', type: 'button', text: 'Clear comparison', onclick: function () { state.compare = []; render(); } });
    return el('section', { class: 'panel compare' },
      el('h2', { text: 'Compare two protocols' }),
      el('p', { class: 'sub', text: 'The same model inputs, side by side, for the two protocols you pick. Two protocols can carry a similar implied value for opposite reasons.' }),
      el('div', { class: 'compare-pickers' }, picker(0, first), picker(1, second)),
      body,
      el('div', { class: 'compare-actions' }, clear)
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      var cats = categoryPanel();
      if (cats) shell.appendChild(cats);
      shell.appendChild(comparePanel());
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
