# Silicon Siege

[Open the live lab](https://silicon-siege.pages.dev/) · [Browse the source](https://github.com/raaaaaif/silicon-siege)

An interactive, adversarial accelerator-design lab bridging digital ECE, computer architecture and machine learning. Change a streaming integer GEMM tile, inspect its clock-by-clock behavior, search a constrained design space, and challenge the result with bandwidth starvation, outliers, ragged shapes and overflow. A restrained pixel-art circuit island makes the mechanics approachable; experiments and downloadable hardware evidence are the core of the project.

![Live Silicon Siege workbench](docs/screenshots/workbench.jpg)

[Original release validation](docs/VALIDATION.md)

## System lab: from trained model to accelerator RTL

![Live trained-model and hardware inspection](docs/screenshots/system-lab.jpg)

[Open the System lab](https://silicon-siege.pages.dev/#/lab). Edit a real held-out digit, switch precision and accumulator width, inspect exact integer tensors, and compare a serialized versus overlapped operand schedule. A constrained architect enumerates 96 configurations using validation accuracy, measured MAC-tile area and RTL-checked clocks; held-out test labels do not participate in selection.

- **Actual ML:** newly trained 64→32→10 MLP, official UCI writer-separated test set, disjoint fitting/calibration/validation, static INT4/INT8 PTQ, integer bias/ReLU/Q20 requantization, accuracy intervals and confusion matrices. All 21,564 held-out integer predictions match the independent NumPy path.
- **Integrated hardware:** synthesizable command decoder, synchronous operand banks, tiled controller, boundary masks, backpressured indexed output, error completion, reset abort and performance counters. 48 hardware configurations exercise 384 full GEMMs, including both quantized classifier layers. The representative synthesized inferred-memory netlist is replayed through the same scoreboard.
- **Falsifiable evidence:** stale-prefetch and index mutations, additional unbounded single-lane arithmetic refinement, and an exhaustive-reference search audit over 20 paired seeds. The fixed heuristic beats adaptive search on nominal regret; those negative results are published.

The memory subsystem is synthesized and simulated; only the MAC tile has routed physical evidence. This remains an academic accelerator case study, not a fabricated or production-qualified SoC.

## Run locally

Requires Node 22+ and Python 3 for the independent-oracle test. No npm dependencies, build step, Docker, or EDA installation is required locally.

```sh
npm run dev       # http://127.0.0.1:4173
npm test          # model, cross-language oracle and API quota contracts
npm run experiments  # reproduce the original 1,620-evaluation benchmark
node scripts/search-audit.mjs  # 20-seed, exhaustive-reference search audit
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

The original Workbench briefs are synthetic numerical kernels; the separate System lab runs the trained classifier. System-lab operand banks and scheduling are implemented in RTL, but the memories/controller are not included in the compute tile's physical area. External memory and SoC integration remain outside scope. Nangate45 is an academic platform; results are not foundry signoff, measured power or fabricated silicon. The old bounded control checks and new single-lane induction proofs do not prove arbitrary RTL or an entire SoC. This is a reproducible engineering project, not a claim to have surpassed state-of-the-art EDA research.

## Reproduce hardware evidence

Repository Actions include **Hardware evidence**, **Physical design evidence**, and **Browser model and API contract**, **Integrated accelerator and ML evidence**, and **Routed pipeline timing ablation**. Hardware tools run remotely. The physical flow pins its official OpenROAD container digest; reports record RTL/library hashes and source commits. The synthesis workflow records tool versions and the library hash.

```sh
gh workflow run hardware.yml
gh workflow run physical.yml
gh workflow run depth.yml
gh workflow run timing.yml
# After downloading the physical-evidence artifact:
python3 scripts/import-evidence.py PATH_TO_ARTIFACT RUN_URL
```

## Deploy to Cloudflare

Upload the contents of `web/` as a Pages direct-upload ZIP. It includes advanced-mode `_worker.js`, static assets, evidence and security headers. `_routes.json` invokes the Worker only for `/api/*`.

Bind Workers AI as `AI` and a dedicated D1 database as `BUDGET`, then redeploy. The table initializes automatically. The mentor fails closed without both bindings or when storage/inference fails. Atomic database counters limit calls to eight per IP/day and 64 globally/day. Only a daily IP hash and counters are stored; fixed question intents and bounded design metrics are sent to Workers AI. Local tools remain available after quota exhaustion. No public EDA job dispatch, keys in client code, or paid plan upgrade is required.

Source layout: `web/` interface/model/Worker; `rtl/` hardware and constraints; `scripts/` reproducibility tools; `tests/` independent correctness and quota tests; `docs/` methodology. Original supplied prototypes are preserved locally in `original/` and excluded from deployment.
