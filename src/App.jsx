import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp, TrendingDown, Minus, Activity, ShieldAlert, Loader2,
  ArrowUpRight, ArrowDownRight, Gauge, Sparkles, Info, RefreshCw, Layers, Calculator,
} from "lucide-react";
import { analyze, getContracts } from "./api.js";
import { analyzeStrategy, STRATEGIES } from "./lib/options.js";

// ── Design tokens ───────────────────────────────────────────────
const C = {
  bg: "#0F1419",
  panel: "#161C24",
  panel2: "#1C242E",
  line: "#2A3542",
  ink: "#E7ECF2",
  inkSoft: "#9AA7B5",
  inkFaint: "#64727F",
  up: "#22C58B",
  upSoft: "rgba(34,197,139,0.12)",
  down: "#F0556B",
  downSoft: "rgba(240,85,107,0.12)",
  flat: "#E0A33E",
  flatSoft: "rgba(224,163,62,0.12)",
  accent: "#5B9DF0",
};
const SANS = "'Inter', -apple-system, system-ui, sans-serif";
const MONO = "'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace";

// ── Helpers ─────────────────────────────────────────────────────
const LS_KEY = "tradewind:prefs";
const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {};
  } catch {
    return {};
  }
};
const savePrefs = (p) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
};

function tickDecimals(tick) {
  if (!tick || Number.isInteger(tick)) return 0;
  const s = String(tick);
  if (s.includes("e")) return 8;
  return Math.min(6, (s.split(".")[1] || "").length);
}
const fmt = (v, dp = 2) =>
  v == null || Number.isNaN(v)
    ? "—"
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtUSD = (v) =>
  v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const biasTheme = (bias) =>
  bias === "long"
    ? { c: C.up, soft: C.upSoft, label: "LONG bias", Icon: TrendingUp }
    : bias === "short"
    ? { c: C.down, soft: C.downSoft, label: "SHORT bias", Icon: TrendingDown }
    : { c: C.flat, soft: C.flatSoft, label: "NEUTRAL", Icon: Minus };

// ── Small UI pieces ─────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({ icon: Icon, children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {Icon && <Icon size={15} color={C.inkSoft} />}
      <span style={{ fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600 }}>
        {children}
      </span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: C.inkFaint, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: color || C.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Sparkline({ series, color }) {
  const { path, area } = useMemo(() => {
    if (!series || series.length < 2) return { path: "", area: "" };
    const xs = series.map((_, i) => i);
    const ys = series.map((d) => d.c);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const W = 100;
    const H = 34;
    const sx = (i) => (i / (xs.length - 1)) * W;
    const sy = (y) => (max === min ? H / 2 : H - ((y - min) / (max - min)) * H);
    let p = `M ${sx(0).toFixed(2)} ${sy(ys[0]).toFixed(2)}`;
    for (let i = 1; i < ys.length; i++) p += ` L ${sx(i).toFixed(2)} ${sy(ys[i]).toFixed(2)}`;
    const a = p + ` L ${W} ${H} L 0 ${H} Z`;
    return { path: p, area: a };
  }, [series]);

  if (!path) return null;
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" style={{ width: "100%", height: 56, display: "block" }}>
      <path d={area} fill={color} opacity={0.1} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ScoreMeter({ score, color }) {
  const pct = (score + 100) / 2; // -100..100 -> 0..100
  return (
    <div>
      <div style={{ position: "relative", height: 8, borderRadius: 999, background: C.panel2, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.line }} />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            background: color,
            borderRadius: 999,
            ...(score >= 0 ? { left: "50%", width: `${pct - 50}%` } : { right: "50%", width: `${50 - pct}%` }),
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10, color: C.inkFaint }}>
        <span>−100 short</span>
        <span style={{ fontFamily: MONO, color, fontWeight: 600 }}>{score > 0 ? `+${score}` : score}</span>
        <span>long +100</span>
      </div>
    </div>
  );
}

function Disclaimer() {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        background: C.flatSoft,
        border: `1px solid ${C.flat}33`,
        borderRadius: 12,
        padding: "12px 14px",
        color: C.inkSoft,
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <ShieldAlert size={16} color={C.flat} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        <strong style={{ color: C.ink }}>Analysis only — not advice, and not an order.</strong> Tradewind never connects
        to a broker or places trades. Signals are mechanical summaries of delayed, continuous-contract data and can be
        wrong. Verify contract specs with your broker, manage your own risk, and place every trade yourself.
      </span>
    </div>
  );
}

