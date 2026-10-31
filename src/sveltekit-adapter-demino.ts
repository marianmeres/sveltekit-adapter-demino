import { writeFileSync } from "node:fs";
import type { Adapter, Builder } from "@sveltejs/kit";
import type { DenoImportsOptions } from "./deno-imports.ts";
import { emitDenoImports } from "./deno-imports.ts";

export type { DenoImportsOptions } from "./deno-imports.ts";

/**
 * Per-category Cache-Control header values.
 *
 * Each key targets a different class of static response.
 * Set to `false` to skip setting any Cache-Control header for that category.
 */
export interface CacheControlOptions {
	/** Content-hashed assets under `/_app/immutable/`.
	 *  @default "public, immutable, max-age=31536000" */
	immutable?: string | false;

	/** Prerendered HTML pages (known at build time from SvelteKit's prerender list).
	 *  @default "public, max-age=600, stale-while-revalidate=86400" */
	prerendered?: string | false;

	/** Unhashed static files — favicon, fonts, images from SvelteKit's `static/` dir.
	 *  @default "public, max-age=86400" */
	assets?: string | false;
}

/**
 * Configuration options for the SvelteKit Demino adapter.
 */
export interface AdapterOptions {
	/** Output directory for the generated handler and assets. @default "build" */
	out?: string;

	/** Cache-Control headers for static responses served from disk.
	 *  SSR responses are not affected — use SvelteKit's `handle` hook for those. */
	cacheControl?: CacheControlOptions;

	/** Emit `build/deno-imports.json` listing every bare npm specifier the
	 *  SSR bundle references, pinned to the installed version. Deno consumers
	 *  merge its `imports` into their `deno.json` `imports`; it never maps
	 *  `@marianmeres/demino`, so pointing `importMap` at it alone is not
	 *  enough. Pass `false` to disable, or an object to override defaults.
	 *  @default true */
	denoImports?: boolean | DenoImportsOptions;
}

export const CACHE_DEFAULTS: {
	readonly immutable: string;
	readonly prerendered: string;
	readonly assets: string;
} = {
	immutable: "public, immutable, max-age=31536000",
	prerendered: "public, max-age=600, stale-while-revalidate=86400",
	assets: "public, max-age=86400",
};

/**
 * Creates a SvelteKit adapter that produces a web-standard request handler.
 *
 * The adapter generates a `handler.js` file (plus `client/` and `server/` directories)
 * exporting a `(req, info) => Response` handler for
 * {@link https://www.npmjs.com/package/@marianmeres/demino demino} 2.0 on Node or Deno.
 * The handler imports `serveStatic` from `@marianmeres/demino`, which the consuming app
 * provides.
 *
 * @param options - Adapter configuration.
 * @returns A SvelteKit `Adapter` object.
 *
 * @example
 * ```js
 * // svelte.config.js
 * import adapter from "@marianmeres/sveltekit-adapter-demino";
 *
 * export default { kit: { adapter: adapter({ out: "build" }) } };
 * ```
 */
export default function adapter(options: AdapterOptions = {}): Adapter {
	const { out = "build", cacheControl: cc = {}, denoImports = true } = options;
	const cacheControl = {
		immutable: cc.immutable ?? CACHE_DEFAULTS.immutable,
		prerendered: cc.prerendered ?? CACHE_DEFAULTS.prerendered,
		assets: cc.assets ?? CACHE_DEFAULTS.assets,
	};
	const denoImportsOptions: DenoImportsOptions | null =
		denoImports === false ? null : denoImports === true ? {} : denoImports;

	return {
		name: "adapter-demino",

		// Declare that `read` from `$app/server` is supported. Without this,
		// SvelteKit may warn or error at build time for routes that use it.
		supports: { read: () => true },

		async adapt(builder: Builder) {
			const tmp = builder.getBuildDirectory("adapter-demino");

			builder.rimraf(tmp);
			builder.mkdirp(tmp);
			builder.rimraf(out);
			builder.mkdirp(out);

			// Static assets (/_app/*, static/ contents) + prerendered HTML
			// merged into a single `client` dir so one serveStatic call handles them.
			builder.log.minor("Writing client assets…");
			builder.writeClient(`${out}/client`);

			builder.log.minor("Writing prerendered pages…");
			builder.writePrerendered(`${out}/client`);

			// Server-side SvelteKit runtime
			builder.log.minor("Writing server…");
			builder.writeServer(`${out}/server`);

			// Generate handler.js with the manifest inlined
			const manifest = builder.generateManifest({
				relativePath: "./server",
			});

			const redirects = JSON.stringify([...builder.prerendered.redirects]);
			const prerenderedPages = JSON.stringify([
				...builder.prerendered.pages.keys(),
			]);

			// Resolve false → null for JSON serialization
			const ccJson = JSON.stringify({
				immutable: cacheControl.immutable || null,
				prerendered: cacheControl.prerendered || null,
				assets: cacheControl.assets || null,
			});

			const handlerSrc = generateHandler(
				manifest,
				redirects,
				prerenderedPages,
				ccJson,
			);
			writeFileSync(`${out}/handler.js`, handlerSrc, "utf-8");

			if (denoImportsOptions) {
				emitDenoImports({
					serverDir: `${out}/server`,
					outFile: `${out}/deno-imports.json`,
					cwd: process.cwd(),
					log: builder.log,
					options: denoImportsOptions,
				});
			}

			builder.log.minor(`adapter-demino: output written to ./${out}/`);
		},
	};
}

