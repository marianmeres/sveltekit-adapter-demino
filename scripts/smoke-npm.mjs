/**
 * Smoke-tests the built npm package (`pnpm run smoke`, or
 * `node scripts/smoke-npm.mjs` after `pnpm run build`).
 *
 * `pnpm pack`s the repo root - the tarball `pnpm publish` would upload - and in
 * a throw-away project under the OS temp dir installs it with npm next to
 * `@marianmeres/demino`, as a consumer's server gets it, then on Node:
 *
 *  1. checks the installed package.json (the `.` export and its files, no
 *     runtime dependencies, `@sveltejs/kit` as a peer, `engines.node`) and that
 *     the tarball carries `dist/` and none of the repo-only directories;
 *  2. drives `adapt()` from the built `dist/` with a stub SvelteKit Builder,
 *     then imports the generated `handler.js` (with a stub SvelteKit `Server`)
 *     and serves a static file and an SSR fallthrough through it;
 *  3. type-checks a consumer `.ts` against the shipped `.d.ts` with this repo's
 *     `tsc` (the `.d.ts` keep `.ts` specifiers, which consumers must resolve).
 *
 * Peers are not installed (`--omit=peer`): the adapter only imports
 * `@sveltejs/kit` types, and the kit's own peers (vite, svelte) would make this
 * a SvelteKit install.
 *
 * Repo tool, Node only (nothing here is shipped).
 */

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const PKG = "@marianmeres/sveltekit-adapter-demino";
const DEMINO = "@marianmeres/demino@^2";

/** Repo directories the published tarball must not carry. */
const REPO_ONLY = ["src", "tests", "scripts", "tmp", "example", "node_modules"];

/** Step 2: runs inside the temp project, where the bare specifiers resolve. */
const CONSUMER = `
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import adapter, { adapter as named, CACHE_DEFAULTS } from "${PKG}";

assert.equal(typeof adapter, "function", "default export");
assert.equal(named, adapter, "named export is the default");
assert.equal(typeof CACHE_DEFAULTS.assets, "string", "CACHE_DEFAULTS");

const out = join(process.cwd(), "build");
const mkdirp = (p) => mkdirSync(p, { recursive: true });
const builder = {
	getBuildDirectory: (name) => join(process.cwd(), ".svelte-kit", name),
	rimraf: (p) => rmSync(p, { recursive: true, force: true }),
	mkdirp,
	writeClient: (p) => (mkdirp(p), []),
	writePrerendered: (p) => (mkdirp(p), []),
	writeServer: (p) => (mkdirp(p), []),
	generateManifest: () => "{}",
	prerendered: { redirects: new Map(), pages: new Map() },
	log: { minor: () => {} },
};
await adapter({ out }).adapt(builder);
console.log("smoke: adapt() wrote build/ from dist/");

writeFileSync(
	join(out, "server/index.js"),
	\`export class Server {
		async init() {}
		async respond(req) { return new Response("ssr:" + new URL(req.url).pathname); }
	}\`,
);
writeFileSync(join(out, "client/hello.txt"), "hello");
const { handler } = await import(pathToFileURL(join(out, "handler.js")).href);

let res = await handler(new Request("http://localhost/hello.txt"));
assert.equal(res.status, 200, "static status");
assert.equal(await res.text(), "hello", "static body");
assert.equal(res.headers.get("cache-control"), CACHE_DEFAULTS.assets, "cache-control");
res = await handler(new Request("http://localhost/missing"));
assert.equal(await res.text(), "ssr:/missing", "SSR fallthrough");
console.log("smoke: handler.js serves static + SSR on @marianmeres/demino");
`;

/** Step 3: type-checked, never run. */
const TYPES_CONSUMER = `
import adapter, {
	type AdapterOptions,
	CACHE_DEFAULTS,
	type CacheControlOptions,
	type DenoImportsOptions,
} from "${PKG}";

const denoImports: DenoImportsOptions = { versionPrefix: "exact" };
const cacheControl: CacheControlOptions = { assets: false };
const options: AdapterOptions = { out: "build", cacheControl, denoImports };
const name: string = adapter(options).name;
const immutable: string = CACHE_DEFAULTS.immutable;
// @ts-expect-error a wrong option type is rejected, so the types are not \`any\`
adapter({ out: 1 });

export { immutable, name };
`;

function run(cmd, args, cwd) {
	console.log(`smoke: $ ${[cmd, ...args].join(" ")}`);
	execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function check(condition, what) {
	if (!condition) throw new Error(`smoke: ${what}`);
}

function checkInstalledManifest(dir) {
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	check(pkg.name === PKG, `installed package is "${pkg.name}", expected "${PKG}"`);
	const exportKeys = Object.keys(pkg.exports ?? {});
	check(
		JSON.stringify(exportKeys) === JSON.stringify(["."]),
		`exports keys are ${JSON.stringify(exportKeys)}`,
	);
	for (const kind of ["types", "import"]) {
		const file = pkg.exports["."][kind];
		check(
			typeof file === "string" && existsSync(join(dir, file)),
			`exports["."].${kind} does not exist: ${file}`,
		);
	}
	check(
		Object.keys(pkg.dependencies ?? {}).length === 0,
		`unexpected runtime dependencies: ${JSON.stringify(pkg.dependencies)}`,
	);
	check(
		typeof pkg.peerDependencies?.["@sveltejs/kit"] === "string",
		`"@sveltejs/kit" is not a peer dependency`,
	);
	check(typeof pkg.engines?.node === "string", "engines.node missing");
	for (const name of REPO_ONLY) {
		check(!existsSync(join(dir, name)), `the tarball carries "${name}/"`);
	}
	console.log(
		`smoke: ${pkg.name}@${pkg.version} - peer @sveltejs/kit ` +
			`${pkg.peerDependencies["@sveltejs/kit"]}, engines.node ${pkg.engines.node}`,
	);
}

check(
	existsSync(join(DIST, "mod.js")),
	`${DIST} has no mod.js - run \`pnpm run build\` first`,
);

const project = mkdtempSync(join(tmpdir(), "adapter-demino-npm-smoke-"));
try {
	writeFileSync(
		join(project, "package.json"),
		JSON.stringify(
			{ name: "adapter-demino-npm-smoke", private: true, type: "module" },
			null,
			"\t",
		),
	);
	const packDir = join(project, "pack");
	mkdirSync(packDir);
	run("pnpm", ["pack", "--pack-destination", packDir], ROOT);
	const tarballs = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
	check(tarballs.length === 1, `expected one tarball, got ${JSON.stringify(tarballs)}`);
	run(
		"npm",
		[
			"install",
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
			"--omit=peer",
			join(packDir, tarballs[0]),
			DEMINO,
		],
		project,
	);
	checkInstalledManifest(join(project, "node_modules", PKG));

	writeFileSync(join(project, "consumer.mjs"), CONSUMER);
	run(process.execPath, ["consumer.mjs"], project);

	writeFileSync(join(project, "types-consumer.ts"), TYPES_CONSUMER);
	run(
		join(ROOT, "node_modules", ".bin", "tsc"),
		[
			"--noEmit",
			"--strict",
			"--skipLibCheck",
			"--target",
			"es2024",
			"--module",
			"nodenext",
			"--moduleResolution",
			"nodenext",
			"--types",
			"node",
			"--typeRoots",
			join(ROOT, "node_modules", "@types"),
			"types-consumer.ts",
		],
		project,
	);
	console.log("smoke: the shipped .d.ts type-check for a consumer");
	console.log("smoke: OK");
} finally {
	rmSync(project, { recursive: true, force: true });
}
