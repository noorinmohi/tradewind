# Tradewind

A **futures analysis desk**. Pick a contract, and Tradewind pulls recent price
history, computes a set of technical indicators, derives a transparent
rule-based signal, sizes a risk plan to your account, and (optionally) asks
Claude for a plain-language read of the setup.

> **Analysis only — not advice, and not an order.** Tradewind never connects to
> a broker and never places a trade. Every output is a mechanical summary of
> *delayed, continuous-contract* data for **you** to review and act on yourself.
> Markets are uncertain; nothing here predicts the future or guarantees a
> result. Verify contract specs with your broker and manage your own risk.

## What it does

- **Technical indicators** — SMA(20/50), EMA(9/21), RSI(14), MACD, ATR(14).
- **Rule-based signal** — a transparent score from −100 (short) to +100 (long).
  Every point is explained in "Why this signal," and conflicts (e.g. uptrend
  but overbought RSI) surface as "Cautions." No black box.
- **ATR risk plan** — volatility-aware stop, R-multiple targets, and a
  position size from fixed-fractional risk (never risk more than your chosen %
  of the account on one trade).
- **AI read** *(optional)* — Claude explains what the numbers show, names the
  strongest and the most conflicting factor, and what would invalidate the
  setup. Skipped gracefully if no API key is set.
- **Contracts incl. micros** — index, metals, energy, rates, ags, FX, and
  crypto, in both full-size (ES, NQ, CL, GC, HG, 6E, BTC…) and micro (MES, MNQ,
  MGC, SIL, MHG, M6E, MBT…) flavors. Micros pull the same price series as their
  full-size sibling but apply the micro multiplier, so small accounts get
  realistic position sizing.
- **Backtesting** — replay history through the *same* signal functions to see
  how the rules would have done. See [Backtesting](#backtesting).

## Architecture

```
Browser (React + Vite)
   │  POST /api/analyze   ← never sees your API key
   ▼
Express server (server.js)
   │  1. fetch bars (fetchSeries — the ONLY data-source touchpoint)
   │  2. compute indicators (src/lib/indicators.js)
   │  3. rule signal + risk plan (src/lib/signal.js)
   │  4. add x-api-key, ask Claude for the read
   ▼
Yahoo Finance (data)  +  Anthropic Messages API (the read)
```

The signal/indicator math is **pure and testable** in `src/lib/`. Swapping the
data provider (Databento, Polygon, IBKR, a crypto exchange…) is a one-function
change in `fetchSeries` in `server.js`.

## Data source & its limits

By default Tradewind uses Yahoo Finance **continuous front-month** futures
(`ES=F`, `NQ=F`, `CL=F`, `GC=F`, …). Free, no key — but:

- It is **delayed** (~10–15 min), so it is **not** for precise live execution.
- It is a **stitched continuous series**, not a specific expiry's order book.
- Contract specs in `src/lib/contracts.js` are standard CME values and can
  change; **micros differ**. Confirm yours with your broker before sizing.

### Switching data provider

The feed lives behind a switch in `src/lib/data.js`. Pick it with `DATA_PROVIDER`:

```bash
DATA_PROVIDER=yahoo      # default — free, delayed ~10-15 min
DATA_PROVIDER=polygon    # real-time futures; needs POLYGON_API_KEY (paid + CME fees)
DATA_PROVIDER=databento  # CME futures; needs DATABENTO_API_KEY (paid)
```

> **Real-time data is paid.** Free feeds are always delayed. A live futures feed
> means a paid vendor plan **plus CME exchange fees** (there's a cheaper
> "non-professional" tier for individuals) and a credit card. The app only needs
> a one-line switch; the cost and entitlement are on the data vendor's side.

**Polygon** and **Databento** adapters are included, written to their documented
APIs but **not exercised in this repo** (they need live keys). When you activate
one, confirm the futures ticker/symbology convention and the response/price
format against the vendor's current docs — both are flagged in `src/lib/data.js`.
**Adding another feed** (IBKR, a crypto exchange) is one function with the
signature `(spec, interval, range) => { rows, meta }`, registered in the
`providers` map — nothing else changes.

To go live on Polygon: add `DATA_PROVIDER=polygon` and `POLYGON_API_KEY` as
secrets in your host dashboard (e.g. Render → Environment), exactly like the AI
keys — never in `render.yaml` (the repo is public).

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer (uses built-in `fetch`; the env-file
  flag in the scripts needs Node 20.12+, which any current install satisfies).
- *(Optional)* an Anthropic API key for the AI read — <https://console.anthropic.com/>.

## Quick start (use it locally)

```bash
npm install
npm run serve      # builds the UI and starts the app
```

Then open **<http://localhost:3001>** and pick a contract. That's it — no key
required; you get the indicators, signal, and risk plan immediately.

To stop it, press `Ctrl-C` in that terminal. To run it again later, just
`npm run serve` (or `npm start` to skip the rebuild).

### Enable the AI read (optional, free)

The AI read (plain-language commentary on each setup) is off until you point it
at a model. It runs behind a provider switch (`src/lib/ai.js`) so you can use a
**free** model now and switch to Claude later by changing one line.

**Free, no credit card — Groq (default):**

1. Get a free key (no card) at <https://console.groq.com/keys>.
2. Open `.env` (created for you; gitignored) and set:
   ```
   AI_PROVIDER=groq
   GROQ_API_KEY=gsk_...your real key...
   ```
3. Restart: `Ctrl-C`, then `npm start`.

Other free choices: `AI_PROVIDER=gemini` (free key at
<https://aistudio.google.com/apikey>) or `AI_PROVIDER=ollama` (free + local, no
key — run `ollama serve`). For the best quality once you have credits, use
`AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` (Claude). See `.env.example`.

The scripts auto-load `.env` (`node --env-file-if-exists=.env`). Until a key for
the selected provider is present, the app cleanly hides the AI read rather than
erroring.

## Develop (with hot reload)

```bash
npm run dev
```

Vite serves the UI on <http://localhost:5173> and proxies `/api` to the Express
backend on port 3001, so the key stays server-side. Use this when editing code;
use `npm run serve` when you just want to use the tool.

## Deploy (share a public URL)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/noorinmohi/tradewind)

The default deploy is **analysis-only**: no API key on the server, so there is
nothing to abuse and no per-request cost — safe to hand to a friend. The
indicators, signal, and risk plan all work; the AI-read card is simply hidden
when no key is present.

You need a host that runs Node (the Express backend fetches data and serves the
app), not a static-only host. A `Dockerfile`, `render.yaml`, and
`docker-compose.yml` are included.

**Render (free, uses `render.yaml`):**

1. Push this folder to a GitHub repo.
2. In Render: **New → Blueprint**, point it at the repo. It reads `render.yaml`
   and provisions the service (build `npm ci && npm run build`, start
   `node server.js`).
3. Share the `https://tradewind-xxxx.onrender.com` URL it gives you.

> Free Render services sleep after inactivity, so the first hit may take ~30s to
> wake. Fine for a friend; upgrade the plan if you want it always-on.

**Anywhere that runs a container (Fly.io, Railway, a VPS):**

```bash
docker build -t tradewind .
docker run -p 3001:3001 tradewind        # http://localhost:3001
# or: docker compose up --build
```

### Enabling the AI read on a public deploy (passcode-gated)

The AI read spends your model quota on every call, so on a shared URL you should
gate it. Tradewind has this built in: set a passcode and the **free analysis
stays open to everyone, but the AI read only runs for visitors who enter the
code**. There's also a per-IP rate limit in case the code leaks.

In your host's **dashboard** (Render → Environment; never in git — the repo is
public), set environment variables:

