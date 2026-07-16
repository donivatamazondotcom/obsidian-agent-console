/**
 * Frozen A2UI v1.0-candidate spec snapshot for the `buttons-v0` profile.
 *
 * The plugin pins the A2UI v1.0 candidate (verified against
 * https://a2ui.org/specification/v1.0-a2ui/ on 2026-07-15) and freezes the
 * tiny surface area the profile consumes here, so upstream candidate churn
 * cannot silently change what the trust boundary accepts. Update this file
 * deliberately, never by re-deriving from the live spec at runtime.
 *
 * Profile: exactly one `createSurface` envelope per fence, inline components,
 * literal values only — no data model, no bindings, no functions, no checks.
 */

/** The only version the client teaches and advertises. */
export const A2UI_VERSION = "v1.0";

/**
 * Versions tolerated at parse for the message shapes we accept (Postel:
 * strict out, tolerant in). v0.9.1 single-envelope createSurface shapes are
 * identical at this profile's depth.
 */
export const A2UI_TOLERATED_VERSIONS: readonly string[] = ["v0.9.1"];

/** The profile catalog id taught by the briefing and advertised in _meta. */
export const BUTTONS_V0_CATALOG_ID =
	"https://agentconsole.dev/a2ui/catalogs/buttons-v0";

/**
 * A2UI's own Basic Catalog id, tolerated inbound under the same profile
 * subset (a model regurgitating the standard id still gets the strict
 * component allowlist).
 */
export const A2UI_BASIC_CATALOG_ID =
	"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

/** Component types allowed in `buttons-v0` (strict subset of the Basic Catalog). */
export const BUTTONS_V0_COMPONENT_TYPES: readonly string[] = [
	"Text",
	"Row",
	"Column",
	"Card",
	"Button",
	"Divider",
];

/**
 * Keys that must not appear anywhere in a `buttons-v0` envelope: data-model
 * bindings, client/server RPC, validation checks, and data-model sync are all
 * out of the profile (spec D6, D12). Presence anywhere renders the fence inert.
 */
export const BUTTONS_V0_FORBIDDEN_KEYS: readonly string[] = [
	"path",
	"call",
	"functionCall",
	"checks",
	"dataModel",
	"sendDataModel",
	"wantResponse",
];

/**
 * Agent-supplied surface identity fields are an impersonation vector — the
 * chat header already attributes the session (spec D12 / safety boundary #7).
 * Their presence inside `surfaceProperties` renders the fence inert.
 */
export const SURFACE_IDENTITY_FIELDS: readonly string[] = [
	"agentDisplayName",
	"iconUrl",
];

/** Hard limits for the trust boundary (spec § Safety boundary #2). */
export const BUTTONS_V0_LIMITS = {
	/** Exactly one envelope per fence in buttons-v0 (D6). */
	maxEnvelopesPerFence: 1,
	maxComponents: 64,
	maxTreeDepth: 8,
	maxStringLength: 2048,
	maxFenceBytes: 32768,
	maxActiveSurfacesPerSession: 8,
} as const;

/** surfaceId shape taught by the briefing: kebab-case. */
export const SURFACE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * UAX #31 identifier rule for event/context names (A2UI v1.0 catalog entity
 * naming; canonical regex from the spec).
 */
export const UAX31_IDENTIFIER_PATTERN = /^[\p{XID_Start}_][\p{XID_Continue}]*$/u;
