// Deployable integer inference; independent from the NumPy training/reference path.
export const roundHalfUp = (x) => Math.floor(x + 0.5);
export function modular(x, width) {
  const mod = 2 ** width;
  return ((((x + mod / 2) % mod) + mod) % mod) - mod / 2;
}
export function inferDigit(pixels, model, acc = 24) {
  if (
    pixels.length !== 64 ||
    pixels.some((x) => !Number.isFinite(x) || x < 0 || x > 16)
  )
    throw Error("Expected 64 pixels in [0,16]");
  if (![16, 24, 32].includes(acc)) throw Error("Invalid accumulator");
  const qmax = 2 ** (model.bits - 1) - 1;
  let a = pixels.map((x) =>
    Math.max(-qmax, Math.min(qmax, roundHalfUp(x / 16 / model.input_scale))),
  );
  const stages = [];
  let overflows = 0,
    clips = 0;
  for (const [index, layer] of model.layers.entries()) {
    const raw = layer.bias.map((_, j) =>
      a.reduce((s, x, k) => s + x * layer.w[k][j], 0),
    );
    const biased = raw.map((x, j) => x + layer.bias[j]);
    overflows += biased.filter(
      (x) => x < -(2 ** (acc - 1)) || x >= 2 ** (acc - 1),
    ).length;
    const accum = biased.map((x) => modular(x, acc));
    const scaled = accum.map((x, j) =>
      Math.floor(
        (x * layer.mult[j] + 2 ** (model.shift - 1)) / 2 ** model.shift,
      ),
    );
    stages.push({
      input: [...a],
      matmul: raw.map((x) => modular(x, acc)),
      accum,
      scaled,
    });
    if (!index) {
      clips = scaled.filter((x) => x > qmax).length;
      a = scaled.map((x) => Math.max(0, Math.min(qmax, x)));
    }
  }
  const logits = stages.at(-1).scaled;
  const prediction = logits.indexOf(Math.max(...logits));
  return { prediction, logits, stages, overflows, clips };
}
// Closed-form architectural contract independently checked against every RTL run.
// Counts after command acceptance, through last result acceptance. Host preload excluded.
export function systemCycles({ m, n, k, p, pipe, prefetch, stalls = 0 }) {
  if (
    ![2, 4].includes(p) ||
    ![0, 1].includes(pipe) ||
    ![0, 1].includes(prefetch) ||
    ![m, n, k, stalls].every(Number.isInteger) ||
    m < 1 ||
    m > 8 ||
    n < 1 ||
    n > 32 ||
    k < 1 ||
    k > 64 ||
    stalls < 0
  )
    throw Error("Invalid system descriptor");
  const tiles = Math.ceil(m / p) * Math.ceil(n / p),
    reads = tiles * (prefetch ? 1 : k);
  return {
    tiles,
    reads,
    beats: tiles * k,
    drain: tiles * (pipe + 1),
    emit: tiles * p * p,
    cycles: reads + tiles * (k + pipe + 1 + p * p) + stalls,
    preload: m * k + k * n,
    usefulMACs: m * n * k,
    paddedMACs: tiles * k * p * p,
  };
}
// Exact constrained enumeration of the small verified subsystem space.
// Selection uses validation accuracy only; held-out test outcomes cannot influence it.
export function selectArchitecture(
  data,
  system,
  synthesis,
  { minimumAccuracy = 0.95, maximumTileArea = 6000 } = {},
) {
  if (
    !Number.isFinite(minimumAccuracy) ||
    minimumAccuracy < 0 ||
    minimumAccuracy > 1 ||
    !Number.isFinite(maximumTileArea) ||
    maximumTileArea <= 0
  )
    throw Error("Invalid design constraints");
  const candidates = [];
  for (const hardware of system.rows)
    for (const channel of [false, true]) {
      const accuracy = data.results.find(
        (r) =>
          r.bits === hardware.bits &&
          r.acc === hardware.acc &&
          r.channel === channel,
      ).validation_accuracy;
      const area = synthesis.candidates.find((s) =>
        ["p", "bits", "acc", "pipe"].every((k) => s[k] === hardware[k]),
      ).area_um2;
      const cycles = [
        { m: 4, n: 32, k: 64 },
        { m: 4, n: 10, k: 32 },
      ].reduce(
        (s, shape) => s + systemCycles({ ...hardware, ...shape }).cycles,
        0,
      );
      candidates.push({
        config: Object.fromEntries(
          ["p", "bits", "acc", "pipe", "prefetch"]
            .map((k) => [k, hardware[k]])
            .concat([["channel", channel]]),
        ),
        validationAccuracy: accuracy,
        tileArea: area,
        cycles,
        feasible: accuracy >= minimumAccuracy && area <= maximumTileArea,
      });
    }
  const feasible = candidates
    .filter((x) => x.feasible)
    .sort(
      (a, b) =>
        a.cycles - b.cycles ||
        a.tileArea - b.tileArea ||
        b.validationAccuracy - a.validationAccuracy,
    );
  return {
    evaluated: candidates.length,
    feasible: feasible.length,
    best: feasible[0] || null,
    candidates,
  };
}
