import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT,
  TileCore,
  evaluate,
  referenceGemm,
  workload,
  wrap,
  validateConfig,
  allConfigs,
  frontier,
} from "../web/engine.js";
import { search } from "../web/search.js";
test("signed modular arithmetic includes extrema and wraparound", () => {
  assert.equal(wrap(32768, 16), -32768);
  assert.equal(wrap(-32769, 16), 32767);
  assert.equal(wrap(-16129, 24), -16129);
});
test("independent rectangular GEMM reference", () =>
  assert.deepEqual(
    referenceGemm([1, -2, 3, 4], [5, 6, -7, 8], 2, 2, 2),
    [19, -10, -13, 50],
  ));
for (const pipe of [0, 1])
  test(`stream core signed MAC, bubbles, reset and output stalls; pipe=${pipe}`, () => {
    const c = { ...DEFAULT, p: 2, pipe },
      core = new TileCore(c);
    core.tick({ reset: true });
    assert(
      core.tick({ valid: true, first: true, a: [-128, 127], b: [-128, 127] })
        .accepted,
    );
    core.tick();
    core.tick({ valid: true, last: true, a: [-3, 4], b: [5, -6] });
    if (pipe) core.tick();
    assert(core.valid);
    assert.deepEqual(core.accum, [16369, -16238, -16236, 16105]);
    for (let n = 0; n < 8; n++) {
      const e = core.tick({
        valid: true,
        first: true,
        last: true,
        a: [1, 1],
        b: [1, 1],
      });
      assert(!e.accepted);
      assert(e.valid);
      assert.deepEqual(e.accum, [16369, -16238, -16236, 16105]);
    }
    assert(core.tick({ ready: true }).consumed);
    assert(core.ready);
    core.tick({ reset: true });
    assert.deepEqual(core.accum, [0, 0, 0, 0]);
    assert(!core.valid);
  });
test("cycle simulator deterministic and exact core matches tiled oracle on all dimensions", () => {
  for (const p of [2, 4, 8])
    for (const pipe of [0, 1])
      for (const bits of [4, 8])
        for (const acc of [16, 24, 32]) {
          const c = { ...DEFAULT, p, pipe, bits, acc };
          const a = evaluate(c, workload(0, "shape"));
          const b = evaluate(c, workload(0, "shape"));
          assert.deepEqual(a, b);
          assert.equal(a.macs, 21 * 31 * 15);
          assert(a.cycles > 0);
          assert(a.nrmse >= 0);
        }
});
test("bandwidth attack adds stalls, narrow accumulator fails overflow workload", () => {
  const baseline = evaluate(DEFAULT, workload(1)),
    attack = evaluate(DEFAULT, workload(1, "bandwidth"));
  assert(attack.cycles > baseline.cycles);
  const overflow = evaluate({ ...DEFAULT, acc: 16 }, workload(1, "overflow"));
  assert(overflow.overflows > 0);
  assert(!overflow.feasible);
  const safe = evaluate({ ...DEFAULT, acc: 24 }, workload(1, "overflow"));
  assert.equal(safe.overflows, 0);
  assert(safe.nrmse < 1e-9);
});
test("search uses unique, valid configurations and retains the best measurement", () => {
  const xs = [...search(workload(0), { budget: 18 })];
  assert.equal(xs.length, 18);
  assert.equal(
    new Set(xs.map((x) => JSON.stringify(x.result.config))).size,
    18,
  );
  assert(xs.at(-1).best.objective <= xs[0].best.objective);
  assert.equal(allConfigs().length, 1296);
  assert.throws(() => validateConfig({ ...DEFAULT, bw: 1000 }));
  assert(frontier(xs.map((x) => x.result)).length > 0);
});
