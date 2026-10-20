# Research and search experiments

Research checked 20 October 2026.

## Related work

Gemmini ([Genc et al.](https://arxiv.org/abs/1911.09925)) evaluates accelerator hardware alongside its memory system and software stack. Silicon Siege includes a standalone banked-memory controller; it does not implement Gemmini's CPU or SoC integration.

Timeloop ([Parashar et al.](https://accelergy.mit.edu/timeloop.pdf)) separates mappings and access counts from technology costs. The Workbench similarly reports its cache/transfer model separately from standard-cell area. Its LRU cache model covers fewer architectural effects than Timeloop.

SmoothQuant ([Xiao et al.](https://arxiv.org/abs/2211.10438), [implementation](https://github.com/mit-han-lab/smoothquant)) addresses activation outliers in quantization. Silicon Siege uses symmetric per-tensor activation scaling and per-tensor or per-output-channel weight scaling; it does not implement SmoothQuant. The Workbench reports GEMM NRMSE. The System lab separately reports held-out classifier accuracy.

RTL-OPT ([Lu et al.](https://arxiv.org/abs/2601.01765)) evaluates functionality alongside optimization. Dr. RTL ([Fang et al.](https://arxiv.org/abs/2604.14989), [source](https://github.com/hkust-zhiyao/Dr_RTL)) studies agent-driven RTL optimization. Silicon Siege's search selects parameters of fixed hardware; its cloud model does not generate HDL.

OpenROAD ([flow documentation](https://openroad-flow-scripts.readthedocs.io/en/latest/mainREADME.html)) supplies the RTL-to-layout flow. The published Nangate45 results are compute-tile measurements on an academic technology platform.

## Search model

The Workbench search space contains 1,296 configurations. Features encode each parameter by its normalized position in its finite domain. The surrogate uses RBF-weighted observed objectives. Its acquisition function subtracts a nearest-observation distance bonus from the predicted objective. This distance is an exploration heuristic, not a calibrated uncertainty estimate or Gaussian-process posterior.

Methods share the evaluator, starting configuration, budget and six-evaluation warmup. Random search samples without replacement. The fixed heuristic orders configurations by precision, accumulator width, scale mode, tile order and resource choices without using observed objectives. Adaptive search ranks remaining candidates by acquisition and makes a random exploratory query every fifth iteration after warmup. The greedy ablation removes both exploration mechanisms.

## Original five-seed comparison

Five seeds, three synthetic kernels, three methods and 36 evaluations per run produce 1,620 evaluations. Mean best objective is 0.475 for adaptive search, 0.539 for random search and 0.465 for the fixed heuristic; lower is better. Adaptive and heuristic find feasible designs in 15/15 runs, random in 14/15. The reported standard deviations combine workload and seed variation and are not confidence intervals.

Reproduce with `npm run experiments`. Results are in `web/evidence/experiments.json`.

## Exhaustive-reference comparison

The expanded experiment uses 20 paired seeds, three fixed kernels, four methods and the same 36-evaluation budget. Each kernel's entire 1,296-configuration space is evaluated to establish its reference optimum. Regret is the selected objective minus that optimum. Confidence intervals resample seeds as clusters, keeping the three kernels paired within each sampled seed; they are conditional on this workload suite.

| Method | Mean regret | Frozen-design stress passes |
| --- | --- | --- |
| Fixed heuristic | 0.02197 | 60/180 |
| Adaptive RBF | 0.04505 | 74/180 |
| RBF without exploration | 0.09412 | 66/180 |
| Random | 0.17383 | 48/180 |

Adaptive-minus-heuristic mean regret is +0.02308, with a 95% seed-cluster interval of [+0.01339, +0.03299]. The heuristic performs better on the nominal objective. Stress transfer freezes the selected design before bandwidth, outlier and shape changes. Adaptive search passes more of these fixed stress cases. The experiments do not establish performance on other workloads or physical PPA.

Reproduce with `npm run audit-search`. Raw trajectories, reference optima and intervals are in `web/evidence/search-audit.json`.

## Classifier co-design

The System lab uses a separate exact selector over 96 hardware/scaling combinations. It filters on validation accuracy and mapped MAC-tile area, then minimizes active clocks, tile area and negative validation accuracy in that order. Held-out test results do not participate in selection. Its trained-model and RTL experiments are described in [system architecture and measurements](MEASUREMENTS.md).
