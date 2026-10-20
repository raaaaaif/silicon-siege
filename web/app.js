import {
  DEFAULT,
  DOMAINS,
  MISSIONS,
  VERSION,
  evaluate,
  workload,
  validateConfig,
  frontier,
  adversary,
  describeDelta,
  configId,
} from "./engine.js";
import { search, SPACE_SIZE } from "./search.js";
// Avoid a hash anchor or browser scroll restoration hiding the primary navigation.
history.scrollRestoration = "manual";
window.addEventListener("pageshow", () =>
  window.scrollTo({ top: 0, behavior: "instant" }),
);
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  fmt = (n, d = 0) =>
    Number(n).toLocaleString("en-US", { maximumFractionDigits: d }),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem("siege-v1") || "{}");
} catch {}
let config;
try {
  config = validateConfig(saved.config || DEFAULT);
} catch {
  config = { ...DEFAULT };
}
let mission =
    Number.isInteger(saved.mission) && saved.mission >= 0 && saved.mission < 3
      ? saved.mission
      : 0,
  attack = "none",
  result,
  events = [],
  traceIndex = 0,
  selected = 0,
  playing = null,
  proposal = null,
  candidates = [],
  searchToken = 0,
  synth = null,
  verification = null,
  physical = null,
  expReport = null,
  mentorOnline = false;
let completed = Array.isArray(saved.completed)
  ? saved.completed.filter((x) => Number.isInteger(x) && x >= 0 && x < 3)
  : [];
const shared = new URLSearchParams(location.search);
if (shared.has("design"))
  try {
    config = validateConfig(JSON.parse(atob(shared.get("design"))));
    const m = Number(shared.get("brief"));
    if (m >= 0 && m < 3 && Number.isInteger(m)) mission = m;
  } catch {
    toast("That shared design is invalid. Loaded your saved work.");
  }
