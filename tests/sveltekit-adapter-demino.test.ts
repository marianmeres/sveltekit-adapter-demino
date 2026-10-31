import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Builder } from "@sveltejs/kit";
import adapter, { CACHE_DEFAULTS } from "../src/sveltekit-adapter-demino.ts";

function assertIncludes(actual: string, expected: string): void {
	assert.ok(actual.includes(expected), `expected output to include ${expected}`);
}

test("adapter factory returns valid Adapter object", () => {
	const a = adapter();
	assert.equal(a.name, "adapter-demino");
	assert.equal(typeof a.adapt, "function");
});

test("adapter declares supports.read", () => {
	const a = adapter();
	assert.equal(typeof a.supports?.read, "function");
	assert.equal(
		a.supports?.read?.(
			{} as Parameters<NonNullable<NonNullable<typeof a.supports>["read"]>>[0],
		),
		true,
	);
});

test("adapter respects custom out option", () => {
	const a = adapter({ out: "custom-build" });
	assert.equal(a.name, "adapter-demino");
});

test("adapter defaults are applied", () => {
	const a = adapter({});
	assert.equal(a.name, "adapter-demino");
});

test("CACHE_DEFAULTS exports sensible values", () => {
	assert.equal(CACHE_DEFAULTS.immutable, "public, immutable, max-age=31536000");
	assert.equal(
		CACHE_DEFAULTS.prerendered,
		"public, max-age=600, stale-while-revalidate=86400",
	);
	assert.equal(CACHE_DEFAULTS.assets, "public, max-age=86400");
});

test("adapter accepts cacheControl overrides", () => {
	const a = adapter({
		cacheControl: {
			prerendered: "public, s-maxage=3600, stale-while-revalidate=86400",
			assets: false,
		},
	});
	assert.equal(a.name, "adapter-demino");
});

test("adapter accepts all cacheControl set to false", () => {
	const a = adapter({
		cacheControl: {
			immutable: false,
			prerendered: false,
			assets: false,
		},
	});
	assert.equal(a.name, "adapter-demino");
});

// Minimal Builder stub sufficient to drive adapter.adapt().
function createFakeBuilder(tmp: string): Builder {
	return {
		getBuildDirectory: (name: string) => `${tmp}/.svelte-kit/${name}`,
		rimraf: (path: string) => rmSync(path, { recursive: true, force: true }),
		mkdirp: (path: string) => mkdirSync(path, { recursive: true }),
		writeClient: (path: string) => {
			mkdirSync(path, { recursive: true });
			return [];
		},
		writePrerendered: (path: string) => {
			mkdirSync(path, { recursive: true });
			return [];
		},
		writeServer: (path: string) => {
			mkdirSync(path, { recursive: true });
			return [];
		},
		generateManifest: () => `{ /* stub manifest */ }`,
		prerendered: {
			redirects: new Map([["/old", { status: 308, location: "/new" }]]),
			pages: new Map([
				["/about", { file: "about.html" }],
				["/", { file: "index.html" }],
			]),
		},
		log: {
			minor: () => {},
		},
	} as unknown as Builder;
}

