export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-api-key,anthropic-version");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ status: "ok", proxy: "AI Multi-Hub v4" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch (e) { return res.status(400).json({ error: "Invalid JSON body" }); }

  const { url, headers = {}, body: apiBody } = body || {};
  if (!url) return res.status(400).json({ error: "Missing url" });

  const allowed = [
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "api.perplexity.ai",
    "api.deepseek.com",
    "api.openai.com",
    "api.tavily.com",
    "api.moonshot.cn",
    "api.moonshot.ai",
  ];

  let hostname;
  try { hostname = new URL(url).hostname; }
  catch (e) { return res.status(400).json({ error: "Invalid URL" }); }

  if (!allowed.some((h) => hostname === h || hostname.endsWith("." + h))) {
    return res.status(403).json({ error: "Host not allowed: " + hostname });
  }

  try {
    const fetchHeaders = { "Content-Type": "application/json" };
    for (const [k, v] of Object.entries(headers)) { if (v) fetchHeaders[k] = v; }
    const fetchBody = typeof apiBody === "string" ? apiBody : JSON.stringify(apiBody);
    const upstream = await fetch(url, { method: "POST", headers: fetchHeaders, body: fetchBody });
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); }
    catch { res.status(upstream.status).setHeader("Content-Type", "application/json"); return res.end(text); }
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message || "Proxy fetch failed" });
  }
}