function persist() {
  try {
    localStorage.setItem(
      "siege-v1",
      JSON.stringify({ config, mission, completed }),
    );
  } catch {}
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function log(who, text) {
  const box = document.createElement("div");
  box.className = `agent-message ${who}`;
  const labels = {
    architect: "PIP / ARCHITECT",
    verifier: "SENTRY / VERIFIER",
    adversary: "GLITCH / ADVERSARY",
  };
  box.innerHTML = `<b>${labels[who] || labels.architect}</b><p>${esc(text)}</p>`;
  $("#agentLog").append(box);
  while ($("#agentLog").children.length > 8)
    $("#agentLog").firstElementChild.remove();
  $("#agentLog").scrollTop = $("#agentLog").scrollHeight;
}
const terms = {
  "MAC array":
    "A multiply-accumulate (MAC) computes a × b + sum. A P × P tile computes P² output entries in parallel. This is an output-stationary outer-product array: inputs broadcast across rows and columns; partial sums stay in their processing elements. It is not a neighbor-to-neighbor systolic array.",
  Precision:
    "Symmetric INT4 or INT8 quantization maps each input to a signed integer. Lower precision reduces multiplier size and input traffic. Error is measured against a floating-point GEMM, not against task-level classification accuracy. The most-negative code is unused by this symmetric quantizer, but the RTL handles it correctly.",
  Scratchpad:
    "This system-level model uses 16-byte cache lines with least-recently-used eviction and no prefetch. Scratchpad capacity controls reuse across host-scheduled tiles. The RTL evidence covers the streaming compute tile; this cache model is not an SRAM implementation included in the synthesized area.",
  "Tile order":
    "Reuse weights visits output-column tiles before changing columns. Reuse inputs visits output-row tiles first. Both use the same output-stationary RTL datapath. The difference is host scheduling and memory access order, not a weight-stationary hardware implementation.",
  Accumulator:
    "Each lane sums products in a signed 16-, 24-, or 32-bit register. Results wrap modulo 2^width, matching the RTL. Any mathematical overflow rejects a design even when the modular hardware behaves correctly. Worst-case safe signed width for K terms is conservatively 2×operand bits + ceil(log2 K).",
  Pipeline:
    "With the product register enabled, multiplication is separated from accumulation by one clock. The initiation interval stays one accepted vector per clock. This adds one drain cycle per tile. Timing/area evidence is kept separate from the simulated cycle count.",
  Bandwidth:
    "The modeled link moves 4, 8, or 16 bytes per clock. Cache misses block input delivery, and results drain through the same-width link. Memory transfer and compute do not overlap in this conservative host model. The bandwidth attack reduces this by a factor of four.",
  "Weight scales":
    "Per-tensor uses one scale for all weights. Per-channel uses one scale for each output column, which factors out of the reduction. Activations always use one per-tensor scale. Scale selection uses this synthetic input, not an independent calibration dataset; this is a numerical exploration, not a deployment accuracy claim.",
  "Resource budget":
    "A transparent architecture proxy: P² × (bits² + 2×accumulator bits + pipeline×2×bits) + 0.7×scratchpad bytes + 35×link bytes/cycle. These are relative resource units. They are not gate equivalents, mm², power, energy, or measured silicon.",
  "Cycle model":
    "The tile controller is stepped at every clock and checked against an independent integer GEMM. System scheduling adds explicit 16-byte line fills, writeout stalls, reset and drain cycles. Those system-level memory costs are a model; they are not validated against a complete SoC or DRAM controller.",
  "Surrogate search":
    "The architect learns an RBF-weighted regression model from evaluated candidates, then chooses a low predicted objective with an exploration bonus based on distance to observations. Six warmup evaluations and periodic random exploration reduce premature focus. This is an adaptive surrogate heuristic, not a calibrated Gaussian process or a claim of Bayesian optimality.",
  Objective:
    "Minimize 0.5×latency/budget + 0.25×resource/budget + 0.25×NRMSE/budget, with a 3× penalty for each normalized constraint violation and a 10-point overflow penalty. Passing requires every constraint and zero overflow. The Pareto view uses latency, resources, and error separately.",
  "Evidence levels":
    "The browser shows deterministic model results. Icarus simulation checks RTL against independent Python vectors. Yosys checks bounded control invariants and maps cells to Nangate45. OpenROAD evaluates one representative routed tile. None of these are fabricated-silicon measurements; synthesis excludes memory and host circuitry.",
};
function showDialog(title, body, kicker = "INSPECT") {
  stop();
  $("#dialogEyebrow").textContent = kicker;
  $("#dialogBody").innerHTML = `<h2>${esc(title)}</h2>${body}`;
  $("#detailDialog").showModal();
}
$("#closeDialog").onclick = () => $("#detailDialog").close();
$("#detailDialog").addEventListener("click", (e) => {
  if (e.target === $("#detailDialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
document.addEventListener("click", (e) => {
  const help = e.target.closest("[data-term]");
  if (help)
    showDialog(
      help.dataset.term,
      `<p>${esc(terms[help.dataset.term])}</p>`,
      "FIELD NOTE",
    );
  const open = e.target.closest("[data-open]");
  if (open) setView(open.dataset.open);
});
function setView(id) {
  if (!["workbench", "lab", "experiments", "evidence", "guide"].includes(id))
    id = "workbench";
  stop();
  $$(".view").forEach((x) => x.classList.toggle("active", x.id === id));
  $$(".nav").forEach((x) => {
    x.classList.toggle("active", x.dataset.view === id);
    x.setAttribute("aria-current", x.dataset.view === id ? "page" : "false");
  });
  history.replaceState(
    null,
    "",
    location.pathname + location.search + "#/" + id,
  );
  window.scrollTo({ top: 0, behavior: "instant" });
}
$$(".nav").forEach((x) => (x.onclick = () => setView(x.dataset.view)));
$(".brand").onclick = (e) => {
  e.preventDefault();
  setView("workbench");
};
$("#guideStart").onclick = () => setView("workbench");
function renderMissions() {
  $("#missions").innerHTML = MISSIONS.map(
    (m, i) =>
      `<button class="mission-tab ${i === mission ? "active" : ""}" data-mission="${i}" aria-pressed="${i === mission}"><span class="mission-num">0${i + 1}</span><span><small>${m.subtitle}</small><strong>${m.name}</strong></span><span class="mission-check">${completed.includes(i) ? "✓" : i === mission ? "↗" : "·"}</span></button>`,
  ).join("");
  $("#milestones").textContent = `${completed.length} of 3 design briefs met`;
  $$("[data-mission]").forEach(
    (b) =>
      (b.onclick = () => {
        mission = +b.dataset.mission;
        attack = "none";
        candidates = [];
        searchToken++;
        refresh(true);
        log("architect", MISSIONS[mission].brief);
      }),
  );
}
const field = (name, key, labels, hint = "") =>
  `<div class="field"><div class="field-label">${name}<button class="help-dot" data-term="${name}" aria-label="Explain ${name}">?</button><output>${labels[DOMAINS[key].indexOf(config[key])]}</output></div><div class="segmented" role="group" aria-label="${name}">${DOMAINS[key].map((v, i) => `<button data-key="${key}" data-value="${v}" class="${config[key] === v ? "active" : ""}" aria-pressed="${config[key] === v}">${labels[i]}</button>`).join("")}</div>${hint ? `<small>${hint}</small>` : ""}</div>`;
function renderControls() {
  const expanded = $(".advanced")?.open;
  $("#controls").innerHTML =
    field("MAC array", "p", ["2 × 2", "4 × 4", "8 × 8"]) +
    field("Precision", "bits", ["INT4", "INT8"]) +
    field("Scratchpad", "buffer", ["64 B", "256 B", "1 KB"]) +
    `<div class="field"><div class="field-label">Tile order<button class="help-dot" data-term="Tile order" aria-label="Explain tile order">?</button></div><select id="reuse" aria-label="Tile order"><option value="weights" ${config.reuse === "weights" ? "selected" : ""}>Reuse weights</option><option value="inputs" ${config.reuse === "inputs" ? "selected" : ""}>Reuse inputs</option></select></div><details class="advanced" ${expanded ? "open" : ""}><summary>Microarchitecture details</summary>${field("Accumulator", "acc", ["16 bit", "24 bit", "32 bit"])}${field("Pipeline", "pipe", ["Direct", "Registered"])}${field("Bandwidth", "bw", ["4 B/clk", "8 B/clk", "16 B/clk"])}<div class="field"><div class="field-label">Weight scales<button class="help-dot" data-term="Weight scales" aria-label="Explain weight scales">?</button></div><select id="quant" aria-label="Weight scales"><option value="tensor" ${config.quant === "tensor" ? "selected" : ""}>Per tensor</option><option value="channel" ${config.quant === "channel" ? "selected" : ""}>Per output channel</option></select></div></details>`;
  $$("[data-key]").forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.key;
        config[k] =
          typeof DOMAINS[k][0] === "number"
            ? +b.dataset.value
            : b.dataset.value;
        searchToken++;
        refresh(true);
      }),
  );
  $("#reuse").onchange = (e) => {
    config.reuse = e.target.value;
    searchToken++;
    refresh(true);
  };
  $("#quant").onchange = (e) => {
    config.quant = e.target.value;
    searchToken++;
    refresh(true);
  };
}
function areaFor(c) {
  return synth?.candidates.find(
    (x) =>
      x.p === c.p && x.bits === c.bits && x.acc === c.acc && x.pipe === c.pipe,
  );
}
function refresh(invalidate = false) {
  stop();
  selected = Math.min(selected, config.p ** 2 - 1);
  if (invalidate) {
    proposal = null;
    $("#proposal").hidden = true;
    $("#resultBanner").hidden = true;
    $("#search").disabled = false;
    $("#searchProgress").hidden = true;
  }
  result = evaluate(config, workload(mission, attack), { trace: true });
  events = result.events;
  traceIndex = 0;
  renderMissions();
  renderControls();
  renderMetrics();
  renderBrief();
  renderFabric();
  renderInspector();
  renderFrontier();
  persist();
  $("#budgetValue").textContent =
    `${fmt(result.cost)} / ${fmt(MISSIONS[mission].cost)}`;
  $("#budgetBar").style.width =
    Math.min(100, (100 * result.cost) / MISSIONS[mission].cost) + "%";
  $("#budgetBar").classList.toggle(
    "over",
    result.cost > MISSIONS[mission].cost,
  );
  $("#arrayLabel").textContent = `${config.p} × ${config.p} MAC ARRAY`;
  $("#arraySub").textContent =
    `INT${config.bits} · ${config.acc}-BIT ACCUMULATORS`;
  $("#shapeLabel").textContent = `${result.shape.join(" × ")} GEMM`;
  $("#timeline").max = Math.max(0, events.length - 1);
  $("#timeline").value = 0;
  $("#tracePosition").textContent = "CYCLE 0";
  $("#traceCaption").textContent =
    "Step through the first output tile. Memory stalls are included.";
  $("#worldStatus").textContent =
    attack === "none" ? "READY TO EVALUATE" : "STRESS TEST ACTIVE";
  $("#worldHint").textContent = "Select a processing element to inspect it";
  $("#world").classList.toggle("attacked", attack !== "none");
  $("#attackBanner").hidden = attack === "none";
  $("#attackBanner").textContent = `STRESS CASE / ${attack.toUpperCase()}`;
  $("#clearAttack").hidden = attack === "none";
}
function renderMetrics() {
  const m = MISSIONS[mission],
    a = areaFor(config);
  $("#metrics").innerHTML =
    `<div class="metric"><span>Latency <button class="help-dot" data-term="Cycle model" aria-label="Explain cycle model">?</button></span><strong class="${result.cycles <= m.cycles ? "good" : "bad"}">${fmt(result.cycles)}</strong><small>CYCLES · MODELED</small></div><div class="metric"><span>Quantization error</span><strong class="${result.nrmse <= m.error ? "good" : "bad"}">${fmt(result.nrmse, 2)}<small>%</small></strong><small>NRMSE · NUMERICAL</small></div><div class="metric"><span>Data movement</span><strong>${fmt(result.bytes / 1024, 1)}<small> KB</small></strong><small>TRANSFER MODEL</small></div><div class="metric"><span>Core cell area</span><strong>${a ? fmt(a.area_um2 / 1000, 2) : "N/A"}<small>${a ? " kµm²" : ""}</small></strong><small>${a ? "SYNTHESIZED · N45" : "EVIDENCE LOADING"}</small></div>`;
  $(".metrics .metric:nth-child(2)").onclick = showNumerics;
  $(".metrics .metric:nth-child(2)").style.cursor = "pointer";
  $(".metrics .metric:nth-child(2)").title = "Inspect numerical output";
  $(".metrics .metric:nth-child(2)").tabIndex = 0;
  $(".metrics .metric:nth-child(2)").setAttribute("role", "button");
  $(".metrics .metric:nth-child(2)").setAttribute(
    "aria-label",
    "Inspect numerical output",
  );
  $(".metrics .metric:nth-child(2)").onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showNumerics();
    }
  };
}
function renderBrief() {
  const m = MISSIONS[mission];
  $("#briefTitle").textContent = m.description;
  $("#briefText").textContent = m.brief;
  $("#workloadPill").textContent = `SEEDED KERNEL / ${result.seed}`;
  $("#targets").innerHTML = [
    [result.cycles <= m.cycles, `≤ ${fmt(m.cycles)} cycles`],
    [result.cost <= m.cost, `≤ ${fmt(m.cost)} resource units`],
    [result.nrmse <= m.error, `≤ ${m.error}% NRMSE`],
    [!result.overflows, "Zero overflow"],
  ]
    .map(
      ([pass, text]) =>
        `<span><i class="${pass ? "good" : "bad"}">${pass ? "✓" : "×"}</i>${text}</span>`,
    )
    .join("");
}
function renderFabric() {
  const ev = events[traceIndex],
    values = ev?.accum || Array(config.p ** 2).fill(0);
  $("#fabric").style.setProperty("--p", config.p);
  $("#fabric").classList.toggle("dense", config.p === 8);
  $("#fabric").innerHTML = values
    .map(
      (v, i) =>
        `<button class="pe ${i === selected ? "selected" : ""} ${ev?.phase === "mac" ? "active" : ""} ${v < 0 ? "negative" : ""}" data-pe="${i}" aria-label="Processing element ${Math.floor(i / config.p)},${i % config.p}; accumulator ${v}"><small>${Math.floor(i / config.p)},${i % config.p}</small>${v === 0 ? "·" : fmt(v)}</button>`,
    )
    .join("");
  $$("[data-pe]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = +b.dataset.pe;
        renderFabric();
        renderInspector();
      }),
  );
}
function renderInspector() {
  const ev = events[traceIndex],
    r = Math.floor(selected / config.p),
    c = selected % config.p,
    value = ev?.accum?.[selected] || 0;
  $("#selectedPE").textContent = `PE ${r},${c}`;
  const a = ev?.a?.[r],
    b = ev?.b?.[c];
  $("#peEquation").textContent =
    a !== undefined ? `${a} × ${b} → ${fmt(value)}` : `Σ = ${fmt(value)}`;
  $("#inspectorDetails").innerHTML =
    `<b>${config.bits}-bit signed operands</b><br>${config.acc}-bit modular accumulator<br>${config.pipe ? "Registered product · II = 1" : "Direct product · II = 1"}<br>Active lane utilization: <b>${fmt(result.utilization * 100, 1)}%</b><br>Detected overflows: <b class="${result.overflows ? "bad" : "good"}">${fmt(result.overflows)}</b>`;
}
function traceAt(index) {
  traceIndex = Math.max(0, Math.min(events.length - 1, index));
  $("#timeline").value = traceIndex;
  const ev = events[traceIndex];
  $("#tracePosition").textContent = `CYCLE ${ev.cycle}`;
  $("#traceCaption").textContent = ev.detail;
  $("#worldStatus").textContent =
    `${ev.phase.toUpperCase()} / TILE 1 OF ${result.tiles}`;
  $("#worldHint").textContent =
    `Reduction step ${Math.min(result.shape[1], ev.k + 1)} / ${result.shape[1]}`;
  renderFabric();
  renderInspector();
}
function stop() {
  if (playing) clearInterval(playing);
  playing = null;
  $("#play").textContent = "▶";
  $("#play").setAttribute("aria-label", "Play cycle trace");
  $("#world").classList.remove("running");
}
function play() {
  if (playing) {
    stop();
    return;
  }
  if (traceIndex >= events.length - 1) traceIndex = 0;
  $("#play").textContent = "Ⅱ";
  $("#play").setAttribute("aria-label", "Pause cycle trace");
  $("#world").classList.add("running");
  playing = setInterval(() => {
    traceAt(traceIndex + 1);
    if (traceIndex >= events.length - 1) stop();
  }, 150);
}
$("#play").onclick = play;
$("#step").onclick = () => {
  stop();
  traceAt((traceIndex + 1) % events.length);
};
$("#timeline").oninput = (e) => {
  stop();
  traceAt(+e.target.value);
};
$("#visualModes").onclick = (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  $$("[data-mode]").forEach((x) => x.classList.toggle("active", x === b));
  $("#world").classList.toggle("schematic", b.dataset.mode === "schematic");
};
$("#evaluate").onclick = () => {
  result = evaluate(config, workload(mission, attack), { trace: true });
  events = result.events;
  traceAt(events.length - 1);
  const m = MISSIONS[mission];
  $("#resultBanner").hidden = false;
  $("#resultBanner").classList.toggle("failed", !result.feasible);
  $("#resultBanner").innerHTML = result.feasible
    ? `<b>✓ Design brief met.</b> ${fmt(result.cycles)} modeled cycles, ${fmt(result.nrmse, 2)}% numerical error, no overflow. ${attack !== "none" ? "Stress case survived." : "Ready for an adversarial test."}`
    : `<b>Constraint exceeded.</b> ${result.bottleneck}. Inspect the trace or ask Pip to explore a repair.`;
  if (result.feasible && !completed.includes(mission)) {
    completed.push(mission);
    persist();
    renderMissions();
  }
  log(
    "verifier",
    result.feasible
      ? `This configuration meets the “${m.name}” brief on seed ${result.seed}. ${result.tiles} tiles; ${fmt(result.macs)} MACs; zero mathematical overflow. The performance numbers are model results.`
      : `Rejected for this brief. ${result.cycles > m.cycles ? `Latency ${result.cycles} exceeds ${m.cycles}. ` : ""}${result.nrmse > m.error ? `NRMSE ${result.nrmse.toFixed(2)}% exceeds ${m.error}%. ` : ""}${result.cost > m.cost ? "Resource budget exceeded. " : ""}${result.overflows ? `${result.overflows} accumulator overflows. ` : ""}`,
  );
};
$("#attack").onclick = () => {
  stop();
  const worst = adversary(config, mission);
  attack = worst.attack;
  candidates = [];
  searchToken++;
  refresh(true);
  log(
    "adversary",
    `I evaluated bandwidth starvation, activation outliers, ragged matrix shapes, and accumulator pressure. Your worst case is ${attack}: ${fmt(result.cycles)} cycles, ${fmt(result.nrmse, 2)}% NRMSE${result.overflows ? `, ${result.overflows} overflows` : ""}. ${result.feasible ? "You survived this suite. Try another brief." : "Can you repair it within the same budget?"}`,
  );
  $("#evaluate").click();
};
$("#clearAttack").onclick = () => {
  attack = "none";
  candidates = [];
  searchToken++;
  refresh(true);
  log(
    "verifier",
    "Restored the original seeded workload. The stress-test measurements remain in the discussion.",
  );
};
$("#reset").onclick = () => {
  config = { ...DEFAULT };
  attack = "none";
  candidates = [];
  searchToken++;
  refresh(true);
  toast("Architecture reset. Completed briefs were kept.");
};
function showProposal(p, before = result) {
  proposal = p;
  const d = describeDelta(before, p);
  $("#proposal").hidden = false;
  $("#proposal").innerHTML =
    `<h3>${p.feasible ? "A feasible candidate." : "Best observed candidate."}</h3><p>${d.changes.length ? d.changes.map(esc).join("<br>") : "Your current design remains the best observed."}</p><p><b>${fmt(p.cycles)} cycles</b> · ${fmt(p.nrmse, 2)}% NRMSE<br>${d.cycles >= 0 ? "−" : "+"}${fmt(Math.abs(d.cycles), 1)}% latency · ${fmt(p.cost)} resource units</p><button class="button primary full" id="applyProposal">Apply proposal <span>↗</span></button>`;
  $("#applyProposal").onclick = () => {
    const candidate = proposal;
    config = { ...candidate.config };
    searchToken++;
    refresh(true);
    log(
      "architect",
      "Applied the evaluated proposal. Run it to check the brief and inspect the trace.",
    );
  };
}
$("#search").onclick = async () => {
  stop();
  const token = ++searchToken;
  $("#search").disabled = true;
  $("#proposal").hidden = true;
  $("#searchProgress").hidden = false;
  const w = workload(mission, attack),
    before = result;
  candidates = [];
  log(
    "architect",
    `Starting 36 evaluations across ${SPACE_SIZE.toLocaleString()} legal architectures. I will learn from observed results and reject constraint violations.`,
  );
  try {
    let last;
    for (const step of search(w, { budget: 36, seed: 42, start: config })) {
      if (token !== searchToken) return;
      last = step;
      candidates = step.observations;
      $("#searchProgress i").style.width = (100 * step.iteration) / 36 + "%";
      $("#searchProgress span").textContent =
        `EVALUATED ${step.iteration} / 36 · ${step.frontier.length} PARETO CANDIDATES`;
      renderFrontier();
      await sleep(18);
    }
    if (token !== searchToken) return;
    showProposal(last.best, before);
    log(
      "architect",
      `Measured ${candidates.length} candidates. ${candidates.filter((x) => x.feasible).length} met every constraint. The best observed candidate uses ${fmt(last.best.cycles)} cycles and ${fmt(last.best.nrmse, 2)}% NRMSE. This is a budgeted search, not a proof of the global optimum.`,
    );
  } catch (e) {
    log("verifier", "Search failed: " + e.message);
  } finally {
    if (token === searchToken) {
      $("#search").disabled = false;
      $("#searchProgress").hidden = true;
    }
  }
};
function renderFrontier() {
  const rows = candidates.length ? candidates : [result],
    all = [...rows, result];
  const maxX = Math.max(...all.map((r) => r.cost)) * 1.12,
    maxY = Math.max(...all.map((r) => r.cycles)) * 1.15;
  const x = (v) => 55 + (v / maxX) * 670,
    y = (v) => 195 - (v / maxY) * 160;
  const pareto = frontier(rows).filter(
    (r) => r.nrmse <= MISSIONS[mission].error && !r.overflows,
  );
  const ids = new Set(pareto.map((r) => configId(r.config)));
  let s = "";
  for (let i = 0; i <= 4; i++) {
    const xx = 55 + (i * 670) / 4,
      yy = 195 - (i * 160) / 4;
    s += `<line class="gridline" x1="${xx}" y1="25" x2="${xx}" y2="195"/><line class="gridline" x1="55" y1="${yy}" x2="725" y2="${yy}"/><text x="${xx}" y="213" text-anchor="middle">${fmt((i * maxX) / 4)}</text><text x="45" y="${yy + 3}" text-anchor="end">${fmt((i * maxY) / 4)}</text>`;
  }
  s +=
    '<text x="390" y="229" text-anchor="middle">RESOURCE COST →</text><text x="12" y="110" transform="rotate(-90 12 110)" text-anchor="middle">CYCLES →</text>';
  rows.forEach(
    (r, i) =>
      (s += `<circle tabindex="0" role="button" aria-label="Inspect candidate ${i + 1}: ${r.cycles} cycles, ${r.cost} resources" class="point" data-candidate="${i}" cx="${x(r.cost)}" cy="${y(r.cycles)}" r="4" fill="${ids.has(configId(r.config)) ? "#a5d5b5" : "#698681"}" opacity="${r.feasible ? 1 : 0.45}"><title>${r.cycles} cycles · ${r.cost} units · ${r.nrmse.toFixed(2)}% error</title></circle>`),
  );
  s += `<circle cx="${x(result.cost)}" cy="${y(result.cycles)}" r="6" fill="#e6a07c" stroke="#14282c" stroke-width="2"><title>Your current design</title></circle>`;
  $("#frontier").innerHTML = s;
  $("#frontierCount").textContent = candidates.length
    ? `${candidates.length} evaluated · ${pareto.length} feasible-error frontier points`
    : "Your current design · explore to compare";
  $$("[data-candidate]").forEach((el) => {
    const f = () => {
      const r = rows[+el.dataset.candidate];
      showProposal(r);
      log(
        "architect",
        `Selected a measured design-space point: ${r.config.p}×${r.config.p} INT${r.config.bits}, ${r.cycles} cycles, ${r.cost} resource units.`,
      );
    };
    el.onclick = f;
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        f();
      }
    };
  });
}
$("#traceOpen").onclick = () => {
  showDialog(
    "One tile, every event.",
    `<p>The controller advances every clock. Consecutive memory waits are grouped below; the trace covers the first tile, while the metrics cover the whole kernel.</p><div class="table-wrap"><table class="trace-table"><thead><tr><th>Cycle</th><th>Event</th><th>k</th><th>Accumulator 0,0</th><th>What happened</th></tr></thead><tbody>${events.map((e, i) => `<tr data-event="${i}" class="${i === traceIndex ? "selected" : ""}"><td>${e.cycle}</td><td>${e.phase}</td><td>${e.k}</td><td>${e.accum[0]}</td><td>${esc(e.detail)}</td></tr>`).join("")}</tbody></table></div>`,
    "CYCLE TRACE / SEEDED REPLAY",
  );
  $$("[data-event]").forEach(
    (tr) =>
      (tr.onclick = () => {
        $("#detailDialog").close();
        traceAt(+tr.dataset.event);
      }),
  );
};
function showNumerics() {
  const cols = Math.min(result.shape[2], 12),
    count = Math.min(8, result.shape[0]);
  let cells = "";
  for (let r = 0; r < count; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * result.shape[2] + c,
        delta = Math.abs(result.fp[i] - result.decoded[i]);
      cells += `<div class="matrix-cell" style="--shade:rgba(222,145,105,${Math.min(0.8, 0.08 + delta / 2)})" title="FP ${result.fp[i].toFixed(4)}; decoded ${result.decoded[i].toFixed(4)}">${delta.toFixed(2)}</div>`;
    }
  showDialog(
    "Where precision goes.",
    `<p>Absolute error |float GEMM − dequantized integer GEMM|. This is a numerical kernel metric, not inference accuracy on a real dataset.</p><div class="matrix-grid" style="--cols:${cols}">${cells}</div><div class="matrix-note">First ${count} rows × ${cols} columns · warmer = larger error</div><p><b>NRMSE:</b> ${result.nrmse.toFixed(4)}%. <b>Overflows:</b> ${result.overflows}. <b>Scaling:</b> ${esc(config.quant)} weights, per-tensor activations. Seed ${result.seed}.</p>`,
    "NUMERICAL ORACLE",
  );
}
$("#export").onclick = () => {
  const data = {
    schema: 1,
    version: VERSION,
    config,
    mission: MISSIONS[mission].id,
    attack,
    seed: result.seed,
    metrics: {
      cycles: result.cycles,
      nrmse: result.nrmse,
      cost: result.cost,
      bytes: result.bytes,
      overflows: result.overflows,
    },
    evidence: {
      synthesis: areaFor(config) || null,
      rtl_sha256: synth?.rtl_sha256 || null,
    },
    trace: events,
    scope:
      "System metrics are modeled; core area is standard-cell synthesis. Not silicon measurements.",
  };
  download("silicon-siege-experiment.json", JSON.stringify(data, null, 2));
  toast("Experiment exported with configuration, seed, trace and provenance.");
};
function download(name, text) {
  const u = URL.createObjectURL(new Blob([text], { type: "application/json" })),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
$("#share").onclick = async () => {
  const u = new URL(location.href);
  u.search = "";
  u.searchParams.set("design", btoa(JSON.stringify(config)));
  u.searchParams.set("brief", mission);
  u.hash = "/workbench";
  showDialog(
    "Share this design",
    `<p>This link contains architecture settings and the design brief. Progress and history stay in this browser.</p><textarea aria-label="Design link" readonly style="width:100%;height:110px">${esc(u.href)}</textarea><button class="button primary" id="copyDesign">Copy design link ↗</button>`,
  );
  $("#copyDesign").onclick = async () => {
    try {
      await navigator.clipboard.writeText(u.href);
      $("#copyDesign").textContent = "Link copied ✓";
    } catch {
      toast("Select and copy the link above.");
    }
  };
};
async function mentor(question) {
  const local = {
    bottleneck: `${result.bottleneck} is the main pressure point. The array performs ${fmt(result.macs)} useful MACs over ${fmt(result.cycles)} modeled cycles, reaching ${fmt(result.utilization * 100, 1)}% lane utilization. ${result.hits} cache-line hits versus ${result.misses} misses.`,
    precision: `INT${config.bits} with ${config.quant === "channel" ? "per-output-channel" : "per-tensor"} weight scaling gives ${result.nrmse.toFixed(2)}% NRMSE against floating-point GEMM. ${config.acc}-bit accumulation produced ${result.overflows} overflows. Lower precision can save multiplier area and traffic, but must pass the numerical budget.`,
    repair:
      "I can search for a repair using the current stress case. Each proposal will be measured locally before it can be applied.",
  };
  if (!mentorOnline) {
    log("architect", local[question]);
    if (question === "repair") $("#search").click();
    return;
  }
  const btn = $(`[data-question="${question}"]`);
  btn.disabled = true;
  const context = JSON.stringify([config, mission, attack]);
  $("#mentorState").textContent = "Pip is evaluating a design hypothesis…";
  try {
    const response = await fetch("/api/mentor", {
      signal: AbortSignal.timeout(45000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        config,
        mission,
        attack,
        metrics: {
          cycles: result.cycles,
          nrmse: result.nrmse,
          cost: result.cost,
          bytes: result.bytes,
          overflows: result.overflows,
          utilization: result.utilization,
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Mentor unavailable");
    if (context !== JSON.stringify([config, mission, attack])) {
      log(
        "verifier",
        "The design changed while the mentor was thinking. Its stale proposal was discarded; ask again for the current design.",
      );
      $("#mentorState").textContent =
        "Design changed · stale mentor proposal discarded";
      return;
    }
    log("architect", data.explanation);
    $("#mentorState").textContent =
      "Cloudflare Workers AI · proposal checked locally";
    if (data.config) {
      try {
        const proposed = validateConfig(data.config);
        const measured = evaluate(proposed, workload(mission, attack));
        showProposal(measured);
        log(
          "verifier",
          `I evaluated the mentor’s proposal: ${measured.cycles} cycles, ${measured.nrmse.toFixed(2)}% NRMSE. ${measured.feasible ? "It meets the current brief." : "It does not meet every constraint."}`,
        );
      } catch {
        log(
          "verifier",
          "The cloud proposal was outside the legal design space and was rejected.",
        );
      }
    }
  } catch (e) {
    $("#mentorState").textContent =
      "Cloud mentor unavailable or quota reached · local analysis active";
    log("architect", local[question]);
    if (question === "repair") $("#search").click();
  } finally {
    btn.disabled = false;
  }
}
$$("[data-question]").forEach(
  (b) => (b.onclick = () => mentor(b.dataset.question)),
);
let tourStep = 0;
const tourSteps = [
  [
    "Choose a workload",
    "Choose one of the three briefs. A camera, voice detector, and attention-like kernel have different shapes and budgets. Each brief has cycle, resource and numerical-error limits.",
  ],
  [
    "Build an architecture",
    "Change the MAC array, precision and scratchpad. Open Microarchitecture details to control accumulator width, pipelining, bandwidth and quantization. Every change recomputes the model.",
  ],
  [
    "Look inside a cycle",
    "Run an evaluation, select a processing element, then play or scrub the trace. You can inspect individual products, partial sums, memory stalls and the valid/ready output hold.",
  ],
  [
    "Test workload changes",
    "Challenge this design tests four defined perturbations and chooses your worst case. Ask Pip for a repair; compare the measured candidate before applying it.",
  ],
  [
    "Inspect the results",
    "Experiments compares search methods on equal budgets. Evidence links to actual RTL simulations, bounded control checks, synthesis and physical-design artifacts. The scope of every result is explicit.",
  ],
];
function tour() {
  const [t, p] = tourSteps[tourStep];
  showDialog(
    t,
    `<div class="sprite portrait architect-bot" aria-hidden="true"></div><p>${p}</p><p class="micro left">${tourStep + 1} / ${tourSteps.length}</p><button class="button primary" id="tourNext">${tourStep === 4 ? "Start designing" : "Next"} →</button>`,
    "A THREE-MINUTE WALKTHROUGH",
  );
  $("#tourNext").onclick = () => {
    if (tourStep === 4) {
      $("#detailDialog").close();
      tourStep = 0;
    } else {
      tourStep++;
      $("#detailDialog").close();
      tour();
    }
  };
}
$("#tour").onclick = () => {
  tourStep = 0;
  tour();
};
$("#glossary").innerHTML = Object.entries(terms)
  .map(
    ([k, v]) =>
      `<details class="glossary"><summary>${k}</summary><p>${v}</p></details>`,
  )
  .join("");
function renderConvergence(runs) {
  const colors = ["#a5d5b5", "#e6a07c", "#a5afca"];
  const maxY =
      Math.max(
        1,
        ...runs.flatMap((r) => r.steps.map((x) => x.best.objective)),
      ) * 1.05,
    maxN = Math.max(36, ...runs.map((r) => r.steps.length));
  const x = (n) => 60 + (n / maxN) * 900,
    y = (v) => 240 - (v / maxY) * 205;
  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const yy = 240 - (i * 205) / 4;
    svg += `<line class="gridline" x1="60" y1="${yy}" x2="960" y2="${yy}"/><text x="48" y="${yy + 3}" text-anchor="end">${((i * maxY) / 4).toFixed(2)}</text>`;
  }
  for (let n = 0; n <= maxN; n += Math.ceil(maxN / 6))
    svg += `<text x="${x(n)}" y="263" text-anchor="middle">${n}</text>`;
  runs.forEach((r, i) => {
    svg += `<polyline fill="none" stroke="${colors[i]}" stroke-width="2.5" points="${r.steps.map((s) => `${x(s.iteration)},${y(s.best.objective)}`).join(" ")}"/>`;
  });
  svg += '<text x="510" y="285" text-anchor="middle">EVALUATIONS →</text>';
  $("#convergence").innerHTML = svg;
}
$("#runExperiment").onclick = async () => {
  const m = +$("#experimentMission").value,
    budget = +$("#experimentBudget").value,
    seed = +$("#experimentSeed").value;
  if (!Number.isInteger(seed) || seed < 1 || seed > 999999) {
    toast("Choose a whole-number seed from 1 to 999999.");
    return;
  }
  $("#runExperiment").disabled = true;
  const runs = [];
  try {
    for (const method of ["surrogate", "random", "heuristic"]) {
      const run = { method, steps: [] };
      runs.push(run);
      for (const step of search(workload(m), {
        budget,
        seed,
        start: DEFAULT,
        method,
      })) {
        run.steps.push(step);
        $("#experimentStatus").textContent =
          `${method}: ${step.iteration} / ${budget} evaluations · seed ${seed}`;
        renderConvergence(runs);
        await sleep(0);
      }
    }
    $("#experimentResults").innerHTML = `<div class="comparison-grid">${runs
      .map((r) => {
        const b = r.steps.at(-1).best;
        return `<div class="card"><h3>${r.method === "surrogate" ? "Adaptive surrogate" : r.method === "random" ? "Random sampling" : "Fixed heuristic"}</h3><div class="number">${b.objective.toFixed(3)}</div><p>Best normalized objective ↓<br>${b.cycles} cycles · ${b.nrmse.toFixed(2)}% error<br>${r.steps.filter((s) => s.result.feasible).length} / ${budget} feasible evaluations</p><span class="scope-tag ${b.feasible ? "" : "amber"}">${b.feasible ? "FEASIBLE DESIGN FOUND" : "NO FEASIBLE DESIGN FOUND"}</span></div>`;
      })
      .join("")}</div>`;
    $("#experimentStatus").textContent =
      `Completed ${budget * 3} evaluations. Seed ${seed}. Results apply to this seed and workload.`;
  } finally {
    $("#runExperiment").disabled = false;
  }
};
function renderPublished() {
  if (!expReport) return;
  const s = expReport.summary;
  $("#publishedExperiments").innerHTML =
    `<h2>Published multi-seed results</h2><p>Published benchmark: ${expReport.seeds.length} seeds × 3 workloads × 3 methods × ${expReport.budget} evaluations. Performance is evaluated by the same deterministic browser model. All methods use the same starting configuration and evaluation budget.</p><div class="table-wrap"><table><thead><tr><th>Method</th><th>Mean best objective ↓</th><th>Feasible runs</th><th>Mean feasible evaluation rate</th></tr></thead><tbody>${s.map((x) => `<tr><td>${esc(x.method)}</td><td>${x.meanBest.toFixed(3)} ± ${x.stdBest.toFixed(3)}</td><td>${x.feasibleRuns} / ${x.runs}</td><td>${(x.meanFeasibleRate * 100).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div><p>The fixed heuristic has the lowest mean best objective on this suite. Standard deviation is across heterogeneous workload/seed runs, not a confidence interval. This small synthetic suite cannot establish external validity.</p><div class="evidence-links"><a href="/evidence/experiments.json" download>Download all measurements ↓</a><a href="https://github.com/raaaaaif/silicon-siege/blob/main/scripts/experiments.mjs" target="_blank" rel="noopener">Reproduce the experiment ↗</a></div>`;
}
function renderEvidence() {
  if (!synth || !verification) return;
  const clean = verification.reports.filter((r) => !r.bug),
    mutations = verification.reports.filter((r) => r.bug),
    cycles = clean.reduce((s, r) => s + r.cycles, 0);
  let html = `<div class="evidence-grid"><div class="card evidence-stat"><span class="eyebrow">RTL CONFIGURATIONS</span><strong>${clean.filter((r) => r.passed).length} / ${clean.length}</strong><small>Cycle-by-cycle differential tests<br>Icarus + independent Python oracle</small></div><div class="card evidence-stat"><span class="eyebrow">CLOCK EDGES CHECKED</span><strong>${fmt(cycles)}</strong><small>Signed extrema, random bubbles,<br>backpressure and mid-stream reset</small></div><div class="card evidence-stat"><span class="eyebrow">INJECTED DEFECTS</span><strong>${mutations.filter((r) => r.mutation_caught).length} / 2</strong><small>Unsigned multiplication and<br>dropped valid under backpressure</small></div><div class="card evidence-stat"><span class="eyebrow">SYNTHESIZED DESIGNS</span><strong>${synth.candidates.length}</strong><small>Nangate45 typical standard cells<br>Same RTL and library throughout</small></div></div><div class="evidence-row"><div class="card prose"><span class="scope-tag">SIMULATION / EXACT DIGITAL BEHAVIOR</span><h2>Streaming GEMM tile</h2><p>The parameterized streaming GEMM core accepts P activations and P weights per beat, computes P² signed products, and accumulates a complete tile. First/last markers delimit each reduction. The consumer can stall without losing its output.</p><p>Coverage: P ∈ {2,4,8}, bits ∈ {4,8}, accumulator ∈ {16,24,32}, pipeline ∈ {0,1}. Each configuration executes 48 tiles with reduction lengths 1, 2, 3, 7, 16 and 33. Host tiling and the cache/bandwidth system model are outside this RTL core.</p><div class="evidence-links"><a href="/evidence/verification.json" download>Independent test results ↓</a><a href="https://github.com/raaaaaif/silicon-siege/actions/runs/39500095741" target="_blank" rel="noopener">Executed CI run ↗</a></div></div><div class="card prose"><span class="scope-tag">BOUNDED FORMAL / CONTROL INVARIANTS</span><h2>Bounded protocol checks</h2><p>Yosys SAT checked 20 clock edges on the 2×2 INT4 ACC16 registered configuration, starting in reset. Properties: a stalled result preserves valid and data; output valid blocks new input; reset clears valid and accumulators.</p><p>This is a bounded check of local control properties. It is not an unbounded functional equivalence proof, and it does not prove all parameter combinations or an entire SoC.</p><div class="evidence-links"><a href="/evidence/formal.log" target="_blank">Read SAT log ↗</a><a href="/evidence/siege_tile.v" download>Read complete RTL ↓</a></div></div></div>`;
  if (physical)
    html += `<div class="card prose"><span class="scope-tag">PHYSICAL DESIGN / REPRESENTATIVE TILE</span><h2>From RTL to routed layout.</h2><p>${esc(physical.summary)}</p><figure class="physical-layout"><img src="/evidence/physical-layout.webp" alt="Actual routed 4 by 4 streaming GEMM tile from OpenROAD" loading="lazy"><figcaption>Actual placed-and-routed tile · OpenROAD / Nangate45</figcaption></figure><div class="table-wrap"><table><thead><tr><th>Configuration</th><th>Clock target</th><th>Cell area</th><th>Setup WNS</th><th>Route violations</th></tr></thead><tbody><tr><td>4×4 · INT8 · ACC24 · registered</td><td>10 ns / 100 MHz</td><td>${physical.area_um2 != null ? fmt(physical.area_um2, 2) + " µm²" : "See raw report"}</td><td>${physical.wns_ns != null ? fmt(physical.wns_ns, 3) + " ns" : "See raw report"}</td><td>${physical.drc ?? "See raw report"}</td></tr></tbody></table></div><p><b>Electrical and timing checks:</b> ${physical.max_cap_violations} capacitance violations, ${physical.metrics.finish__timing__drv__max_slew} slew violations, ${physical.setup_violations} setup violations, ${physical.hold_violations} hold violations. Worst setup slack +${fmt(physical.worst_setup_slack_ns, 3)} ns; worst hold slack +${fmt(physical.hold_slack_ns, 4)} ns.</p><p>Nangate45 is an open academic technology platform, not a foundry signoff or silicon measurement. Timing is constrained with 2 ns input/output delays and 0.1 ns clock uncertainty. This result excludes SRAM macros, a host processor, package IO and board timing. No measured power is claimed.</p><div class="evidence-links"><a href="${esc(physical.run_url)}" target="_blank" rel="noopener">Executed physical-design run ↗</a><a href="/evidence/physical.json" download>Provenance + physical metrics ↓</a><a href="/evidence/constraints.sdc" download>Timing constraints ↓</a><a href="/evidence/physical-report.txt" target="_blank">Timing report ↗</a><a href="/evidence/siege_tile.gds" download>Routed GDS layout ↓</a></div></div>`;
  else
    html +=
      '<div class="card prose"><span class="scope-tag amber">PHYSICAL DESIGN</span><h2>Physical results are not loaded.</h2><p>The simulation and synthesis evidence above remain available. See the repository Actions for the physical-design run; this interface does not substitute modeled values for missing physical measurements.</p></div>';
  html += `<div class="card prose"><h2>What the verifier catches</h2><p>Two intentional RTL mutations were tested with the same independent oracle. Both failed; the unmutated design passed.</p>${mutations.map((r) => `<details class="glossary"><summary>${r.bug === 1 ? "Mutation 1: signed operands treated as unsigned" : "Mutation 2: valid dropped while the consumer stalls"} : ${r.mutation_caught ? "caught" : "not caught"}</summary><pre>${esc(r.log)}</pre></details>`).join("")}</div><div class="card prose"><h2>The 36-design synthesis sweep</h2><p>${esc(synth.scope)} Area is mapped standard-cell area in µm², not final die area. Scratchpad, link bandwidth, tile ordering and quantization scales do not alter this core's synthesized area.</p><div class="table-wrap"><table><thead><tr><th>Array</th><th>Operand</th><th>Accumulator</th><th>Product register</th><th>Cell area / µm²</th><th>Cells</th></tr></thead><tbody>${synth.candidates.map((r) => `<tr><td>${r.p}×${r.p}</td><td>INT${r.bits}</td><td>${r.acc}</td><td>${r.pipe ? "Yes" : "No"}</td><td>${fmt(r.area_um2, 2)}</td><td>${fmt(r.cells)}</td></tr>`).join("")}</tbody></table></div><div class="evidence-links"><a href="/evidence/synthesis.json" download>Download synthesis data ↓</a></div><p class="hash">RTL SHA-256 ${synth.rtl_sha256}<br>Library SHA-256 ${synth.library_sha256}<br>Tool ${esc(synth.tool)}</p></div><div class="card prose"><h2>Inspect the implementation</h2><details class="glossary"><summary>Streaming GEMM RTL</summary><pre id="rtlSource">Loading…</pre></details><p>Exact compiler versions, input vector hashes and source commits are in the downloadable reports. Reproduction commands and model limitations are documented in the repository.</p><div class="evidence-links"><a href="https://github.com/raaaaaif/silicon-siege" target="_blank" rel="noopener">Complete source and methodology ↗</a></div></div>`;
  $("#evidenceContent").innerHTML = html;
  fetch("/evidence/siege_tile.v")
    .then((r) => r.text())
    .then((t) => {
      if ($("#rtlSource")) $("#rtlSource").textContent = t;
    })
    .catch(() => {});
}
async function loadEvidence() {
  const jobs = [
    ["synthesis.json", (v) => (synth = v)],
    ["verification.json", (v) => (verification = v)],
    ["physical.json", (v) => (physical = v)],
    ["experiments.json", (v) => (expReport = v)],
  ];
  await Promise.allSettled(
    jobs.map(async ([path, assign]) => {
      const r = await fetch("/evidence/" + path);
      if (r.ok) assign(await r.json());
    }),
  );
  renderMetrics();
  renderEvidence();
  renderPublished();
}
refresh();
renderConvergence([]);
setView(location.hash.replace(/^#\/?/, "") || "workbench");
loadEvidence();
fetch("/api/health")
  .then((r) => r.json())
  .then((d) => {
    mentorOnline = d.mentor === true;
    $("#mentorState").textContent = mentorOnline
      ? "Cloudflare Workers AI connected · bounded daily budget"
      : "Local analysis ready · cloud mentor unavailable";
  })
  .catch(() => {
    $("#mentorState").textContent = "Local analysis ready · offline mode";
  });
