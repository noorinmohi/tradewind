// Talks to OUR backend only. The Anthropic key and all data-fetching live on
// the server — the browser never sees the key or calls a provider directly.

export async function analyze(params) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "analysis failed: " + res.status);
  return data;
}

export async function getContracts() {
  const res = await fetch("/api/contracts");
  if (!res.ok) throw new Error("could not load contracts");
  return res.json();
}
