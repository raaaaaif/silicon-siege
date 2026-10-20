import fs from "node:fs/promises";
import {
  allConfigs,
  configId,
  DEFAULT,
  workload,
  evaluate,
  rng,
} from "../web/engine.js";
import { search } from "../web/search.js";
const seeds = Array.from({ length: 20 }, (_, i) => 101 + 37 * i),
  budget = 36,
  runs = [],
  oracles = [];
const methods = ["surrogate", "greedy", "random", "heuristic"];
for (let mission = 0; mission < 3; mission++) {
  const w = workload(mission),
    cache = new Map();
  for (const c of allConfigs()) {
    const v = evaluate(c, w);
    cache.set(configId(c), v);
  }
  const optimum = Math.min(...[...cache.values()].map((x) => x.objective));
  oracles.push({
    mission,
    size: cache.size,
    optimum,
    feasible: [...cache.values()].filter((x) => x.feasible).length,
  });
  console.log("Oracle", mission, optimum);
  for (const seed of seeds)
    for (const method of methods) {
      const steps = [
        ...search(w, {
          seed,
          budget,
          method,
          start: DEFAULT,
          evaluator: (c) => cache.get(configId(c)),
        }),
      ];
      const b = steps.at(-1).best;
      const stress = ["bandwidth", "outliers", "shape"].map((attack) => {
        const v = evaluate(b.config, workload(mission, attack));
        return { attack, objective: v.objective, feasible: v.feasible };
      });
      runs.push({
        mission,
        seed,
        method,
        best: b.objective,
        regret: b.objective - optimum,
        feasible: b.feasible,
        config: b.config,
        stress,
        trace: steps.map((x) => x.best.objective),
      });
    }
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const paired = [];
for (const baseline of ["random", "heuristic", "greedy"]) {
  // Resample search seeds, retaining all three kernels together in each cluster.
  const differences = seeds.map((seed) =>
    mean(
      [0, 1, 2].map(
        (mission) =>
          runs.find(
            (r) =>
              r.seed === seed &&
              r.mission === mission &&
              r.method === "surrogate",
          ).regret -
          runs.find(
            (r) =>
              r.seed === seed && r.mission === mission && r.method === baseline,
          ).regret,
      ),
    ),
  );
  const random = rng(6121),
    boot = Array.from({ length: 10000 }, () =>
      mean(
        differences.map(
          () => differences[Math.floor(random() * differences.length)],
        ),
      ),
    ).sort((a, b) => a - b);
  paired.push({
    baseline,
    mean_delta: mean(differences),
    ci95: [boot[249], boot[9749]],
    interpretation:
      "Negative favors surrogate. Seed-cluster bootstrap, conditional on these three fixed synthetic kernels; not generalization to other workloads.",
  });
}
const summary = methods.map((method) => {
  const a = runs.filter((r) => r.method === method);
  return {
    method,
    mean_regret: mean(a.map((r) => r.regret)),
    feasible_runs: a.filter((r) => r.feasible).length,
    runs: a.length,
    stress_passes: a.flatMap((r) => r.stress).filter((x) => x.feasible).length,
    stress_cases: a.length * 3,
  };
});
await fs.mkdir("build/depth", { recursive: true });
await fs.writeFile(
  "build/depth/search-audit.json",
  JSON.stringify(
    {
      schema: 1,
      seeds,
      budget,
      oracles,
      summary,
      paired,
      runs,
      scope:
        "Exhaustive finite reference, 20 paired search seeds, same six warm-up candidates, no-exploration ablation, frozen-design stress transfer. Objective still uses synthetic workloads and a resource proxy; this is algorithm auditing, not physical chip optimization.",
    },
    null,
    2,
  ),
);
console.log(summary, paired);
