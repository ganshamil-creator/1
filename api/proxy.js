// Vercel Serverless Function — прокси для AI API
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
 
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });
 
  try {
    const { url, headers, body } = req.body;
    if (!url) return res.status(400).json({ error: { message: "Missing url" } });
 
    const allowed = [
      "api.anthropic.com",
      "generativelanguage.googleapis.com",
      "api.perplexity.ai",
      "api.deepseek.com",
      "api.openai.com",
      "api.moonshot.ai",
      "api.tavily.com",
    ];
    const host = new URL(url).hostname;
    if (!allowed.includes(host)) {
      return res.status(403).json({ error: { message: "Domain not allowed: " + host } });
    }
 
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
 
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
 
    clearTimeout(timeout);
    const data = await response.text();
    return res.status(response.status).send(data);
  } catch (e) {
    const msg = e.name === "AbortError" ? "Timeout (55s)" : e.message;
    return res.status(500).json({ error: { message: msg } });
  }
};
 
