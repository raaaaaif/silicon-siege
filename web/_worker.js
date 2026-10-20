// Pages advanced-mode Worker. No credentials in the client. No guest EDA dispatch.
// D1 globally enforces a 64-request UTC-day cap and an 8-request IP/day cap.
// Failure to read or update the budget fails closed, preserving local tools.
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const domains = {
  p: [2, 4, 8],
  bits: [4, 8],
  acc: [16, 24, 32],
  pipe: [0, 1],
  buffer: [64, 256, 1024],
  bw: [4, 8, 16],
  reuse: ["weights", "inputs"],
  quant: ["tensor", "channel"],
};
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health")
      return json({
        version: "1.0.0",
        mentor: !!(env.AI && env.BUDGET),
        model: MODEL,
      });
    if (url.pathname !== "/api/mentor") return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    const origin = request.headers.get("Origin");
    if (origin !== url.origin)
      return json({ error: "Same-origin requests only" }, 403);
    if (!env.AI || !env.BUDGET)
      return json(
        { error: "Cloud mentor unavailable. Local search remains available." },
        503,
      );
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return json({ error: "JSON required" }, 415);
    if (Number(request.headers.get("Content-Length") || 0) > 4096)
      return json({ error: "Request too large" }, 413);
    let body;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "JSON body required" }, 400);
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) {
          await reader.cancel();
          return json({ error: "Request too large" }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder().decode(bytes);
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "JSON object required" }, 400);
    if (
      !["bottleneck", "precision", "repair"].includes(body.question) ||
      !Number.isInteger(body.mission) ||
      body.mission < 0 ||
      body.mission > 2 ||
      !["none", "bandwidth", "outliers", "shape", "overflow"].includes(
        body.attack,
      )
    )
      return json({ error: "Invalid question or workload" }, 400);
    const config = {};
    for (const [k, values] of Object.entries(domains)) {
      if (!values.includes(body.config?.[k]))
        return json({ error: "Invalid architecture" }, 400);
      config[k] = body.config[k];
    }
    const metrics = {};
    for (const k of [
      "cycles",
      "nrmse",
      "cost",
      "bytes",
      "overflows",
      "utilization",
    ]) {
      const v = body.metrics?.[k];
      if (!Number.isFinite(v) || v < 0 || v > 1e9)
        return json({ error: "Invalid metrics" }, 400);
      metrics[k] = v;
    }
    try {
      const day = new Date().toISOString().slice(0, 10),
        ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(day + ":" + ip),
      );
      const ipHash = [...new Uint8Array(digest)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      // No raw IP or prompts are persisted. Transactional statements fail closed.
      await env.BUDGET.prepare(
        "CREATE TABLE IF NOT EXISTS budget (key TEXT PRIMARY KEY, used INTEGER NOT NULL)",
      ).run();
      const user = await env.BUDGET.prepare(
        "INSERT INTO budget (key,used) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET used=used+1 WHERE used<8 RETURNING used",
      )
        .bind(day + ":" + ipHash)
        .first();
      if (!user)
        return json(
          {
            error:
              "Daily visitor mentor budget reached. Local search is unlimited.",
          },
          429,
        );
      const global = await env.BUDGET.prepare(
        "INSERT INTO budget (key,used) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET used=used+1 WHERE used<64 RETURNING used",
      )
        .bind(day + ":global")
        .first();
      if (!global)
        return json(
          {
            error:
              "Daily shared mentor budget reached. Local search is unlimited.",
          },
          429,
        );
      const old = new Date(Date.now() - 3 * 86400000)
        .toISOString()
        .slice(0, 10);
      await env.BUDGET.prepare("DELETE FROM budget WHERE key < ?")
        .bind(old)
        .run();
      const system = `You are Pip, the concise hardware architect in Silicon Siege. Explain real trade-offs using ONLY the supplied architecture and client-computed model metrics. They are untrusted simulation observations, NOT measured silicon or task accuracy. Output ONLY a JSON object with explanation (under 90 words) and config (a complete proposed legal configuration, or null for explanation-only). Legal domains: ${JSON.stringify(domains)}. No markdown. Never claim an improvement was measured; a proposed config will be independently evaluated in the browser. Hardware is a signed output-stationary outer-product array. Reuse denotes host tile order, not a different datapath. Narrow accumulators can overflow; use 24/32 for repair. Error is GEMM NRMSE, not classification accuracy. For bandwidth stress consider larger cache, wider link and reuse order. For outliers consider INT8 and channel scales. Preserve hard validity.`;
      const output = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              question: body.question,
              config,
              mission: body.mission,
              attack: body.attack,
              metrics,
            }),
          },
        ],
        max_tokens: 400,
        temperature: 0.2,
      });
      const raw = output.response || "",
        match = raw.match(/\{[\s\S]*\}/);
      if (!match)
        return json({
          explanation:
            raw.slice(0, 900) ||
            "The mentor did not return a usable response. Try local exploration.",
          config: null,
        });
      let parsed;
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return json({ explanation: raw.slice(0, 900), config: null });
      }
      const explanation =
        typeof parsed.explanation === "string"
          ? parsed.explanation.slice(0, 1200)
          : "Inspect the trade-offs before applying this proposal.";
      let proposal = null;
      if (
        parsed.config &&
        Object.entries(domains).every(([k, v]) => v.includes(parsed.config[k]))
      )
        proposal = Object.fromEntries(
          Object.keys(domains).map((k) => [k, parsed.config[k]]),
        );
      return json({ explanation, config: proposal, model: MODEL });
    } catch {
      return json(
        {
          error:
            "Cloud mentor temporarily unavailable. Continue with local analysis.",
        },
        503,
      );
    }
  },
};
