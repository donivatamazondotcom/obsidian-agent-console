/**
 * Trust-boundary validator for `buttons-v0` fences (probe checks V02–V14).
 *
 * Total and no-throw: any input string produces either a validated surface or
 * a violation list — never an exception, never a coerced half-valid shape
 * (repo tenet: fail loud, drop-and-log; spec § Safety boundary). Runs once at
 * the fence-close edge, not per render.
 *
 * Check order follows the probe's validator spec: line shape (V02), JSON
 * (V03), envelope (V04), version (V05), surfaceId (V06), catalog (V07),
 * component list (V08), types (V09), graph (V10), button contract (V11),
 * forbidden keys (V12), limits (V13), orphans (V14 — warn only).
 */
import {
	A2UI_BASIC_CATALOG_ID,
	A2UI_TOLERATED_VERSIONS,
	A2UI_VERSION,
	BUTTONS_V0_CATALOG_ID,
	BUTTONS_V0_COMPONENT_TYPES,
	BUTTONS_V0_FORBIDDEN_KEYS,
	BUTTONS_V0_LIMITS,
	SURFACE_ID_PATTERN,
	SURFACE_IDENTITY_FIELDS,
	UAX31_IDENTIFIER_PATTERN,
} from "./spec-snapshot";
import type {
	A2uiButtonEvent,
	A2uiComponent,
	A2uiFenceValidation,
	A2uiValidateOptions,
	A2uiViolation,
} from "./types";

type ContainerType = "Row" | "Column" | "Card";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiteral(value: unknown): value is string | number | boolean {
	const t = typeof value;
	return t === "string" || t === "number" || t === "boolean";
}