| Variable | Value | Purpose |
|---|---|---|
| `AI_PROVIDER` | `groq` (or `gemini`/`anthropic`) | which model powers the read |
| `GROQ_API_KEY` | your `gsk_...` key | the provider key (use the matching key var) |
| `AI_PASSCODE` | a code you choose | required to unlock the AI read |
| `AI_RATE_PER_MIN` | `20` (optional) | per-IP AI reads per minute |

Then share the URL **and** the passcode with the people you want to have the AI
read. They enter it once (stored on their device). Without it, they still get
the full signals + risk plan. Leaving `AI_PASSCODE` unset means the AI read is
open to everyone (only do that with a strict spend cap at the provider).

## Backtesting

Because the indicator and signal functions are pure, `backtest.js` replays
historical bars through the exact same logic the live desk uses — so you are
measuring the real rules, not an approximation.

```bash
npm run backtest -- ES=F daily      # or: node backtest.js ES=F daily
node backtest.js MNQ=F hourly
DATA_PROVIDER=databento node backtest.js ES=F intraday   # if you have a key
```

Trade model (lookahead-free): enter at the next bar's open on a non-neutral
signal, stop at 1.5×ATR (= 1R), target at 2R, time-exit after 20 bars, one
position at a time. It reports trades, win rate, total/expectancy in **R**,
profit factor, and max drawdown.

> **It is hypothetical.** No commissions, slippage, or rollover; a single fixed
> stop/target rule; continuous-contract data. A profit factor near 1.0 almost
> certainly loses money once real costs are added. Use it to compare rule
> variants, not to set expectations for real trading.

## Tests

The indicator math, the signal/risk rules, and the backtest trade simulator are
covered by unit tests using Node's built-in runner (no extra dependencies):

```bash
npm test
```

They pin down hand-verified cases so a change to the logic fails loudly instead
of silently shifting every signal and backtest:

- **indicators** — SMA/EMA/ATR values, RSI bounds, `hist = macd − signal`.
- **signal/risk** — scoring, neutral/long/short bias, overbought cautions,
  stop/target direction, tick rounding, position sizing.
- **backtest** — every exit path (target, stop, stop-first on an ambiguous bar,
  timed exit), flat-to-flat sequencing (no overlapping trades), and the stats
  aggregation (win rate, expectancy, profit factor, drawdown).

## Extending it

- **More contracts** — add entries to `CONTRACTS` in `src/lib/contracts.js`
  (verify the Yahoo symbol returns data, and confirm `pointValue`/`tick`).
- **Different/real data** — add a provider in `src/lib/data.js` (see [above](#switching-data-provider)).
- **Tune the signal** — all rules and weights live in `buildSignal` in `src/lib/signal.js`.
  Change them, then re-run `backtest.js` to see the effect.

## License

MIT.
