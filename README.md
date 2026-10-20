# Silicon Siege

[Open the live lab](https://silicon-siege.pages.dev/) · [Browse the source](https://github.com/raaaaaif/silicon-siege)

An interactive, adversarial accelerator-design lab bridging digital ECE, computer architecture and machine learning. Change a streaming integer GEMM tile, inspect its clock-by-clock behavior, search a constrained design space, and challenge the result with bandwidth starvation, outliers, ragged shapes and overflow. A restrained pixel-art circuit island makes the mechanics approachable; experiments and downloadable hardware evidence are the core of the project.

## Run locally

Requires Node 22+ and Python 3 for the independent-oracle test. No npm dependencies, build step, Docker, or EDA installation is required locally.

```sh
npm run dev       # http://127.0.0.1:4173
npm test          # model, cross-language oracle and API quota contracts
npm run experiments  # reproduce the 1,620-evaluation benchmark
```

Cloud mentor calls are disabled on the local static server. Simulation, adaptive search, adversarial cases, evidence, export and share all work without inference credentials. Local development was performed with less than 0.6 GB free disk; large EDA toolchains ran only on GitHub-hosted runners.

## Engineering substance

- **Digital ECE:** parameterized signed 2×2 / 4×4 / 8×8 streaming outer-product RTL, INT4/INT8 operands, 16/24/32-bit modular accumulators, optional product register, bubbles, reset and ready/valid backpressure.
- **Architecture:** exact tile control plus an explicitly separate host/cache/transfer model. Inspect MAC activity, memory stalls, utilization, tile ordering and accumulator contents. Cell area comes from a 36-configuration Yosys/Nangate45 synthesis sweep; the resource budget is a transparent proxy.
- **ML:** seeded floating-point versus quantized GEMM, per-tensor/per-output-channel scaling, overflow detection, adaptive RBF surrogate exploration, and equal-budget random/heuristic baselines. Cloudflare Workers AI chooses a typed design strategy and optional architecture; numeric explanations come from checked observations, and every proposal is evaluated locally before application.
- **Verification:** 36 RTL configurations × 48 tiles, 49,344 checked edges, the same independent Python stimulus replayed against the browser core, two detected intentional defects, and 20-cycle bounded formal control checks on one small configuration.
- **Physical design:** a representative 4×4 INT8 ACC24 registered tile through OpenROAD placement, clock-tree synthesis, detailed routing and GDS. Exact timing, physical metrics, layout and run provenance are published in `web/evidence/`.

The app contains three briefs, a live array inspector, two visual modes, timeline playback/scrubbing, a numerical error map, an adversary, a proposal/apply loop, a clickable Pareto plot, multi-method experiments, a guided walkthrough, local persistence, design links and JSON experiment export. Gamification is limited to meaningful design constraints and earned brief completion.

## Evidence, scope and research

Read [research and stress tests](docs/RESEARCH.md), [architecture and contracts](docs/ARCHITECTURE.md), and [asset provenance](docs/ASSETS.md). Every reported evidence level is distinguished in the interface.

The published 5-seed, 3-workload benchmark does **not** show universal surrogate superiority: the fixed heuristic has the best mean final objective, and adaptive search outperforms random on average. Complete measurements, including unfavorable results, are downloadable.

These are synthetic numerical kernels, not a trained model's classification accuracy. The SRAM, host and external memory are modeled, not included in RTL physical area. Nangate45 is an academic platform; results are not foundry signoff, measured power or fabricated silicon. Bounded control checks are not a proof of arbitrary RTL or an entire SoC. This is a reproducible engineering project, not a claim to have surpassed state-of-the-art EDA research.

## Reproduce hardware evidence

Repository Actions include **Hardware evidence**, **Physical design evidence**, and **Browser model and API contract**. Hardware tools run remotely. The physical flow pins its official OpenROAD container digest; reports record RTL/library hashes and source commits. The synthesis workflow records tool versions and the library hash.

```sh
gh workflow run hardware.yml
gh workflow run physical.yml
# After downloading the physical-evidence artifact:
python3 scripts/import-evidence.py PATH_TO_ARTIFACT RUN_URL
```

## Deploy to Cloudflare

Upload the contents of `web/` as a Pages direct-upload ZIP. It includes advanced-mode `_worker.js`, static assets, evidence and security headers. `_routes.json` invokes the Worker only for `/api/*`.

Bind Workers AI as `AI` and a dedicated D1 database as `BUDGET`, then redeploy. The table initializes automatically. The mentor fails closed without both bindings or when storage/inference fails. Atomic database counters limit calls to eight per IP/day and 64 globally/day. Only a daily IP hash and counters are stored; fixed question intents and bounded design metrics are sent to Workers AI. Local tools remain available after quota exhaustion. No public EDA job dispatch, keys in client code, or paid plan upgrade is required.

Source layout: `web/` interface/model/Worker; `rtl/` hardware and constraints; `scripts/` reproducibility tools; `tests/` independent correctness and quota tests; `docs/` methodology. Original supplied prototypes are preserved locally in `original/` and excluded from deployment.
