import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
	buildImportEntry,
	emitDenoImports,
	extractSpecifiers,
	isBareNpmSpecifier,
	resolvePackageVersion,
	splitPackageName,
} from "../src/deno-imports.ts";

Deno.test("extractSpecifiers: static default/named/namespace imports", () => {
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
		assert(out.includes(s), `missing ${s}`);
	}
});

Deno.test("extractSpecifiers: re-exports", () => {
	const src = `
		export * from "re-a";
		export { foo } from "re-b";
		export * as ns from "re-c";
	`;
	const out = extractSpecifiers(src);
	for (const s of ["re-a", "re-b", "re-c"]) {
		assert(out.includes(s), `missing ${s}`);
	}
});

Deno.test("extractSpecifiers: dynamic imports", () => {
	const src = `const mod = await import("pkg-dyn");`;
	assert(extractSpecifiers(src).includes("pkg-dyn"));
});

Deno.test("extractSpecifiers: multi-line import list", () => {
	const src = `
import {
	a,
	b,
	c,
} from "multi-line-pkg";
`;
	assert(extractSpecifiers(src).includes("multi-line-pkg"));
});

Deno.test("extractSpecifiers: ignores strings and template literals", () => {
	const src = `
		const s = "import foo from 'evil-a'";
		const t = \`export * from "evil-b"\`;
	`;
	const out = extractSpecifiers(src);
	assertEquals(out.includes("evil-a"), false);
	assertEquals(out.includes("evil-b"), false);
});

Deno.test("extractSpecifiers: dynamic import is not matched as a member call", () => {
	const src = `const x = foo.import("not-a-specifier");`;
	assertEquals(extractSpecifiers(src).includes("not-a-specifier"), false);
});

Deno.test("extractSpecifiers: ignores JSDoc type imports in block comments", () => {
	const src = `
		/** @type {import('types').HttpMethod} */
		const m = "GET";
		/* @type {import('also-fake').Thing} */
		const n = "GET";
	`;
	const out = extractSpecifiers(src);
	assertEquals(out.includes("types"), false);
	assertEquals(out.includes("also-fake"), false);
});

Deno.test("extractSpecifiers: ignores dynamic imports embedded in template literals", () => {
	// SvelteKit's SSR output contains e.g.:
	//   return \`import('\${assets}/\${import_path}')\`;
	// The \`import(...)\` inside the backticks is runtime-constructed text, not code.
	const src = "const code = `import('${assets}/${import_path}')`;";
	const out = extractSpecifiers(src);
	assertEquals(
		out.some((s) => s.includes("${")),
		false,
		"must not emit template-literal placeholders as specifiers",
	);
});

Deno.test("extractSpecifiers: ignores dynamic imports embedded in quoted strings", () => {
	const src = `const s = "import('fake-pkg')";`;
	assertEquals(extractSpecifiers(src).includes("fake-pkg"), false);
});

Deno.test("extractSpecifiers: ignores line comments", () => {
	const src = `// import { x } from "commented-pkg";`;
	assertEquals(extractSpecifiers(src).includes("commented-pkg"), false);
});

Deno.test("isBareNpmSpecifier: accepts bare npm specifiers", () => {
	for (const s of [
		"cookie",
		"set-cookie-parser",
		"tailwind-merge",
		"@sveltejs/kit",
		"@sveltejs/kit/internal",
		"@sveltejs/kit/internal/server",
	]) {
		assert(isBareNpmSpecifier(s), `expected true for ${s}`);
	}
});

Deno.test("isBareNpmSpecifier: rejects non-bare specifiers", () => {
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
		assertEquals(isBareNpmSpecifier(s), false, `expected false for ${s}`);
	}
});

Deno.test("splitPackageName: scoped package with and without subpath", () => {
	assertEquals(splitPackageName("@sveltejs/kit"), {
		pkg: "@sveltejs/kit",
		subpath: "",
	});
	assertEquals(splitPackageName("@sveltejs/kit/internal"), {
		pkg: "@sveltejs/kit",
		subpath: "internal",
	});
	assertEquals(splitPackageName("@sveltejs/kit/internal/server"), {
		pkg: "@sveltejs/kit",
		subpath: "internal/server",
	});
});

Deno.test("splitPackageName: unscoped package with and without subpath", () => {
	assertEquals(splitPackageName("cookie"), { pkg: "cookie", subpath: "" });
	assertEquals(splitPackageName("cookie/lib/parse"), {
		pkg: "cookie",
		subpath: "lib/parse",
	});
});

Deno.test("buildImportEntry: root and subpath with caret", () => {
	assertEquals(buildImportEntry("@sveltejs/kit", "", "2.57.1", "caret"), {
		key: "@sveltejs/kit",
		value: "npm:@sveltejs/kit@^2.57.1",
	});
	assertEquals(
		buildImportEntry("@sveltejs/kit", "internal/server", "2.57.1", "caret"),
		{
			key: "@sveltejs/kit/internal/server",
			value: "npm:@sveltejs/kit@^2.57.1/internal/server",
		},
	);
});

