// Pages advanced-mode Worker. No credentials in the client. No guest EDA dispatch.
// D1 globally enforces a 64-request UTC-day cap and an 8-request IP/day cap.
// Failure to read or update the budget fails closed, preserving local tools.
const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
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
      const limits = [
        { cycles: 1600, cost: 4600, error: 3 },
        { cycles: 2200, cost: 5200, error: 2 },
        { cycles: 3400, cost: 8500, error: 2 },
      ][body.mission];
      const strategies = {
        reduce_transfers:
          "Test cache capacity and tile order to reduce modeled line fills. A wider link reduces transfer stalls but adds resource cost.",
        increase_throughput:
          "Test a larger array only if its lanes can be fed. Compare utilization, resource cost and total cycles before applying it.",
        protect_precision:
          "Compare INT8 and per-output-channel scales against the numerical error budget. These scales affect GEMM error, not proven task accuracy.",
        widen_accumulator:
          config.acc < 32
            ? "Compare a wider accumulator against the overflow count. Extra width costs area; it does not remove input quantization error."
            : "The accumulator is already the maximum supported width. Inspect the numerical trace before attributing error to accumulator width.",
        balance_resources:
          "Try a smaller array, buffer or link, then remeasure latency and error. A lower resource proxy alone does not make a design feasible.",
        inspect_trace:
          "Inspect the trace to distinguish compute work, memory stalls and output transfer. A valid proposal still needs an independent measurement.",
      };
      const system = `You select a hardware design hypothesis. Output ONLY JSON with strategy (one of ${Object.keys(strategies).join(", ")}) and config (complete legal architecture or null). No explanation text. Legal domains: ${JSON.stringify(domains)}. Use supplied metrics and hard limits. NRMSE is a PERCENT, not a fraction; 0.77% is below 2%. Overflow=0 means no observed mathematical overflow. ACC32 is the maximum width. Do not recommend increasing a setting already at its maximum. Larger arrays help only if memory feeds them. Memory stress suggests cache, link and tile order; precision stress suggests INT8/channel scaling. Pick a different configuration only as a hypothesis to evaluate, never as an asserted improvement. Hardware is an output-stationary outer-product tile. /no_think`;
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
              limits,
            }),
          },
        ],
        max_tokens: 400,
        response_format: { type: "json_object" },
        temperature: 0.2,
      });
      const raw =
        output.response || output.choices?.[0]?.message?.content || "";
      let parsed;
      try {
        parsed =
          typeof raw === "object"
            ? raw
            : JSON.parse(
                raw
                  .replace(/<think>[\s\S]*?<\/think>/g, "")
                  .replace(/^```(?:json)?\s*|\s*```$/g, "")
                  .trim(),
              );
      } catch {
        return json(
          {
            error:
              "The mentor did not return a valid structured hypothesis. Local analysis remains available.",
          },
          502,
        );
      }
      if (!parsed || !Object.hasOwn(strategies, parsed.strategy))
        return json(
          {
            error:
              "The mentor returned an unsupported strategy. Local analysis remains available.",
          },
          502,
        );
      // Never render free-form model explanations. Facts are derived from bounded observations.
      const explanation = `${metrics.cycles} modeled cycles; ${metrics.nrmse.toFixed(2)}% NRMSE against a ${limits.error}% limit; ${metrics.overflows} observed overflows. Hypothesis: ${strategies[parsed.strategy]}`;
      let proposal = null;
      if (
        parsed.config &&
        Object.entries(domains).every(([k, v]) => v.includes(parsed.config[k]))
      )
        proposal = Object.fromEntries(
          Object.keys(domains).map((k) => [k, parsed.config[k]]),
        );
      if (
        proposal &&
        Object.keys(domains).every((k) => proposal[k] === config[k])
      )
        proposal = null;
      return json({
        explanation,
        strategy: parsed.strategy,
        config: proposal,
        model: MODEL,
      });
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
