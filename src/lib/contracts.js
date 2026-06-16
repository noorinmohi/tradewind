// Futures contracts Tradewind knows about.
//
// Each entry's KEY is Tradewind's contract id (also what the UI shows, minus
// the "=F"). Fields:
//   name, group   — display
//   pointValue    — dollar value of a one-POINT move for ONE contract
//   tick          — minimum price increment
//   yahoo         — symbol to pull bars from on Yahoo Finance
//   root          — CME product root (used by non-Yahoo providers, e.g. Databento)
//
// Micros track the SAME price as their full-size sibling (e.g. MES quotes in the
// same S&P points as ES); only the multiplier differs. So a micro pulls Yahoo
// data from the full-size `yahoo` symbol but keeps its own `pointValue`/`tick`
// for the risk math. On Databento the micro has its own `root`.
//
// ⚠ Specs are standard CME values at time of writing and can change. ALWAYS
// confirm the spec for the exact contract you trade against your broker before
// sizing a position.

export const CONTRACTS = {
  // ── Index ──
  "ES=F": { name: "E-mini S&P 500", group: "Index", pointValue: 50, tick: 0.25, yahoo: "ES=F", root: "ES" },
  "NQ=F": { name: "E-mini Nasdaq 100", group: "Index", pointValue: 20, tick: 0.25, yahoo: "NQ=F", root: "NQ" },
  "YM=F": { name: "E-mini Dow", group: "Index", pointValue: 5, tick: 1, yahoo: "YM=F", root: "YM" },
  "RTY=F": { name: "E-mini Russell 2000", group: "Index", pointValue: 50, tick: 0.1, yahoo: "RTY=F", root: "RTY" },

  // ── Index (Micro) ──
  "MES=F": { name: "Micro E-mini S&P 500", group: "Index (Micro)", pointValue: 5, tick: 0.25, yahoo: "ES=F", root: "MES" },
  "MNQ=F": { name: "Micro E-mini Nasdaq 100", group: "Index (Micro)", pointValue: 2, tick: 0.25, yahoo: "NQ=F", root: "MNQ" },
  "MYM=F": { name: "Micro E-mini Dow", group: "Index (Micro)", pointValue: 0.5, tick: 1, yahoo: "YM=F", root: "MYM" },
  "M2K=F": { name: "Micro E-mini Russell 2000", group: "Index (Micro)", pointValue: 5, tick: 0.1, yahoo: "RTY=F", root: "M2K" },

  // ── Metals ──
  "GC=F": { name: "Gold", group: "Metals", pointValue: 100, tick: 0.1, yahoo: "GC=F", root: "GC" },
  "SI=F": { name: "Silver", group: "Metals", pointValue: 5000, tick: 0.005, yahoo: "SI=F", root: "SI" },
  "PL=F": { name: "Platinum", group: "Metals", pointValue: 50, tick: 0.1, yahoo: "PL=F", root: "PL" },
  "HG=F": { name: "Copper", group: "Metals", pointValue: 25000, tick: 0.0005, yahoo: "HG=F", root: "HG" },
  "MGC=F": { name: "Micro Gold", group: "Metals (Micro)", pointValue: 10, tick: 0.1, yahoo: "GC=F", root: "MGC" },
  "SIL=F": { name: "Micro Silver (1,000 oz)", group: "Metals (Micro)", pointValue: 1000, tick: 0.005, yahoo: "SI=F", root: "SIL" },
  "MHG=F": { name: "Micro Copper", group: "Metals (Micro)", pointValue: 2500, tick: 0.0005, yahoo: "HG=F", root: "MHG" },

  // ── Energy ──
  "CL=F": { name: "Crude Oil (WTI)", group: "Energy", pointValue: 1000, tick: 0.01, yahoo: "CL=F", root: "CL" },
  "NG=F": { name: "Natural Gas", group: "Energy", pointValue: 10000, tick: 0.001, yahoo: "NG=F", root: "NG" },
  "MCL=F": { name: "Micro WTI Crude Oil", group: "Energy (Micro)", pointValue: 100, tick: 0.01, yahoo: "CL=F", root: "MCL" },

  // ── Rates ──
  "ZB=F": { name: "30-Year U.S. T-Bond", group: "Rates", pointValue: 1000, tick: 0.03125, yahoo: "ZB=F", root: "ZB" },
  "ZN=F": { name: "10-Year U.S. T-Note", group: "Rates", pointValue: 1000, tick: 0.015625, yahoo: "ZN=F", root: "ZN" },

  // ── FX ──
  "6E=F": { name: "Euro FX", group: "FX", pointValue: 125000, tick: 0.00005, yahoo: "6E=F", root: "6E" },
  "M6E=F": { name: "Micro EUR/USD", group: "FX (Micro)", pointValue: 12500, tick: 0.0001, yahoo: "6E=F", root: "M6E" },

  // ── Crypto ──
  "BTC=F": { name: "Bitcoin (CME, 5 BTC)", group: "Crypto", pointValue: 5, tick: 5, yahoo: "BTC=F", root: "BTC" },
  "MBT=F": { name: "Micro Bitcoin (0.1 BTC)", group: "Crypto (Micro)", pointValue: 0.1, tick: 5, yahoo: "BTC=F", root: "MBT" },

  // ── Ags ──
  "ZC=F": { name: "Corn", group: "Ags", pointValue: 50, tick: 0.25, yahoo: "ZC=F", root: "ZC" },
};

export const SYMBOLS = Object.keys(CONTRACTS);

// Timeframe presets for the live desk: a friendly label -> Yahoo (interval, range).
// Ranges give enough bars for a 50-period SMA with headroom.
export const TIMEFRAMES = {
  daily: { label: "Daily", interval: "1d", range: "1y" },
  hourly: { label: "1-hour", interval: "1h", range: "3mo" },
  intraday: { label: "15-min", interval: "15m", range: "5d" },
};
