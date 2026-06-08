/**
 * css-audit: extract-targets
 *
 * Parses styles.css and emits the set of (selector, [forced properties]) pairs —
 * one entry per individual selector (comma groups are split) that carries at least
 * one `!important` declaration. This is the manifest the snapshot/diff net measures
 * against, so the cleanup can be proven appearance-preserving.
 *
 * See spec: 04-initiatives/Agent Console/Agent Console Plugin Store Warnings.md
 *
 * Output: tools/css-audit/targets.json
 *   [{ selector, props: [...], line, pseudo: bool }]
 *
 * `pseudo: true` marks selectors with a state/pseudo component
 * (:hover/:focus/:active/:disabled/::before/::after, or a state modifier class)
 * that plain getComputedStyle on the base element cannot reproduce — these need
 * the snapshot net to force the state, or a manual spot-check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const cssPath = fileURLToPath(new URL("../../styles.css", import.meta.url));
const outPath = fileURLToPath(new URL("./targets.json", import.meta.url));

const css = readFileSync(cssPath, "utf8");
const root = postcss.parse(css);

const PSEUDO_RE = /:(hover|focus|focus-visible|focus-within|active|disabled|checked|:before|:after|placeholder)|::(before|after|placeholder)/i;

const targets = [];
root.walkRules((rule) => {
	// Skip @keyframes frame rules (selectors like "0%", "to") — not real elements.
	if (rule.parent && rule.parent.type === "atrule") return;

	const importantProps = [];
	rule.walkDecls((decl) => {
		if (decl.important) importantProps.push(decl.prop);
	});
	if (importantProps.length === 0) return;

	for (const sel of rule.selectors) {
		const selector = sel.replace(/\s+/g, " ").trim();
		targets.push({
			selector,
			props: importantProps,
			line: rule.source && rule.source.start ? rule.source.start.line : null,
			pseudo: PSEUDO_RE.test(selector),
		});
	}
});

writeFileSync(outPath, JSON.stringify(targets, null, 2) + "\n");

const distinct = new Set(targets.map((t) => t.selector));
const pseudoCount = targets.filter((t) => t.pseudo).length;
const totalImportant = targets.reduce((n, t) => n + t.props.length, 0);
console.log(
	`extracted ${targets.length} target entries ` +
		`(${distinct.size} distinct selectors, ${totalImportant} !important decls, ${pseudoCount} pseudo/state)`,
);
console.log(`wrote ${outPath}`);
