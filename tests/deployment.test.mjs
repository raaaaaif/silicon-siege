import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  inferDigit,
  modular,
  roundHalfUp,
  systemCycles,
} from "../web/deployment.js";
const data = JSON.parse(
  fs.readFileSync(new URL("../web/evidence/digits.json", import.meta.url)),
);
const fixtures = JSON.parse(
  fs.readFileSync(new URL("../web/evidence/ml-vectors.json", import.meta.url)),
);
test("Every held-out integer prediction matches independent NumPy reference across all 12 configurations", () => {
  for (const result of data.results) {
    const model = data.models.find(
      (x) => x.bits === result.bits && x.channel === result.channel,
    );
    let overflows = 0,
      clips = 0;
    const confusion = Array.from({ length: 10 }, () => Array(10).fill(0));
    for (let i = 0; i < data.test.x.length; i++) {
      const x = inferDigit(data.test.x[i], model, result.acc);
      assert.equal(
        x.prediction,
        result.predictions[i],
        `sample ${i}, bits ${result.bits}, channel ${result.channel}, acc ${result.acc}`,
      );
      overflows += x.overflows;
      clips += x.clips;
      confusion[data.test.y[i]][x.prediction]++;
      if (i < 4)
        for (let layer = 0; layer < 2; layer++) {
          const f = fixtures.find(
            (f) =>
              f.id ===
              `b${result.bits}-c${+result.channel}-a${result.acc}-l${layer}`,
          );
          assert.deepEqual(x.stages[layer].input, f.A[i]);
          assert.deepEqual(x.stages[layer].matmul, f.C[i]);
        }
    }
    assert.equal(overflows, result.overflow_outputs);
    assert.equal(clips, result.hidden_clips);
    assert.deepEqual(confusion, result.confusion);
  }
});
test("Fit/calibration/validation are disjoint and cover only official training split", () => {
  const all = [
    ...data.split.fit_ids,
    ...data.split.calibration_ids,
    ...data.split.validation_ids,
  ];
  assert.equal(all.length, 3823);
  assert.equal(new Set(all).size, 3823);
  assert(all.every((x) => x >= 0 && x < 3823));
  assert.equal(data.test.x.length, 1797);
});
test("Rounding, negative modular overflow, and invalid input contracts are explicit", () => {
  assert.equal(roundHalfUp(-1.5), -1);
  assert.equal(modular(32768, 16), -32768);
  assert.equal(modular(-32769, 16), 32767);
  assert.throws(() => inferDigit([0], data.models[0]));
  assert.throws(() => inferDigit(Array(64).fill(NaN), data.models[0]));
  assert.throws(() =>
    systemCycles({ m: 0, n: 1, k: 1, p: 4, pipe: 1, prefetch: 1 }),
  );
});
test("Architectural accounting separates host load, read bubbles and useful work", () => {
  const a = systemCycles({ m: 4, n: 32, k: 64, p: 4, pipe: 1, prefetch: 1 });
  const b = systemCycles({ m: 4, n: 32, k: 64, p: 4, pipe: 1, prefetch: 0 });
  assert.equal(a.preload, 2304);
  assert.equal(a.cycles, 664);
  assert.equal(b.cycles - a.cycles, 504);
  assert.equal(a.usefulMACs, 8192);
});
// Published measured evidence is intentionally mandatory, so missing artifacts fail CI.
test("Every RTL performance counter matches the independently authored browser equation", () => {
  const report = JSON.parse(
    fs.readFileSync(new URL("../web/evidence/system.json", import.meta.url)),
  );
  assert.equal(report.configurations, 48);
  assert.equal(report.cases, 384);
  for (const hardware of report.rows)
    for (const c of hardware.cases) {
      const x = systemCycles({ ...hardware, ...c, stalls: c.output_stalls });
      assert.equal(x.cycles, c.cycles);
      assert.equal(x.beats, c.mac_beats);
      assert.equal(x.reads, c.read_cycles);
    }
  assert.equal(report.mutations.length, 2);
  assert(report.mutations.every((x) => x.detected));
});
