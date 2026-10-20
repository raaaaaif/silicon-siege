// Sequential surrogate-guided optimization. RBF kernel regression with an
// uncertainty exploration bonus; explicitly not an LLM or exact GP posterior.
import {
  allConfigs,
  configId,
  DOMAINS,
  DEFAULT,
  evaluate,
  rng,
  frontier,
} from "./engine.js";
const space = allConfigs();
export function features(c) {
  return Object.entries(DOMAINS).map(
    ([k, v]) => v.indexOf(c[k]) / (v.length - 1 || 1),
  );
}
export function predict(c, observations) {
  const x = features(c);
  let weights = 0,
    total = 0,
    closest = Infinity;
  for (const o of observations) {
    const y = features(o.config);
    const d = x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0);
    const weight = Math.exp(-d / 0.8);
    weights += weight;
    total += weight * o.objective;
    closest = Math.min(closest, d);
  }
  const mean = weights ? total / weights : 1;
  return {
    mean,
    uncertainty: Math.sqrt(closest === Infinity ? 1 : closest),
    acquisition: mean - 0.45 * Math.sqrt(closest === Infinity ? 1 : closest),
  };
}
export function* search(
  w,
  { budget = 36, seed = 42, method = "surrogate", start = DEFAULT } = {},
) {
  const random = rng(seed),
    remaining = new Map(space.map((c) => [configId(c), c])),
    observations = [];
  for (let i = 0; i < Math.min(budget, space.length); i++) {
    let c,
      pred = null;
    const candidates = [...remaining.values()];
    if (i === 0) c = start;
    else if (method === "random" || i < 6)
      c = candidates[Math.floor(random() * candidates.length)];
    else if (method === "heuristic") {
      // Fixed engineering baseline: wide accumulators, INT8, reuse weights;
      // enumerate resource choices in order. No observed objective used.
      c = candidates.sort((a, b) => heuristic(a) - heuristic(b))[0];
    } else {
      const ranked = candidates
        .map((c) => ({ c, p: predict(c, observations) }))
        .sort((a, b) => a.p.acquisition - b.p.acquisition);
      // Every 5th query explores instead of trusting a weak surrogate.
      c =
        i % 5 === 0
          ? candidates[Math.floor(random() * candidates.length)]
          : ranked[0].c;
      pred = predict(c, observations);
    }
    if (!remaining.has(configId(c))) c = candidates[0];
    remaining.delete(configId(c));
    const result = evaluate(c, w);
    observations.push(result);
    yield {
      iteration: i + 1,
      budget,
      result,
      prediction: pred,
      best: observations.reduce((a, b) => (a.objective < b.objective ? a : b)),
      frontier: frontier(observations),
      observations: [...observations],
    };
  }
}
function heuristic(c) {
  return (
    (c.bits === 8 ? 0 : 100) +
    (c.acc === 24 ? 0 : 20) +
    (c.quant === "channel" ? 0 : 10) +
    (c.reuse === "weights" ? 0 : 5) +
    Math.abs(c.p - 4) +
    Math.abs(c.buffer - 256) / 256 +
    Math.abs(c.bw - 8) / 8 +
    (c.pipe ? 0 : 1)
  );
}
export const SPACE_SIZE = space.length;
