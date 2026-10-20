# Silicon Siege: engineering position and research record

Research checked 20 October 2026. The project combines digital design, architecture and ML systems with an interactive browser interface. This is not a claim of industrial EDA state of the art or novel autonomous RTL generation.

## Differentiation after reviewing the field

**Gemmini** ([Genc et al.](https://arxiv.org/abs/1911.09925)) establishes how much accelerator evaluation depends on the full stack. That directly motivates the boundary in this project: the measured hardware is a streaming compute tile; host scheduling and memory are explicit models. We do not describe tile results as whole-system speedups.

**Timeloop** ([Parashar et al.](https://accelergy.mit.edu/timeloop.pdf)) separates architectural mappings and access counts from technology costs. Silicon Siege likewise exposes tile order, transfer accounting and stalls separately from standard-cell synthesis. Its lightweight cache model is much narrower than Timeloop and is not a replacement for it.

**SmoothQuant** ([Xiao et al.](https://arxiv.org/abs/2211.10438), [implementation](https://github.com/mit-han-lab/smoothquant)) motivates testing outliers and being precise about numerical evaluation. This project implements symmetric quantization with per-tensor activations and either per-tensor or per-output-channel weights. It does not implement SmoothQuant. Its NRMSE is a GEMM error metric, not classification accuracy or language-model quality.

**RTL-OPT** ([Lu et al.](https://arxiv.org/abs/2601.01765)) evaluates functionality and optimization quality together. That influenced the independent reference oracle, mutation testing, area reports and rejection of overflow-producing candidates. Passing a parser or generating plausible RTL is insufficient.

**Dr. RTL** ([Fang et al.](https://arxiv.org/abs/2604.14989), [source](https://github.com/hkust-zhiyao/Dr_RTL)) already explores agentic, tool-grounded RTL optimization. Consequently, the defensible wedge here is the human-interactive adversarial co-design environment with replayable evidence. Silicon Siege uses a bounded architecture grammar; it does not claim arbitrary LLM-generated RTL has been verified.

**OpenROAD** ([official flow](https://openroad-flow-scripts.readthedocs.io/en/latest/mainREADME.html)) makes a real remote RTL-to-layout artifact feasible. The representative Nangate45 layout is an educational technology result, not manufactured silicon, foundry signoff or measured power.

## Falsifiable experiment

Question: under a fixed 36-evaluation budget, does an adaptive surrogate find lower constrained objectives more reliably than random search or a fixed engineering heuristic?

The experiment covers three synthetic kernels and five search seeds. Each method starts from the same architecture. Each receives the same budget and evaluator. The first six evaluations are the common baseline plus seeded random warmup; subsequently the heuristic uses a fixed ordering, random samples without replacement, and the surrogate combines kernel-regression prediction with a distance-based exploration bonus. Every fifth surrogate iteration explores randomly. The published JSON retains every evaluated configuration and objective.

Initial measured result: adaptive mean best objective **0.475**, random **0.539**, heuristic **0.465**; lower is better. Adaptive and heuristic found feasible results in 15/15 runs; random in 14/15. These are observed on this synthetic suite. The fixed baseline slightly beats the adaptive average; the product does not conceal that negative result. This does not establish a general advantage or statistical significance.

The regression is intentionally small and auditable: radial-basis weighted observations, normalized ordinal/categorical features, distance-based exploration. Its uncertainty is a heuristic, not a GP posterior. Search is trained on modeled performance/resource/error measurements, not on the physical-design run. Standard-cell area is shown separately, not smuggled into an uncalibrated system PPA score.

## Stress-testing the project itself

| Objection | Implemented answer | Remaining scientific boundary |
|---|---|---|
| Just an attractive dashboard | Executed RTL verification, a standard-cell sweep, bounded SAT checks and a routed GDS | No fabrication or board bring-up |
| The visuals invent computation | JS tile controller matches the same independent Python vectors used by Icarus, 49,344 edges | System cache/DRAM timing remains a model |
| The agent might break arithmetic | Every candidate is evaluated; overflows reject it; cloud proposals must pass legal-domain validation | No arbitrary HDL generation |
| Signed arithmetic is under-tested | Full signed extrema, negative values, randomized vectors, 36 configurations, two caught mutations | Simulation is not a full functional proof |
| AI search beats an unfair baseline | Equal budgets, common start/warmup, seeded data and raw trajectories | Three small kernels; no broad benchmark claim |
| Quantization “accuracy” is misleading | Report numerical NRMSE and per-element errors, not task accuracy | No trained network or independent calibration dataset |
| Physical numbers are proxies | Use raw Nangate45 cell area and routed STA, with hashes and constraints | No activity-annotated power measurement |
| Guests could consume unlimited EDA | No public CI dispatch; browser-local exploration; cloud mentor quotas | Global AI quota can be exhausted, local lab remains functional |
| Local storage blocks the engineering | Zero npm dependencies; remote EDA; only compact reports, source and GDS downloaded | Reproducing EDA locally still requires the documented toolchain |

