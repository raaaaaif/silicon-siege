// Deterministic, dependency-free hardware/software co-design model.
// Exact integer math and cycle-step streaming-tile semantics; explicit memory model.
export const VERSION = "1.0.0";
export const DEFAULT = {
  p: 4,
  bits: 8,
  acc: 24,
  pipe: 1,
  buffer: 256,
  bw: 8,
  reuse: "weights",
  quant: "channel",
};
export const DOMAINS = {
  p: [2, 4, 8],
  bits: [4, 8],
  acc: [16, 24, 32],
  pipe: [0, 1],
  buffer: [64, 256, 1024],
  bw: [4, 8, 16],
  reuse: ["weights", "inputs"],
  quant: ["tensor", "channel"],
};
export const MISSIONS = [
  {
    id: "vision",
    name: "The quiet camera",
    subtitle: "EDGE VISION",
    shape: [16, 24, 12],
    seed: 1701,
    description:
      "Give a battery-powered wildlife camera enough compute to recognize a visitor before it disappears.",
    brief:
      "Balance a small resource budget with low quantization error. More compute is only useful if you can feed it.",
    cycles: 1600,
    cost: 4600,
    error: 3,
    attack: "bandwidth",
    lesson: "Data movement can dominate arithmetic.",
  },
  {
    id: "audio",
    name: "A voice in the noise",
    subtitle: "ALWAYS-ON AUDIO",
    shape: [8, 64, 16],
    seed: 2701,
    description:
      "Keep a tiny voice detector responsive when its input suddenly gets louder.",
    brief:
      "Low precision saves resources, but outliers and narrow accumulators can break a seemingly good design.",
    cycles: 2200,
    cost: 5200,
    error: 2,
    attack: "outliers",
    lesson: "Numerical correctness and model fidelity are different questions.",
  },
  {
    id: "attention",
    name: "The long conversation",
    subtitle: "ATTENTION KERNEL",
    shape: [24, 48, 24],
    seed: 3701,
    description:
      "Serve a longer attention-like GEMM without letting memory traffic stall the entire array.",
    brief:
      "Explore tile order, storage and bandwidth together. This is a synthetic kernel, not a complete language model.",
    cycles: 3400,
    cost: 8500,
    error: 2,
    attack: "shape",
    lesson: "The best architecture depends on the workload.",
  },
];
export function validateConfig(c) {
  const out = {};
  for (const [k, values] of Object.entries(DOMAINS)) {
    if (!values.includes(c?.[k])) throw Error(`Invalid ${k}`);
    out[k] = c[k];
  }
  return out;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const wrap = (x, bits) => {
  const mod = 2 ** bits;
  return ((((x + mod / 2) % mod) + mod) % mod) - mod / 2;
};
export function workload(mission = 0, attack = "none", seedOffset = 0) {
  const m = MISSIONS[mission];
  let [M, K, N] = m.shape;
  if (attack === "shape") {
    M += 5;
    N += 3;
    K += 7;
  }
  const seed = m.seed + seedOffset,
    random = rng(seed);
  const A = Array.from(
    { length: M * K },
    () => (random() + random() + random() - 1.5) * 1.8,
  );
  const B = Array.from(
    { length: K * N },
    (_, i) => (random() + random() - 1) * (0.3 + (i % N) / N),
  );
  if (attack === "outliers") for (let i = 0; i < A.length; i += 29) A[i] *= 14;
  if (attack === "overflow") {
    A.fill(-1);
    B.fill(-1);
    K = K;
  }
  return { M, K, N, A, B, seed, attack, mission };
}
export function quantize(w, c) {
  const max = (xs) => Math.max(1e-12, ...xs.map(Math.abs));
  const qmax = 2 ** (c.bits - 1) - 1;
  const sa = max(w.A) / qmax;
  const sb = Array.from(
    { length: w.N },
    (_, col) =>
      max(
        c.quant === "channel"
          ? Array.from({ length: w.K }, (_, k) => w.B[k * w.N + col])
          : w.B,
      ) / qmax,
  );
  const qa = w.A.map((x) =>
    Math.max(-qmax, Math.min(qmax, Math.round(x / sa))),
  );
  const qb = w.B.map((x, i) =>
    Math.max(-qmax, Math.min(qmax, Math.round(x / sb[i % w.N]))),
  );
  return { qa, qb, sa, sb };
}
export function referenceGemm(A, B, M, K, N) {
  const out = Array(M * N).fill(0);
  for (let r = 0; r < M; r++)
    for (let col = 0; col < N; col++)
      for (let k = 0; k < K; k++)
        out[r * N + col] += A[r * K + k] * B[k * N + col];
  return out;
}
// One edge of the same handshaked core implemented in rtl/siege_tile.v.
export class TileCore {
  constructor(c) {
    this.c = c;
    this.accum = Array(c.p * c.p).fill(0);
    this.closing = false;
    this.valid = false;
    this.pending = null;
    this.cycle = 0;
  }
  get ready() {
    return !this.closing && !this.valid;
  }
  tick({
    reset = false,
    valid = false,
    first = false,
    last = false,
    a = [],
    b = [],
    ready = false,
  } = {}) {
    const accepted = valid && this.ready && !reset,
      consumed = this.valid && ready && !reset,
      before = [...this.accum];
    if (reset) {
      this.accum.fill(0);
      this.closing = false;
      this.valid = false;
      this.pending = null;
    } else {
      if (consumed) {
        this.valid = false;
        this.closing = false;
      }
      if (accepted && last) this.closing = true;
      const op = accepted
        ? { first, last, products: a.flatMap((x) => b.map((y) => x * y)) }
        : null;
      const commit = this.c.pipe ? this.pending : op;
      this.pending = this.c.pipe ? op : null;
      if (commit) {
        this.accum = this.accum.map((x, i) =>
          wrap((commit.first ? 0 : x) + commit.products[i], this.c.acc),
        );
        if (commit.last) this.valid = true;
      }
    }
    this.cycle++;
    return {
      cycle: this.cycle,
      accepted,
      consumed,
      ready: this.ready,
      valid: this.valid,
      accum: [...this.accum],
      before,
    };
  }
}
export function resourceCost(c) {
  return Math.round(
    c.p * c.p * (c.bits * c.bits + 2 * c.acc + c.pipe * 2 * c.bits) +
      c.buffer * 0.7 +
      c.bw * 35,
  );
}
export function evaluate(c, input, { trace = false } = {}) {
  validateConfig(c);
  const w = input,
    { M, K, N } = w,
    { qa, qb, sa, sb } = quantize(w, c);
  const fp = referenceGemm(w.A, w.B, M, K, N),
    ints = Array(M * N).fill(0),
    decoded = Array(M * N).fill(0);
  let cycles = 0,
    bytes = 0,
    macs = 0,
    overflows = 0,
    misses = 0,
    hits = 0,
    computeCycles = 0;
  const events = [];
  const cache = new Map();
  const maxLines = Math.max(1, Math.floor(c.buffer / 16));
  const bw = w.attack === "bandwidth" ? Math.max(1, c.bw / 4) : c.bw;
  const access = (tags) => {
    let loaded = 0;
    for (const tag of new Set(tags)) {
      if (cache.has(tag)) {
        hits++;
        cache.delete(tag);
      } else {
        misses++;
        loaded += 16;
        if (cache.size >= maxLines) cache.delete(cache.keys().next().value);
      }
      cache.set(tag, 1);
    }
    return loaded;
  };
  const tiles = [];
  for (let r = 0; r < M; r += c.p)
    for (let col = 0; col < N; col += c.p) tiles.push([r, col]);
  if (c.reuse === "weights") tiles.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (let ti = 0; ti < tiles.length; ti++) {
    const [r, col] = tiles[ti],
      core = new TileCore(c);
    core.tick({ reset: true });
    cycles++;
    for (let k = 0; k < K; k++) {
      const aa = Array.from({ length: c.p }, (_, i) =>
          r + i < M ? qa[(r + i) * K + k] : 0,
        ),
        bb = Array.from({ length: c.p }, (_, i) =>
          col + i < N ? qb[k * N + col + i] : 0,
        );
      const tags = [];
      for (let i = 0; i < c.p; i++) {
        if (r + i < M)
          tags.push(`a${Math.floor((((r + i) * K + k) * c.bits) / 8 / 16)}`);
        if (col + i < N)
          tags.push(`b${Math.floor(((k * N + col + i) * c.bits) / 8 / 16)}`);
      }
      const loaded = access(tags),
        delay = Math.ceil(loaded / bw);
      bytes += loaded;
      if (delay) {
        for (let t = 0; t < delay; t++) core.tick();
        cycles += delay;
        if (trace && ti === 0)
          events.push({
            cycle: cycles,
            phase: "memory",
            duration: delay,
            bytes: loaded,
            k,
            tile: ti,
            accum: [...core.accum],
            detail: `Fetch ${loaded} B across a ${bw} B/cycle link.`,
          });
      }
      const edge = core.tick({
        valid: true,
        first: k === 0,
        last: k === K - 1,
        a: aa,
        b: bb,
      });
      cycles++;
      computeCycles++;
      if (trace && ti === 0)
        events.push({
          ...edge,
          cycle: cycles,
          phase: "mac",
          k,
          tile: ti,
          a: aa,
          b: bb,
          detail: `${c.p * c.p} lanes: A[:,${k}] × B[${k},:] → partial sums.`,
        });
      for (let i = 0; i < c.p; i++)
        for (let j = 0; j < c.p; j++)
          if (r + i < M && col + j < N) {
            const index = (r + i) * N + col + j;
            const next = ints[index] + aa[i] * bb[j];
            if (next >= 2 ** (c.acc - 1) || next < -(2 ** (c.acc - 1)))
              overflows++;
            ints[index] = wrap(next, c.acc);
            macs++;
          }
    }
    if (c.pipe) {
      core.tick();
      cycles++;
      if (trace && ti === 0)
        events.push({
          cycle: cycles,
          phase: "drain",
          k: K,
          tile: ti,
          accum: [...core.accum],
          detail: "Drain the product register into the accumulators.",
        });
    }
    const outputBytes =
      (Math.min(c.p, M - r) * Math.min(c.p, N - col) * c.acc) / 8;
    const outputCycles = Math.ceil(outputBytes / bw);
    bytes += outputBytes;
    for (let t = 0; t < outputCycles; t++) core.tick({ ready: false });
    cycles += outputCycles;
    if (trace && ti === 0)
      events.push({
        cycle: cycles,
        phase: "hold",
        duration: outputCycles,
        k: K,
        tile: ti,
        accum: [...core.accum],
        detail:
          "Result remains stable while the consumer applies backpressure.",
      });
    const edge = core.tick({ ready: true });
    cycles++;
    if (trace && ti === 0)
      events.push({
        ...edge,
        cycle: cycles,
        phase: "output",
        k: K,
        tile: ti,
        detail: "valid ∧ ready: transfer the completed output tile.",
      });
    for (let i = 0; i < c.p; i++)
      for (let j = 0; j < c.p; j++)
        if (r + i < M && col + j < N) {
          const idx = (r + i) * N + col + j;
          if (core.accum[i * c.p + j] !== ints[idx])
            throw Error("Core/reference disagreement");
          decoded[idx] = core.accum[i * c.p + j] * sa * sb[col + j];
        }
  }
  const sum = fp.reduce((s, x) => s + x * x, 0),
    sq = fp.reduce((s, x, i) => s + (x - decoded[i]) ** 2, 0),
    nrmse = 100 * Math.sqrt(sq / Math.max(sum, 1e-12));
  const cost = resourceCost(c),
    mission = MISSIONS[w.mission];
  const ratios = [
    cycles / mission.cycles,
    cost / mission.cost,
    nrmse / mission.error,
  ];
  const feasible = ratios.every((x) => x <= 1) && overflows === 0;
  const objective =
    (0.5 * cycles) / mission.cycles +
    (0.25 * cost) / mission.cost +
    (0.25 * nrmse) / mission.error +
    ratios.reduce((s, x) => s + Math.max(0, x - 1) * 3, 0) +
    (overflows ? 10 : 0);
  return {
    config: { ...c },
    cycles,
    bytes,
    macs,
    computeCycles,
    utilization: macs / (cycles * c.p * c.p),
    occupancy: macs / (computeCycles * c.p * c.p),
    nrmse,
    cost,
    overflows,
    feasible,
    objective,
    score: Math.max(0, Math.round(100 / (1 + objective))),
    hits,
    misses,
    tiles: tiles.length,
    events,
    fp,
    decoded,
    ints,
    shape: [M, K, N],
    seed: w.seed,
    attack: w.attack,
    mission: w.mission,
    bottleneck: overflows
      ? "Accumulator overflow"
      : nrmse > mission.error
        ? "Quantization error"
        : computeCycles / cycles < 0.45
          ? "Memory traffic"
          : "Compute throughput",
  };
}
export function allConfigs() {
  let xs = [{}];
  for (const [k, values] of Object.entries(DOMAINS))
    xs = xs.flatMap((x) => values.map((v) => ({ ...x, [k]: v })));
  return xs;
}
export const configId = (c) =>
  Object.keys(DOMAINS)
    .map((k) => c[k])
    .join("-");
export function frontier(rows) {
  return rows.filter(
    (x) =>
      !rows.some(
        (y) =>
          y !== x &&
          y.cycles <= x.cycles &&
          y.cost <= x.cost &&
          y.nrmse <= x.nrmse &&
          (y.cycles < x.cycles || y.cost < x.cost || y.nrmse < x.nrmse),
      ),
  );
}
export function adversary(c, mission) {
  return ["bandwidth", "outliers", "shape", "overflow"]
    .map((attack) => evaluate(c, workload(mission, attack)))
    .sort((a, b) => b.objective - a.objective)[0];
}
export function describeDelta(before, after) {
  const changes = Object.keys(DOMAINS)
    .filter((k) => before.config[k] !== after.config[k])
    .map((k) => `${k}: ${before.config[k]} → ${after.config[k]}`);
  return {
    changes,
    cycles: (100 * (before.cycles - after.cycles)) / before.cycles,
    error: after.nrmse - before.nrmse,
    cost: after.cost - before.cost,
  };
}
