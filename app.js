(function () {
  "use strict";

  const D = window.EVAL_DATA;
  const DIMS = [
    { key: "safety", label: "Safety", fixed: true },
    { key: "accuracy", label: "Accuracy" },
    { key: "tone", label: "Tone" },
    { key: "cases", label: "Cases passed" }
  ];
  const STORE = "eval-workbench-v1";
  const DEFAULT_A = D.variants[Math.max(D.variants.length - 2, 0)].id;
  const DEFAULT_B = D.variants[D.variants.length - 1].id;

  const saved = load();
  const state = {
    variants: D.variants.map((v) => ({ ...v, outputs: outputsFor(v.id) })).concat(saved.extraVariants || []),
    a: saved.a || DEFAULT_A,
    b: saved.b || DEFAULT_B,
    gate: { ...D.gate, ...(saved.gate || {}), safety: 100 },
    overrides: saved.overrides || {},
    open: new Set()
  };
  if (!state.variants.find((v) => v.id === state.a)) state.a = DEFAULT_A;
  if (!state.variants.find((v) => v.id === state.b)) state.b = DEFAULT_B;

  function outputsFor(id) {
    const out = {};
    D.cases.forEach((c) => (out[c.id] = c.outputs[id]));
    return out;
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
  }
  function save() {
    const extra = state.variants.filter((v) => !D.variants.find((d) => d.id === v.id));
    try {
      localStorage.setItem(STORE, JSON.stringify({
        a: state.a, b: state.b, gate: state.gate, overrides: state.overrides, extraVariants: extra
      }));
    } catch (e) { /* storage full or blocked: the page still works, it just won't remember */ }
  }

  // ---------- grading ----------
  // Model output often uses typographic apostrophes; compare on straight ones.
  const norm = (s) => String(s || "").replace(/[‘’ʼ]/g, "'");

  function grade(text, check) {
    const raw = norm(text);
    const t = raw.toLowerCase();
    if (check.any) return check.any.some((p) => t.includes(norm(p).toLowerCase()));
    if (check.none) return !check.none.some((p) => t.includes(norm(p).toLowerCase()));
    if (check.noneRe) return !new RegExp(check.noneRe).test(raw);
    if (check.maxWords) return raw.trim().split(/\s+/).filter(Boolean).length <= check.maxWords;
    return false;
  }

  function score(variant) {
    const dims = { safety: [0, 0], accuracy: [0, 0], tone: [0, 0] };
    const cases = {};
    let casePass = 0;
    D.cases.forEach((c) => {
      const text = variant.outputs[c.id];
      const results = c.checks.map((ch) => {
        const ok = text != null && grade(text, ch);
        dims[ch.dim][1] += 1;
        if (ok) dims[ch.dim][0] += 1;
        return ok;
      });
      const auto = text != null && results.every(Boolean);
      const ov = (state.overrides[variant.id] || {})[c.id];
      const final = ov ? ov === "pass" : auto;
      if (final) casePass += 1;
      cases[c.id] = { results, auto, final, override: ov || null, missing: text == null };
    });
    const pct = (p) => (p[1] ? (100 * p[0]) / p[1] : 0);
    return {
      cases,
      pct: {
        safety: pct(dims.safety),
        accuracy: pct(dims.accuracy),
        tone: pct(dims.tone),
        cases: (100 * casePass) / D.cases.length
      },
      raw: { ...dims, cases: [casePass, D.cases.length] }
    };
  }

  // ---------- rendering helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmt = (n) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, "") + "%";
  const byId = (id) => state.variants.find((v) => v.id === id);
  const passMark = (ok) => ok
    ? '<span class="st st-good"><span aria-hidden="true">✓</span> Pass</span>'
    : '<span class="st st-bad"><span aria-hidden="true">✕</span> Fail</span>';
  const metMark = (ok) => ok
    ? '<span class="st st-good"><span aria-hidden="true">✓</span> Met</span>'
    : '<span class="st st-bad"><span aria-hidden="true">✕</span> Not met</span>';

  function current() {
    const A = byId(state.a), B = byId(state.b);
    return { A, B, sa: score(A), sb: score(B) };
  }

  function render() {
    renderSelectors();
    const { A, B, sa, sb } = current();
    renderVerdict(B, sb);
    renderChart(A, sa, B, sb);
    renderDiff(A, sa, B, sb);
    renderTable(A, sa, B, sb);
    save();
  }

  function renderSelectors() {
    ["a", "b"].forEach((k) => {
      const el = $("#sel-" + k);
      el.innerHTML = state.variants.map((v) =>
        `<option value="${esc(v.id)}"${v.id === state[k] ? " selected" : ""}>${esc(v.name)}</option>`).join("");
    });
  }

  // The gate rows are built once so threshold inputs keep focus while scores update.
  function buildVerdict() {
    const rows = DIMS.map((d) => `<div class="gate-row" data-row="${d.key}">
        <div class="gate-name">${d.label}</div>
        <div class="gate-val"></div>
        ${d.fixed
          ? '<div class="gate-th"><span class="muted">needs</span> 100% <span class="muted small">(fixed)</span></div>'
          : `<label class="gate-th"><span class="muted">needs ≥</span>
            <input type="number" min="0" max="100" step="1" value="${state.gate[d.key]}" data-gate="${d.key}" aria-label="${d.label} threshold">%</label>`}
        <div class="gate-st"></div>
      </div>`).join("");
    $("#verdict").innerHTML = `
      <div class="verdict-head">
        <div class="verdict-badge" aria-live="polite"></div>
        <div class="verdict-sub"></div>
      </div>
      <div class="gate">${rows}</div>
      <p class="muted small">Safety, Accuracy and Tone are the share of automated checks passed, and Safety must be perfect. Cases passed counts a case only if every check passes. A reviewer override changes the case result, not the check scores.</p>`;
    document.querySelectorAll("[data-gate]").forEach((inp) =>
      inp.addEventListener("change", (e) => {
        const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
        e.target.value = v;
        state.gate[e.target.dataset.gate] = v;
        const { A, B, sa, sb } = current();
        renderVerdict(B, sb);
        renderChart(A, sa, B, sb);
        save();
      }));
  }

  function renderVerdict(B, sb) {
    const ship = DIMS.every((d) => sb.pct[d.key] >= state.gate[d.key]);
    const head = $("#verdict .verdict-head");
    head.classList.toggle("is-ship", ship);
    head.classList.toggle("is-hold", !ship);
    const badge = `<span aria-hidden="true">${ship ? "✓" : "✕"}</span> ${ship ? "Ready to ship" : "Not ready"}<span class="sr">: ${esc(B.name)}</span>`;
    if ($("#verdict .verdict-badge").innerHTML !== badge) $("#verdict .verdict-badge").innerHTML = badge;
    $("#verdict .verdict-sub").textContent = `${B.name} against the launch gate`;
    DIMS.forEach((d) => {
      const row = $(`#verdict [data-row="${d.key}"]`);
      const raw = sb.raw[d.key];
      row.querySelector(".gate-val").innerHTML = `${fmt(sb.pct[d.key])} <span class="muted">(${raw[0]}/${raw[1]})</span>`;
      row.querySelector(".gate-st").innerHTML = metMark(sb.pct[d.key] >= state.gate[d.key]);
    });
  }

  function renderChart(A, sa, B, sb) {
    const W = 640, rowH = 58, top = 8, left = 112, right = 56, barH = 14, gap = 4;
    const H = top + DIMS.length * rowH;
    const x = (v) => left + ((W - left - right) * v) / 100;
    const summary = DIMS.map((d) =>
      `${d.label}: A ${fmt(sa.pct[d.key])}, B ${fmt(sb.pct[d.key])}, gate ${state.gate[d.key]}%`).join("; ");
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc("Score by dimension. " + summary)}" class="chart-svg">`;
    [0, 50, 100].forEach((t) => {
      svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - 6}" class="grid"/>` +
        `<text x="${x(t)}" y="${H}" class="tick" text-anchor="middle">${t}%</text>`;
    });
    DIMS.forEach((d, i) => {
      const y0 = top + i * rowH + 6;
      svg += `<text x="${left - 12}" y="${y0 + barH + 2}" class="cat" text-anchor="end">${d.label}</text>`;
      const th = state.gate[d.key];
      svg += `<line x1="${x(th)}" x2="${x(th)}" y1="${y0 - 4}" y2="${y0 + 2 * barH + gap + 4}" class="thresh"/>`;
      [[A, sa, "a"], [B, sb, "b"]].forEach(([v, s, k], j) => {
        const val = s.pct[d.key];
        const y = y0 + j * (barH + gap);
        const w = Math.max(x(val) - left, 0);
        const raw = s.raw[d.key];
        const tip = `${v.name} · ${d.label}: ${fmt(val)} (${raw[0]}/${raw[1]}) · gate ${th}%`;
        svg += `<g class="bar-g" data-tip="${esc(tip)}">` +
          `<rect x="${left}" y="${y - 3}" width="${W - left - right}" height="${barH + 6}" class="hit"/>` +
          (w > 0 ? `<path d="${barPath(left, y, w, barH)}" class="bar bar-${k}"/>` : "") +
          `<text x="${left + w + 6}" y="${y + barH - 3}" class="val">${fmt(val)}</text></g>`;
      });
    });
    svg += "</svg>";
    $("#chart").innerHTML = svg;
    $("#legend").innerHTML =
      `<span class="lg"><i class="sw sw-a"></i>${esc(A.name)} (A)</span>` +
      `<span class="lg"><i class="sw sw-b"></i>${esc(B.name)} (B)</span>` +
      `<span class="lg"><i class="sw sw-th"></i>Gate threshold</span>`;
    bindTips();
  }

  // Bar with 4px rounded data end, square at the baseline.
  function barPath(x, y, w, h) {
    const r = Math.min(4, w, h / 2);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  function bindTips() {
    const tip = $("#tip");
    document.querySelectorAll(".bar-g").forEach((g) => {
      g.addEventListener("mousemove", (e) => {
        tip.textContent = g.dataset.tip;
        tip.hidden = false;
        const box = $("#chart-wrap").getBoundingClientRect();
        const left = Math.min(e.clientX - box.left + 12, box.width - tip.offsetWidth);
        tip.style.left = Math.max(left, 0) + "px";
        const above = e.clientY - box.top - tip.offsetHeight - 10;
        tip.style.top = (above < 0 ? e.clientY - box.top + 16 : above) + "px";
      });
      g.addEventListener("mouseleave", () => (tip.hidden = true));
    });
  }

  function renderDiff(A, sa, B, sb) {
    const reg = [], fix = [];
    D.cases.forEach((c) => {
      const a = sa.cases[c.id].final, b = sb.cases[c.id].final;
      if (a && !b) reg.push(c);
      if (!a && b) fix.push(c);
    });
    const failing = (c, s) => c.checks.filter((_, i) => !s.cases[c.id].results[i]).map((ch) => ch.label).join("; ");
    const li = (c, s) => `<li><button class="link" data-open="${c.id}">${c.id} · ${esc(c.topic)}</button>` +
      (s ? `<span class="muted"> - ${esc(failing(c, s) || "reviewer override")}</span>` : "") + "</li>";
    $("#diff").innerHTML = `
      <div class="diff-col"><h3><span class="st st-bad"><span aria-hidden="true">↓</span> Regressions</span> <span class="muted">${reg.length}</span></h3>
        ${reg.length ? `<ul>${reg.map((c) => li(c, sb)).join("")}</ul>` : '<p class="muted">None. Nothing that passed in A fails in B.</p>'}</div>
      <div class="diff-col"><h3><span class="st st-good"><span aria-hidden="true">↑</span> Fixed</span> <span class="muted">${fix.length}</span></h3>
        ${fix.length ? `<ul>${fix.map((c) => li(c)).join("")}</ul>` : '<p class="muted">None.</p>'}</div>`;
    document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.open;
      state.open.add(id);
      renderCases(id);
      const row = document.getElementById("row-" + id);
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  }

  // Opening or closing a row changes no scores, so only the table re-renders.
  function renderCases(focusId) {
    const { A, B, sa, sb } = current();
    renderTable(A, sa, B, sb);
    if (focusId) {
      const btn = document.querySelector(`#row-${focusId} .row-btn`);
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  function renderTable(A, sa, B, sb) {
    const body = D.cases.map((c) => {
      const ra = sa.cases[c.id], rb = sb.cases[c.id];
      const open = state.open.has(c.id);
      let html = `<tr id="row-${c.id}" class="case-row${open ? " is-open" : ""}" data-toggle="${c.id}">
        <td class="mono">${c.id}</td>
        <td><button class="row-btn" aria-expanded="${open}" aria-controls="detail-${c.id}">${esc(c.topic)}</button></td>
        <td>${cell(ra)}</td><td>${cell(rb)}</td><td class="chev" aria-hidden="true">${open ? "▾" : "▸"}</td></tr>`;
      if (open) {
        html += `<tr class="detail" id="detail-${c.id}"><td colspan="5">
          <div class="msg"><span class="muted small">Customer</span><p>${esc(c.message)}</p></div>
          <div class="pair">${side(A, ra, c, "a")}${side(B, rb, c, "b")}</div></td></tr>`;
      }
      return html;
    }).join("");
    $("#cases tbody").innerHTML = body;
    document.querySelectorAll("[data-toggle]").forEach((tr) => tr.addEventListener("click", () => {
      const id = tr.dataset.toggle;
      state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      renderCases(id);
    }));
    document.querySelectorAll("[data-ov]").forEach((sel) => sel.addEventListener("change", (e) => {
      const [vid, cid] = e.target.dataset.ov.split("|");
      state.overrides[vid] = state.overrides[vid] || {};
      if (e.target.value === "auto") delete state.overrides[vid][cid]; else state.overrides[vid][cid] = e.target.value;
      render();
      const again = document.querySelector(`[data-ov="${CSS.escape(e.target.dataset.ov)}"]`);
      if (again) again.focus();
    }));
  }

  function cell(r) {
    const reviewer = r.override ? ' <span class="muted small">(reviewer)</span>' : "";
    if (r.missing && !r.override) return '<span class="muted">No output</span>';
    return passMark(r.final) + reviewer;
  }

  function side(v, r, c, k) {
    const checks = c.checks.map((ch, i) =>
      `<li>${r.results[i]
        ? '<span class="ok" aria-hidden="true">✓</span><span class="sr">Pass:</span>'
        : '<span class="no" aria-hidden="true">✕</span><span class="sr">Fail:</span>'} ${esc(ch.label)} <span class="muted small">${ch.dim}</span></li>`).join("");
    const ov = r.override || "auto";
    return `<div class="side side-${k}">
      <div class="side-head"><i class="sw sw-${k}"></i>${esc(v.name)}</div>
      <p class="out">${r.missing ? '<span class="muted">No output for this case.</span>' : esc(v.outputs[c.id])}</p>
      <ul class="checks">${checks}</ul>
      <label class="small muted">Reviewer verdict
        <select data-ov="${esc(v.id)}|${c.id}">
          <option value="auto"${ov === "auto" ? " selected" : ""}>Use automated checks</option>
          <option value="pass"${ov === "pass" ? " selected" : ""}>Override: pass</option>
          <option value="fail"${ov === "fail" ? " selected" : ""}>Override: fail</option>
        </select></label></div>`;
  }

  // ---------- live run (bring your own key) ----------
  function policyText() { return D.scenario.policy.map((p) => "- " + p).join("\n"); }

  async function runLive() {
    const key = $("#api-key").value.trim();
    const model = $("#model").value;
    const prompt = $("#live-prompt").value.replace("[store policy]", "Store policy:\n" + policyText());
    const status = $("#live-status");
    if (!key) { status.textContent = "Add an Anthropic API key to run live."; return; }
    const btn = $("#run");
    btn.disabled = true;
    const outputs = {};
    const skipped = [];
    try {
      for (let i = 0; i < D.cases.length; i++) {
        const c = D.cases[i];
        status.textContent = `Running ${i + 1}/${D.cases.length}: ${c.topic}…`;
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          // These models think before replying, and thinking counts toward max_tokens.
          // Low effort keeps that short; the cap is a ceiling, not a target.
          body: JSON.stringify({
            model,
            max_tokens: 4000,
            output_config: { effort: "low" },
            system: prompt,
            messages: [{ role: "user", content: c.message }]
          })
        });
        const json = await res.json();
        if (!res.ok) throw new Error((json.error && json.error.message) || res.statusText);
        // A cut-off or declined reply isn't the model's answer, so it is left ungraded (counts as a fail).
        if (json.stop_reason === "max_tokens" || json.stop_reason === "refusal") {
          skipped.push(`${c.id} (${json.stop_reason === "refusal" ? "declined" : "cut off"})`);
          continue;
        }
        outputs[c.id] = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      }
      addVariant({ id: "live-" + Date.now(), name: `Live - ${model} (${new Date().toLocaleTimeString()})`, prompt, outputs });
      status.textContent = "Done. The live run is now selected as B." +
        (skipped.length ? ` No usable reply for ${skipped.join(", ")}, so those cases show as no output.` : "");
    } catch (e) {
      status.textContent = "Run stopped: " + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  function addVariant(v) {
    state.variants.push(v);
    state.b = v.id;
    render();
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(reader.result);
        if (!j.outputs || typeof j.outputs !== "object" || Array.isArray(j.outputs)) {
          throw new Error('expected { "name": "...", "outputs": { "C01": "..." } }');
        }
        const outputs = {};
        const unknown = [];
        Object.keys(j.outputs).forEach((id) => {
          if (typeof j.outputs[id] !== "string") throw new Error(`output for ${id} must be text`);
          if (!D.cases.find((c) => c.id === id)) { unknown.push(id); return; }
          outputs[id] = j.outputs[id];
        });
        addVariant({
          id: "imp-" + Date.now(),
          name: typeof j.name === "string" && j.name ? j.name : "Imported outputs",
          prompt: typeof j.prompt === "string" ? j.prompt : "",
          outputs
        });
        $("#live-status").textContent = "Imported. It's now selected as B." +
          (unknown.length ? ` Ignored IDs not in the golden set: ${unknown.join(", ")}.` : "");
      } catch (e) {
        $("#live-status").textContent = "Couldn't import: " + e.message;
      }
    };
    reader.readAsText(file);
  }

  function exportResults() {
    const report = state.variants.map((v) => {
      const s = score(v);
      return { variant: v.name, scores: s.pct, cases: D.cases.map((c) => ({ id: c.id, topic: c.topic, output: v.outputs[c.id], pass: s.cases[c.id].final })) };
    });
    const blob = new Blob([JSON.stringify({ gate: state.gate, report }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "eval-report.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- theme ----------
  function setTheme(t) {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(STORE + "-theme", t);
    document.querySelectorAll("[data-theme-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeBtn === t)));
  }

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", () => {
    $("#scenario-name").textContent = D.scenario.name;
    $("#scenario-blurb").textContent = D.scenario.blurb;
    $("#policy").innerHTML = D.scenario.policy.map((p) => `<li>${esc(p)}</li>`).join("");
    $("#live-prompt").value = D.variants[D.variants.length - 1].prompt;
    $("#sel-a").addEventListener("change", (e) => { state.a = e.target.value; render(); });
    $("#sel-b").addEventListener("change", (e) => { state.b = e.target.value; render(); });
    $("#swap").addEventListener("click", () => { [state.a, state.b] = [state.b, state.a]; render(); });
    $("#run").addEventListener("click", runLive);
    $("#import").addEventListener("change", (e) => {
      if (e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = "";
    });
    $("#export").addEventListener("click", exportResults);
    $("#reset").addEventListener("click", () => {
      localStorage.removeItem(STORE);
      location.reload();
    });
    document.querySelectorAll("[data-theme-btn]").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeBtn)));
    setTheme(localStorage.getItem(STORE + "-theme") || "auto");
    buildVerdict();
    render();
  });
})();
