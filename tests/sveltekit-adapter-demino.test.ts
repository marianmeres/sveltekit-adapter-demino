import { assertEquals } from "@std/assert";
import adapter, { CACHE_DEFAULTS } from "../src/sveltekit-adapter-demino.ts";

Deno.test("adapter factory returns valid Adapter object", () => {
	const a = adapter();
	assertEquals(a.name, "adapter-demino");
	assertEquals(typeof a.adapt, "function");
});

Deno.test("adapter respects custom out option", () => {
	const a = adapter({ out: "custom-build" });
	assertEquals(a.name, "adapter-demino");
});

Deno.test("adapter defaults are applied", () => {
	const a = adapter({});
	assertEquals(a.name, "adapter-demino");
});

Deno.test("CACHE_DEFAULTS exports sensible values", () => {
	assertEquals(CACHE_DEFAULTS.immutable, "public, immutable, max-age=31536000");
	assertEquals(CACHE_DEFAULTS.prerendered, "public, max-age=600, stale-while-revalidate=86400");
	assertEquals(CACHE_DEFAULTS.assets, "public, max-age=86400");
});

Deno.test("adapter accepts cacheControl overrides", () => {
	const a = adapter({
		cacheControl: {
			prerendered: "public, s-maxage=3600, stale-while-revalidate=86400",
			assets: false,
		},
	});
	assertEquals(a.name, "adapter-demino");
});

Deno.test("adapter accepts all cacheControl set to false", () => {
	const a = adapter({
		cacheControl: {
			immutable: false,
			prerendered: false,
			assets: false,
		},
	});
	assertEquals(a.name, "adapter-demino");
});
