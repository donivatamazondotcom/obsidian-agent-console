/**
 * I72: Init-window image paste shows a misleading "unsupported image" notice.
 *
 * Root cause: `supportsImages = session.promptCapabilities?.image ?? false`
 * collapses two distinct states into `false`:
 *   - Unknown      → promptCapabilities undefined (caps not loaded yet; transient init window)
 *   - Unsupported  → promptCapabilities.image === false (agent advertised no image support)
 * A clipboard screenshot pasted in the Unknown window misfires the permanent
 * "this agent does not support image paste" notice.
 *
 * `classifyImagePaste` separates the two so the paste/drop handlers can show an
 * accurate transient message instead.
 *
 * Test gate per SDLC § Stack-Trace Patch Anti-Pattern:
 *  - PRE-FIX: ../image-paste does not exist → import throws → FAILS
 *  - POST-FIX: classifier returns the right outcome per state → PASSES
 *
 * Covers spec test cases T-I72a (connecting), T-I72b (unsupported),
 * T-I72c (supported). See [[I72 ...]] in the vault.
 */

import { describe, it, expect } from "vitest";
import {
	classifyImagePaste,
	IMAGE_PASTE_CONNECTING_NOTICE,
	IMAGE_PASTE_UNSUPPORTED_NOTICE,
} from "../image-paste";

describe("I72: classifyImagePaste — distinguish 'unknown' from 'unsupported'", () => {
	// T-I72c: agent supports images → attach
	it("returns 'attach-as-image' when the agent supports images", () => {
		expect(
			classifyImagePaste({
				supportsImages: true,
				imageCapabilityKnown: true,
			}),
		).toBe("attach-as-image");
	});

	// T-I72a / T-I72d core: caps not loaded yet → transient, NOT unsupported
	it("returns 'connecting' when capabilities are not yet known (init window)", () => {
		expect(
			classifyImagePaste({
				supportsImages: false,
				imageCapabilityKnown: false,
			}),
		).toBe("connecting");
	});

	// T-I72b: caps known and image:false → genuine unsupported path
	it("returns 'fallback-or-unsupported' when caps are known and images are unsupported", () => {
		expect(
			classifyImagePaste({
				supportsImages: false,
				imageCapabilityKnown: true,
			}),
		).toBe("fallback-or-unsupported");
	});

	// supportsImages true implies caps known; the known flag must not override it.
	it("treats supportsImages=true as image-capable regardless of the known flag", () => {
		expect(
			classifyImagePaste({
				supportsImages: true,
				imageCapabilityKnown: false,
			}),
		).toBe("attach-as-image");
	});

	it("connecting and unsupported notices are distinct, accurate copy", () => {
		expect(IMAGE_PASTE_CONNECTING_NOTICE).not.toBe(
			IMAGE_PASTE_UNSUPPORTED_NOTICE,
		);
		expect(IMAGE_PASTE_CONNECTING_NOTICE).toMatch(/connecting/i);
		expect(IMAGE_PASTE_UNSUPPORTED_NOTICE).toMatch(
			/does not support image/i,
		);
	});
});