/**
 * Named export alias for the {@link adapter default} adapter factory.
 */
export { adapter };

function generateHandler(
	manifest: string,
	redirects: string,
	prerenderedPages: string,
	cacheControl: string,
): string {
	return `\
// Generated by adapter-demino — do not edit manually.
// Runs on Deno and Node under a @marianmeres/demino adapter (or any
// (req, info) => Response host). Import this from your demino server.
import { Server } from './server/index.js';
import { serveStatic } from '@marianmeres/demino';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const server = new Server(${manifest});

const __dir = fileURLToPath(new URL('.', import.meta.url));
const clientDir = join(__dir, 'client');

await server.init({
	// Copied, so SvelteKit gets a plain object on every runtime.
	env: { ...process.env },
	async read(file) {
		const path = join(clientDir, file);
		try {
			if (!statSync(path).isFile()) return null;
		} catch {
			return null;
		}
		return Readable.toWeb(createReadStream(path));
	},
});

const prerenderedRedirects = new Map(${redirects});
const prerenderedPages = new Set(${prerenderedPages});
const cacheControl = ${cacheControl};

/**
 * Cache-Control value for a static file at \`pathname\`, or null when its
 * category is disabled.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
function pickCacheControl(pathname) {
	if (pathname.startsWith('/_app/immutable/')) return cacheControl.immutable;
	if (prerenderedPages.has(pathname) || prerenderedPages.has(pathname + '/')) {
		return cacheControl.prerendered;
	}
	return cacheControl.assets;
}

/**
 * Drop-in SvelteKit request handler for demino (or any (req, info) => Response host).
 *
 * @param {Request} req
 * @param {import('@marianmeres/demino').DeminoServeInfo} [info]
 * @returns {Promise<Response>}
 */
export async function handler(req, info) {
	const url = new URL(req.url);

	// 1. Handle prerendered trailing-slash redirects.
	const redirect = prerenderedRedirects.get(url.pathname);
	if (redirect) {
		return new Response(null, {
			status: redirect.status,
			headers: { location: redirect.location },
		});
	}

	// 2. Serve static assets & prerendered HTML from the client dir.
	//    Only for GET/HEAD — other methods go straight to SSR.
	//    serveStatic handles HEAD natively (null body, full headers) and
	//    applies \`headers\` to 200/206/304 only — never to redirects or errors.
	if (req.method === 'GET' || req.method === 'HEAD') {
		const staticRes = await serveStatic(req, {
			fsRoot: clientDir,
			headers: () => {
				const cc = pickCacheControl(url.pathname);
				return cc ? { 'cache-control': cc } : null;
			},
		});

		// Pass through to SSR on 404/405; anything else is returned as is.
		if (staticRes.status !== 404 && staticRes.status !== 405) return staticRes;
	}

	// 3. Everything else goes through SvelteKit's SSR engine.
	return server.respond(req, {
		getClientAddress() {
			return info?.remoteAddr?.hostname ?? '127.0.0.1';
		},
		platform: { info },
	});
}
`;
}
