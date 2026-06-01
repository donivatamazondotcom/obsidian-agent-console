/**
 * Minimal type declaration for `sharp` — enough for tsc to pass without
 * installing the package. The real `@types/sharp` or `sharp`'s built-in
 * types will replace this once `npm i -D sharp` runs in Phase E.
 */
declare module "sharp" {
	interface SharpInstance {
		extract(region: { left: number; top: number; width: number; height: number }): SharpInstance;
		resize(width: number, height: number): SharpInstance;
		webp(opts?: { quality?: number }): SharpInstance;
		toFile(path: string): Promise<unknown>;
	}
	function sharp(input: string): SharpInstance;
	export default sharp;
}
