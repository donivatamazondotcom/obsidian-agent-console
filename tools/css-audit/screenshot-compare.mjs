/**
 * css-audit: comparative screenshot
 *
 * Renders the harmonized buttons in a small injected panel (body-level, NOT the live
 * React view) and clip-captures it under two stylesheet states:
 *   before → styles.baseline.css (original, !important), plugin classes only
 *   after  → styles.css (harmonized), plugin classes + .clickable-icon
 *
 * Both are deterministic via <style> swap, so the result is independent of whichever
 * build the target Obsidian has loaded. Capture is CDP Page.captureScreenshot with a
 * clip (no reload, no live-view mutation). Restores the stylesheet + removes the panel.
 *
 * Usage: node screenshot-compare.mjs --before before.png --after after.png [--vault vault]
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const getArg = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const vault = getArg("--vault", "vault");
const beforeOut = getArg("--before", "tools/css-audit/before.png");
const afterOut = getArg("--after", "tools/css-audit/after.png");

const baselineCss = fileURLToPath(new URL("./styles.baseline.css", import.meta.url));
const harmonizedCss = fileURLToPath(new URL("../../styles.css", import.meta.url));
const runtimePath = fileURLToPath(new URL("./.screenshot-runtime.generated.js", import.meta.url));

function cdp(method, paramsObj) {
	const params = JSON.stringify(paramsObj);
	for (let attempt = 0; attempt < 4; attempt++) {
		const raw = execFileSync("obsidian", [`vault=${vault}`, "dev:cdp", `method=${method}`, `params=${params}`],
			{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
		if (raw && raw.trim()) return JSON.parse(raw);
		execFileSync("sleep", ["0.4"]); // transient empty (Obsidian busy after a heavy eval) — settle + retry
	}
	throw new Error(`${method}: empty response after retries`);
}

// Panel builder runtime. mode = "before" | "after" | "cleanup".
function runtimeSrc(mode) {
	return `(function () {
  const fs = require("fs");
  const MODE = ${JSON.stringify(mode)};
  const BASELINE = ${JSON.stringify(baselineCss)};
  const HARMONIZED = ${JSON.stringify(harmonizedCss)};

  const styleEl = Array.from(document.querySelectorAll("style")).find(s => (s.textContent || "").includes(".agent-client-"));
  if (!styleEl) return JSON.stringify({ __error: "plugin <style> not found" });
  if (styleEl.dataset.cssAuditOrig === undefined) styleEl.dataset.cssAuditOrig = styleEl.textContent;

  const existing = document.getElementById("css-audit-panel");
  if (existing) existing.remove();

  if (MODE === "cleanup") {
    if (styleEl.dataset.cssAuditOrig !== undefined) { styleEl.textContent = styleEl.dataset.cssAuditOrig; delete styleEl.dataset.cssAuditOrig; }
    return JSON.stringify({ ok: true });
  }

  styleEl.textContent = fs.readFileSync(MODE === "after" ? HARMONIZED : BASELINE, "utf8");
  const CI = MODE === "after" ? "clickable-icon " : "";

  const send = '<svg class="agent-client-icon-active" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  const x = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  const down = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  const p = document.createElement("div");
  p.id = "css-audit-panel";
  p.style.cssText = "position:fixed;top:24px;left:24px;z-index:99999;width:340px;padding:16px 18px;background:#0b0c11;border:1px solid #363a48;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);font-family:var(--font-interface);";
  const h = document.createElement("div");
  h.textContent = MODE.toUpperCase();
  h.style.cssText = "font-weight:700;font-size:12px;letter-spacing:.08em;color:var(--text-accent);margin-bottom:14px;";
  p.appendChild(h);

  function row(label, build) {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;align-items:center;gap:14px;margin:12px 0;min-height:30px;";
    const l = document.createElement("div");
    l.textContent = label;
    l.style.cssText = "width:150px;font-size:11px;color:var(--text-muted);";
    r.appendChild(l);
    const host = document.createElement("div");
    host.style.cssText = "display:inline-flex;align-items:center;";
    build(host);
    r.appendChild(host);
    p.appendChild(r);
  }

  row("toolbar-dropdown", (host) => {
    const b = document.createElement("button"); b.type = "button"; b.className = CI + "agent-client-toolbar-dropdown";
    b.innerHTML = '<span class="agent-client-toolbar-dropdown-label-area"><span class="agent-client-toolbar-dropdown-label">claude-opus-4.8</span></span><span class="agent-client-toolbar-dropdown-chevron">' + down + '</span>';
    host.appendChild(b);
  });
  row("chat-send-button", (host) => {
    const b = document.createElement("button"); b.className = CI + "agent-client-chat-send-button"; b.innerHTML = send; host.appendChild(b);
  });
  row("scroll-to-bottom", (host) => {
    const b = document.createElement("button"); b.className = CI + "agent-client-scroll-to-bottom";
    b.style.position = "static"; b.style.transform = "none"; b.innerHTML = down; host.appendChild(b);
  });
  row("error-overlay-close", (host) => {
    const b = document.createElement("button"); b.className = CI + "agent-client-error-overlay-close"; b.innerHTML = x; host.appendChild(b);
  });
  row("attachment-preview-remove", (host) => {
    host.className = "agent-client-attachment-preview-item";
    host.style.cssText = "position:relative;width:46px;height:46px;background:#4a5163;border-radius:6px;display:inline-block;";
    const b = document.createElement("button"); b.className = CI + "agent-client-attachment-preview-remove"; b.style.opacity = "1"; b.innerHTML = x; host.appendChild(b);
  });

  document.body.appendChild(p);
  const rect = p.getBoundingClientRect();
  return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, dpr: window.devicePixelRatio });
})()`;
}

function evalRuntime(mode) {
	writeFileSync(runtimePath, runtimeSrc(mode));
	const expr = `eval(require("fs").readFileSync(${JSON.stringify(runtimePath)}, "utf8"))`;
	const res = cdp("Runtime.evaluate", { expression: expr, returnByValue: true });
	const val = res && res.result && res.result.value;
	if (!val) throw new Error("inject(" + mode + ") returned no value: " + JSON.stringify(res).slice(0, 300));
	const obj = JSON.parse(val);
	if (obj.__error) throw new Error(obj.__error);
	return obj;
}

function capture(rect, out) {
	const clip = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height), scale: 1 };
	const res = cdp("Page.captureScreenshot", { format: "png", clip });
	const data = res && (res.data || (res.result && res.result.data));
	if (!data) throw new Error("captureScreenshot returned no data: " + JSON.stringify(res).slice(0, 300));
	writeFileSync(out, Buffer.from(data, "base64"));
	console.log(`  captured ${out}  (${clip.width}x${clip.height} css px @${rect.dpr}x)`);
}

try {
	console.log("before…"); const rb = evalRuntime("before"); capture(rb, beforeOut);
	console.log("after…"); const ra = evalRuntime("after"); capture(ra, afterOut);
} finally {
	console.log("cleanup…"); evalRuntime("cleanup");
}
console.log("done");
