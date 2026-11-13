/**
 * CRC-32 (IEEE 802.3, the one Python's `zlib.crc32` computes) over a
 * string's UTF-8 bytes. Pure, no Obsidian (a utils leaf).
 *
 * Used as the `crc` integrity check on quick-prompt links: the sender
 * computes it over the link's `selection`, and the plugin refuses a link
 * whose text doesn't match. It is a check against damage, not authenticity.
 *
 * Spec: [[Agent Console Fresh-Session Handoff]] § Plugin change.
 */

const TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

/** The CRC-32 of `text` encoded as UTF-8, as an unsigned 32-bit number. */
export function crc32(text: string): number {
	const bytes = new TextEncoder().encode(text);
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/** The CRC-32 of `text` as eight lowercase hex digits, zero-padded. */
export function crc32Hex(text: string): string {
	return crc32(text).toString(16).padStart(8, "0");
}
