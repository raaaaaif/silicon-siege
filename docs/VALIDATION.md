# Original v1.0 release validation — 20 October 2026

This records the first release. The later System lab adds a trained model and unbounded single-lane refinement; see the published integrated evidence for that scope.

Live site: https://silicon-siege.pages.dev/

## Automated evidence

- 13 Node tests pass, including 49,344 independent Python-to-JavaScript controller comparisons over all 36 hardware configurations.
- [Hardware CI](https://github.com/raaaaaif/silicon-siege/actions/runs/39501333594): 36 RTL configurations pass independent cycle tests; both intentional mutations fail; 20-cycle SAT control checks pass; 36 designs synthesized.
- [Physical CI](https://github.com/raaaaaif/silicon-siege/actions/runs/39501334783): routed GDS produced. Representative tile: 16,303.9 µm² standard-cell area, +6.93734 ns worst setup slack, +0.00896738 ns worst hold slack at the declared 10 ns clock. Zero route DRC, setup, hold, capacitance and slew violations.
- [Application CI](https://github.com/raaaaaif/silicon-siege/actions/runs/39503163785): model and Worker contracts pass on hosted Node 22.
- The first physical run had two capacitance violations. Added repair margins and reran without relaxing the timing constraints; the published run is the repaired result. The CI now gates the electrical/timing counts as well as tool completion.
- Published benchmark: 1,620 evaluations (five seeds × three workloads × three methods × 36 calls). Fixed heuristic mean objective 0.465, adaptive surrogate 0.475, random 0.539. This favors neither a fabricated AI advantage nor a general superiority claim.

## Manual Chrome checks on the real interface

Performed through browser/computer use, on both the local server and the public Cloudflare deployment:

- All three briefs: change controls, search, inspect proposal, apply and evaluate. Observed passing audio design at 1,200 cycles / 0.72% NRMSE and attention design at 2,628 cycles / 0.77%.
- INT4 rejection: numerical error 13.81% exceeds the vision brief's 3% threshold.
- Adversary and repair: bandwidth attack followed by 36-candidate search and a verified 636-cycle / 0.87% NRMSE repair.
- Trace: playback, step, end-position scrub, output-hold/transfer explanation, PE selection, and numerical error inspection.
- Foundry and schematic modes, five-step walkthrough, field guide and live evidence links.
- Design sharing: open the generated link and reproduce INT4 / ACC16 / 256-byte / 4×4 settings and metrics.
- JSON export: downloaded and parsed configuration, workload seed, 36 trace events, synthesis result and RTL hash.
- Public experiment: 108 evaluations completed with the three curves and independently published multi-seed summary.
- Public physical layout loaded at its actual 1100×1100 resolution; raw GDS and evidence JSON match local artifacts.
- Mobile viewport 390×844: visible navigation, no horizontal document overflow, controls work, 8×8 array and PE 7,7 remain selectable. Restored the browser viewport after testing.
- Production cloud mentor: generated an ACC32 proposal; the browser measured 996 cycles / 0.67% NRMSE and reproduced that after application. It was **slower** than the starting design, and the UI disclosed +2.5% latency. Valid and feasible do not mean superior.
- No browser console errors observed in the final live checks.

## Repairs from live testing

The initial small-model explanation falsely blamed a 32-bit accumulator. Free-form model explanations are now discarded. Qwen3 selects a typed strategy and optional legal configuration; bounded observations and curated engineering statements form the displayed rationale. Its proposals are still hypotheses, and the independent evaluator measures their performance. Tests reject invalid strategies/configurations and ensure fabricated model prose cannot appear as a measurement.

Cloudflare JSON mode returned a decoded object, which the first adapter treated as a string. The adapter now accepts decoded objects, string responses and compatible completion envelopes; regression tests cover all three. The final live proposal/application check succeeded after this repair.

Also repaired initial hash/scroll restoration hiding the header, added explicit mentor progress/timeout handling, discarded stale mentor responses when the design changes, and made share links inspectable without clipboard access.

## Deployment checks and scope

Eleven representative production assets, including code, original art, tests/benchmark results and the GDS, were fetched and compared byte for byte with the source tree. `/api/health` reports the expected Qwen model and active bindings. CSP, `nosniff` and referrer-policy headers were observed in production.

The new Pages project uses a dedicated D1 quota database and Workers AI binding. Eight attempts per visitor IP/day and 64 global attempts/day are enforced before inference. Automated tests cover exhausted quota and database failure; live testing deliberately did not exhaust the visitor budget. No paid plan upgrade was used. Simulation and adaptive search remain local and unlimited.

This validates the stated digital, model and academic physical-design contracts. It is not foundry signoff, measured silicon, task-level neural-network accuracy, or unbounded verification.

## v1.1 integrated evidence

The later [integrated workflow](https://github.com/raaaaaif/silicon-siege/actions/runs/39505161076) passes 48 configurations and 384 matrix transactions, independent result/counter checks, synthesized inferred-memory netlist replay, both controller mutations, and four unbounded single-lane refinement proofs. The browser test suite now has 19 passing tests, including all 21,564 integer classifier predictions and all 384 measured performance records. Selector tests remove test outcomes entirely and verify that architecture selection remains identical.

The [matched routed timing experiment](https://github.com/raaaaaif/silicon-siege/actions/runs/39504591731) completes both direct and pipelined 4×4 INT8 ACC24 tiles at the same 2 ns clock and 0.4 ns input/output delays. Both pass setup/hold, capacitance/slew, and routing checks. Exact numbers and scope are in `web/evidence/timing-ablation.json`.

Repair history: inferred-memory synthesis initially checked the intermediate graph before dead-cell cleanup; the standard cleanup pass resolved its dangling intermediate nodes, while `check -assert` remains enabled. A new synthesized-netlist replay confirms behavior after cleanup. The netlist testbench needed parameter overrides removed because synthesis specializes those parameters. Neither hardware constraints nor oracle comparisons were relaxed. The first INT8 magnitude/sign formal reference timed out; the published successful harness uses a shared mathematical multiplication primitive and independently tracks sequential state, with that limitation documented.
