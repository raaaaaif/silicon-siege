# Browser model and API contracts

This document describes the Workbench model. The System lab has a separate banked-memory controller and trained classifier, documented in [system architecture and measurements](MEASUREMENTS.md).

## Runtime

The browser executes plain ES modules with no package dependencies or build step. `engine.js` owns exact quantization, integer GEMM, the clocked tile controller and the system memory model. `search.js` owns a deterministic surrogate-guided search. `app.js` renders controls, trace replay, campaign state, proposals, fair experiments and evidence.

Cloudflare Pages serves assets directly. Only `/api/*` invokes `_worker.js`. The mentor uses Workers AI `@cf/qwen/qwen3-30b-a3b-fp8`, a catalog model checked against [official model documentation](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/). D1 `BUDGET` uses conditional atomic increments to cap model calls at 64/day globally and 8/day per hashed source IP. The cap is checked before inference; database errors fail closed. An unsuccessful inference still consumes an attempt. No arbitrary prompts, HDL, code execution or GitHub workflow dispatch is exposed. Fixed question intents and finite design domains bound the API input. The model selects a typed strategy and optional configuration. Free-form model prose is never rendered: rationale templates and numerical statements are derived from bounded observations. This boundary was added after live testing caught a false accumulator explanation. Returned configurations are validated on both server and client and independently evaluated before application.

Only a daily hash of the source IP and request counters are persisted in D1. Raw IPs and prompts are not stored by this application. Old budget keys are removed after three days. Inference context goes to Cloudflare Workers AI. Browser-local saved progress and experiment history are not uploaded. Origin checks reduce browser abuse; they are not authentication. Network-level callers can forge Origin, but the atomic global quota remains the spending boundary. The deployment uses Cloudflare Pages, Workers AI and D1; credentials are not included in client code.

## RTL contract

`siege_tile` has P×P MAC lanes. Every accepted input beat broadcasts P activations and P weights to form an outer product. `in_first` initializes the partial sums and adds the first product in one cycle. `in_last` closes the tile. `PIPE=1` registers products, preserves an initiation interval of one, and adds a one-cycle drain. A completed output is stable while `out_valid && !out_ready`. Synchronous reset clears all validity and accumulator state.

The host must label the first and last accepted beats of each tile. It may insert arbitrary bubbles and stall output. No input is accepted while a tile is closing or a result awaits acknowledgement. Accumulators wrap modulo 2^ACC. The oracle implements this exact behavior, while the application separately detects mathematical overflow and rejects such designs for the brief. A real software host would zero-pad ragged tile boundaries and perform quantization/dequantization. No RISC-V CPU, DMA, SRAM macro or complete SoC is included.

## Numerical model

Synthetic A and B come from a seeded PRNG. Quantization uses symmetric signed INT4/INT8 with qmax=2^(bits−1)−1. A uses one scale; B uses one scale or a scale per output column. Float reference C=A×B is computed independently of the clock controller. Integer outputs are dequantized with scale_A×scale_B[column]. NRMSE is sqrt(sum(error²)/sum(reference²)) × 100%. It is not a trained-model quality metric. Calibration uses the same generated tensors; it should not be described as independent calibration.

## Memory and scheduling

The system model maintains 16-byte lines and LRU replacement. For each reduction beat it computes distinct A/B line accesses, evicts when capacity is exceeded, and blocks the producer for ceil(missed_bytes / link_width) clocks. It then sends one vector beat to the core. At the end it drains the pipeline and models output transfer while holding ready low, then acknowledges. One reset edge is counted per tile. This is conservative serial scheduling without prefetch or double buffering. “Reuse weights” and “reuse inputs” are tile traversal choices, not alternative RTL dataflows.

Nibbles are packed in the traffic model. This is an abstract bandwidth assumption, not a synthesized packing unit. Cached activation/weight lines persist across output tiles; output traffic bypasses that read cache. No cache coherency, bank conflicts, DRAM burst timing, clock-domain crossing, interconnect contention or OS overhead is modeled.

## Evidence hierarchy

1. Browser numerical and cycle outputs: deterministic model results.
2. Python/JS parity: all 36 controller configurations checked against independent Python vectors.
3. Icarus/Python parity: 36 RTL configurations, 48 transactions each, every edge checked, reset mid-transaction, signed extrema and randomized stalls.
4. Mutation testing: unsigned multiplication and dropped-valid-under-stall are independently detected.
5. Yosys SAT: bounded local reset/stall control properties, 20 edges, one 2×2 INT4 ACC16 registered configuration. No claim of unbounded functional proof.
6. Yosys + Nangate45: 36 mapped standard-cell areas. Host/memory/IO/routing excluded.
7. OpenROAD: 4×4 INT8 ACC24 registered tile, full physical flow, 100 MHz target, explicit IO and uncertainty constraints. Academic technology, not silicon measurement. Raw reports preserved.

Analytical resource cost, mapped cell area and routed cell area are separate quantities. The application reports no power measurement or energy score.

## Reproducibility

`npm test` runs dependency-free Node tests and Python-oracle parity. `npm run experiments` regenerates the 1,620-evaluation benchmark. GitHub workflows run EDA remotely. The physical tool image is pinned by digest. Reports retain RTL/library/netlist hashes, seeds, source commits and tool versions. `scripts/import-evidence.py` imports a completed physical artifact without inventing values. Public artifacts are served under `web/evidence/`; the source repository retains the full reproducible methodology.

Cloudflare JSON mode can return an already-decoded object; the adapter accepts that form as well as string and OpenAI-compatible choices. Invalid output fails closed into local analysis. See [JSON Mode documentation](https://developers.cloudflare.com/workers-ai/features/json-mode/).
