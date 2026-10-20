import test from "node:test";
import assert from "node:assert/strict";
import worker from "../web/_worker.js";
import { DEFAULT } from "../web/engine.js";
const body = {
  question: "repair",
  config: DEFAULT,
  mission: 0,
  attack: "none",
  metrics: {
    cycles: 972,
    nrmse: 0.67,
    cost: 2507,
    bytes: 5200,
    overflows: 0,
    utilization: 0.29,
  },
};
const req = (data = body, origin = "https://example.test", method = "POST") =>
  new Request("https://example.test/api/mentor", {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(data) } : {}),
  });
function environment() {
  let used = 0,
    calls = 0;
  return {
    AI: {
      run: async () => {
        calls++;
        return {
          response: JSON.stringify({
            explanation: "Try more bandwidth, then measure it.",
            config: { ...DEFAULT, bw: 16 },
          }),
        };
      },
    },
    BUDGET: {
      prepare: (sql) => ({
        run: async () => ({ success: true }),
        bind: () => ({
          run: async () => ({ success: true }),
          first: async () => {
            if (sql.includes("used<8")) return ++used <= 8 ? { used } : null;
            return { used: 1 };
          },
        }),
      }),
    },
    calls: () => calls,
  };
}
test("worker fails closed when bindings missing and rejects cross-origin/malformed input", async () => {
  assert.equal((await worker.fetch(req(), {})).status, 503);
  const env = environment();
  assert.equal(
    (await worker.fetch(req(body, "https://evil.test"), env)).status,
    403,
  );
  assert.equal(
    (await worker.fetch(req({ ...body, config: { ...DEFAULT, p: 100 } }), env))
      .status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        req({ ...body, metrics: { ...body.metrics, cycles: -1 } }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(env.calls(), 0);
});
test("null and oversized chunked bodies are rejected before model invocation", async () => {
  const env = environment();
  assert.equal((await worker.fetch(req(null), env)).status, 400);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(4097)));
      controller.close();
    },
  });
  const request = new Request("https://example.test/api/mentor", {
    method: "POST",
    duplex: "half",
    body: stream,
    headers: {
      Origin: "https://example.test",
      "Content-Type": "application/json",
    },
  });
  assert.equal((await worker.fetch(request, env)).status, 413);
  assert.equal(env.calls(), 0);
});
test("worker validates proposals and enforces visitor budget before model invocation", async () => {
  const env = environment();
  for (let i = 0; i < 8; i++) {
    const r = await worker.fetch(req(), env);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).config.bw, 16);
  }
  assert.equal((await worker.fetch(req(), env)).status, 429);
  assert.equal(env.calls(), 8);
});
test("database failure prevents model calls", async () => {
  const env = environment();
  env.BUDGET.prepare = () => {
    throw Error("unavailable");
  };
  assert.equal((await worker.fetch(req(), env)).status, 503);
  assert.equal(env.calls(), 0);
});
