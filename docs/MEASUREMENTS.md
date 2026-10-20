# System architecture and measurements

## Architectural decisions

`siege_system.v` implements a banked-memory controller with a separate timing contract from the Workbench cache model. The System lab reports its RTL-checked counters.

A and B use P independent synchronous banks each. Rows of A and columns of B map to banks; each bank supplies one value per cycle. The overlapping schedule issues the next synchronous read while consuming the current vector. The serialized ablation adds a read clock before every MAC beat. This is not a speculative out-of-order scheduler or external-memory double buffering.

For T output tiles, reduction K, array width P and product pipeline S:

`active clocks = T × [(overlap ? 1 : K) + K + S + 1 + P²] + output stalls`

The extra one after S is the controller's result-observation clock. Every padded output slot costs one clock but does not assert result valid. Host preload is `M×K + K×N` element transfers, plus one command-acceptance clock. Host bias, ReLU and requantization are outside these accelerator counters. There is no conversion from clocks to latency without a matching system timing result.

The interface rejects zero or out-of-range dimensions; busy state locks host writes and new commands; completion remains asserted until acknowledged. Reset aborts execution and clears counters, but does not erase operand SRAM. The caller must initialize all referenced words. Bounds are M≤8, N≤32, K≤64, with physical strides 64 and 32. There is no claim of AXI compliance, DMA, coherency, interrupt support or a complete CPU/SoC.

## Numerical contract and experiment discipline

Training uses NumPy Adam, a fixed seed and a fixed 100-epoch budget. The best validation checkpoint is selected without looking at the canonical test set. Of the 3,823 official training records, 3,055 fit weights, 256 calibrate activation scales, and 512 validate. The official 1,797 test records come from different writers. All data hashes and split indices are published.

Weights use symmetric per-tensor or per-output-channel scaling. Input scale is fixed by the documented pixel range; hidden activation scale is determined from calibration records. Bias is quantized into the accumulator scale. Integer MACs and bias wrap modulo the configured accumulator width. ReLU and Q20 integer multiplication/rounding implement the host-side transition between layers. Rounding is floor(x+0.5), including negatives; JavaScript and NumPy agree explicitly.

Accuracy intervals are Wilson intervals. Changes against the floating-point model use paired bootstrap intervals on the same test examples. This is one training seed on a small classical dataset: the intervals do not quantify retraining variability or modern vision-model performance. Changing an interactive pixel never recalibrates the model or changes the benchmark accuracy.

The co-design selector uses validation accuracy only, MAC-tile synthesis area, and the checked controller cycle contract. It exhaustively enumerates 96 small-space configurations. Its objective is lexicographic: fewest active clocks, then smallest tile area, then highest validation accuracy. The separate test result is displayed after selection. Enumeration evaluates every candidate in this finite space.

## Measured findings

- Floating-point test accuracy: 95.882%. INT8/channel/ACC24: 95.882%. INT4/channel/ACC16: 95.715%. INT8/channel/ACC16: 2.226%, with 25,153 overflowed layer outputs. The INT8/ACC16 configuration overflows during inference.
- For four examples, the two GEMMs take 817 active clocks on the 4×4 pipelined overlapping controller versus 1,414 when reads and MACs are serialized: 42.2% fewer active clocks. Cold operand loading plus two command acceptances add 2,754 clocks, making the overlap configuration 3,571 interface clocks before host postprocessing. These counts exclude host postprocessing.
- Matched routed 4×4 INT8 ACC24 tiles, 2 ns target, 0.4 ns I/O delay, 0.1 ns uncertainty: direct MAC 14,826.8 µm², +0.187457 ns setup, +0.00927347 ns hold; product register 16,358.5 µm², +0.570088 ns setup, +0.00984701 ns hold. Both have zero reported route DRC, capacitance, slew, setup and hold violations. The pipeline increases setup margin with roughly 10.3% more routed cell area, and adds one clock per tile. This is one typical corner, not a measured maximum frequency or full-system timing result.
- Search regret against the exhaustive optimum: fixed heuristic 0.02197, adaptive 0.04505, no-exploration RBF 0.09412, random 0.17383. Adaptive-minus-heuristic paired mean +0.02308, 95% seed-cluster interval [+0.01339, +0.03299]. Adaptive does better on the three frozen-design stress cases (74/180 pass versus 60/180 for the heuristic), but neither result establishes general superiority.

The formal reference uses the same signed-multiplication mathematical primitive and a separate sequential scoreboard; it establishes state/accumulation refinement, not independent multiplier implementation diversity. Independent Python oracle tests, real-network fixtures and intentional defect detection supply additional independent checks. The first alternate magnitude/sign multiplication proof timed out for INT8 and is not reported as a successful proof.

## Scope

The controller and inferred operand memories are synthesized and simulated. Routed physical measurements cover the compute tile only. SRAM macro mapping, full-system timing, multi-corner analysis, activity-annotated power, DFT, CDC/RDC, DMA and coherent SoC integration are outside the evaluated design. No silicon has been fabricated.

The classifier is a small digit MLP evaluated with one training seed. The search experiments use three synthetic kernels. The cloud mentor selects bounded configurations; it does not generate RTL. Formal results cover the listed lane and control properties.

## Primary references

- [Gemmini source and architecture](https://github.com/ucb-bar/gemmini): motivates evaluating controllers, scratchpads and software alongside the array. This project does not reproduce Gemmini's SoC integration.
- [UCI Optical Recognition of Handwritten Digits](https://archive.ics.uci.edu/dataset/80/optical+recognition+of+handwritten+digits), E. Alpaydin and C. Kaynak, CC BY 4.0. Redistributed processed pixel records and labels retain attribution; model weights are newly trained.
- [Jacob et al., integer-arithmetic-only inference](https://arxiv.org/abs/1712.05877): integer scaling and numerical contracts. The present model uses simpler symmetric PTQ, not their quantization-aware training recipe.
- [Yosys SAT and temporal induction](https://yosyshq.readthedocs.io/projects/yosys/en/v0.51/cmd/sat.html): distinguishes bounded checks from induction.
- [OpenROAD flow documentation](https://openroad-flow-scripts.readthedocs.io/en/latest/mainREADME.html): reproducible academic physical-design flow, with exact Docker digest and constraints recorded.