// ── Options ─────────────────────────────────────────────────────
function niceStrike(x) {
  if (!isFinite(x) || x <= 0) return 0;
  if (x >= 1000) return Math.round(x / 5) * 5;
  if (x >= 100) return Math.round(x);
  if (x >= 10) return Math.round(x * 2) / 2;
  return Math.round(x * 100) / 100;
}

function PayoffChart({ curve, S, breakevens }) {
  const W = 600, H = 240, padL = 8, padR = 8, padT = 14, padB = 22;
  const prices = curve.map((c) => c.price);
  const pnls = curve.map((c) => c.pnl);
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const yMin = Math.min(0, ...pnls), yMax = Math.max(0, ...pnls);
  const sx = (p) => padL + ((p - pMin) / (pMax - pMin || 1)) * (W - padL - padR);
  const sy = (y) => padT + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const y0 = sy(0);

  // Colored line segments: green where profitable, red where not.
  const segs = [];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    const up = (a.pnl + b.pnl) / 2 >= 0;
    segs.push(<line key={i} x1={sx(a.price)} y1={sy(a.pnl)} x2={sx(b.price)} y2={sy(b.pnl)} stroke={up ? C.up : C.down} strokeWidth={2} />);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 220, display: "block" }}>
      {/* zero P&L baseline */}
      <line x1={padL} y1={y0} x2={W - padR} y2={y0} stroke={C.inkFaint} strokeWidth={1} strokeDasharray="3 3" />
      <text x={padL + 2} y={y0 - 4} fontSize="10" fill={C.inkFaint} fontFamily={MONO}>$0</text>
      {/* current underlying */}
      {S > pMin && S < pMax && (
        <>
          <line x1={sx(S)} y1={padT} x2={sx(S)} y2={H - padB} stroke={C.accent} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
          <text x={sx(S)} y={H - 8} fontSize="10" fill={C.accent} fontFamily={MONO} textAnchor="middle">now {fmt(S, 2)}</text>
        </>
      )}
      {/* breakevens */}
      {breakevens.filter((b) => b > pMin && b < pMax).map((b, i) => (
        <g key={i}>
          <line x1={sx(b)} y1={padT} x2={sx(b)} y2={H - padB} stroke={C.flat} strokeWidth={1} strokeDasharray="1 3" opacity={0.8} />
          <circle cx={sx(b)} cy={y0} r={3} fill={C.flat} />
        </g>
      ))}
      {segs}
    </svg>
  );
}

