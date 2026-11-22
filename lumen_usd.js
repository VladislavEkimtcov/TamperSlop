// ==UserScript==
// @name         Lumen USD
// @namespace    https://lumen.ncsa.illinois.edu/
// @version      1.1.0
// @description  Adds US-dollar equivalents (OpenRouter list prices, refreshed daily) next to Lumen coin figures.
// @match        https://lumen.ncsa.illinois.edu/models*
// @match        https://lumen.ncsa.illinois.edu/profile*
// @match        https://lumen.ncsa.illinois.edu/usage*
// @connect      openrouter.ai
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const OR_URL = 'https://openrouter.ai/api/v1/models';
  const DAY_MS = 864e5;
  const RETRY_MS = 10 * 60e3; // minimum gap between refetches (failed fetch, or a name still missing)
  // Lumen name -> OpenRouter id, for models whose names differ. Empty by default.
  const ALIASES = {};

  const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd3 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3 });

  const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
  const num = s => { const n = parseFloat(String(s).replace(/[,\s+]/g, '')); return Number.isFinite(n) ? n : NaN; };
  const approx = v => (Number.isFinite(v) ? '≈ ' + usd2.format(v) : '');

  // One stored record, holding only the models Lumen offers:
  //   { day, tried, ratesAt, models: { name: { ci, co, id, pi, po } } }
  //   ci/co: coins per 1M tokens (Lumen /models); pi/po: $ per 1M tokens (OpenRouter);
  //   id: matched OpenRouter id, null = looked up and not found, absent = never looked up.
  const catalog = GM_getValue('catalog', null) || { day: '', tried: 0, ratesAt: 0, models: {} };
  let catalogDirty = false;

  function saveCatalog() {
    if (catalogDirty) { GM_setValue('catalog', catalog); catalogDirty = false; }
  }

  // Reads the coin rates from a /models document (live or fetched). Names Lumen no
  // longer lists are dropped; new names arrive without an id, which triggers a price refresh.
  function readCoinRates(doc) {
    const seen = new Set();
    for (const tr of doc.querySelectorAll('table tbody tr')) {
      if (tr.cells.length < 4) continue;
      const name = tr.cells[0].textContent.trim();
      const ci = num(tr.cells[2].textContent), co = num(tr.cells[3].textContent);
      if (!name || Number.isNaN(ci) || Number.isNaN(co)) continue;
      seen.add(name);
      const m = catalog.models[name] || (catalog.models[name] = {});
      if (m.ci !== ci || m.co !== co) { m.ci = ci; m.co = co; catalogDirty = true; }
    }
    if (!seen.size) return;
    for (const name of Object.keys(catalog.models)) {
      if (!seen.has(name)) { delete catalog.models[name]; catalogDirty = true; }
    }
    catalog.ratesAt = Date.now();
    catalogDirty = true;
  }

  async function ensureCoinRates(names) {
    const age = Date.now() - (catalog.ratesAt || 0);
    const missing = names.some(n => !catalog.models[n] || catalog.models[n].ci === undefined);
    if (age < DAY_MS && !(missing && age > RETRY_MS)) return;
    try {
      const r = await fetch('/models', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      readCoinRates(new DOMParser().parseFromString(await r.text(), 'text/html'));
    } catch (e) {
      console.warn('[lumen-usd] /models fetch failed', e);
    }
  }

  function needsPrices() {
    if (Date.now() - catalog.tried < RETRY_MS) return false;
    if (catalog.day !== today()) return true;
    return Object.values(catalog.models).some(m => !('id' in m));
  }

  function fetchOpenRouter() {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'GET',
      url: OR_URL,
      responseType: 'json',
      timeout: 20000,
      onload: r => (r.status === 200 && r.response && Array.isArray(r.response.data)
        ? resolve(r.response.data) : reject(new Error('HTTP ' + r.status))),
      onerror: () => reject(new Error('network error')),
      ontimeout: () => reject(new Error('timeout')),
    }));
  }

  // One request a day for the whole list (OpenRouter has no per-id filter); only the
  // entries matching Lumen's models are kept, the rest is dropped with the response.
  async function refreshPrices() {
    catalog.tried = Date.now();
    catalogDirty = true;
    let data;
    try {
      data = await fetchOpenRouter();
    } catch (e) {
      console.warn('[lumen-usd] OpenRouter fetch failed; using stored prices', e);
      return;
    }
    const byId = new Map(), byTail = new Map();
    for (const m of data) {
      const id = m.id, p = m.pricing;
      if (!id || !p || id.includes(':')) continue; // skip :free / :batch / ... variants
      const pi = Number(p.prompt) * 1e6, po = Number(p.completion) * 1e6;
      if (!(pi >= 0) || !(po >= 0)) continue; // router pseudo-models list -1
      const entry = [id, pi, po];
      byId.set(id, entry);
      const tail = id.slice(id.indexOf('/') + 1).toLowerCase();
      if (!byTail.has(tail)) byTail.set(tail, entry);
    }
    for (const [name, m] of Object.entries(catalog.models)) {
      const hit = ALIASES[name] ? byId.get(ALIASES[name]) : byTail.get(name.toLowerCase());
      if (hit) { m.id = hit[0]; m.pi = hit[1]; m.po = hit[2]; } else { m.id = null; delete m.pi; delete m.po; }
    }
    catalog.day = today();
  }

  const priced = name => {
    const m = catalog.models[name];
    return m && m.id && m.ci !== undefined ? m : null;
  };

  // $ for `tokens` that cost `coins` on Lumen: split the tokens into input/output from the
  // two coin rates (coins*1e6 = in*ci + out*co, tokens = in + out), then price each part.
  function usdFor(m, tokens, coins) {
    let inTok = m.co !== m.ci ? (tokens * m.co - coins * 1e6) / (m.co - m.ci) : tokens / 2;
    inTok = Math.min(tokens, Math.max(0, inTok));
    return (inTok * m.pi + (tokens - inTok) * m.po) / 1e6;
  }

  // Lumen's /profile embeds `const MODEL_ROWS = [{ model_name: "...", tokens: n, cost: x, ... }]`
  // as a JS literal (not JSON) and renders its tables from it; pull the fields we need.
  function parseModelRows(text) {
    const start = text.indexOf('const MODEL_ROWS');
    if (start < 0) return null;
    const seg = text.slice(start, text.indexOf('];', start));
    const rows = [];
    for (const chunk of seg.split('model_name:').slice(1)) {
      const name = /^\s*"([^"]+)"/.exec(chunk), tok = /\btokens:\s*(\d+)/.exec(chunk), cost = /\bcost:\s*([\d.]+)/.exec(chunk);
      const req = /\brequests:\s*(\d+)/.exec(chunk);
      if (name && tok && cost) rows.push({ name: name[1], requests: req ? +req[1] : 0, tokens: +tok[1], coins: +cost[1] });
    }
    return rows.length ? rows : null;
  }

  // Per-model $ plus the coin-weighted $/coin rate, used for figures with no model attached.
  // perReq: each model's average $ and coins per request, so /usage can re-weight them by
  // the model mix of whichever period it is showing.
  function blend(rows) {
    const perModel = new Map(), perReq = {};
    let usd = 0, coins = 0;
    for (const r of rows) {
      const m = priced(r.name);
      if (!m || !r.tokens) continue;
      const v = usdFor(m, r.tokens, r.coins);
      perModel.set(r.name, v);
      if (r.coins > 0) { usd += v; coins += r.coins; }
      if (r.requests > 0) perReq[r.name] = { usd: v / r.requests, coins: r.coins / r.requests };
    }
    return { perModel, perReq, rate: coins > 0 ? usd / coins : null };
  }

  async function ensureRate(rows) {
    await ensureCoinRates(rows.map(r => r.name));
    if (needsPrices()) await refreshPrices();
    saveCatalog();
    const b = blend(rows);
    if (b.rate !== null) GM_setValue('rate', { usdPerCoin: b.rate, perReq: b.perReq, at: Date.now() });
    return b;
  }

  GM_addStyle(
    '.lumen-usd{opacity:.7;font-size:.85em;font-weight:normal;white-space:nowrap}' +
    '.lumen-usd-models{max-height:14rem;overflow:auto;font-size:.85em}' +
    '.lumen-usd-models th:not(:first-child),.lumen-usd-models td:not(:first-child){text-align:right}' +
    '.lumen-refill-bar{position:relative}' +
    '.lumen-refill-notch{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--bs-body-bg,#fff);opacity:.75;pointer-events:none;z-index:2;box-shadow:0 0 0 .5px rgba(0,0,0,.25)}' +
    '.lumen-refill-scale{position:relative;height:2.8em;margin-top:2px;font-size:.7rem;line-height:1.15;font-variant-numeric:tabular-nums;user-select:none}' +
    '.lumen-refill-tick{position:absolute;top:0;transform:translateX(-50%);text-align:center;white-space:nowrap;opacity:.75}' +
    '.lumen-refill-tick::before{content:"";display:block;width:1px;height:4px;margin:0 auto 1px;background:currentColor;opacity:.45}' +
    '.lumen-refill-tick.is-end{transform:translateX(-100%);text-align:right}' +
    '.lumen-refill-tick.is-end::before{margin:0 0 1px auto}' +
    '.lumen-refill-tick.is-done{opacity:.45}' +
    '.lumen-refill-pct{font-size:.9em;opacity:.75}' +
    '.lumen-refill-eta{display:block;font-weight:500}');

  function usdNode(tag, text, title) {
    const el = document.createElement(tag);
    el.className = 'lumen-usd';
    el.textContent = text;
    if (title) el.title = title;
    return el;
  }

  function coinCell(td, rate) {
    const c = num(td.textContent);
    if (!Number.isNaN(c)) td.appendChild(usdNode('div', approx(c * rate)));
  }

  // Lumen rebuilds these tbodies on every sort/search; re-annotate new rows only.
  // childList without subtree, so our own writes inside cells never re-trigger it.
  function watchRows(id, annotate) {
    const tbody = document.getElementById(id);
    if (!tbody) return;
    const run = () => {
      for (const tr of tbody.rows) {
        if (tr.dataset.lumenUsd || tr.cells.length < 4) continue;
        tr.dataset.lumenUsd = '1';
        annotate(tr);
      }
    };
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; run(); });
    }).observe(tbody, { childList: true });
    run();
  }

  // Keeps a $ line next to a coin figure Lumen may rewrite.
  function mirror(src, line, format) {
    const update = () => { line.textContent = format(num(src.textContent)); };
    update();
    new MutationObserver(update).observe(src, { childList: true, characterData: true, subtree: true });
  }

  async function modelsPage() {
    const table = document.querySelector('table');
    if (!table || !table.tHead || table.tHead.rows.length < 2 || !table.tBodies[0]) return;
    readCoinRates(document);
    if (needsPrices()) await refreshPrices();
    saveCatalog();

    const [h1, h2] = table.tHead.rows;
    const group = document.createElement('th');
    group.scope = 'colgroup';
    group.colSpan = 2;
    group.className = 'text-center';
    group.textContent = 'USD / 1M tokens';
    group.title = 'OpenRouter list price, refreshed daily';
    h1.insertBefore(group, h1.cells[3] || null);
    for (const label of ['Input', 'Output']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = 'text-end';
      th.textContent = label;
      h2.appendChild(th);
    }
    for (const tr of table.tBodies[0].rows) {
      if (tr.cells.length < 4) continue;
      const m = priced(tr.cells[0].textContent.trim());
      for (const [i, price, coins] of [[4, 'pi', 'ci'], [5, 'po', 'co']]) {
        const td = tr.insertCell(i);
        td.className = 'text-end';
        if (!m) { td.textContent = '—'; continue; }
        td.textContent = usd3.format(m[price]);
        td.title = m.id + (m[coins] > 0 ? ' · ' + usd3.format(m[price] / m[coins]) + ' per coin' : '');
      }
    }
  }

  function parseUtc(s) {
    if (!s) return NaN;
    const t = s.trim();
    return Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(' ', 'T') + 'Z');
  }

  function fmtEta(ms) {
    if (ms <= 0) return 'now';
    const sec = Math.ceil(ms / 1e3);
    if (sec < 60) return sec + 's';
    const min = Math.ceil(ms / 60e3);
    if (min < 60) return min + 'm';
    const hr = Math.floor(min / 60), remM = min % 60;
    if (hr < 24) return remM ? hr + 'h ' + remM + 'm' : hr + 'h';
    const d = Math.floor(hr / 24), remH = hr % 24;
    return remH ? d + 'd ' + remH + 'h' : d + 'd';
  }

  // Quarter notches (25/50/75%) on the Coins Available bar with live timers at 25/50/75/100%.
  function mountRefillTiers() {
    const left = document.getElementById('coins-left');
    const bar = document.getElementById('coins-left-bar');
    const progress = bar && bar.parentElement;
    if (!left || !progress) return;
    const max = num((left.nextElementSibling ? left.nextElementSibling.textContent : '').replace('/', ''));
    if (!(max > 0)) return;

    let refillRate = NaN, refillCard = null;
    const availCard = left.closest('.profile-stat-card');
    for (const card of document.querySelectorAll('.profile-stat-card')) {
      const label = card.firstElementChild && card.firstElementChild.textContent.trim();
      if (label === 'Refill Rate') {
        refillCard = card;
        const val = card.querySelector('.fw-bold');
        if (val) refillRate = num(val.textContent);
        break;
      }
    }
    if (!(refillRate > 0)) return;

    progress.classList.add('lumen-refill-bar');
    for (const pct of [25, 50, 75]) {
      const notch = document.createElement('span');
      notch.className = 'lumen-refill-notch';
      notch.style.left = pct + '%';
      progress.appendChild(notch);
    }

    const scale = document.createElement('div');
    scale.className = 'lumen-refill-scale';
    const tiers = [25, 50, 75, 100].map(pct => {
      const el = document.createElement('div');
      el.className = 'lumen-refill-tick' + (pct === 100 ? ' is-end' : '');
      el.style.left = pct + '%';
      const label = document.createElement('span');
      label.className = 'lumen-refill-pct';
      label.textContent = pct + '%';
      const eta = document.createElement('span');
      eta.className = 'lumen-refill-eta';
      el.append(label, eta);
      scale.appendChild(el);
      return { pct, target: max * pct / 100, el, eta };
    });
    progress.after(scale);

    const findNextMs = () => {
      const timeEl = (refillCard && refillCard.querySelector('.local-time[data-utc]'))
        || (availCard && availCard.querySelector('.local-time[data-utc]'));
      return timeEl ? parseUtc(timeEl.dataset.utc) : NaN;
    };

    const HOUR_MS = 3600e3;
    const fmtAt = ms => new Date(ms).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    const update = () => {
      const cur = num(left.textContent);
      if (Number.isNaN(cur)) return;
      const now = Date.now();
      const nextMs = findNextMs();
      for (const t of tiers) {
        const deficit = t.target - cur;
        const coinsStr = t.target.toFixed(2) + ' coins';
        if (deficit <= 1e-9) {
          t.el.classList.add('is-done');
          t.eta.textContent = '✓';
          t.el.title = t.pct + '% (' + coinsStr + ') · reached';
          continue;
        }
        t.el.classList.remove('is-done');
        const etaMs = Number.isFinite(nextMs)
          ? nextMs + (Math.max(1, Math.ceil((deficit - 1e-9) / refillRate)) - 1) * HOUR_MS
          : now + (deficit / refillRate) * HOUR_MS;
        const rem = Math.max(0, etaMs - now);
        const rel = rem > 0 ? 'in ' + fmtEta(rem) : 'now';
        t.eta.textContent = fmtEta(rem);
        t.el.title = t.pct + '% (' + coinsStr + ') · ' + rel + ' (' + fmtAt(etaMs) + ')';
      }
    };

    update();
    new MutationObserver(update).observe(left, { childList: true, characterData: true, subtree: true });
    setInterval(() => { if (!document.hidden) update(); }, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  }

  async function profilePage() {
    mountRefillTiers();
    const script = [...document.scripts].find(s => !s.src && s.textContent.includes('const MODEL_ROWS'));
    const rows = script && parseModelRows(script.textContent);
    if (!rows) { console.warn('[lumen-usd] MODEL_ROWS not found on /profile'); return; }
    const b = await ensureRate(rows);

    watchRows('model-tbody', tr => {
      const v = b.perModel.get(tr.cells[0].textContent.trim());
      if (v !== undefined) tr.cells[3].appendChild(usdNode('div', approx(v), 'Tokens split into input/output from the coin rates, priced at OpenRouter list'));
    });
    if (b.rate === null) return;
    const rate = b.rate;
    watchRows('key-tbody', tr => coinCell(tr.cells[3], rate));
    for (const tr of document.querySelectorAll('#pane-chat table:not(#key-table) tbody tr')) {
      if (tr.cells.length >= 4) coinCell(tr.cells[3], rate);
    }

    for (const card of document.querySelectorAll('.profile-stat-card')) {
      const label = card.firstElementChild && card.firstElementChild.textContent.trim();
      const value = card.querySelector('.fw-bold');
      if (!value) continue;
      if (label === 'Coins Used') {
        value.after(usdNode('div', approx(num(value.textContent) * rate)));
      } else if (label === 'Refill Rate') {
        value.after(usdNode('div', approx(num(value.textContent) * rate) + '/hr'));
      } else if (label === 'Coins Available') {
        const left = document.getElementById('coins-left');
        if (!left) continue;
        const max = num((left.nextElementSibling ? left.nextElementSibling.textContent : '').replace('/', ''));
        const line = usdNode('div', '');
        (left.closest('.d-flex') || value).after(line);
        mirror(left, line, c => approx(c * rate) + (Number.isNaN(max) ? '' : ' / ' + usd2.format(max * rate)));
      }
    }
  }

  // The page's own query for the current view (see fetchJSON in Lumen's usage.html).
  function usageQuery() {
    const q = new URLSearchParams({ period: document.getElementById('period-select').value });
    const entity = parseInt(new URLSearchParams(location.search).get('entity_id'), 10);
    const all = document.getElementById('all-users-check');
    if (entity) q.set('entity_id', entity);
    else if (!(all && all.checked)) q.set('mine', '1');
    return q;
  }

  // Re-weights each model's lifetime $ and coins per request (from /profile) by the requests
  // /usage reports for the period, giving that period's $/coin and a $ estimate per model.
  function periodMix(models, perReq) {
    const rows = [];
    let usd = 0, coins = 0;
    for (const { model, requests } of models) {
      if (!Object.hasOwn(perReq, model)) continue;
      const p = perReq[model];
      rows.push({ model, requests, usd: requests * p.usd });
      if (p.coins > 0) { usd += requests * p.usd; coins += requests * p.coins; }
    }
    return { rows, rate: coins > 0 ? usd / coins : null };
  }

  const cell = (text, tag = 'td') => { const el = document.createElement(tag); el.textContent = text; return el; };
  const row = (...cells) => { const tr = document.createElement('tr'); tr.append(...cells); return tr; };

  // A small table under the Model Popularity chart: that chart counts requests, this prices them.
  function mountModelCosts() {
    const canvas = document.getElementById('chart-models');
    const box = canvas && canvas.closest('.chart-box');
    if (!box) return null;
    const wrap = document.createElement('div');
    wrap.className = 'lumen-usd-models mt-3';
    wrap.hidden = true;
    const table = document.createElement('table');
    table.className = 'table table-sm mb-0';
    const caption = document.createElement('caption');
    caption.className = 'caption-top';
    caption.textContent = 'Estimated cost by model';
    caption.title = 'Requests in this period × your lifetime average $ per request on that model (OpenRouter list prices)';
    const head = document.createElement('thead');
    head.appendChild(row(cell('Model', 'th'), cell('Requests', 'th'), cell('≈ USD', 'th')));
    const body = document.createElement('tbody');
    const foot = document.createElement('tfoot');
    table.append(caption, head, body, foot);
    wrap.appendChild(table);
    box.after(wrap);
    return { wrap, body, foot };
  }

  function renderModelCosts(ui, rows) {
    ui.wrap.hidden = !rows.length;
    ui.body.replaceChildren(...rows.map(r => row(cell(r.model), cell(r.requests.toLocaleString()), cell('≈ ' + usd3.format(r.usd)))));
    const requests = rows.reduce((a, r) => a + r.requests, 0), total = rows.reduce((a, r) => a + r.usd, 0);
    ui.foot.replaceChildren(row(cell('Total (priced models)'), cell(requests.toLocaleString()), cell('≈ ' + usd3.format(total))));
  }

  async function usagePage() {
    const cost = document.getElementById('stat-cost');
    if (!cost) return;
    let rate = GM_getValue('rate', null);
    if (!rate || !rate.perReq || Date.now() - rate.at > DAY_MS) {
      try {
        const r = await fetch('/profile', { credentials: 'same-origin' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const rows = parseModelRows(await r.text());
        if (rows) {
          const b = await ensureRate(rows);
          if (b.rate !== null) rate = { usdPerCoin: b.rate, perReq: b.perReq, at: Date.now() };
        }
      } catch (e) {
        console.warn('[lumen-usd] could not derive $/coin from /profile', e);
      }
    }
    if (!rate) return;
    const perReq = rate.perReq || {};
    const line = usdNode('div', '');
    cost.after(line);
    const ui = mountModelCosts();

    // The page blanks #stat-cost to "…" and refills it on every period / user change, then
    // redraws the charts. Price each fill with that period's model mix; a newer fill
    // supersedes an older one still waiting on its request.
    let seq = 0;
    async function update() {
      const mine = ++seq;
      const coins = num(cost.textContent);
      if (Number.isNaN(coins)) { line.textContent = ''; if (ui) ui.wrap.hidden = true; return; }
      let mix = { rows: [], rate: null };
      try {
        const r = await fetch('/api/usage/models?' + usageQuery(), { credentials: 'same-origin' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        mix = periodMix(await r.json(), perReq);
      } catch (e) {
        console.warn('[lumen-usd] could not load /api/usage/models; using the blended rate', e);
      }
      if (mine !== seq) return;
      const exact = mix.rate !== null;
      line.textContent = approx(coins * (exact ? mix.rate : rate.usdPerCoin));
      line.title = exact
        ? "This period's model mix, priced at OpenRouter list from your /profile history"
        : 'At your blended $/coin rate from /profile';
      if (ui) renderModelCosts(ui, mix.rows);
    }
    new MutationObserver(update).observe(cost, { childList: true, characterData: true, subtree: true });
    update();
  }

  const routes = { '/models': modelsPage, '/profile': profilePage, '/usage': usagePage };
  const page = routes[location.pathname.replace(/\/+$/, '')];
  if (page) page().catch(e => console.error('[lumen-usd]', e));
})();