/** Deep-scan for forbidden object keys and oversized strings (V12, V13). */
function scanDeep(
	value: unknown,
	violations: A2uiViolation[],
	keyPath: string,
): void {
	if (typeof value === "string") {
		if (value.length > BUTTONS_V0_LIMITS.maxStringLength) {
			violations.push({
				code: "over-limit",
				detail: `string at ${keyPath} exceeds ${BUTTONS_V0_LIMITS.maxStringLength} chars (${value.length})`,
			});
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((v, i) => scanDeep(v, violations, `${keyPath}[${i}]`));
		return;
	}
	if (isPlainObject(value)) {
		for (const [key, v] of Object.entries(value)) {
			if (BUTTONS_V0_FORBIDDEN_KEYS.includes(key)) {
				violations.push({
					code: "forbidden-key",
					detail: `"${key}" at ${keyPath}`,
				});
			}
			scanDeep(v, violations, `${keyPath}.${key}`);
		}
	}
}

interface RawComponentEntry {
	id: string;
	raw: Record<string, unknown>;
}

/** Parse one raw component into the typed union; null on shape violations (already reported). */
function parseComponent(
	entry: RawComponentEntry,
	violations: A2uiViolation[],
): A2uiComponent | null {
	const { id, raw } = entry;
	const type = raw.component;

	if (
		typeof type !== "string" ||
		!BUTTONS_V0_COMPONENT_TYPES.includes(type)
	) {
		violations.push({
			code: "unknown-component-type",
			detail: `component "${id}" has type ${JSON.stringify(type)}`,
		});
		return null;
	}

	if (type === "Text") {
		if (typeof raw.text !== "string") {
			violations.push({
				code: "bad-components",
				detail: `Text "${id}" needs a literal string "text"`,
			});
			return null;
		}
		return { kind: "text", id, text: raw.text };
	}

	if (type === "Divider") {
		return { kind: "divider", id };
	}

	if (type === "Button") {
		return parseButton(id, raw, violations);
	}

	// Containers: accept `children` (array) or `child` (single ref) — the
	// v1.0 spec example uses `child` on Card while the probe corpus uses
	// `children`; both passed the gate.
	const hasChildren = raw.children !== undefined;
	const hasChild = raw.child !== undefined;
	if (hasChildren && hasChild) {
		violations.push({
			code: "bad-components",
			detail: `container "${id}" sets both "child" and "children"`,
		});
		return null;
	}
	let children: string[] = [];
	if (hasChildren) {
		if (
			!Array.isArray(raw.children) ||
			raw.children.some((c) => typeof c !== "string")
		) {
			violations.push({
				code: "bad-components",
				detail: `container "${id}" children must be an array of component ids`,
			});
			return null;
		}
		children = raw.children as string[];
	} else if (hasChild) {
		if (typeof raw.child !== "string") {
			violations.push({
				code: "bad-components",
				detail: `container "${id}" child must be a component id`,
			});
			return null;
		}
		children = [raw.child];
	}
	return {
		kind: "container",
		id,
		component: type as ContainerType,
		children,
	};
}

function parseButton(
	id: string,
	raw: Record<string, unknown>,
	violations: A2uiViolation[],
): A2uiComponent | null {
	if (typeof raw.child !== "string") {
		violations.push({
			code: "bad-button",
			detail: `Button "${id}" needs a "child" Text reference`,
		});
		return null;
	}
	const action = raw.action;
	if (!isPlainObject(action) || !isPlainObject(action.event)) {
		violations.push({
			code: "bad-button",
			detail: `Button "${id}" needs action.event`,
		});
		return null;
	}
	const event = action.event;
	if (
		typeof event.name !== "string" ||
		!UAX31_IDENTIFIER_PATTERN.test(event.name)
	) {
		violations.push({
			code: "bad-button",
			detail: `Button "${id}" event name must be a UAX #31 identifier`,
		});
		return null;
	}
	const rawContext = event.context ?? {};
	if (!isPlainObject(rawContext)) {
		violations.push({
			code: "bad-button",
			detail: `Button "${id}" context must be an object`,
		});
		return null;
	}
	const context: A2uiButtonEvent["context"] = {};
	for (const [key, value] of Object.entries(rawContext)) {
		if (!isLiteral(value)) {
			violations.push({
				code: "bad-button",
				detail: `Button "${id}" context "${key}" must be a literal string, number, or boolean`,
			});
			return null;
		}
		context[key] = value;
	}
	return {
		kind: "button",
		id,
		child: raw.child,
		label: "", // resolved after the component map is built
		event: { name: event.name, context },
	};
}

/** Edges out of a component (container children + button label ref). */
function edgesOf(component: A2uiComponent): string[] {
	if (component.kind === "container") return component.children;
	if (component.kind === "button") return [component.child];
	return [];
}

/** V10 walk: dangling refs, cycles, depth; returns visited set for V14. */
function walkGraph(
	components: Map<string, A2uiComponent>,
	violations: A2uiViolation[],
): Set<string> {
	const visited = new Set<string>();
	const walk = (id: string, path: string[]): void => {
		const component = components.get(id);
		if (component === undefined) {
			violations.push({
				code: "dangling-ref",
				detail: `"${path[path.length - 1] ?? "root"}" references missing "${id}"`,
			});
			return;
		}
		if (path.includes(id)) {
			violations.push({
				code: "cycle",
				detail: `cycle through "${id}"`,
			});
			return;
		}
		const depth = path.length + 1;
		if (depth > BUTTONS_V0_LIMITS.maxTreeDepth) {
			violations.push({
				code: "depth-exceeded",
				detail: `"${id}" at depth ${depth} > ${BUTTONS_V0_LIMITS.maxTreeDepth}`,
			});
			return;
		}
		visited.add(id);
		for (const child of edgesOf(component)) {
			walk(child, [...path, id]);
		}
	};
	walk("root", []);
	return visited;
}

export function validateA2uiFence(
	body: string,
	options: A2uiValidateOptions = {},
): A2uiFenceValidation {
	const violations: A2uiViolation[] = [];

	// V13 (fence size) before anything else — don't parse oversized payloads.
	const byteLength = new TextEncoder().encode(body).length;
	if (byteLength > BUTTONS_V0_LIMITS.maxFenceBytes) {
		return {
			kind: "invalid",
			violations: [
				{
					code: "over-limit",
					detail: `fence is ${byteLength} bytes > ${BUTTONS_V0_LIMITS.maxFenceBytes}`,
				},
			],
		};
	}

	// V02: exactly one non-blank line (one envelope per fence — D6).
	const contentLines = body
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	if (contentLines.length !== 1) {
		return {
			kind: "invalid",
			violations: [
				{
					code: "not-single-line",
					detail: `expected exactly 1 envelope line, found ${contentLines.length}`,
				},
			],
		};
	}

	// V03: JSON.
	let parsed: unknown;
	try {
		parsed = JSON.parse(contentLines[0]);
	} catch (error) {
		return {
			kind: "invalid",
			violations: [
				{
					code: "invalid-json",
					detail: error instanceof Error ? error.message : String(error),
				},
			],
		};
	}

	// V04: envelope shape — exactly one message key, and it is createSurface.
	if (!isPlainObject(parsed)) {
		return {
			kind: "invalid",
			violations: [{ code: "bad-envelope", detail: "envelope must be a JSON object" }],
		};
	}
	const messageKeys = Object.keys(parsed).filter((k) => k !== "version");
	if (messageKeys.length !== 1 || messageKeys[0] !== "createSurface") {
		return {
			kind: "invalid",
			violations: [
				{
					code: "bad-envelope",
					detail: `expected exactly one "createSurface" message key, found [${messageKeys.join(", ")}]`,
				},
			],
		};
	}
	const createSurface = parsed.createSurface;
	if (!isPlainObject(createSurface)) {
		return {
			kind: "invalid",
			violations: [{ code: "bad-envelope", detail: "createSurface must be an object" }],
		};
	}

	// V05: version — v1.0, or a tolerated older shape (D5).
	const version = parsed.version;
	let toleratedVersion = false;
	if (version !== A2UI_VERSION) {
		if (
			typeof version === "string" &&
			A2UI_TOLERATED_VERSIONS.includes(version)
		) {
			toleratedVersion = true;
		} else {
			violations.push({
				code: "bad-version",
				detail: `version ${JSON.stringify(version)}`,
			});
		}
	}

	// V12 + V13 (strings): deep scan the whole createSurface payload.
	scanDeep(createSurface, violations, "createSurface");

	// V12: agent-supplied identity fields (impersonation vector, D12).
	if (isPlainObject(createSurface.surfaceProperties)) {
		for (const field of SURFACE_IDENTITY_FIELDS) {
			if (field in createSurface.surfaceProperties) {
				violations.push({
					code: "identity-field",
					detail: `surfaceProperties.${field}`,
				});
			}
		}
	}

	// V06: surfaceId.
	const surfaceId = createSurface.surfaceId;
	if (typeof surfaceId !== "string" || !SURFACE_ID_PATTERN.test(surfaceId)) {
		violations.push({
			code: "bad-surface-id",
			detail: JSON.stringify(surfaceId),
		});
	} else if (options.existingSurfaceIds?.has(surfaceId)) {
		violations.push({
			code: "duplicate-surface-id",
			detail: surfaceId,
		});
	}

	// V07: catalog — profile id, or the Basic Catalog id tolerated under the
	// same subset (D10).
	const catalogId = createSurface.catalogId;
	let toleratedCatalog = false;
	if (catalogId !== BUTTONS_V0_CATALOG_ID) {
		if (catalogId === A2UI_BASIC_CATALOG_ID) {
			toleratedCatalog = true;
		} else {
			violations.push({
				code: "bad-catalog",
				detail: JSON.stringify(catalogId),
			});
		}
	}

	// V08: component list shape.
	const rawComponents = createSurface.components;
	if (!Array.isArray(rawComponents) || rawComponents.length === 0) {
		violations.push({
			code: "bad-components",
			detail: "components must be a non-empty array",
		});
		return { kind: "invalid", violations };
	}
	if (rawComponents.length > BUTTONS_V0_LIMITS.maxComponents) {
		violations.push({
			code: "over-limit",
			detail: `${rawComponents.length} components > ${BUTTONS_V0_LIMITS.maxComponents}`,
		});
		return { kind: "invalid", violations };
	}

	const entries: RawComponentEntry[] = [];
	const seenIds = new Set<string>();
	for (const raw of rawComponents) {
		if (!isPlainObject(raw) || typeof raw.id !== "string" || raw.id === "") {
			violations.push({
				code: "bad-components",
				detail: "every component needs a string id",
			});
			continue;
		}
		if (seenIds.has(raw.id)) {
			violations.push({ code: "duplicate-component-id", detail: raw.id });
			continue;
		}
		seenIds.add(raw.id);
		entries.push({ id: raw.id, raw });
	}
	if (!seenIds.has("root")) {
		violations.push({
			code: "missing-root",
			detail: 'no component with id "root"',
		});
	}

	// V09/V11: per-component typing.
	const components = new Map<string, A2uiComponent>();
	for (const entry of entries) {
		const component = parseComponent(entry, violations);
		if (component !== null) {
			components.set(component.id, component);
		}
	}

	// Button labels must resolve to a Text child (V11).
	for (const component of components.values()) {
		if (component.kind !== "button") continue;
		const label = components.get(component.child);
		if (label === undefined) {
			// Missing target is reported by the graph walk as dangling-ref;
			// only flag non-Text targets here.
			continue;
		}
		if (label.kind !== "text") {
			violations.push({
				code: "bad-button",
				detail: `Button "${component.id}" child "${component.child}" is not a Text`,
			});
		} else {
			component.label = label.text;
		}
	}

	// V10 + V14: graph walk (only meaningful when the map is coherent so far).
	let orphanIds: string[] = [];
	if (violations.length === 0) {
		const visited = walkGraph(components, violations);
		orphanIds = [...components.keys()].filter((id) => !visited.has(id));
	}

	if (violations.length > 0) {
		return { kind: "invalid", violations };
	}

	return {
		kind: "valid",
		surface: {
			surfaceId: surfaceId as string,
			catalogId: catalogId as string,
			version: version as string,
			components,
			rootId: "root",
			tolerated: { version: toleratedVersion, catalog: toleratedCatalog },
			orphanIds,
		},
	};
}
