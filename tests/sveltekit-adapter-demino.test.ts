import {
	assertEquals,
	assertExists,
	assertInstanceOf,
	assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
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

Deno.test("generateHandler: read() returns a web ReadableStream via node:fs", async () => {
	const src = await buildHandlerString();
	// Must open the file and convert the Node stream, not return it directly.
	assertStringIncludes(src, "createReadStream(");
	assertStringIncludes(src, "Readable.toWeb(");
});

Deno.test("generateHandler: output is runtime-portable (no Deno., jsr:, serveDir)", async () => {
	const src = await buildHandlerString();
	for (const needle of ["Deno.", "jsr:", "serveDir"]) {
		assertEquals(src.includes(needle), false, `must not contain "${needle}"`);
	}
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
	// Cache-Control goes in through serveStatic's `headers` option; a static
	// response's headers may be immutable, so .set/.append/.delete could throw.
	assertEquals(
		/staticRes\.headers\.(set|append|delete)\b/.test(src),
		false,
		"must not mutate staticRes.headers (immutable)",
	);
});

Deno.test("generateHandler: applies Cache-Control via serveStatic headers (no clone)", async () => {
	const src = await buildHandlerString();
	assertStringIncludes(src, "serveStatic(req, {");
	assertStringIncludes(src, "'cache-control'");
	assertEquals(src.includes("new Response(staticRes.body"), false);
});

// The generated handler is executed, not just inspected. It lives under the repo's
// gitignored tmp/ so its bare `@marianmeres/demino` import resolves through this
// repo's import map; ./server/index.js is replaced by a stub SvelteKit Server.
const RUNTIME_TMP = fromFileUrl(new URL("../tmp/", import.meta.url));

const STUB_SERVER = `\
export let initOptions = null;
export class Server {
	constructor() {}
	async init(o) { initOptions = o; }
	async respond(req, { getClientAddress }) {
		return new Response('ssr:' + new URL(req.url).pathname + ':' + getClientAddress());
	}
}
`;

async function withGeneratedHandler(
	opts: Parameters<typeof adapter>[0],
	fn: (
		// deno-lint-ignore no-explicit-any
		handler: (req: Request, info?: any) => Promise<Response>,
		// deno-lint-ignore no-explicit-any
		initOptions: any,
	) => Promise<void>,
): Promise<void> {
	await Deno.mkdir(RUNTIME_TMP, { recursive: true });
	const tmp = await Deno.makeTempDir({
		dir: RUNTIME_TMP,
		prefix: "adapter-demino-runtime-",
	});
	const out = join(tmp, "build");
	try {
		await adapter({ ...opts, out }).adapt(createFakeBuilder(tmp));
		await Deno.writeTextFile(join(out, "server/index.js"), STUB_SERVER);
		await Deno.mkdir(join(out, "client/_app/immutable"), { recursive: true });
		await Deno.writeTextFile(join(out, "client/hello.txt"), "hello");
		await Deno.writeTextFile(join(out, "client/_app/immutable/x.js"), "export {};");
		await Deno.writeTextFile(join(out, "client/index.html"), "<p>home</p>");

		const { handler } = await import(toFileUrl(join(out, "handler.js")).href);
		const stub = await import(toFileUrl(join(out, "server/index.js")).href);
		await fn(handler, stub.initOptions);
	} finally {
		await Deno.remove(tmp, { recursive: true });
	}
}

const url = (path: string) => `http://localhost${path}`;

Deno.test("handler.js runtime: init receives env and a working read()", async () => {
	Deno.env.set("ADAPTER_DEMINO_TEST_ENV", "1");
	try {
		await withGeneratedHandler({}, async (_handler, init) => {
			assertEquals(Object.getPrototypeOf(init.env), Object.prototype);
			assertEquals(init.env.ADAPTER_DEMINO_TEST_ENV, "1");

			const stream = await init.read("hello.txt");
			assertInstanceOf(stream, ReadableStream);
			assertEquals(
				await new Response(stream as ReadableStream<Uint8Array>).text(),
				"hello",
			);

			assertEquals(await init.read("missing.txt"), null);
			assertEquals(await init.read("_app"), null); // a directory
		});
	} finally {
		Deno.env.delete("ADAPTER_DEMINO_TEST_ENV");
	}
});

Deno.test("handler.js runtime: static files, cache-control, HEAD, SSR fallthrough", async () => {
	await withGeneratedHandler({}, async (handler) => {
		let res = await handler(new Request(url("/hello.txt")));
		assertEquals(res.status, 200);
		assertEquals(await res.text(), "hello");
		assertExists(res.headers.get("etag"));
		assertEquals(res.headers.get("cache-control"), CACHE_DEFAULTS.assets);

		res = await handler(new Request(url("/hello.txt"), { method: "HEAD" }));
		assertEquals(res.status, 200);
		assertEquals(await res.text(), "");
		assertEquals(res.headers.get("content-length"), "5");

		res = await handler(new Request(url("/_app/immutable/x.js")));
		assertEquals(res.status, 200);
		await res.body?.cancel();
		assertEquals(res.headers.get("cache-control"), CACHE_DEFAULTS.immutable);

		// "/" is prerendered in the fake builder; served as the directory index.
		res = await handler(new Request(url("/")));
		assertEquals(res.status, 200);
		assertEquals(await res.text(), "<p>home</p>");
		assertEquals(res.headers.get("cache-control"), CACHE_DEFAULTS.prerendered);

		res = await handler(new Request(url("/old")));
		assertEquals(res.status, 308);
		assertEquals(res.headers.get("location"), "/new");

		res = await handler(new Request(url("/missing")), {
			remoteAddr: { hostname: "1.2.3.4" },
		});
		assertEquals(await res.text(), "ssr:/missing:1.2.3.4");

		res = await handler(new Request(url("/missing")));
		assertEquals(await res.text(), "ssr:/missing:127.0.0.1");

		// Non-GET/HEAD skips static serving even for an existing file.
		res = await handler(new Request(url("/hello.txt"), { method: "POST" }));
		assertEquals(await res.text(), "ssr:/hello.txt:127.0.0.1");
	});
});

Deno.test("handler.js runtime: cacheControl=false sets no header", async () => {
	await withGeneratedHandler({ cacheControl: { assets: false } }, async (handler) => {
		const res = await handler(new Request(url("/hello.txt")));
		assertEquals(res.status, 200);
		assertEquals(await res.text(), "hello");
		assertEquals(res.headers.get("cache-control"), null);
	});
});
