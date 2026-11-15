// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, compare: [] };

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
  // The size curve is fitted on the snapshot's own traded comparables: log10(market cap) on
  // log10(TVL), intercept and slope in DATA.fit. Growth and the launch window are small stated
  // priors, not fitted claims: the comps show no reliable growth or age effect on the multiple.
  function curveValue(tvl, fit) {
    if (!tvl || tvl <= 0) return 1;
    return Math.max(1, Math.round(Math.pow(10, fit.intercept + fit.slope * Math.log10(tvl))));
  }
  function growthMultiplier(row, fit) {
    var growth = Math.min(100, Math.max(-50, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    return 1 + (growth / 100) * fit.growthWeight;
  }
  // The launch window, as a prior: rises from 0.80 at listing to full value over 18 months, holds
  // to 2 years, then eases to 0.90 by 3 years. An unknown age takes the 1-year point.
  function maturityMultiplier(age) {
    var a = age === null || age === undefined ? 365 : age;
    if (a <= 0) return 0.8;
    if (a < 540) return 0.8 + (a / 540) * 0.2;
    if (a <= 730) return 1.0;
    var over = Math.min(a - 730, 365);
    return 1.0 - 0.1 * (over / 365);
  }
  function impliedOf(row, fit) {
    return Math.max(1, Math.round(curveValue(row.tvl_usd, fit) * growthMultiplier(row, fit) * maturityMultiplier(row.age_days)));
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
      return { text: 'Review the position every week while the move is hot, and take some of it off the table if the growth reverses sharply.', cost: 'about $3 of gas to unwind part of the position', time: '10 minutes a week', gasUsd: 3, capitalUsd: 0 };
    }
    return { text: 'Review the position once a month, check the protocol\'s points page, and leave the position alone between reviews.', cost: 'nothing to review', time: '10 minutes a month', gasUsd: 0, capitalUsd: 0 };
  }
  // A protocol's farm plan, netted to the dollar: nine action steps plus a tenth that adds the
  // totals up. The gas and capital of every step are counted here, so the net step is the plan's
  // own arithmetic: a top-tier farmer's share of a 7% farmer pool at the low end of the band,
  // minus the gas the plan spends. Farm when the net clears $100, Thin when it covers the gas,
  // Skip when it does not. The same derivation main.ts writes to board.json.
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = secondChainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var half = Math.max(10, Math.round(capital / 2));
    var weeklyGas = 2 * Math.ceil(hold / 7);
    var spread = second !== null
      ? { text: 'Repeat the same deposit on ' + second + " so the wallet's activity is counted on two chains, not one.", cost: 'another $' + capital + ' of capital and about $4 of gas', time: '15 minutes', gasUsd: 4, capitalUsd: capital }
      : { text: 'Vote on one open governance proposal, or verify the wallet in the protocol\'s community forum.', cost: 'about $1 of gas, or nothing to verify', time: '10 minutes', gasUsd: 1, capitalUsd: 0 };
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes', gasUsd: 3, capitalUsd: 0 },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up', gasUsd: capital >= 150 ? 8 : 4, capitalUsd: capital },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + half + ' of capital and about $3 of gas', time: '10 minutes', gasUsd: 3, capitalUsd: half },
      spread,
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week, about $' + weeklyGas + ' over the ' + hold + '-day hold', time: '10 minutes a week', gasUsd: weeklyGas, capitalUsd: 0 },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days', gasUsd: 0, capitalUsd: 0 },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes', gasUsd: 0, capitalUsd: 0 },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes', gasUsd: 0, capitalUsd: 0 },
      reviewStep(riskBandOf(p))
    ];
    var gas = steps.reduce(function (n, s) { return n + s.gasUsd; }, 0);
    var cap = steps.reduce(function (n, s) { return n + s.capitalUsd; }, 0);
    var fit = DATA.fit;
    var expected = Math.round(fit.farmerPoolPct * fit.farmerShare * p.band_low);
    var net = expected - gas;
    var verdict = net >= 100 ? 'Farm' : net >= 0 ? 'Thin' : 'Skip';
    steps.push({
      text: 'Net: $' + gas + ' of gas spent and $' + cap + ' of capital at work (returned on exit). At the low end of the band ($' + p.band_low.toLocaleString('en-US') + "), a top-tier farmer's share of a 7% farmer pool is $" + expected.toLocaleString('en-US') + ', so this plan nets $' + net.toLocaleString('en-US') + ' after gas. Verdict: ' + verdict + '.',
      cost: 'the totals above',
      time: 'no extra time',
      gasUsd: 0,
      capitalUsd: 0
    });
    return steps.map(stepText);
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
      if (state.verdict !== 'all' && r.net_verdict !== state.verdict) return false;
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
      else if (key === 'net') { av = a.net_usd; bv = b.net_usd; }
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
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more genuine launch candidates the watchlist leaves out, above and below that floor. Wrapped, staked and bridged products are set aside: their token already trades. Implied value comes from a size curve fitted on ' + DATA.fit.comps + ' traded comparables and tested blind four ways (leave-one-out ' + DATA.fit.looMedian + 'x, time split ' + DATA.fit.splitMedian + 'x, 5-fold ' + DATA.fit.kfoldMedian + 'x), not a hand-set multiple \u2014 a dollar of TVL is worth less as a protocol grows. Every farm plan is netted to the dollar, with a Farm, Thin or Skip verdict. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Launch candidates added' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Farm plans that clear $100 net' }), el('b', { text: String(DATA.rows.filter(function (r) { return r.net_verdict === 'Farm'; }).length) + ' of ' + DATA.board_size }))
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
    var verdicts = ['Farm', 'Thin', 'Skip'];
    var verdictSelect = el('select', { id: 'verdict', 'aria-label': 'Filter by farm-plan verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      verdicts.map(function (v) { return el('option', { value: v, text: v + ' plan', selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSelect.addEventListener('change', function () { state.verdict = verdictSelect.value; render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm plan' }), verdictSelect),
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
        el('td', null, el('div', { class: 'net' },
          el('span', { class: 'num' + (r.net_usd < 0 ? ' neg' : ' pos'), text: (r.net_usd >= 0 ? '+' : '') + '$' + r.net_usd.toLocaleString('en-US') }),
          el('span', { class: 'verdict verdict-' + r.net_verdict.toLowerCase(), text: r.net_verdict })
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
            sortHeader('net', 'Plan net'),
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
    var f = DATA.fit;
    function curveAt(tvl) {
      return Math.max(1, Math.round(Math.pow(10, f.intercept + f.slope * Math.log10(tvl))));
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one fitted curve, not a hand-set multiple. The curve is fitted on the snapshot\u2019s own traded protocols, and it is tested blind before it prices anything.' }),
      el('div', { class: 'formula' },
        'implied = round( 10 ^ (' + f.intercept + ' + ' + f.slope + ' x log10(tvl_usd)) x (1 + clamp(change_7d, -50, 100) / 100 x ' + f.growthWeight + ') x launchWindow(age_days) )'
      ),
      el('p', { class: 'sub', text: 'The comparables are the ' + f.comps + ' traded protocols with a market cap on record, cleaned the same way the board is cleaned: no wrapped, staked or bridged product, no exchange, and a market-cap-to-TVL ratio inside [0.05, 5] — the window where a token\u2019s value is actually tied to its protocol\u2019s size, so a nearly dead token (under a twentieth of its TVL) and a speculative premium (over five times it) cannot bend the fit. The fit is least squares of log10(market cap) on log10(TVL): intercept ' + f.intercept + ', slope ' + f.slope + ', R\u00b2 ' + f.r2 + '. A dollar of TVL is worth less, not more, as a protocol grows: the curve prices $1B of TVL at about ' + fmtUsd(curveAt(1e9)) + ' and $10B at about ' + fmtUsd(curveAt(1e10)) + ', where the old flat 0.25x multiple priced them at $250M and $2.5B. Growth and the launch window are small stated priors, not fitted claims: the comps show no reliable growth or age effect on the multiple, so a fast week lifts the value a little and a bad week trims it a little, and launchWindow rises from 0.80 at listing to 1.00 over 18 months, holds to 2 years, then eases to 0.90 by 3 years; an unknown age takes the 1-year point.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Leave-one-out, median error' }), el('b', { text: f.looMedian + 'x (p75 ' + f.looP75 + 'x)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Time split (fit before Jun 2025, test after)' }), el('b', { text: f.splitMedian + 'x on ' + f.splitN + ' protocols' })),
        el('div', { class: 'fact' }, el('span', { text: '5-fold cross-validation, median error' }), el('b', { text: f.kfoldMedian + 'x' })),
        el('div', { class: 'fact' }, el('span', { text: 'Bootstrap slope, 90% interval' }), el('b', { text: f.slopeP5 + ' \u2013 ' + f.slopeP95 })),
        el('div', { class: 'fact' }, el('span', { text: 'Implied-value band' }), el('b', { text: '\u00f7/\u00d7 ' + f.band + 'x' })),
        el('div', { class: 'fact' }, el('span', { text: 'Farmer pool assumption' }), el('b', { text: (f.farmerPoolPct * 100) + '% pool \u00d7 ' + (f.farmerShare * 100) + '% share' }))
      ),
      el('p', { class: 'sub', text: 'Each farm plan is netted to the dollar in its last step: the gas the plan spends, the capital it puts to work (returned on exit), and what a top-tier farmer\u2019s share of a ' + (f.farmerPoolPct * 100) + '% farmer pool would be worth at the low end of the band. Farm when the net clears $100, Thin when it covers the gas, Skip when it does not. The pool and share are stated assumptions, not promises; the net is the plan\u2019s own arithmetic on them. The early radar is every genuine launch candidate the watchlist leaves out, above and below the floor, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  // Why this model, and what was tried and rejected. A reader who only sees the formula
  // cannot tell whether the choices behind it were tested or guessed, so this panel says
  // plainly what was tried, what the blind tests said, and what the model does not claim.
  function researchNote() {
    var f = DATA.fit;
    return el('section', { class: 'panel note' },
      el('h2', { text: 'Why this model — and what it does not claim' }),
      el('p', { class: 'sub', text: 'The size curve is the whole model, and it is fitted, not set: log10(market cap) on log10(TVL) over ' + f.comps + ' traded comparables the snapshot itself carries. The comparables are the traded protocols whose token value is actually tied to their size — a market-cap-to-TVL ratio inside [0.05, 5]. Below that window the token is nearly dead, above it the price is a speculative premium, and either tail bends the curve. The window keeps the ratio distribution\u2019s own bulk (median 0.25, 75th percentile about 1.06) and trims the tails.' }),
      el('p', { class: 'sub', text: 'Four blind tests, all on this run: leave-one-out median error ' + f.looMedian + 'x, time split ' + f.splitMedian + 'x on ' + f.splitN + ' protocols listed after June 2025, 5-fold cross-validation ' + f.kfoldMedian + 'x, and a bootstrap over the comparables that puts the slope between ' + f.slopeP5 + ' and ' + f.slopeP95 + ' nine times in ten. The band the board states is the time-split error, \u00f7/\u00d7 ' + f.band + 'x. A wider comp window was tried and rejected: more comparables, worse blind error on every test. Fitting seven-day growth as a feature was tried and rejected too: one week\u2019s spike would dominate the valuation, and a protocol up thousands of percent in seven days would jump to the top of the board on noise alone, so growth stays a small prior. A category factor and a chain count were tried and rejected the same way — both raised the blind error.' }),
      el('p', { class: 'sub', text: 'What the model does not claim: the implied value is an estimate from size alone, not a price, and the fit is noisy (R\u00b2 ' + f.r2 + ') because a protocol\u2019s token value depends on more than its TVL — its team, its token design, its timing. The band says how noisy. The farm plans are arithmetic on stated assumptions (a ' + (f.farmerPoolPct * 100) + '% farmer pool, a ' + (f.farmerShare * 100) + '% top-tier share), not a promise that any airdrop pays.' })
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
        el('div', null, el('span', { text: 'Size curve value' }), el('b', { class: 'num', text: fmtUsd(row.curve_value) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Implied-value band' }), el('b', { class: 'num', text: fmtUsd(row.band_low) + ' \u2013 ' + fmtUsd(row.band_high) })),
        el('div', null, el('span', { text: 'Farm plan net' }), el('b', { class: 'num', text: (row.net_usd >= 0 ? '+' : '') + '$' + row.net_usd.toLocaleString('en-US') + ' \u00b7 ' + row.net_verdict }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same fitted curve scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.fit)) + (impliedOf(row, DATA.fit) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' The band is \u00f7/\u00d7 ' + DATA.fit.band + 'x, the time-split blind-test error. This is an estimate, not a price.' }),
      el('p', { class: 'why', text: 'Why rank ' + row.rank + ': ' + row.name + ' holds ' + fmtUsd(row.tvl_usd) + ' of TVL, which the fitted curve prices at ' + fmtUsd(row.curve_value) + '; ' + (row.change_7d !== null && row.change_7d !== undefined ? (row.change_7d >= 0 ? 'a ' + fmtPct(row.change_7d) + ' week lifts it a little' : 'a ' + fmtPct(row.change_7d) + ' week trims it a little') + ' and ' : '') + fmtAge(row.age_days) + ' with no token ' + (row.age_days !== null && row.age_days !== undefined && row.age_days > 540 ? 'keeps it near full maturity' : 'puts it early in the launch window') + ', for an implied value of ' + fmtUsd(row.implied_value_usd) + '. The farm plan nets ' + (row.net_usd >= 0 ? '+' : '') + '$' + row.net_usd.toLocaleString('en-US') + ' after gas, so the verdict is ' + row.net_verdict + '.' })
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

  // The ten strongest launches, at a glance. A reader who never scrolls the 203-row board
  // still sees the whole point of it: the top of the ranking, each row's implied value and
  // its farm-plan verdict, in one strip.
  function topStrip() {
    var top = DATA.rows.slice(0, 10);
    var items = top.map(function (r) {
      return el('div', { class: 'top-item' },
        el('span', { class: 'top-rank', text: '#' + r.rank }),
        el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') })
        ),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'verdict verdict-' + r.net_verdict.toLowerCase(), text: r.net_verdict })
      );
    });
    return el('section', { class: 'panel top10' },
      el('h2', { text: 'The ten strongest launches' }),
      el('p', { class: 'sub', text: 'Ranked by implied value. Select any row on the board below for its model and farm plan.' }),
      el('div', { class: 'top-list' }, items)
    );
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
      ['Size curve value', function (r) { return fmtUsd(r.curve_value); }],
      ['Implied-value band', function (r) { return fmtUsd(r.band_low) + ' \u2013 ' + fmtUsd(r.band_high); }],
      ['Seven-day growth', function (r) { return fmtPct(r.change_7d); }],
      ['Age with no token', function (r) { return fmtAge(r.age_days); }],
      ['Growth multiplier', function (r) { return String(r.growth_multiplier); }],
      ['Maturity multiplier', function (r) { return String(r.maturity_multiplier); }],
      ['Farm plan net', function (r) { return (r.net_usd >= 0 ? '+' : '') + '$' + r.net_usd.toLocaleString('en-US') + ' (' + r.net_verdict + ')'; }],
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
    shell.appendChild(topStrip());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(researchNote());
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
