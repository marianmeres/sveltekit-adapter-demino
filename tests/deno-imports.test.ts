import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import {
	buildImportEntry,
	emitDenoImports,
	extractSpecifiers,
	isBareNpmSpecifier,
	resolvePackageVersion,
	splitPackageName,
} from "../src/deno-imports.ts";

test("extractSpecifiers: static default/named/namespace imports", () => {
	const src = `
		import a from "pkg-default";
		import { b } from "pkg-named";
		import * as c from "pkg-ns";
		import d, { e } from "pkg-combined";
		import "pkg-side-effect";
	`;
	const out = extractSpecifiers(src);
	for (const s of [
		"pkg-default",
		"pkg-named",
		"pkg-ns",
		"pkg-combined",
		"pkg-side-effect",
	]) {
		assert.ok(out.includes(s), `missing ${s}`);
	}
});

test("extractSpecifiers: re-exports", () => {
	const src = `
		export * from "re-a";
		export { foo } from "re-b";
		export * as ns from "re-c";
	`;
	const out = extractSpecifiers(src);
	for (const s of ["re-a", "re-b", "re-c"]) {
		assert.ok(out.includes(s), `missing ${s}`);
	}
});

test("extractSpecifiers: dynamic imports", () => {
	const src = `const mod = await import("pkg-dyn");`;
	assert.ok(extractSpecifiers(src).includes("pkg-dyn"));
});

test("extractSpecifiers: multi-line import list", () => {
	const src = `
import {
	a,
	b,
	c,
} from "multi-line-pkg";
`;
	assert.ok(extractSpecifiers(src).includes("multi-line-pkg"));
});

test("extractSpecifiers: ignores strings and template literals", () => {
	const src = `
		const s = "import foo from 'evil-a'";
		const t = \`export * from "evil-b"\`;
	`;
	const out = extractSpecifiers(src);
	assert.equal(out.includes("evil-a"), false);
	assert.equal(out.includes("evil-b"), false);
});

test("extractSpecifiers: dynamic import is not matched as a member call", () => {
	const src = `const x = foo.import("not-a-specifier");`;
	assert.equal(extractSpecifiers(src).includes("not-a-specifier"), false);
});

test("extractSpecifiers: ignores JSDoc type imports in block comments", () => {
	const src = `
		/** @type {import('types').HttpMethod} */
		const m = "GET";
		/* @type {import('also-fake').Thing} */
		const n = "GET";
	`;
	const out = extractSpecifiers(src);
	assert.equal(out.includes("types"), false);
	assert.equal(out.includes("also-fake"), false);
});

test("extractSpecifiers: ignores dynamic imports embedded in template literals", () => {
	// SvelteKit's SSR output contains e.g.:
	//   return \`import('\${assets}/\${import_path}')\`;
	// The \`import(...)\` inside the backticks is runtime-constructed text, not code.
	const src = "const code = `import('${assets}/${import_path}')`;";
	const out = extractSpecifiers(src);
	assert.equal(
		out.some((s) => s.includes("${")),
		false,
		"must not emit template-literal placeholders as specifiers",
	);
});

test("extractSpecifiers: ignores dynamic imports embedded in quoted strings", () => {
	const src = `const s = "import('fake-pkg')";`;
	assert.equal(extractSpecifiers(src).includes("fake-pkg"), false);
});

test("extractSpecifiers: ignores line comments", () => {
	const src = `// import { x } from "commented-pkg";`;
	assert.equal(extractSpecifiers(src).includes("commented-pkg"), false);
});

test("isBareNpmSpecifier: accepts bare npm specifiers", () => {
	for (const s of [
		"cookie",
		"set-cookie-parser",
		"tailwind-merge",
		"@sveltejs/kit",
		"@sveltejs/kit/internal",
		"@sveltejs/kit/internal/server",
	]) {
		assert.ok(isBareNpmSpecifier(s), `expected true for ${s}`);
	}
});

test("isBareNpmSpecifier: rejects non-bare specifiers", () => {
	for (const s of [
		"",
		"./relative",
		"../up",
		"/absolute",
		"npm:pkg",
		"node:fs",
		"jsr:@std/path",
		"https://example.com/mod.js",
		"file:///abs.js",
		"data:text/javascript,x",
		"$app/server",
		"$lib/foo",
		"$env/dynamic/public",
		"$service-worker",
		"#internal",
		"${assets}",
		"${import_path}",
		"foo bar",
		"UpperCase",
	]) {
		assert.equal(isBareNpmSpecifier(s), false, `expected false for ${s}`);
	}
});

