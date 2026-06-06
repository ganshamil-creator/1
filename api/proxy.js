// api/proxy.js — Vercel Serverless Function
// Принимает: POST { url, headers, body }
// Проксирует запрос к внешнему API от имени сервера (обходит CORS на мобильных)

export default async function handler(req, res) {
  // ─── CORS ────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'AI Multi-Hub proxy running' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ─── Парсим тело ─────────────────────────────────────────────
  let reqBody;
  try {
    reqBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { url, headers: extraHeaders, body } = reqBody || {};

  if (!url) {
    return res.status(400).json({ error: 'Missing url in request body' });
  }

  // ─── Безопасность: разрешаем только нужные домены ────────────
  const ALLOWED = [
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'api.deepseek.com',
    'api.perplexity.ai',
    'api.openai.com',
    'api.moonshot.ai',
    'api.tavily.com',
  ];

  let targetHost;
  try {
    targetHost = new URL(url).hostname;
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  if (!ALLOWED.some(h => targetHost === h || targetHost.endsWith('.' + h))) {
    return res.status(403).json({ error: `Domain not allowed: ${targetHost}` });
  }

  // ─── Проксируем запрос ───────────────────────────────────────
  try {
    const fetchHeaders = {
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    };

    // body из фронта всегда объект (JSON.stringify делает proxyFetch)
    // Сериализуем в строку для upstream API
    const upstreamBody = typeof body === 'string' ? body : JSON.stringify(body);
    
    const upstream = await fetch(url, {
      method: 'POST',
      headers: fetchHeaders,
      body: upstreamBody,
    });

    // Передаём статус и тело ответа как есть
    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (err) {
    console.error('[proxy] upstream error:', err);
    return res.status(500).json({ error: 'Proxy upstream error', details: err.message });
  }
}
