/**
 * Minimal type declaration for `sharp` — enough for tsc to pass without
 * relying on the package's bundled types. Covers the subset used by the
 * screenshot tooling (crop/resize/encode plus drop-shadow compositing).
 */
declare module "sharp" {
	interface SharpInstance {
		extract(region: { left: number; top: number; width: number; height: number }): SharpInstance;
		resize(width: number, height: number): SharpInstance;
		webp(opts?: { quality?: number }): SharpInstance;
		png(): SharpInstance;
		blur(sigma?: number): SharpInstance;
		composite(images: Array<{ input: string | Buffer; left?: number; top?: number }>): SharpInstance;
		metadata(): Promise<{ width?: number; height?: number; hasAlpha?: boolean }>;
		toBuffer(): Promise<Buffer>;
		toFile(path: string): Promise<unknown>;
	}
	interface CreateInput {
		create: {
			width: number;
			height: number;
			channels: number;
			background: { r: number; g: number; b: number; alpha: number };
		};
	}
	function sharp(input?: string | Buffer | CreateInput): SharpInstance;
	namespace sharp {
		function cache(enabled: boolean): void;
	}
	export default sharp;
}