test("splitPackageName: scoped package with and without subpath", () => {
	assert.deepEqual(splitPackageName("@sveltejs/kit"), {
		pkg: "@sveltejs/kit",
		subpath: "",
	});
	assert.deepEqual(splitPackageName("@sveltejs/kit/internal"), {
		pkg: "@sveltejs/kit",
		subpath: "internal",
	});
	assert.deepEqual(splitPackageName("@sveltejs/kit/internal/server"), {
		pkg: "@sveltejs/kit",
		subpath: "internal/server",
	});
});

test("splitPackageName: unscoped package with and without subpath", () => {
	assert.deepEqual(splitPackageName("cookie"), { pkg: "cookie", subpath: "" });
	assert.deepEqual(splitPackageName("cookie/lib/parse"), {
		pkg: "cookie",
		subpath: "lib/parse",
	});
});

test("buildImportEntry: root and subpath with caret", () => {
	assert.deepEqual(buildImportEntry("@sveltejs/kit", "", "2.57.1", "caret"), {
		key: "@sveltejs/kit",
		value: "npm:@sveltejs/kit@^2.57.1",
	});
	assert.deepEqual(
		buildImportEntry("@sveltejs/kit", "internal/server", "2.57.1", "caret"),
		{
			key: "@sveltejs/kit/internal/server",
			value: "npm:@sveltejs/kit@^2.57.1/internal/server",
		},
	);
});

test("buildImportEntry: caret / tilde / exact prefix modes", () => {
	assert.equal(
		buildImportEntry("cookie", "", "0.6.0", "caret").value,
		"npm:cookie@^0.6.0",
	);
	assert.equal(
		buildImportEntry("cookie", "", "0.6.0", "tilde").value,
		"npm:cookie@~0.6.0",
	);
	assert.equal(
		buildImportEntry("cookie", "", "0.6.0", "exact").value,
		"npm:cookie@0.6.0",
	);
});

test("resolvePackageVersion: finds @sveltejs/kit in own node_modules", () => {
	const v = resolvePackageVersion("@sveltejs/kit", process.cwd());
	assert.ok(v !== null, "expected to resolve @sveltejs/kit");
	assert.ok(/^\d+\.\d+\.\d+/.test(v.version), `version ${v.version} looks wrong`);
});

test("resolvePackageVersion: returns null for unknown package", () => {
	const v = resolvePackageVersion(
		"this-package-definitely-does-not-exist-xyzzy",
		process.cwd(),
	);
	assert.equal(v, null);
});

