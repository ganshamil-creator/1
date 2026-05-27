exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, anthropic-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    const { url, headers, body } = JSON.parse(event.body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body: body,
    });

    clearTimeout(timeout);
    const data = await response.text();

    return {
      statusCode: response.status,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: data,
    };
  } catch (e) {
    const msg = e.name === "AbortError" ? "Request timeout" : e.message;
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: { message: msg } }),
    };
  }
};