function OptionsPanel({ underlying, contractLabel, inputStyle, labelStyle }) {
  const baseS = underlying && underlying > 0 ? niceStrike(underlying) : 100;
  const [strategy, setStrategy] = useState("long_call");
  const [S, setS] = useState(baseS);
  const [K1, setK1] = useState(niceStrike(baseS * 0.95));
  const [K2, setK2] = useState(niceStrike(baseS * 1.05));
  const [W, setW] = useState(Math.max(niceStrike(baseS * 0.05), 0.01));
  const [dte, setDte] = useState(30);
  const [iv, setIv] = useState(30);
  const [rate, setRate] = useState(4);
  const [mult, setMult] = useState(100);

  const fields = STRATEGIES[strategy].fields;
  const result = useMemo(() => {
    try {
      return analyzeStrategy(strategy, { S, K1, K2, W, dte, r: rate, sigma: iv, multiplier: mult });
    } catch {
      return null;
    }
  }, [strategy, S, K1, K2, W, dte, iv, rate, mult]);

  const money = (v) =>
    v === Infinity ? "Unlimited" : v === -Infinity ? "Unlimited risk" : fmtUSD(v);
  const num = (set) => (e) => set(e.target.value === "" ? "" : Number(e.target.value));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}>
      <Card>
        <CardTitle icon={Calculator}>Options strategy</CardTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Strategy</label>
            <select style={inputStyle} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              {Object.entries(STRATEGIES).map(([k, s]) => (
                <option key={k} value={k}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Underlying price</label>
            <input style={inputStyle} type="number" value={S} onChange={num(setS)} />
            {underlying > 0 && niceStrike(underlying) !== S && (
              <button
                onClick={() => setS(niceStrike(underlying))}
                style={{ marginTop: 4, background: "none", border: "none", color: C.accent, fontSize: 11, cursor: "pointer", padding: 0, fontFamily: SANS }}
              >
                ↺ use {contractLabel ? `${contractLabel.split(" · ")[0]} ` : ""}{fmt(underlying, 2)}
              </button>
            )}
          </div>
          {fields.includes("K1") && (
            <div>
              <label style={labelStyle}>{fields.includes("K2") ? "Lower strike" : "Strike"}</label>
              <input style={inputStyle} type="number" value={K1} onChange={num(setK1)} />
            </div>
          )}
          {fields.includes("K2") && (
            <div>
              <label style={labelStyle}>{fields.includes("K1") ? "Upper strike" : "Call strike"}</label>
              <input style={inputStyle} type="number" value={K2} onChange={num(setK2)} />
            </div>
          )}
          {fields.includes("W") && (
            <div>
              <label style={labelStyle}>Wing width</label>
              <input style={inputStyle} type="number" value={W} onChange={num(setW)} />
            </div>
          )}
          <div>
            <label style={labelStyle}>Days to expiry</label>
            <input style={inputStyle} type="number" min="0" value={dte} onChange={num(setDte)} />
          </div>
          <div>
            <label style={labelStyle}>Implied vol (%)</label>
            <input style={inputStyle} type="number" min="0" value={iv} onChange={num(setIv)} />
          </div>
          <div>
            <label style={labelStyle}>Rate (%)</label>
            <input style={inputStyle} type="number" value={rate} onChange={num(setRate)} />
          </div>
          <div>
            <label style={labelStyle}>Contract multiplier</label>
            <input style={inputStyle} type="number" min="1" value={mult} onChange={num(setMult)} />
          </div>
        </div>
      </Card>

      {result && (
        <>
          <Card>
            <CardTitle icon={Layers}>
              {STRATEGIES[strategy].label}
              <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: C.inkFaint, marginLeft: 8 }}>
                payoff at expiration
              </span>
            </CardTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 14 }}>
              <Stat
                label={result.netCost >= 0 ? "Net debit (you pay)" : "Net credit (you get)"}
                value={fmtUSD(Math.abs(result.netCost))}
                color={result.netCost >= 0 ? C.down : C.up}
              />
              <Stat label="Max profit" value={money(result.maxProfit)} color={C.up} />
              <Stat label="Max loss" value={money(result.maxLoss)} color={C.down} />
              <Stat
                label={`Breakeven${result.breakevens.length === 1 ? "" : "s"}`}
                value={result.breakevens.length ? result.breakevens.map((b) => fmt(b, 2)).join(" / ") : "—"}
              />
            </div>
            <PayoffChart curve={result.curve} S={S} breakevens={result.breakevens} />
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <CardTitle icon={Gauge}>Net Greeks</CardTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Stat label="Delta" value={fmt(result.netGreeks.delta, 1)} sub="per $1 underlying" />
                <Stat label="Gamma" value={fmt(result.netGreeks.gamma, 3)} sub="delta per $1" />
                <Stat label="Theta" value={fmtUSD(result.netGreeks.theta)} sub="per day" color={result.netGreeks.theta >= 0 ? C.up : C.down} />
                <Stat label="Vega" value={fmtUSD(result.netGreeks.vega)} sub="per 1% IV" />
              </div>
            </Card>
            <Card>
              <CardTitle icon={Activity}>Legs</CardTitle>
              <div style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.8, fontFamily: MONO }}>
                {result.legs.map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: l.position > 0 ? C.up : C.down }}>
                      {l.position > 0 ? "Long" : "Short"}{" "}
                      {l.kind === "stock" ? "underlying" : `${l.K} ${l.type}`}
                    </span>
                    <span style={{ color: C.inkFaint }}>
                      {l.kind === "stock" ? `@ ${fmt(l.entry, 2)}` : `@ ${fmt(l.premium, 2)}`}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              background: C.flatSoft,
              border: `1px solid ${C.flat}33`,
              borderRadius: 12,
              padding: "12px 14px",
              color: C.inkSoft,
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            <Info size={16} color={C.flat} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong style={{ color: C.ink }}>Theoretical, not quotes.</strong> Premiums are Black-Scholes
              estimates from the IV you enter (European-style, no dividends) — real option prices differ. This
              shows a strategy's shape and risk for you to study; it is not advice and places no trades.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────
