// api/proxy.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', proxy: 'AI Multi-Hub', version: '3' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let reqBody;
  try {
    reqBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { url, headers: extraHeaders, body } = reqBody || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const ALLOWED = [
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'api.deepseek.com',
    'api.perplexity.ai',
    'api.openai.com',
    'api.moonshot.ai',
  ];

  let targetHost;
  try { targetHost = new URL(url).hostname; }
  catch { return res.status(400).json({ error: 'Invalid url' }); }

  if (!ALLOWED.includes(targetHost)) {
    return res.status(403).json({ error: `Domain not allowed: ${targetHost}` });
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
