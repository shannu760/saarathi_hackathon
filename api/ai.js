// Vercel serverless function: forwards a prompt to OpenRouter.
// The API key stays on the server (environment variable), never in the page.
const hits = new Map();

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(503).json({ error: "AI is not configured" });

  // Same-origin requests only.
  const host = req.headers.host;
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== host) return res.status(403).json({ error: "Forbidden" });
    } catch (e) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // Best-effort rate limit: 20 requests per 10 minutes per IP (per warm instance).
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  if (hits.size > 1000) hits.clear();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 600000);
  if (recent.length >= 20) return res.status(429).json({ error: "Too many requests" });
  recent.push(now);
  hits.set(ip, recent);

  const prompt = req.body && req.body.prompt;
  if (typeof prompt !== "string" || prompt.length < 5 || prompt.length > 8000) {
    return res.status(400).json({ error: "Invalid prompt" });
  }

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://" + host,
        "X-Title": "Saarathi",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
        max_tokens: 700,
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: "AI provider error" });
    const data = await r.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return res.status(502).json({ error: "Empty response" });
    return res.status(200).json({ text: String(text).trim() });
  } catch (e) {
    return res.status(502).json({ error: "AI unavailable" });
  }
};
