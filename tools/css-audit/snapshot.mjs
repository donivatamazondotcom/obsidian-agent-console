/**
 * css-audit: snapshot
 *
 * Measures the computed value of each forced property (targets.json) on the running
 * Agent Console UI via CDP (`obsidian dev:cdp Runtime.evaluate`).
 *
 * WHY THE INDIRECTION: `obsidian dev:cdp` silently returns EMPTY for large `params`
 * arguments (~>several KB). Embedding targets + a 55KB stylesheet in the expression
 * hit that limit (the symptom looked like a failed capture). Fix: write a tiny
 * self-contained runtime file to disk and have the renderer read its inputs from
 * disk via Node `fs` (Obsidian is Electron with node integration — verified). The
 * CDP expression is then just `eval(fs.readFileSync(<runtime>))`, a few hundred bytes.
 *
 * CRASH-SAFETY:
 *  - Stylesheet swap is OPT-IN (`--swap`). Baseline runs without it: zero style-tag
 *    mutation, no whole-app recalc.
 *  - Replicas live in an OFFSCREEN body-level wrapper recreating the view ancestor
 *    chain; the live React view is never mutated. Live elements are read-only.
 *
 * Baseline:  node snapshot.mjs --out baseline.json
 * After:     node snapshot.mjs --out after.json --swap [--css styles.css]
 *
 * Spec: 04-initiatives/Agent Console/Agent Console Plugin Store Warnings.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const getArg = (flag, def) => {
	const i = args.indexOf(flag);
	return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (flag) => args.includes(flag);

const outPath = getArg("--out", null);
if (!outPath) {
	console.error("error: --out <file.json> is required");
	process.exit(2);
}
const doSwap = hasFlag("--swap");
// When set, the 5 harmonized button selectors are measured on an offscreen replica
// that ALSO carries the `clickable-icon` class — mirroring the TSX change that isn't
// in the loaded build (we never reload). Pair with --swap --css styles.css for the
// "after" run. Omit it (with --css styles.baseline.css) for the "before" run; those
// same 5 selectors are still forced to replica so before/after are apples-to-apples.
const addClickableIcon = hasFlag("--clickable-icon");
const vault = getArg("--vault", "donivatamazondotcom");

const here = fileURLToPath(new URL(".", import.meta.url));
const targetsPath = fileURLToPath(new URL("./targets.json", import.meta.url));
const cssPath = fileURLToPath(new URL("../../" + getArg("--css", "styles.css"), import.meta.url));
const runtimePath = fileURLToPath(new URL("./.measure-runtime.generated.js", import.meta.url));
const cssLabel = doSwap ? getArg("--css", "styles.css") : "(loaded stylesheet, no swap)";

// Runtime source: a self-contained IIFE that reads its inputs from disk and
// returns the measurement JSON string. Baked params are JSON-encoded literals.
const runtimeSource = `(function () {
  const fs = require("fs");
  const TARGETS_PATH = ${JSON.stringify(targetsPath)};
  const CSS_PATH = ${JSON.stringify(cssPath)};
  const DO_SWAP = ${JSON.stringify(doSwap)};
  const ADD_CI = ${JSON.stringify(addClickableIcon)};
  // Selectors harmonized to Obsidian's native .clickable-icon. These are ALWAYS
  // measured on a replica (the loaded build lacks the class; we never reload), and
  // when ADD_CI is set the replica carries .clickable-icon too.
  const CI_LIST = ${JSON.stringify(["agent-client-scroll-to-bottom", "agent-client-chat-send-button", "agent-client-toolbar-dropdown", "agent-client-error-overlay-close", "agent-client-attachment-preview-remove"])};
  const isCI = (sel) => CI_LIST.some((c) => sel.indexOf(c) >= 0);

  const targets = JSON.parse(fs.readFileSync(TARGETS_PATH, "utf8"));

  let styleEl = null, orig = null;
  if (DO_SWAP) {
    styleEl = Array.from(document.querySelectorAll("style"))
      .find((s) => (s.textContent || "").includes(".agent-client-"));
    if (!styleEl) return JSON.stringify({ __error: "plugin <style> tag not found" });
  }

  // Offscreen wrapper recreating the view ancestor chain (body-level, not the live React view).
  const wrap = document.createElement("div");
  wrap.setAttribute("data-css-audit", "1");
  wrap.style.cssText = "position:absolute;left:-99999px;top:0;width:900px;height:700px;visibility:hidden;contain:layout style;";
  wrap.className = "workspace-leaf-content";
  wrap.setAttribute("data-type", "agent-client-chat-view");
  const viewContent = document.createElement("div"); viewContent.className = "view-content";
  const tabPanel = document.createElement("div"); tabPanel.className = "agent-client-tab-panel";
  const container = document.createElement("div"); container.className = "agent-client-chat-view-container";
  tabPanel.appendChild(container); viewContent.appendChild(tabPanel); wrap.appendChild(viewContent);
  document.body.appendChild(wrap);

  const tagFor = (sel) => {
    const last = sel.trim().split(/\\s+/).pop();
    const m = last.match(/^([a-z][a-z0-9]*)/i);
    if (m) return m[1];
    if (/textarea/.test(sel)) return "textarea";
    if (/\\bselect\\b/.test(sel)) return "select";
    if (/button|send-button|dropdown|overlay-close|preview-remove|scroll-to-bottom/.test(sel)) return "button";
    return "div";
  };
  const classesFor = (sel) => {
    const last = sel.trim().split(/\\s+/).pop();
    const base = last.replace(/:not\\([^)]*\\)/g, "").replace(/::?[a-zA-Z-]+(\\([^)]*\\))?/g, "");
    return (base.match(/\\.[A-Za-z0-9_-]+/g) || []).map((c) => c.slice(1));
  };

  const results = {};
  try {
    if (DO_SWAP) { orig = styleEl.textContent; styleEl.textContent = fs.readFileSync(CSS_PATH, "utf8"); }
    for (const t of targets) {
      let el = null, made = false;
      const forceReplica = isCI(t.selector);
      const liveSel = t.selector.replace(/:(hover|focus|focus-visible|focus-within|active)/g, "");
      if (!forceReplica) { try { el = document.querySelector(liveSel); } catch (e) {} }
      if (!el) {
        el = document.createElement(tagFor(t.selector));
        for (const c of classesFor(t.selector)) el.classList.add(c);
        if (ADD_CI && forceReplica) el.classList.add("clickable-icon");
        container.appendChild(el); made = true;
      }
      const cs = getComputedStyle(el);
      const rec = { __source: made ? "replica" : "live", __pseudo: !!t.pseudo };
      for (const p of t.props) rec[p] = cs.getPropertyValue(p).trim();
      results[t.selector] = rec;
      if (made) el.remove();
    }
  } finally {
    if (DO_SWAP && styleEl) styleEl.textContent = orig;
    wrap.remove();
  }
  return JSON.stringify(results);
})()`;

writeFileSync(runtimePath, runtimeSource);

// Tiny CDP expression: read + eval the runtime file in the renderer.
const expression = `eval(require("fs").readFileSync(${JSON.stringify(runtimePath)}, "utf8"))`;
const params = JSON.stringify({ expression, returnByValue: true });

let raw;
try {
	raw = execFileSync(
		"obsidian",
		[`vault=${vault}`, "dev:cdp", "method=Runtime.evaluate", `params=${params}`],
		{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60000 },
	);
} catch (e) {
	console.error("CDP call failed:", e.stderr || e.message);
	process.exit(1);
}

if (!raw || !raw.trim()) {
	console.error("CDP returned empty — Obsidian down, or expression too large.");
	process.exit(1);
}

let parsed;
try {
	parsed = JSON.parse(raw);
} catch (e) {
	console.error("could not parse CDP response:", raw.slice(0, 500));
	process.exit(1);
}
const value = parsed && parsed.result && parsed.result.value;
if (!value) {
	console.error("CDP returned no value:", JSON.stringify(parsed).slice(0, 800));
	process.exit(1);
}
const measured = JSON.parse(value);
if (measured.__error) {
	console.error("measurement error:", measured.__error);
	process.exit(1);
}

const out = {
	capturedAt: new Date().toISOString(),
	mode: doSwap ? "swap" : "loaded",
	css: cssLabel,
	vault,
	targetCount: JSON.parse(readFileSync(targetsPath, "utf8")).length,
	results: measured,
};
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

const live = Object.values(measured).filter((r) => r.__source === "live").length;
const replica = Object.values(measured).filter((r) => r.__source === "replica").length;
const pseudo = Object.values(measured).filter((r) => r.__pseudo).length;
console.log(
	`snapshot → ${outPath}  mode=${out.mode}  (${Object.keys(measured).length} targets: ${live} live, ${replica} replica; ${pseudo} pseudo in base state)`,
);
void here;