export default function App() {
  const [contracts, setContracts] = useState(null);
  const [timeframes, setTimeframes] = useState(null);
  const prefs = loadPrefs();

  const [symbol, setSymbol] = useState(prefs.symbol || "ES=F");
  const [timeframe, setTimeframe] = useState(prefs.timeframe || "daily");
  const [accountSize, setAccountSize] = useState(prefs.accountSize ?? 25000);
  const [riskPct, setRiskPct] = useState(prefs.riskPct ?? 1);
  const [accessCode, setAccessCode] = useState(prefs.accessCode || "");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [view, setView] = useState("desk"); // "desk" | "options"

  useEffect(() => {
    getContracts()
      .then((d) => {
        setContracts(d.contracts);
        setTimeframes(d.timeframes);
      })
      .catch(() => setError("Could not load contract list — is the server running?"));
  }, []);

  useEffect(() => {
    savePrefs({ symbol, timeframe, accountSize, riskPct, accessCode });
  }, [symbol, timeframe, accountSize, riskPct, accessCode]);

  async function run() {
    setLoading(true);
    setError("");
    try {
      const d = await analyze({ symbol, timeframe, accountSize: Number(accountSize), riskPct: Number(riskPct), accessCode });
      setData(d);
    } catch (e) {
      setError(e.message || "Analysis failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    if (!contracts) return {};
    const g = {};
    for (const [sym, spec] of Object.entries(contracts)) {
      (g[spec.group] ||= []).push([sym, spec]);
    }
    return g;
  }, [contracts]);

  const theme = data ? biasTheme(data.signal.bias) : biasTheme("neutral");
  const dp = data ? tickDecimals(data.spec.tick) : 2;
  const changeColor = data ? (data.change >= 0 ? C.up : C.down) : C.ink;

  const inputStyle = {
    background: C.panel2,
    border: `1px solid ${C.line}`,
    borderRadius: 9,
    color: C.ink,
    padding: "9px 11px",
    fontSize: 14,
    fontFamily: SANS,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 11, color: C.inkSoft, marginBottom: 5, display: "block", fontWeight: 500 };

  return (
    <div style={{ minHeight: "100%", background: C.bg, color: C.ink, fontFamily: SANS }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px 64px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: `linear-gradient(135deg, ${C.accent}, ${C.up})`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Activity size={18} color="#0B0F14" />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>Tradewind</div>
            <div style={{ fontSize: 12.5, color: C.inkSoft }}>Analysis to review — never orders to place</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 18, borderBottom: `1px solid ${C.line}` }}>
          {[
            { key: "desk", label: "Futures desk", Icon: Activity },
            { key: "options", label: "Options", Icon: Layers },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "none",
                border: "none",
                borderBottom: `2px solid ${view === key ? C.accent : "transparent"}`,
                color: view === key ? C.ink : C.inkSoft,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: SANS,
                padding: "10px 14px",
                marginBottom: -1,
                cursor: "pointer",
              }}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {view === "desk" && (
        <>
        {/* Controls */}
        <Card style={{ marginTop: 20, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.9fr", gap: 12, alignItems: "end" }}>
            <div>
              <label style={labelStyle}>Contract</label>
              <select style={inputStyle} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {Object.entries(grouped).map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map(([sym, spec]) => (
                      <option key={sym} value={sym}>
                        {sym.replace("=F", "")} · {spec.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Timeframe</label>
              <select style={inputStyle} value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                {timeframes &&
                  Object.entries(timeframes).map(([key, tf]) => (
                    <option key={key} value={key}>
                      {tf.label}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Account ($)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={accountSize}
                onChange={(e) => setAccountSize(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Risk / trade (%)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={riskPct}
                onChange={(e) => setRiskPct(e.target.value)}
              />
            </div>
          </div>

          <button
            onClick={run}
            disabled={loading || !contracts}
            style={{
              marginTop: 14,
              width: "100%",
              border: "none",
              borderRadius: 10,
              padding: "11px 16px",
              background: loading ? C.panel2 : C.accent,
              color: loading ? C.inkSoft : "#0B0F14",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={15} />}
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </Card>

        {error && (
          <Card style={{ borderColor: `${C.down}55`, marginBottom: 16 }}>
            <div style={{ color: C.down, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
              <Info size={15} /> {error}
            </div>
          </Card>
        )}

        {!data && !error && (
          <div style={{ marginBottom: 16 }}>
            <Disclaimer />
          </div>
        )}

        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Price + signal header */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div style={{ minWidth: 200 }}>
                  <div style={{ fontSize: 12.5, color: C.inkSoft }}>
                    {data.symbol.replace("=F", "")} · {data.name} · {data.timeframe}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
                    <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700 }}>{fmt(data.price, dp)}</span>
                    <span style={{ color: changeColor, fontFamily: MONO, fontSize: 14, display: "flex", alignItems: "center", gap: 2 }}>
                      {data.change >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                      {fmt(Math.abs(data.change), dp)} ({fmt(Math.abs(data.changePct), 2)}%)
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: C.inkFaint, marginTop: 6 }}>
                    {data.bars} bars · as of {new Date(data.asOf).toLocaleString()} · {data.provider === "yahoo" ? "delayed continuous front-month via Yahoo" : `via ${data.provider}`}
                  </div>
                </div>

                <div
                  style={{
                    background: theme.soft,
                    border: `1px solid ${theme.c}55`,
                    borderRadius: 12,
                    padding: "12px 16px",
                    minWidth: 200,
                    flex: "0 0 auto",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <theme.Icon size={18} color={theme.c} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: theme.c }}>{theme.label}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {data.signal.confidence} conf.
                    </span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <ScoreMeter score={data.signal.score} color={theme.c} />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <Sparkline series={data.series} color={theme.c} />
              </div>
            </Card>

            {/* Indicators */}
            <Card>
              <CardTitle icon={Gauge}>Indicators</CardTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                <Stat label="RSI (14)" value={fmt(data.indicators.rsi14, 1)}
                  color={data.indicators.rsi14 >= 70 ? C.down : data.indicators.rsi14 <= 30 ? C.up : C.ink}
                  sub={data.indicators.rsi14 >= 70 ? "overbought" : data.indicators.rsi14 <= 30 ? "oversold" : "neutral"} />
                <Stat label="MACD hist" value={fmt(data.indicators.macd.hist, 3)}
                  color={data.indicators.macd.hist >= 0 ? C.up : C.down}
                  sub={data.indicators.macd.hist >= 0 ? "bullish" : "bearish"} />
                <Stat label="ATR (14)" value={fmt(data.indicators.atr14, dp)} sub="volatility / bar" />
                <Stat label="SMA 20" value={fmt(data.indicators.sma20, dp)}
                  color={data.price > data.indicators.sma20 ? C.up : C.down} />
                <Stat label="SMA 50" value={fmt(data.indicators.sma50, dp)}
                  color={data.price > data.indicators.sma50 ? C.up : C.down} />
                <Stat label="EMA 9 / 21" value={`${fmt(data.indicators.ema9, dp)} / ${fmt(data.indicators.ema21, dp)}`}
                  color={data.indicators.ema9 > data.indicators.ema21 ? C.up : C.down} />
              </div>
            </Card>

            {/* Why + cautions */}
            <div style={{ display: "grid", gridTemplateColumns: data.signal.cautions.length ? "1fr 1fr" : "1fr", gap: 16 }}>
              <Card>
                <CardTitle icon={Activity}>Why this signal</CardTitle>
                <ul style={{ margin: 0, paddingLeft: 18, color: C.inkSoft, fontSize: 13, lineHeight: 1.7 }}>
                  {data.signal.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Card>
              {data.signal.cautions.length > 0 && (
                <Card style={{ borderColor: `${C.flat}44` }}>
                  <CardTitle icon={ShieldAlert}>Cautions</CardTitle>
                  <ul style={{ margin: 0, paddingLeft: 18, color: C.flat, fontSize: 13, lineHeight: 1.7 }}>
                    {data.signal.cautions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>

            {/* Risk plan */}
            {data.risk && (
              <Card>
                <CardTitle icon={ShieldAlert}>
                  Risk plan
                  <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: C.inkFaint, marginLeft: 8 }}>
                    {data.risk.isReference
                      ? "(neutral bias — shown as a long-side reference)"
                      : `${data.risk.direction} · ${data.risk.atrMult}× ATR stop`}
                  </span>
                </CardTitle>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                  <Stat label="Entry (ref)" value={fmt(data.risk.entry, dp)} />
                  <Stat label="Stop" value={fmt(data.risk.stop, dp)} color={C.down}
                    sub={`${fmt(data.risk.stopDistancePts, dp)} pts (1R)`} />
                  <Stat label={`Target 1 (${data.risk.rMultiples.target1}R)`} value={fmt(data.risk.target1, dp)} color={C.up} />
                  <Stat label={`Target 2 (${data.risk.rMultiples.target2}R)`} value={fmt(data.risk.target2, dp)} color={C.up} />
                  <Stat label="Risk / contract" value={fmtUSD(data.risk.riskPerContract)}
                    sub={`$${data.risk.pointValue}/pt`} />
                  <Stat label="$ at risk" value={fmtUSD(data.risk.dollarRisk)} sub={`${riskPct}% of account`} />
                  <Stat label="Suggested size" value={`${data.risk.suggestedContracts} contract${data.risk.suggestedContracts === 1 ? "" : "s"}`}
                    color={data.risk.suggestedContracts > 0 ? C.ink : C.flat}
                    sub={data.risk.suggestedContracts === 0 ? "stop too wide for this risk %" : "to stay within $ risk"} />
                </div>
                <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 12, lineHeight: 1.5 }}>
                  Entry is the current (delayed) reference price, not a fill. Targets are R-multiples of the stop distance,
                  not predictions. Confirm point value and tick for your exact contract before sizing.
                </div>
              </Card>
            )}

            {/* AI read — gated by passcode on shared deploys; hidden entirely if
                no AI key is configured on the server */}
            {data.aiStatus === "on" && (
              <Card>
                <CardTitle icon={Sparkles}>{data.aiProvider ? `AI read · ${data.aiProvider}` : "AI read"}</CardTitle>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: C.ink, whiteSpace: "pre-wrap" }}>
                  {data.explanation}
                </div>
              </Card>
            )}
            {data.aiStatus === "locked" && (
              <Card>
                <CardTitle icon={Sparkles}>AI read — locked</CardTitle>
                <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
                  A plain-language AI explanation of this setup is available. Enter the access code to turn it on —
                  ask whoever shared this link. It's saved on this device so you only enter it once.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={{ ...inputStyle, maxWidth: 240 }}
                    type="password"
                    placeholder="access code"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && run()}
                  />
                  <button
                    onClick={run}
                    disabled={loading || !accessCode}
                    style={{
                      border: "none", borderRadius: 9, padding: "0 18px",
                      background: loading || !accessCode ? C.panel2 : C.accent,
                      color: loading || !accessCode ? C.inkSoft : "#0B0F14",
                      fontSize: 13, fontWeight: 600, cursor: loading || !accessCode ? "default" : "pointer",
                    }}
                  >
                    Unlock
                  </button>
                </div>
              </Card>
            )}
            {data.aiStatus === "rate_limited" && (
              <Card style={{ borderColor: `${C.flat}44` }}>
                <div style={{ fontSize: 13, color: C.flat, display: "flex", gap: 8, alignItems: "center" }}>
                  <Info size={15} /> AI read is busy (rate limit reached). The signal and risk plan above are
                  current — try again in a minute.
                </div>
              </Card>
            )}

            <Disclaimer />
          </div>
        )}
        </>
        )}

        {view === "options" && (
          <OptionsPanel
            underlying={data?.price}
            contractLabel={data ? `${data.symbol.replace("=F", "")} · ${data.name}` : null}
            inputStyle={inputStyle}
            labelStyle={labelStyle}
          />
        )}
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        select option { background: ${C.panel2}; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.4; }
        body { -webkit-font-smoothing: antialiased; }
      `}</style>
    </div>
  );
}