async function buildHandlerString(
	opts: Parameters<typeof adapter>[0] = {},
): Promise<string> {
	const tmp = await mkdtemp(join(tmpdir(), "adapter-demino-test-"));
	const out = `${tmp}/build`;
	try {
		const a = adapter({ ...opts, out });
		await a.adapt(createFakeBuilder(tmp));
		return await readFile(`${out}/handler.js`, "utf-8");
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}

test("generateHandler: read() returns a web ReadableStream via node:fs", async () => {
	const src = await buildHandlerString();
	// Must open the file and convert the Node stream, not return it directly.
	assertIncludes(src, "createReadStream(");
	assertIncludes(src, "Readable.toWeb(");
});

test("generateHandler: output is runtime-portable (no Deno., jsr:, serveDir)", async () => {
	const src = await buildHandlerString();
	for (const needle of ["Deno.", "jsr:", "serveDir"]) {
		assert.equal(src.includes(needle), false, `must not contain "${needle}"`);
	}
});

test("generateHandler: embeds default cacheControl values", async () => {
	const src = await buildHandlerString();
	assertIncludes(src, CACHE_DEFAULTS.immutable);
	assertIncludes(src, CACHE_DEFAULTS.prerendered);
	assertIncludes(src, CACHE_DEFAULTS.assets);
});

test("generateHandler: cacheControl=false serialises to null", async () => {
	const src = await buildHandlerString({
		cacheControl: { immutable: false, prerendered: false, assets: false },
	});
	assertIncludes(src, `"immutable":null`);
	assertIncludes(src, `"prerendered":null`);
	assertIncludes(src, `"assets":null`);
});

test("generateHandler: embeds prerendered pages and redirects", async () => {
	const src = await buildHandlerString();
	// Pages from the fake builder should appear in the prerenderedPages Set literal.
	assertIncludes(src, `"/about"`);
	// Redirects should appear in the Map literal.
	assertIncludes(src, `"/old"`);
	assertIncludes(src, `"/new"`);
});

test("generateHandler: falls through to SSR on 404/405 only", async () => {
	const src = await buildHandlerString();
	assertIncludes(src, "staticRes.status !== 404");
	assertIncludes(src, "staticRes.status !== 405");
});

test("generateHandler: uses native HEAD support (no HEAD→GET rewrite)", async () => {
	const src = await buildHandlerString();
	// The old workaround constructed a fresh Request with method: 'GET' for HEAD.
	// After the refactor it should be gone.
	const hasWorkaround = /method:\s*['"]GET['"]/.test(src);
	assert.equal(hasWorkaround, false, "HEAD→GET workaround should be removed");
});

test("generateHandler: never mutates staticRes.headers", async () => {
	const src = await buildHandlerString();
	// Cache-Control goes in through serveStatic's `headers` option; a static
	// response's headers may be immutable, so .set/.append/.delete could throw.
	assert.equal(
		/staticRes\.headers\.(set|append|delete)\b/.test(src),
		false,
		"must not mutate staticRes.headers (immutable)",
	);
});

test("generateHandler: applies Cache-Control via serveStatic headers (no clone)", async () => {
	const src = await buildHandlerString();
	assertIncludes(src, "serveStatic(req, {");
	assertIncludes(src, "'cache-control'");
	assert.equal(src.includes("new Response(staticRes.body"), false);
});

// The generated handler is executed, not just inspected. It lives under the repo's
// gitignored tmp/ so its bare `@marianmeres/demino` import resolves from this repo's
// node_modules (a dev dependency); ./server/index.js is replaced by a stub SvelteKit
// Server.
const RUNTIME_TMP = fileURLToPath(new URL("../tmp/", import.meta.url));

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

interface StubInitOptions {
	env: Record<string, string>;
	read: (file: string) => Promise<ReadableStream | null>;
}

type GeneratedHandler = (
	req: Request,
	info?: { remoteAddr?: { hostname?: string } },
) => Promise<Response>;

async function withGeneratedHandler(
	opts: Parameters<typeof adapter>[0],
	fn: (handler: GeneratedHandler, initOptions: StubInitOptions) => Promise<void>,
): Promise<void> {
	await mkdir(RUNTIME_TMP, { recursive: true });
	const tmp = await mkdtemp(join(RUNTIME_TMP, "adapter-demino-runtime-"));
	const out = join(tmp, "build");
	try {
		await adapter({ ...opts, out }).adapt(createFakeBuilder(tmp));
		await writeFile(join(out, "server/index.js"), STUB_SERVER);
		await mkdir(join(out, "client/_app/immutable"), { recursive: true });
		await writeFile(join(out, "client/hello.txt"), "hello");
		await writeFile(join(out, "client/_app/immutable/x.js"), "export {};");
		await writeFile(join(out, "client/index.html"), "<p>home</p>");

		const { handler } = await import(pathToFileURL(join(out, "handler.js")).href);
		const stub = await import(pathToFileURL(join(out, "server/index.js")).href);
		await fn(handler, stub.initOptions);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}

const url = (path: string) => `http://localhost${path}`;

test("handler.js runtime: init receives env and a working read()", async () => {
	process.env.ADAPTER_DEMINO_TEST_ENV = "1";
	try {
		await withGeneratedHandler({}, async (_handler, init) => {
			assert.equal(Object.getPrototypeOf(init.env), Object.prototype);
			assert.equal(init.env.ADAPTER_DEMINO_TEST_ENV, "1");

			const stream = await init.read("hello.txt");
			assert.ok(stream instanceof ReadableStream);
			assert.equal(await new Response(stream).text(), "hello");

			assert.equal(await init.read("missing.txt"), null);
			assert.equal(await init.read("_app"), null); // a directory
		});
	} finally {
		delete process.env.ADAPTER_DEMINO_TEST_ENV;
	}
});

test("handler.js runtime: static files, cache-control, HEAD, SSR fallthrough", async () => {
	await withGeneratedHandler({}, async (handler) => {
		let res = await handler(new Request(url("/hello.txt")));
		assert.equal(res.status, 200);
		assert.equal(await res.text(), "hello");
		assert.ok(res.headers.get("etag"));
		assert.equal(res.headers.get("cache-control"), CACHE_DEFAULTS.assets);

		res = await handler(new Request(url("/hello.txt"), { method: "HEAD" }));
		assert.equal(res.status, 200);
		assert.equal(await res.text(), "");
		assert.equal(res.headers.get("content-length"), "5");

		res = await handler(new Request(url("/_app/immutable/x.js")));
		assert.equal(res.status, 200);
		await res.body?.cancel();
		assert.equal(res.headers.get("cache-control"), CACHE_DEFAULTS.immutable);

		// "/" is prerendered in the fake builder; served as the directory index.
		res = await handler(new Request(url("/")));
		assert.equal(res.status, 200);
		assert.equal(await res.text(), "<p>home</p>");
		assert.equal(res.headers.get("cache-control"), CACHE_DEFAULTS.prerendered);

		res = await handler(new Request(url("/old")));
		assert.equal(res.status, 308);
		assert.equal(res.headers.get("location"), "/new");

		res = await handler(new Request(url("/missing")), {
			remoteAddr: { hostname: "1.2.3.4" },
		});
		assert.equal(await res.text(), "ssr:/missing:1.2.3.4");

		res = await handler(new Request(url("/missing")));
		assert.equal(await res.text(), "ssr:/missing:127.0.0.1");

		// Non-GET/HEAD skips static serving even for an existing file.
		res = await handler(new Request(url("/hello.txt"), { method: "POST" }));
		assert.equal(await res.text(), "ssr:/hello.txt:127.0.0.1");
	});
});

test("handler.js runtime: cacheControl=false sets no header", async () => {
	await withGeneratedHandler({ cacheControl: { assets: false } }, async (handler) => {
		const res = await handler(new Request(url("/hello.txt")));
		assert.equal(res.status, 200);
		assert.equal(await res.text(), "hello");
		assert.equal(res.headers.get("cache-control"), null);
	});
});
