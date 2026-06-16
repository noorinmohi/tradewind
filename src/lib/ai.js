// AI-read provider layer — the ONE place that knows how to call a language
// model, behind a provider switch (mirrors the data layer in data.js).
//
// Pick a provider with AI_PROVIDER (default "anthropic"). Each provider exposes:
//   enabled() -> boolean        // is it configured (key present, etc.)?
//   generate(system, user) -> Promise<string>   // the model's reply text
//
// Switching providers is one env var. A free, no-credit-card setup might be:
//   AI_PROVIDER=groq      GROQ_API_KEY=...        (free key, console.groq.com)
//   AI_PROVIDER=gemini    GEMINI_API_KEY=...      (free key, aistudio.google.com)
//   AI_PROVIDER=ollama                            (free, local, no key)
// and later, once you have credits:
//   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=...   (Claude — the best quality)

const PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();

// Treat the ".env.example" placeholder as "not set" so a forgotten placeholder
// reads as "AI off" instead of throwing a 401 on every request.
const real = (v) => (v && !v.includes("your-key-here") ? v : null);

const MAX_TOKENS = 600;
const TEMPERATURE = 0.4;

// ── Anthropic (Claude) — best quality; pay-as-you-go key ────────
async function anthropicGenerate(system, user) {
  const key = real(process.env.ANTHROPIC_API_KEY);
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return (d.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
}

// ── Groq — free tier, OpenAI-compatible, very fast ──────────────
async function groqGenerate(system, user) {
  const key = real(process.env.GROQ_API_KEY);
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return (d.choices?.[0]?.message?.content || "").trim();
}

// ── Google Gemini — free tier ───────────────────────────────────
async function geminiGenerate(system, user) {
  const key = real(process.env.GEMINI_API_KEY);
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: TEMPERATURE },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

// ── Ollama — free, local, no key (needs `ollama serve` running) ──
async function ollamaGenerate(system, user) {
  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1";
  const r = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      options: { temperature: TEMPERATURE, num_predict: MAX_TOKENS },
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return (d.message?.content || "").trim();
}

const providers = {
  anthropic: { enabled: () => Boolean(real(process.env.ANTHROPIC_API_KEY)), generate: anthropicGenerate },
  groq: { enabled: () => Boolean(real(process.env.GROQ_API_KEY)), generate: groqGenerate },
  gemini: { enabled: () => Boolean(real(process.env.GEMINI_API_KEY)), generate: geminiGenerate },
  ollama: { enabled: () => true, generate: ollamaGenerate }, // local; no key to check
};

export function aiProvider() {
  return PROVIDER;
}

export function aiEnabled() {
  return providers[PROVIDER]?.enabled() ?? false;
}

export async function generateRead(system, user) {
  const p = providers[PROVIDER];
  if (!p) throw new Error(`unknown AI_PROVIDER "${PROVIDER}" (available: ${Object.keys(providers).join(", ")})`);
  return p.generate(system, user);
}
