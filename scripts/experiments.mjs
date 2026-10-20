import fs from "node:fs/promises";
import crypto from "node:crypto";
import { DEFAULT, workload, MISSIONS } from "../web/engine.js";
import { search } from "../web/search.js";
const seeds = [11, 29, 42, 71, 97],
  budget = 36,
  runs = [];
for (let mission = 0; mission < 3; mission++)
  for (const seed of seeds)
    for (const method of ["surrogate", "random", "heuristic"]) {
      const steps = [
          ...search(workload(mission), {
            budget,
            seed,
            method,
            start: DEFAULT,
          }),
        ],
        best = steps.at(-1).best;
      runs.push({
        mission: MISSIONS[mission].id,
        seed,
        method,
        best: {
          config: best.config,
          objective: best.objective,
          cycles: best.cycles,
          cost: best.cost,
          nrmse: best.nrmse,
          feasible: best.feasible,
        },
        feasibleRate: steps.filter((x) => x.result.feasible).length / budget,
        trace: steps.map((s) => ({
          iteration: s.iteration,
          config: s.result.config,
          objective: s.result.objective,
          best: s.best.objective,
          feasible: s.result.feasible,
        })),
      });
      console.log(
        MISSIONS[mission].id,
        seed,
        method,
        best.objective.toFixed(4),
        best.feasible,
      );
    }
const summary = ["surrogate", "random", "heuristic"].map((method) => {
  const group = runs.filter((x) => x.method === method),
    meanBest = group.reduce((s, x) => s + x.best.objective, 0) / group.length;
  return {
    method,
    runs: group.length,
    meanBest,
    stdBest: Math.sqrt(
      group.reduce((s, x) => s + (x.best.objective - meanBest) ** 2, 0) /
        group.length,
    ),
    feasibleRuns: group.filter((x) => x.best.feasible).length,
    meanFeasibleRate:
      group.reduce((s, x) => s + x.feasibleRate, 0) / group.length,
  };
});
const hash = async (p) =>
  crypto
    .createHash("sha256")
    .update(await fs.readFile(p))
    .digest("hex");
await fs.mkdir("web/evidence", { recursive: true });
await fs.writeFile(
  "web/evidence/experiments.json",
  JSON.stringify(
    {
      schema: 1,
      seeds,
      budget,
      totalEvaluations: runs.length * budget,
      methodology:
        "Same default starting point and budget. RBF surrogate with distance-based exploration, random without replacement, fixed hand-coded heuristic. Synthetic seeded workloads; simulated metrics; no external task accuracy or SOTA claim.",
      engine_sha256: await hash("web/engine.js"),
      search_sha256: await hash("web/search.js"),
      summary,
      runs,
    },
    null,
    2,
  ),
);
console.log(summary);