Deno.test("buildImportEntry: caret / tilde / exact prefix modes", () => {
	assertEquals(
		buildImportEntry("cookie", "", "0.6.0", "caret").value,
		"npm:cookie@^0.6.0",
	);
	assertEquals(
		buildImportEntry("cookie", "", "0.6.0", "tilde").value,
		"npm:cookie@~0.6.0",
	);
	assertEquals(
		buildImportEntry("cookie", "", "0.6.0", "exact").value,
		"npm:cookie@0.6.0",
	);
});

Deno.test("resolvePackageVersion: finds @sveltejs/kit in own node_modules", () => {
	const v = resolvePackageVersion("@sveltejs/kit", Deno.cwd());
	assert(v !== null, "expected to resolve @sveltejs/kit");
	assert(
		/^\d+\.\d+\.\d+/.test(v!.version),
		`version ${v!.version} looks wrong`,
	);
});

Deno.test("resolvePackageVersion: returns null for unknown package", () => {
	const v = resolvePackageVersion(
		"this-package-definitely-does-not-exist-xyzzy",
		Deno.cwd(),
	);
	assertEquals(v, null);
});

Deno.test(
	"emitDenoImports: emits sorted JSON covering bare specifiers only",
	async () => {
		const tmp = await Deno.makeTempDir({ prefix: "deno-imports-test-" });
		try {
			const serverDir = join(tmp, "server");
			Deno.mkdirSync(join(serverDir, "sub"), { recursive: true });
			Deno.writeTextFileSync(
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
			Deno.writeTextFileSync(
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
				cwd: Deno.cwd(),
				log: { minor: () => {} },
			});

			const raw = Deno.readTextFileSync(outFile);
			const json = JSON.parse(raw) as {
				$comment: string;
				imports: Record<string, string>;
			};

			assertStringIncludes(raw, `"$comment"`);
			// Keys sorted alphabetically for deterministic output.
			const keys = Object.keys(json.imports);
			assertEquals(keys, [...keys].sort());

			// @sveltejs/kit is resolvable from this repo's node_modules.
			assert(
				"@sveltejs/kit" in json.imports,
				"expected @sveltejs/kit in imports",
			);
			assertStringIncludes(json.imports["@sveltejs/kit"], "npm:@sveltejs/kit@");

			// Subpaths get their own entries pointing at the same package version.
			assert("@sveltejs/kit/internal" in json.imports);
			assert("@sveltejs/kit/internal/server" in json.imports);
			assertStringIncludes(
				json.imports["@sveltejs/kit/internal/server"],
				"/internal/server",
			);

			// Filtered-out specifiers never appear as keys.
			for (const k of [
				"$app/server",
				"node:fs",
				"jsr:@std/path",
				"./index.js",
			]) {
				assertEquals(
					k in json.imports,
					false,
					`expected ${k} not to appear as a key`,
				);
			}
		} finally {
			await Deno.remove(tmp, { recursive: true });
		}
	},
);

Deno.test("emitDenoImports: exclude option drops a package", async () => {
	const tmp = await Deno.makeTempDir({ prefix: "deno-imports-exclude-" });
	try {
		const serverDir = join(tmp, "server");
		Deno.mkdirSync(serverDir, { recursive: true });
		Deno.writeTextFileSync(
			join(serverDir, "a.js"),
			`import { error } from "@sveltejs/kit";`,
		);
		const outFile = join(tmp, "deno-imports.json");
		emitDenoImports({
			serverDir,
			outFile,
			cwd: Deno.cwd(),
			log: { minor: () => {} },
			options: { exclude: ["@sveltejs/kit"] },
		});
		const json = JSON.parse(Deno.readTextFileSync(outFile));
		assertEquals("@sveltejs/kit" in json.imports, false);
	} finally {
		await Deno.remove(tmp, { recursive: true });
	}
});

Deno.test("emitDenoImports: extraSpecifiers forces inclusion", async () => {
	const tmp = await Deno.makeTempDir({ prefix: "deno-imports-extra-" });
	try {
		const serverDir = join(tmp, "server");
		Deno.mkdirSync(serverDir, { recursive: true });
		Deno.writeTextFileSync(join(serverDir, "a.js"), `// empty`);
		const outFile = join(tmp, "deno-imports.json");
		emitDenoImports({
			serverDir,
			outFile,
			cwd: Deno.cwd(),
			log: { minor: () => {} },
			options: { extraSpecifiers: ["@sveltejs/kit"] },
		});
		const json = JSON.parse(Deno.readTextFileSync(outFile));
		assert("@sveltejs/kit" in json.imports);
	} finally {
		await Deno.remove(tmp, { recursive: true });
	}
});

Deno.test("emitDenoImports: enabled=false skips writing the file", async () => {
	const tmp = await Deno.makeTempDir({ prefix: "deno-imports-disabled-" });
	try {
		const serverDir = join(tmp, "server");
		Deno.mkdirSync(serverDir, { recursive: true });
		Deno.writeTextFileSync(join(serverDir, "a.js"), `import "cookie";`);
		const outFile = join(tmp, "deno-imports.json");
		emitDenoImports({
			serverDir,
			outFile,
			cwd: Deno.cwd(),
			log: { minor: () => {} },
			options: { enabled: false },
		});
		let exists = false;
		try {
			Deno.statSync(outFile);
			exists = true;
		} catch {
			// expected
		}
		assertEquals(exists, false);
	} finally {
		await Deno.remove(tmp, { recursive: true });
	}
});
