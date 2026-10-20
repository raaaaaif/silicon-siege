import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { selectArchitecture } from "../web/deployment.js";
const read = (name) =>
  JSON.parse(
    fs.readFileSync(new URL(`../web/evidence/${name}.json`, import.meta.url)),
  );
test("Co-design uses validation only, enforces both constraints, and returns the exact finite optimum", () => {
  const data = read("digits"),
    system = read("system"),
    synthesis = read("synthesis");
  const result = selectArchitecture(data, system, synthesis);
  assert.equal(result.evaluated, 96);
  assert(result.best);
  assert(result.best.validationAccuracy >= 0.95);
  assert(result.best.tileArea <= 6000);
  assert(
    result.candidates
      .filter((x) => x.feasible)
      .every((x) => x.cycles >= result.best.cycles),
  );
  const original = result.best;
  // Delete all held-out outcomes: selection must be identical and still work.
  delete data.test;
  delete data.float_accuracy;
  for (const row of data.results) {
    delete row.accuracy;
    delete row.predictions;
    delete row.overflow_outputs;
    delete row.confusion;
  }
  assert.deepEqual(selectArchitecture(data, system, synthesis).best, original);
  assert.equal(
    selectArchitecture(data, system, synthesis, {
      minimumAccuracy: 1,
      maximumTileArea: 1,
    }).best,
    null,
  );
  assert.throws(() =>
    selectArchitecture(data, system, synthesis, { minimumAccuracy: NaN }),
  );
});