test("emitDenoImports: emits sorted JSON covering bare specifiers only", async () => {
	const tmp = await mkdtemp(join(tmpdir(), "deno-imports-test-"));
	try {
		const serverDir = join(tmp, "server");
		mkdirSync(join(serverDir, "sub"), { recursive: true });
		writeFileSync(
			join(serverDir, "a.js"),
			`
				import { Server } from "./index.js";
				import { error, json } from "@sveltejs/kit";
				import { foo } from "@sveltejs/kit/internal";
				import "cookie";
				import * as devalue from "devalue";
				import { x } from "node:fs";
				import { y } from "jsr:@std/path";
				import { z } from "$app/server";
			`,
		);
		writeFileSync(
			join(serverDir, "sub/b.js"),
			`
				import { clsx } from "clsx";
				const mod = await import("set-cookie-parser");
				export * from "@sveltejs/kit/internal/server";
			`,
		);

		const outFile = join(tmp, "deno-imports.json");
		emitDenoImports({
			serverDir,
			outFile,
			cwd: process.cwd(),
			log: { minor: () => {} },
		});

		const raw = readFileSync(outFile, "utf-8");
		const json = JSON.parse(raw) as {
			$comment: string;
			imports: Record<string, string>;
		};

		assert.ok(raw.includes(`"$comment"`));
		// Keys sorted alphabetically for deterministic output.
		const keys = Object.keys(json.imports);
		assert.deepEqual(keys, [...keys].sort());

		// @sveltejs/kit is resolvable from this repo's node_modules.
		assert.ok("@sveltejs/kit" in json.imports, "expected @sveltejs/kit in imports");
		assert.ok(json.imports["@sveltejs/kit"].includes("npm:@sveltejs/kit@"));

		// Subpaths get their own entries pointing at the same package version.
		assert.ok("@sveltejs/kit/internal" in json.imports);
		assert.ok("@sveltejs/kit/internal/server" in json.imports);
		assert.ok(
			json.imports["@sveltejs/kit/internal/server"].includes("/internal/server"),
		);

		// Filtered-out specifiers never appear as keys.
		for (const k of ["$app/server", "node:fs", "jsr:@std/path", "./index.js"]) {
			assert.equal(
				k in json.imports,
				false,
				`expected ${k} not to appear as a key`,
			);
		}
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});

test("emitDenoImports: exclude option drops a package", async () => {
	const tmp = await mkdtemp(join(tmpdir(), "deno-imports-exclude-"));
	try {
		const serverDir = join(tmp, "server");
		mkdirSync(serverDir, { recursive: true });
		writeFileSync(join(serverDir, "a.js"), `import { error } from "@sveltejs/kit";`);
		const outFile = join(tmp, "deno-imports.json");
		emitDenoImports({
			serverDir,
			outFile,
			cwd: process.cwd(),
			log: { minor: () => {} },
			options: { exclude: ["@sveltejs/kit"] },
		});
		const json = JSON.parse(readFileSync(outFile, "utf-8"));
		assert.equal("@sveltejs/kit" in json.imports, false);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});

test("emitDenoImports: never maps @marianmeres/demino (skip list)", async () => {
	const tmp = await mkdtemp(join(tmpdir(), "deno-imports-skip-"));
	try {
		// A resolvable demino install, so only the skip list can keep it out.
		const pkgDir = join(tmp, "node_modules/@marianmeres/demino");
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify({ name: "@marianmeres/demino", version: "2.0.0" }),
		);
		assert.ok(resolvePackageVersion("@marianmeres/demino", tmp) !== null);

		const serverDir = join(tmp, "server");
		mkdirSync(serverDir, { recursive: true });
		writeFileSync(
			join(serverDir, "a.js"),
			`
				import { serveStatic } from "@marianmeres/demino";
				import { serve } from "@marianmeres/demino/node";
			`,
		);
		const outFile = join(tmp, "deno-imports.json");
		const warnings: string[] = [];
		emitDenoImports({
			serverDir,
			outFile,
			cwd: tmp,
			log: { minor: () => {}, warn: (m) => warnings.push(m) },
			// Even a forced specifier does not bring it back.
			options: { extraSpecifiers: ["@marianmeres/demino"] },
		});
		const json = JSON.parse(readFileSync(outFile, "utf-8"));
		assert.deepEqual(json.imports, {});
		// Skipped, not "unresolved".
		assert.deepEqual(warnings, []);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});

test("emitDenoImports: extraSpecifiers forces inclusion", async () => {
	const tmp = await mkdtemp(join(tmpdir(), "deno-imports-extra-"));
	try {
		const serverDir = join(tmp, "server");
		mkdirSync(serverDir, { recursive: true });
		writeFileSync(join(serverDir, "a.js"), `// empty`);
		const outFile = join(tmp, "deno-imports.json");
		emitDenoImports({
			serverDir,
			outFile,
			cwd: process.cwd(),
			log: { minor: () => {} },
			options: { extraSpecifiers: ["@sveltejs/kit"] },
		});
		const json = JSON.parse(readFileSync(outFile, "utf-8"));
		assert.ok("@sveltejs/kit" in json.imports);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});

test("emitDenoImports: enabled=false skips writing the file", async () => {
	const tmp = await mkdtemp(join(tmpdir(), "deno-imports-disabled-"));
	try {
		const serverDir = join(tmp, "server");
		mkdirSync(serverDir, { recursive: true });
		writeFileSync(join(serverDir, "a.js"), `import "cookie";`);
		const outFile = join(tmp, "deno-imports.json");
		emitDenoImports({
			serverDir,
			outFile,
			cwd: process.cwd(),
			log: { minor: () => {} },
			options: { enabled: false },
		});
		assert.equal(existsSync(outFile), false);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});
