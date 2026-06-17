// Market-data layer — the ONE place that knows how to fetch bars.
//
// Everything else (server.js, backtest.js) calls fetchSeries(spec, interval,
// range) and gets back a normalized shape, so switching feeds is a config
// change, not a code change. To add a feed, write an async function with the
// same (spec, interval, range) -> { rows, meta } contract and register it in
// `providers`, then set DATA_PROVIDER to its name.
//
//   rows: [{ t (ms epoch), o, h, l, c, v }]   ascending by time
//   meta: { price, currency, asOf (ms) }
//
// Select the provider with the DATA_PROVIDER env var (default "yahoo").

const PROVIDER = (process.env.DATA_PROVIDER || "yahoo").toLowerCase();

// ── Yahoo Finance (default, free, no key) ───────────────────────
// Delayed (~10-15 min) continuous front-month series. Good for analysis and
// backtesting the rules; not for precise live execution.
async function yahoo(spec, interval, range) {
  const sym = spec.yahoo;
  const path =
    `/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;

  // Try both Yahoo hosts — query1 occasionally rate-limits datacenter IPs (429),
  // which matters once this runs on a cloud host rather than your laptop.
  let j = null;
  let lastErr = null;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(`https://${host}${path}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) { j = await r.json(); break; }
      lastErr = new Error(`Yahoo (${host}) returned ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  if (!j) throw lastErr || new Error("Yahoo request failed");

  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(j?.chart?.error?.description || "no data for that symbol");

  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const m = result.meta || {};

  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue; // skip gaps
    rows.push({ t: ts[i] * 1000, o, h, l, c, v: q.volume?.[i] ?? 0 });
  }

  return {
    rows,
    meta: {
      price: m.regularMarketPrice ?? (rows.length ? rows[rows.length - 1].c : null),
      currency: m.currency || "USD",
      asOf: m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now(),
    },
  };
}

// ── Databento Historical (real intraday feed; requires a paid key) ──
// Written against Databento's documented REST timeseries API. Set
// DATA_PROVIDER=databento and DATABENTO_API_KEY=...; optionally
// DATABENTO_DATASET (default GLBX.MDP3 = CME Globex).
//
// ⚠ Provided as a ready-to-use integration point but NOT exercised in this repo
// (it needs a live key). Before trusting it, verify two things against your
// account: the continuous-contract symbology ("<ROOT>.c.0") and the fixed-point
// PRICE_SCALE for your dataset. Both are set conservatively below.
const PRICE_SCALE = 1e-9; // Databento prices are integers in units of 1e-9
const SCHEMA_BY_INTERVAL = { "1d": "ohlcv-1d", "1h": "ohlcv-1h", "15m": "ohlcv-1m", "1m": "ohlcv-1m" };

async function databento(spec, interval, range) {
  const key = process.env.DATABENTO_API_KEY;
  if (!key) throw new Error("DATA_PROVIDER=databento but DATABENTO_API_KEY is not set");

  const dataset = process.env.DATABENTO_DATASET || "GLBX.MDP3";
  const schema = SCHEMA_BY_INTERVAL[interval] || "ohlcv-1d";
  const { start, end } = rangeToDates(range);

  const params = new URLSearchParams({
    dataset,
    symbols: `${spec.root}.c.0`, // continuous front-month by calendar roll
    stype_in: "continuous",
    schema,
    start,
    end,
    encoding: "json",
  });
  const url = `https://hist.databento.com/v0/timeseries.get_range?${params}`;
  const auth = "Basic " + Buffer.from(key + ":").toString("base64");

  const r = await fetch(url, { headers: { Authorization: auth } });
  if (!r.ok) throw new Error(`Databento returned ${r.status}: ${(await r.text()).slice(0, 200)}`);

  // JSON-lines: one OHLCV record per line.
  const text = await r.text();
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    const tsNs = Number(rec.hd?.ts_event ?? rec.ts_event);
    rows.push({
      t: Math.floor(tsNs / 1e6),
      o: Number(rec.open) * PRICE_SCALE,
      h: Number(rec.high) * PRICE_SCALE,
      l: Number(rec.low) * PRICE_SCALE,
      c: Number(rec.close) * PRICE_SCALE,
      v: Number(rec.volume ?? 0),
    });
  }
  rows.sort((a, b) => a.t - b.t);

  return {
    rows,
    meta: {
      price: rows.length ? rows[rows.length - 1].c : null,
      currency: "USD",
      asOf: rows.length ? rows[rows.length - 1].t : Date.now(),
    },
  };
}

// ── Polygon.io (real-time, paid; prepared but not yet exercised) ──
// Real-time futures via Polygon's aggregates API. Set DATA_PROVIDER=polygon and
// POLYGON_API_KEY=... — requires a paid Polygon plan WITH the CME real-time
// futures entitlement (real-time exchange data is never free).
//
// ⚠ Prepared, not run in this repo (needs a live key). Polygon's Futures product
// is newer/evolving, so when you activate it, confirm TWO things against your
// account's current docs:
//   1. The futures TICKER convention for the contract you want (front-month or
//      continuous). `polygonTicker` maps from the CME root in contracts.js;
//      override per contract via a `polygon` field if your plan differs.
//   2. The aggregates response shape (this assumes v2-style results: t,o,h,l,c,v).
const POLY_AGG = { "1d": [1, "day"], "1h": [1, "hour"], "15m": [15, "minute"] };

function polygonTicker(spec) {
  // Many setups use the product root (e.g. "ES"); some need an explicit contract
  // or a continuous symbol. Override with spec.polygon when needed.
  return spec.polygon || spec.root;
}

async function polygon(spec, interval, range) {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("DATA_PROVIDER=polygon but POLYGON_API_KEY is not set");

  const [mult, span] = POLY_AGG[interval] || POLY_AGG["1d"];
  const { start, end } = rangeToDates(range);
  const ticker = polygonTicker(spec);
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}` +
    `/range/${mult}/${span}/${start}/${end}?adjusted=true&sort=asc&limit=50000`;

  // Key goes in the Authorization header (not the URL) so it stays out of logs.
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`Polygon ${r.status}: ${(await r.text()).slice(0, 200)}`);

  const j = await r.json();
  const results = j?.results || [];
  const rows = results
    .filter((b) => b.o != null && b.h != null && b.l != null && b.c != null)
    .map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 }));

  return {
    rows,
    meta: {
      price: rows.length ? rows[rows.length - 1].c : null,
      currency: "USD",
      asOf: rows.length ? rows[rows.length - 1].t : Date.now(),
    },
  };
}

// Convert a Yahoo-style range ("5d","3mo","1y","5y") to ISO start/end dates.
function rangeToDates(range) {
  const end = new Date();
  const start = new Date(end);
  const m = /^(\d+)(d|mo|y)$/.exec(range);
  if (m) {
    const n = Number(m[1]);
    if (m[2] === "d") start.setDate(start.getDate() - n);
    else if (m[2] === "mo") start.setMonth(start.getMonth() - n);
    else start.setFullYear(start.getFullYear() - n);
  } else {
    start.setFullYear(start.getFullYear() - 1);
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const providers = { yahoo, databento, polygon };

export function activeProvider() {
  return PROVIDER;
}

export async function fetchSeries(spec, interval, range) {
  const fn = providers[PROVIDER];
  if (!fn) {
    throw new Error(`unknown DATA_PROVIDER "${PROVIDER}" (available: ${Object.keys(providers).join(", ")})`);
  }
  const { rows, meta } = await fn(spec, interval, range);
  if (!rows || rows.length < 60) {
    throw new Error("not enough price history to analyze this timeframe");
  }
  return { rows, meta };
}
