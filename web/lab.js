import { inferDigit, systemCycles, selectArchitecture } from "./deployment.js";
const $ = (s) => document.querySelector(s),
  pct = (x) => (x * 100).toFixed(2) + "%",
  num = (x) => x.toLocaleString("en-US");
let data,
  system,
  proof,
  audit,
  synthesis,
  timing,
  pixels,
  sample = 0,
  edited = false;
const choice = { bits: 8, channel: true, acc: 24, p: 4, pipe: 1, prefetch: 1 };
const model = () =>
  data.models.find(
    (x) => x.bits === choice.bits && x.channel === choice.channel,
  );
const row = () =>
  data.results.find(
    (x) =>
      x.bits === choice.bits &&
      x.channel === choice.channel &&
      x.acc === choice.acc,
  );
function selects() {
  return `<label>Operand precision<select id="labBits"><option value="8">INT8</option><option value="4">INT4</option></select></label>
 <label>Weight calibration<select id="labChannel"><option value="true">Per output channel</option><option value="false">Per tensor</option></select></label>
 <label>Accumulator<select id="labAcc"><option>24</option><option>16</option><option>32</option></select></label>
 <label>MAC array<select id="labP"><option value="4">4 × 4</option><option value="2">2 × 2</option></select></label>
 <label>Product register<select id="labPipe"><option value="1">Pipelined</option><option value="0">Direct</option></select></label>
 <label>Operand schedule<select id="labPrefetch"><option value="1">Overlap read + compute</option><option value="0">Serialize read + compute</option></select></label>`;
}
async function init() {
  try {
    [data, system, proof, audit, synthesis, timing] = await Promise.all(
      [
        "digits",
        "system",
        "formal-depth",
        "search-audit",
        "synthesis",
        "timing-ablation",
      ].map(async (name) => {
        const r = await fetch(`/evidence/${name}.json`);
        if (!r.ok) throw Error(name);
        return r.json();
      }),
    );
    $("#labContent").innerHTML =
      `<div class="lab-controls card">${selects()}</div>
 <div class="lab-stats" id="labStats" aria-live="polite"></div>
 <div class="lab-grid">
 <section class="card lab-sample"><div class="eyebrow">01 / THE ACTUAL INPUT</div><h2>A handwritten digit. An integer decision.</h2>
 <div class="lab-digit-row"><div class="digit-grid" id="digitGrid" role="group" aria-label="Editable 8 by 8 digit. Activate a pixel to change its intensity."></div><div id="labDecision" aria-live="polite"></div></div>
 <label for="labSample">Held-out example <span id="sampleLabel"></span></label><input type="range" min="0" max="1796" value="0" id="labSample" />
 <div class="lab-actions"><button class="button pale" id="labNext">Next digit →</button><button class="button pale" id="labMistake">Find a misclassification</button><button class="text-btn" id="labRestore">Restore input</button></div>
 <p class="muted">Click any pixel to perturb it. Quantization scales stay frozen. The decision reruns locally; benchmark accuracy below always refers to the untouched test set.</p>
 <div class="logit-bars" id="labLogits" aria-label="Integer class logits"></div></section>
 <section class="card prose"><div class="eyebrow">02 / FOLLOW THE NUMBERS</div><h2>From tensor to hardware.</h2>
 <div class="pipeline-strip"><span>64 pixels</span><b>→</b><span>64 × 32 GEMM</span><b>→</b><span>ReLU + Q20</span><b>→</b><span>32 × 10 GEMM</span></div>
 <div id="labLayers"></div><p class="muted">Signed integer MACs wrap modulo 2<sup>ACC</sup>. The host adds quantized bias, applies ReLU, and requantizes with an integer Q20 multiplier. Those host operations are not included in accelerator cycle counts.</p>
 <details><summary>Inspect this input’s exact integer tensors</summary><pre id="labTensors" class="lab-tensors"></pre></details>
 <button class="button pale" id="labExport">Export inference trace ↓</button></section>
 </div>
 <section class="card lab-design"><div><div class="eyebrow">CONSTRAINED CO-DESIGN</div><h2>Give the architect a measurable brief.</h2><p>Enumerate 96 verified configurations. Minimize active clocks, then mapped MAC-tile area, subject to validation accuracy and area limits. Test labels are excluded from selection.</p></div><div class="lab-design-controls"><label>Minimum validation accuracy (%)<input id="labAccuracyTarget" type="number" min="0" max="100" step="0.1" value="95" /></label><label>Maximum MAC-tile area (µm²)<input id="labAreaTarget" type="number" min="1" max="100000" step="100" value="6000" /></label><button class="button primary" id="labOptimize">Find a feasible architecture ↗</button></div><p id="labDesignResult" role="status">Area comes from Nangate45 standard-cell synthesis of the MAC tile. Controller, memories and routing are excluded. Clocks are not wall-clock latency.</p></section><section class="card prose lab-system"><div class="eyebrow">03 / A REAL CONTROLLER, WITH ACCOUNTING</div><h2>Data movement has a cost.</h2>
 <p>The synthesizable subsystem accepts a matrix descriptor, reads independent synchronous operand banks, handles ragged tiles, and streams indexed results with backpressure. Below: RTL measurements for a batch of four real test examples.</p>
 <div id="labSystem"></div>
 <div id="labTiming"></div><details><summary>Interface and memory contract</summary><p>A is stored at row × 64 + k; B at k × 32 + column. Each operand has P banks. The host loads one element per accepted clock while idle. A command locks writes until its completion is acknowledged. Invalid dimensions return an error completion; reset aborts outstanding work. SRAM contents are not reset, so referenced entries must be initialized before execution.</p><p>The accelerator supports M ≤ 8, N ≤ 32, K ≤ 64. It has no AXI, DMA, cache coherence or DRAM model. Inferred memories synthesize, but no SRAM macro layout is claimed. The routed physical evidence elsewhere covers the compute tile only.</p></details>
 </section>
 <div class="lab-grid"><section class="card prose"><div class="eyebrow">04 / HELD-OUT ACCURACY</div><h2>Calibration is not evaluation.</h2><div id="labAccuracy"></div>
 <p>Fit: 3,055 examples. Calibration: 256. Validation: 512. Test: the official 1,797-example split from different writers. Best floating-point checkpoint selected on validation only; static activation scales use calibration only.</p>
 <p>Intervals are 95% Wilson intervals for accuracy and paired bootstrap intervals for the change against the floating-point model. They describe this test set; they do not cover training-seed variation or distribution shift.</p>
 <a href="https://archive.ics.uci.edu/dataset/80/optical+recognition+of+handwritten+digits" target="_blank" rel="noopener">UCI Optical Digits · Alpaydin &amp; Kaynak · CC BY 4.0 ↗</a>
 </section><section class="card prose"><div class="eyebrow">05 / EVIDENCE THAT CAN FAIL</div><h2>Verification beyond a happy path.</h2><div id="labVerification"></div></section></div>
 <section class="card prose"><div class="eyebrow">06 / AUDIT THE AGENT</div><h2>Does adaptive search earn its complexity?</h2><div id="labSearchAudit"></div></section>
 <section class="card prose"><h2>What this establishes—and what it does not.</h2><p>This is a reproducible accelerator engineering case study, with a deliberately small real ML task. It demonstrates numerical contracts, controller design, verification, architecture experiments and honest model evaluation. It is not a production SoC, a new state-of-the-art classifier, foundry signoff, or evidence of tapeout experience.</p><a href="https://github.com/raaaaaif/silicon-siege/blob/main/docs/MEASUREMENTS.md" target="_blank" rel="noopener">Architecture, methodology and measurements ↗</a></section>`;
    for (const [id, key] of [
      ["Bits", "bits"],
      ["Acc", "acc"],
      ["P", "p"],
      ["Pipe", "pipe"],
      ["Prefetch", "prefetch"],
      ["Channel", "channel"],
    ])
      $("#lab" + id).onchange = (e) => {
        choice[key] =
          key === "channel" ? e.target.value === "true" : +e.target.value;
        render();
        $("#labDesignResult").textContent =
          "Manual configuration. Run the architect again to evaluate the current constraints.";
      };
    $("#labSample").oninput = (e) => loadSample(+e.target.value);
    $("#labNext").onclick = () => loadSample((sample + 1) % data.test.x.length);
    $("#labRestore").onclick = () => loadSample(sample);
    $("#labMistake").onclick = () => {
      const r = row();
      for (let i = 1; i <= r.predictions.length; i++) {
        const n = (sample + i) % r.predictions.length;
        if (r.predictions[n] !== data.test.y[n]) {
          loadSample(n);
          return;
        }
      }
    };
    $("#labExport").onclick = () => {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              schema: 1,
              sample,
              edited,
              pixels,
              configuration: choice,
              model: model(),
              trace: inferDigit(pixels, model(), choice.acc),
            },
            (key, value) => (typeof value === "function" ? undefined : value),
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "silicon-siege-inference.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $("#labOptimize").onclick = () => {
      try {
        const report = selectArchitecture(data, system, synthesis, {
          minimumAccuracy: +$("#labAccuracyTarget").value / 100,
          maximumTileArea: +$("#labAreaTarget").value,
        });
        if (!report.best) {
          $("#labDesignResult").textContent =
            `${report.evaluated} architectures evaluated; none meets both constraints. The limits were kept intact.`;
          return;
        }
        Object.assign(choice, report.best.config);
        for (const [id, key] of [
          ["Bits", "bits"],
          ["Acc", "acc"],
          ["P", "p"],
          ["Pipe", "pipe"],
          ["Prefetch", "prefetch"],
          ["Channel", "channel"],
        ])
          $("#lab" + id).value = String(choice[key]);
        render();
        $("#labDesignResult").textContent =
          `${report.feasible} of ${report.evaluated} architectures pass. Selected ${choice.p}×${choice.p} INT${choice.bits} / ACC${choice.acc}: ${report.best.cycles} active clocks, ${report.best.tileArea.toFixed(1)} µm² MAC-tile area, ${pct(report.best.validationAccuracy)} validation accuracy. Exact enumeration; no surrogate prediction needed for this small space.`;
      } catch (e) {
        $("#labDesignResult").textContent = e.message;
      }
    };
    loadSample(0);
  } catch (error) {
    $("#labContent").innerHTML =
      '<div class="card prose"><h2>Evidence could not load.</h2><p>The system lab needs its published model and verification artifacts.</p><button class="button pale" id="labRetry">Retry loading evidence</button></div>';
    $("#labRetry").onclick = init;
    console.error(error);
  }
}
function loadSample(n) {
  sample = n;
  pixels = [...data.test.x[n]];
  edited = false;
  $("#labSample").value = n;
  render();
}
function render() {
  const r = row(),
    prediction = inferDigit(pixels, model(), choice.acc),
    q = model();
  $("#sampleLabel").textContent = `${sample + 1} / ${data.test.x.length}`;
  $("#digitGrid").innerHTML = pixels
    .map(
      (x, i) =>
        `<button style="--pixel:${x / 16}" aria-label="Pixel ${Math.floor(i / 8) + 1}, ${(i % 8) + 1}: ${x} of 16" data-pixel="${i}"></button>`,
    )
    .join("");
  $("#digitGrid")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const i = +b.dataset.pixel;
          pixels[i] = ((Math.floor(pixels[i] / 4) + 1) % 5) * 4;
          edited = true;
          render();
          $("#digitGrid").querySelector(`[data-pixel="${i}"]`).focus();
        }),
    );
  $("#labDecision").innerHTML =
    `<span class="eyebrow">PREDICTED DIGIT</span><strong class="digit-answer">${prediction.prediction}</strong><p>${edited ? "Edited input · original label" : "Ground truth"}: <b>${data.test.y[sample]}</b><br>${edited ? "No accuracy claim for this edit" : prediction.prediction === data.test.y[sample] ? "Correct classification" : "Misclassification exposed"}</p><span class="mono">${prediction.overflows} overflowed outputs<br>${prediction.clips} clipped hidden activations</span>`;
  const min = Math.min(...prediction.logits),
    max = Math.max(...prediction.logits);
  $("#labLogits").innerHTML =
    prediction.logits
      .map(
        (x, i) =>
          `<div><b>${i}</b><span><i style="width:${(100 * (x - min)) / (max - min || 1)}%" class="${i === prediction.prediction ? "winner" : ""}"></i></span><code>${x}</code></div>`,
      )
      .join("") +
    "<small>Q20-requantized class logits · bar lengths are relative scores, not probabilities</small>";
  $("#labStats").innerHTML =
    `<div class="card"><span>UNTOUCHED TEST ACCURACY</span><b>${pct(r.accuracy)}</b><small>Float baseline ${pct(data.float_accuracy)}</small></div><div class="card"><span>INTEGER HARDWARE CONTRACT</span><b>${system.configurations} configurations</b><small>${num(system.cases)} complete matrix transactions verified</small></div><div class="card"><span>CALIBRATION STAYS FROZEN</span><b>${q.hidden_scale.toFixed(5)}</b><small>Hidden activation scale · ${choice.channel ? "channel" : "tensor"} weights</small></div>`;
  $("#labLayers").innerHTML = prediction.stages
    .map(
      (s, i) =>
        `<div class="layer-metrics"><b>Layer ${i + 1} · ${i ? 32 : 64} → ${s.scaled.length}</b><span>MAC accumulator range <code>${Math.min(...s.accum)} … ${Math.max(...s.accum)}</code></span><span>Integer multiplier range <code>${Math.min(...q.layers[i].mult)} … ${Math.max(...q.layers[i].mult)}</code></span></div>`,
    )
    .join("");
  $("#labTensors").textContent = JSON.stringify(prediction.stages, null, 2);
  const record = system.rows.find((x) =>
    ["p", "bits", "acc", "pipe", "prefetch"].every((k) => x[k] === choice[k]),
  );
  const layers = [0, 1].map((layer) =>
    record.cases.find(
      (x) =>
        x.id === `b${choice.bits}-c${+choice.channel}-a${choice.acc}-l${layer}`,
    ),
  );
  let total = 0,
    cold = 0,
    serial = 0;
  const table = layers
    .map((x, i) => {
      const c = systemCycles({ ...choice, ...x }),
        noOverlap = systemCycles({ ...choice, ...x, prefetch: 0 });
      total += c.cycles;
      cold += c.cycles + c.preload + 1;
      serial += noOverlap.cycles;
      return `<tr><td>Dense ${i + 1}<small>4 × ${x.k} × ${x.n}</small></td><td>${num(x.cycles)}<small>includes ${x.output_stalls} output stalls</small></td><td>${num(x.cycles - x.output_stalls)}<small>no output stalls</small></td><td>${num(c.preload)}<small>host load clocks</small></td><td>${((100 * c.usefulMACs) / c.paddedMACs).toFixed(1)}%</td></tr>`;
    })
    .join("");
  $("#labSystem").innerHTML =
    `<div class="table-scroll"><table><thead><tr><th>Layer</th><th>RTL measured</th><th>Stalls removed</th><th>Cold preload</th><th>Lane occupancy</th></tr></thead><tbody>${table}</tbody></table></div><div class="lab-callout"><b>${num(total)} active clocks</b><span>Both GEMMs without output stalls. Cold operands + commands add ${num(cold - total)} clocks, for ${num(cold)} accelerator-interface clocks. Host bias, activation and requantization are excluded.</span></div><p>${choice.prefetch ? `Overlapping synchronous reads with MACs removes ${num(serial - total)} clocks (${((100 * (serial - total)) / serial).toFixed(1)}%) versus the serialized schedule for the same array.` : "The serialized schedule spends an explicit read clock on every reduction beat. Switch to overlapping read + compute to test the architectural improvement."}</p><p class="muted">Exact checked equation: tiles × [read clocks per tile + K + pipeline drain + P² output slots] + output stalls. Padded output slots consume clocks but never assert result_valid. Values are clocks, not MHz or inferred chip power.</p>`;
  $("#labTiming").innerHTML =
    `<h3>Does the pipeline buy timing margin?</h3><p>Separate routed datapath experiment: 4×4 INT8 ACC24, 2 ns clock (500 MHz target), 0.4 ns input/output delays and 0.1 ns uncertainty. Nangate45 typical corner; both designs use identical constraints.</p><div class="table-scroll"><table><thead><tr><th>Datapath</th><th>Routed area</th><th>Setup slack</th><th>Hold slack</th><th>Closure</th></tr></thead><tbody>${timing.rows.map((r) => `<tr><td>${r.pipe ? "Product register" : "Direct MAC"}</td><td>${num(r.area_um2)} µm²</td><td>${r.setup_slack_ns.toFixed(3)} ns</td><td>${r.hold_slack_ns.toFixed(3)} ns</td><td>${r.passes ? "Pass" : "Fail"}<small>DRC ${r.drc ?? "unresolved"} · cap ${r.cap_violations} · slew ${r.slew_violations}</small></td></tr>`).join("")}</tbody></table></div><p class="muted">The pipeline adds one clock per tile. Timing margin and area must be considered together; passing the same clock target does not make the pipelined design faster. These paths exclude the new controller and memories.</p><a href="/evidence/timing-ablation.json" target="_blank">Matched constraints and raw measurements ↗</a>`;
  $("#labAccuracy").innerHTML =
    `<div class="lab-callout"><b>${pct(r.accuracy)}</b><span>95% interval ${r.accuracy_ci95.map(pct).join(" – ")}<br>Change from float: ${(r.delta_vs_float * 100).toFixed(2)} percentage points<br>Paired 95% interval: ${r.paired_delta_ci95.map((x) => (100 * x).toFixed(2)).join(" to ")} points</span></div><p>Validation accuracy ${pct(r.validation_accuracy)} · float agreement ${pct(r.agreement)} · ${num(r.overflow_outputs)} overflowed layer outputs · ${num(r.hidden_clips)} hidden activations clipped across the test set.</p><details><summary>Confusion matrix · rows true, columns predicted</summary><div class="table-scroll"><table class="confusion"><thead><tr><th>↓ / →</th>${Array.from({ length: 10 }, (_, i) => `<th>${i}</th>`).join("")}</tr></thead><tbody>${r.confusion.map((a, i) => `<tr><th>${i}</th>${a.map((v, j) => `<td class="${i === j ? "diagonal" : ""}">${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  $("#labVerification").innerHTML =
    `<ul><li>${system.configurations} RTL configurations × ${system.cases / system.configurations} GEMMs: real quantized layers, ragged shapes, signed extrema and random data.</li><li>Scoreboard checks every accepted output, index uniqueness and complete coverage. All four counters must match independently derived values.</li><li>Random output stalls, stable data under backpressure, completion hold, reset abort, and invalid descriptors are exercised.</li><li>${proof.proofs.length} unbounded induction proofs: single-lane arithmetic refinement for INT4/INT8, direct and pipelined, plus protocol invariants.</li><li>Subsystem synthesis checks inferred synchronous memories. The synthesized subsystem netlist also passes the scoreboard; injected stale-prefetch and output-index faults are detected. The tile retains its independent differential and mutation tests.</li></ul><div class="evidence-links"><a href="/evidence/system.json" target="_blank">RTL results ↗</a><a href="/evidence/formal-depth.json" target="_blank">Proof scope ↗</a><a href="/evidence/digits.json" target="_blank">Model + dataset ↗</a><a href="https://github.com/raaaaaif/silicon-siege/blob/main/rtl/siege_system.v" target="_blank" rel="noopener">System RTL ↗</a></div>`;
  $("#labSearchAudit").innerHTML =
    `<p>20 paired seeds, three fixed synthetic kernels, 36 evaluations per method. Every kernel’s entire 1,296-design space is evaluated independently to establish the exact reference optimum. Removing exploration supplies an ablation, not another marketing label.</p><div class="table-scroll"><table><thead><tr><th>Method</th><th>Mean regret ↓</th><th>Feasible runs</th><th>Stress transfer passes</th></tr></thead><tbody>${audit.summary.map((x) => `<tr><td>${{ surrogate: "Adaptive RBF", greedy: "RBF without exploration", random: "Random", heuristic: "Fixed engineering heuristic" }[x.method]}</td><td>${x.mean_regret.toFixed(4)}</td><td>${x.feasible_runs} / ${x.runs}</td><td>${x.stress_passes} / ${x.stress_cases}</td></tr>`).join("")}</tbody></table></div><p>${audit.paired.map((x) => `Adaptive minus ${x.baseline}: ${x.mean_delta.toFixed(4)} [${x.ci95.map((n) => n.toFixed(4)).join(", ")}]`).join("<br>")}<br><small>95% seed-cluster bootstrap intervals; negative favors adaptive. Fixed suite only.</small></p><p class="muted">Stress transfer freezes the selected design before bandwidth, outlier and shape perturbations. Search still uses the original synthetic resource proxy; this is not a physical-PPA benchmark. The real classifier and subsystem above have separate evidence. A negative result remains visible.</p><a href="/evidence/search-audit.json" target="_blank">Download all seeds, oracles, traces and intervals ↗</a>`;
}
init();
