import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Builder } from "@sveltejs/kit";
import adapter, { CACHE_DEFAULTS } from "../src/sveltekit-adapter-demino.ts";

Deno.test("adapter factory returns valid Adapter object", () => {
	const a = adapter();
	assertEquals(a.name, "adapter-demino");
	assertEquals(typeof a.adapt, "function");
});

Deno.test("adapter declares supports.read", () => {
	const a = adapter();
	assertEquals(typeof a.supports?.read, "function");
	assertEquals(
		a.supports!.read!(
			{} as Parameters<NonNullable<NonNullable<typeof a.supports>["read"]>>[0],
		),
		true,
	);
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

// Minimal Builder stub sufficient to drive adapter.adapt().
function createFakeBuilder(tmp: string): Builder {
	return {
		getBuildDirectory: (name: string) => `${tmp}/.svelte-kit/${name}`,
		rimraf: (path: string) => {
			try {
				Deno.removeSync(path, { recursive: true });
			} catch {
				// ignore missing
			}
		},
		mkdirp: (path: string) => Deno.mkdirSync(path, { recursive: true }),
		writeClient: (path: string) => {
			Deno.mkdirSync(path, { recursive: true });
			return [];
		},
		writePrerendered: (path: string) => {
			Deno.mkdirSync(path, { recursive: true });
			return [];
		},
		writeServer: (path: string) => {
			Deno.mkdirSync(path, { recursive: true });
			return [];
		},
		generateManifest: () => `{ /* stub manifest */ }`,
		prerendered: {
			redirects: new Map([
				["/old", { status: 308, location: "/new" }],
			]),
			pages: new Map([
				["/about", { file: "about.html" }],
				["/", { file: "index.html" }],
			]),
			// deno-lint-ignore no-explicit-any
		} as any,
		log: {
			minor: () => {},
			// deno-lint-ignore no-explicit-any
		} as any,
		// deno-lint-ignore no-explicit-any
	} as any;
}

async function buildHandlerString(
	opts: Parameters<typeof adapter>[0] = {},
): Promise<string> {
	const tmp = await Deno.makeTempDir({ prefix: "adapter-demino-test-" });
	const out = `${tmp}/build`;
	try {
		const a = adapter({ ...opts, out });
		await a.adapt(createFakeBuilder(tmp));
		return await Deno.readTextFile(`${out}/handler.js`);
	} finally {
		await Deno.remove(tmp, { recursive: true });
	}
}

Deno.test("generateHandler: read() returns ReadableStream (not Deno.FsFile)", async () => {
	const src = await buildHandlerString();
	// Must access `.readable` on the opened file, not return the FsFile directly.
	assertStringIncludes(src, ".readable");
	// And it must actually open a file.
	assertStringIncludes(src, "Deno.open(");
});

Deno.test("generateHandler: embeds default cacheControl values", async () => {
	const src = await buildHandlerString();
	assertStringIncludes(src, CACHE_DEFAULTS.immutable);
	assertStringIncludes(src, CACHE_DEFAULTS.prerendered);
	assertStringIncludes(src, CACHE_DEFAULTS.assets);
});

Deno.test("generateHandler: cacheControl=false serialises to null", async () => {
	const src = await buildHandlerString({
		cacheControl: { immutable: false, prerendered: false, assets: false },
	});
	assertStringIncludes(src, `"immutable":null`);
	assertStringIncludes(src, `"prerendered":null`);
	assertStringIncludes(src, `"assets":null`);
});

Deno.test("generateHandler: embeds prerendered pages and redirects", async () => {
	const src = await buildHandlerString();
	// Pages from the fake builder should appear in the prerenderedPages Set literal.
	assertStringIncludes(src, `"/about"`);
	// Redirects should appear in the Map literal.
	assertStringIncludes(src, `"/old"`);
	assertStringIncludes(src, `"/new"`);
});

Deno.test("generateHandler: falls through to SSR on 404/405 only", async () => {
	const src = await buildHandlerString();
	assertStringIncludes(src, "staticRes.status !== 404");
	assertStringIncludes(src, "staticRes.status !== 405");
});

Deno.test("generateHandler: uses native HEAD support (no HEAD→GET rewrite)", async () => {
	const src = await buildHandlerString();
	// The old workaround constructed a fresh Request with method: 'GET' for HEAD.
	// After the refactor it should be gone.
	const hasWorkaround = /method:\s*['"]GET['"]/.test(src);
	assertEquals(hasWorkaround, false, "HEAD→GET workaround should be removed");
});

Deno.test("generateHandler: never mutates staticRes.headers", async () => {
	const src = await buildHandlerString();
	// Response headers from serveDir() are immutable — any .set/.append/.delete
	// on staticRes.headers throws at runtime.
	assertEquals(
		/staticRes\.headers\.(set|append|delete)\b/.test(src),
		false,
		"must not mutate staticRes.headers (immutable)",
	);
});

Deno.test("generateHandler: clones response when Cache-Control applies", async () => {
	const src = await buildHandlerString();
	assertStringIncludes(src, "new Headers(staticRes.headers)");
	assertStringIncludes(src, "new Response(staticRes.body");
});
