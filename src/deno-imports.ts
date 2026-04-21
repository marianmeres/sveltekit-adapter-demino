import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Options controlling `deno-imports.json` emission.
 *
 * The adapter scans the SSR bundle for bare npm specifiers and writes a JSON
 * file the consumer can merge into their `deno.json` (or point `importMap`
 * at) so Deno can resolve every package the bundle references.
 */
export interface DenoImportsOptions {
	/** Emit `deno-imports.json`. @default true */
	enabled?: boolean;

	/** How versions are written into the `npm:` specifiers. @default "caret" */
	versionPrefix?: "caret" | "exact" | "tilde";

	/** Specifiers to force-add (useful for dynamic imports a scanner can't see). */
	extraSpecifiers?: string[];

	/** Package names to omit from the emitted map. */
	exclude?: string[];
}

/**
 * Friendly logger shape compatible with `builder.log`.
 * `warn` falls back to `minor` when the Builder doesn't expose it.
 */
export interface DenoImportsLogger {
	minor: (message: string) => void;
	warn?: (message: string) => void;
}

/**
 * Scans the given directory recursively and returns absolute paths of all
 * `.js` files found. Returns an empty array if the directory does not exist.
 */
export function scanJsFiles(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) return results;

	const stack: string[] = [dir];
	while (stack.length) {
		const cur = stack.pop()!;
		let entries;
		try {
			entries = readdirSync(cur, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			const full = join(cur, e.name);
			if (e.isDirectory()) stack.push(full);
			else if (e.isFile() && e.name.endsWith(".js")) results.push(full);
		}
	}
	return results;
}

// `[^'";]*?` admits newlines (a JS character class negation matches \n by
// default), which covers both single- and multi-line import lists.
const RE_STATIC_FROM =
	/(?:^|[\s;{}()])(?:import|export)\b[^'";]*?\sfrom\s*["']([^"']+)["']/g;
const RE_SIDE_EFFECT = /(?:^|[\s;{}()])import\s+["']([^"']+)["']/g;
// Lookbehind rejects quotes and backtick so we don't match `import(...)`
// literals embedded in string or template-literal contents.
const RE_DYNAMIC = /(?<![.$_\w`"'])import\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Removes `//` line comments and `/* *\/` block comments (including JSDoc,
 * which often embeds `import('types')` type references that aren't real
 * imports). Strings and template literals are left in place so genuine
 * import specifiers remain scannable.
 */
function stripComments(source: string): string {
	return source
		.replace(/\/\/.*$/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Extracts every module specifier from a JavaScript source. Handles static
 * `import`/`export ... from`, side-effect `import "x"`, and dynamic
 * `import("x")`. Does not deduplicate.
 */
export function extractSpecifiers(source: string): string[] {
	const stripped = stripComments(source);
	const out: string[] = [];
	for (const re of [RE_STATIC_FROM, RE_SIDE_EFFECT, RE_DYNAMIC]) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(stripped)) !== null) out.push(m[1]);
	}
	return out;
}

/**
 * Returns true iff `spec` is a bare specifier that names an npm package
 * (possibly with a subpath). Filters out relative paths, protocol-prefixed
 * specifiers (`npm:`, `jsr:`, `node:`, `http(s):`, `data:`, `blob:`, `file:`),
 * SvelteKit aliases (`$app/*`, `$lib/*`, `$env/*`, `$service-worker`), and
 * package-internal imports (`#name`).
 */
export function isBareNpmSpecifier(spec: string): boolean {
	if (!spec) return false;
	if (/^[./]/.test(spec)) return false;
	if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return false;
	if (/^\$(app|lib|env|service-worker)(\/|$)/.test(spec)) return false;
	if (spec.startsWith("#")) return false;
	// Must match npm package-name grammar: optional scope, lowercase letters/
	// digits/`-`/`_`/`.`; no spaces, no `$`, no braces. This catches stray
	// template-literal fragments (e.g. `${assets}`) the parser may surface.
	return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-zA-Z0-9._\-/]+)?$/
		.test(spec);
}

/**
 * Splits a bare specifier into `{ pkg, subpath }`. For scoped packages the
 * package is the first two path segments; otherwise the first segment.
 * `subpath` is empty when the specifier imports the package root.
 */
export function splitPackageName(spec: string): { pkg: string; subpath: string } {
	if (spec.startsWith("@")) {
		const parts = spec.split("/");
		return {
			pkg: parts.slice(0, 2).join("/"),
			subpath: parts.slice(2).join("/"),
		};
	}
	const idx = spec.indexOf("/");
	if (idx === -1) return { pkg: spec, subpath: "" };
	return { pkg: spec.slice(0, idx), subpath: spec.slice(idx + 1) };
}

/**
 * Resolves the installed version of `pkg` starting from `cwd`. Tries
 * `require.resolve` first (respects exports maps), then walks up the
 * directory tree looking for `node_modules/<pkg>/package.json` (handles
 * pnpm's symlinked layout transparently). Returns null if neither works.
 */
export function resolvePackageVersion(
	pkg: string,
	cwd: string,
): { version: string; source: "require" | "walk" } | null {
	try {
		const req = createRequire(join(cwd, "noop.js"));
		const pkgJsonPath = req.resolve(`${pkg}/package.json`);
		const json = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
		if (typeof json.version === "string") {
			return { version: json.version, source: "require" };
		}
	} catch {
		// Package doesn't expose ./package.json via exports, or not found here.
	}

	let dir = cwd;
	while (true) {
		const candidate = join(dir, "node_modules", pkg, "package.json");
		if (existsSync(candidate)) {
			try {
				const json = JSON.parse(readFileSync(candidate, "utf-8"));
				if (typeof json.version === "string") {
					return { version: json.version, source: "walk" };
				}
			} catch {
				// Malformed package.json; keep walking.
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/**
 * Builds a single import-map entry for `pkg[/subpath]` at `version`, using
 * the requested version prefix style.
 */
export function buildImportEntry(
	pkg: string,
	subpath: string,
	version: string,
	prefix: "caret" | "exact" | "tilde",
): { key: string; value: string } {
	const prefixChar = prefix === "caret" ? "^" : prefix === "tilde" ? "~" : "";
	const versioned = `${prefixChar}${version}`;
	const key = subpath ? `${pkg}/${subpath}` : pkg;
	const value = subpath
		? `npm:${pkg}@${versioned}/${subpath}`
		: `npm:${pkg}@${versioned}`;
	return { key, value };
}

/**
 * Scans `serverDir/**\/*.js` for bare npm specifiers, resolves each package
 * to an installed version, and writes `outFile` (a `{ imports: ... }` JSON
 * document sorted alphabetically by key).
 *
 * Never throws on missing data — unresolvable packages are skipped with one
 * aggregated warning, and an empty input produces `{"imports":{}}`.
 */
export function emitDenoImports(ctx: {
	serverDir: string;
	outFile: string;
	cwd: string;
	log: DenoImportsLogger;
	options?: DenoImportsOptions;
}): void {
	const opts = ctx.options ?? {};
	if (opts.enabled === false) return;

	const prefix = opts.versionPrefix ?? "caret";
	const exclude = new Set(opts.exclude ?? []);
	const warn = (m: string) => (ctx.log.warn ?? ctx.log.minor)(m);

	const specifiers = new Set<string>();
	const files = scanJsFiles(ctx.serverDir);
	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, "utf-8");
		} catch {
			continue;
		}
		for (const s of extractSpecifiers(source)) specifiers.add(s);
	}
	for (const s of opts.extraSpecifiers ?? []) specifiers.add(s);

	// pkg -> set of subpaths ("" means the package root)
	const byPkg = new Map<string, Set<string>>();
	for (const spec of specifiers) {
		if (!isBareNpmSpecifier(spec)) continue;
		const { pkg, subpath } = splitPackageName(spec);
		if (exclude.has(pkg)) continue;
		if (!byPkg.has(pkg)) byPkg.set(pkg, new Set());
		byPkg.get(pkg)!.add(subpath);
	}

	const imports: Record<string, string> = {};
	const unresolved: string[] = [];
	for (const [pkg, subpaths] of byPkg) {
		const v = resolvePackageVersion(pkg, ctx.cwd);
		if (!v) {
			unresolved.push(pkg);
			continue;
		}
		for (const subpath of subpaths) {
			const { key, value } = buildImportEntry(pkg, subpath, v.version, prefix);
			imports[key] = value;
		}
	}

	const sorted: Record<string, string> = {};
	for (const k of Object.keys(imports).sort()) sorted[k] = imports[k];

	const output = {
		$comment:
			"Generated by @marianmeres/sveltekit-adapter-demino. Do not edit by hand.",
		imports: sorted,
	};
	writeFileSync(ctx.outFile, JSON.stringify(output, null, 2) + "\n", "utf-8");

	const entryCount = Object.keys(sorted).length;
	const pkgCount = byPkg.size;
	const unresolvedCount = unresolved.length;
	ctx.log.minor(
		`adapter-demino: emitted deno-imports.json (${entryCount} entries, ${pkgCount - unresolvedCount} packages, ${unresolvedCount} unresolved)`,
	);
	if (unresolvedCount > 0) {
		warn(
			`adapter-demino: could not resolve version for ${unresolvedCount} package(s); omitted: ${unresolved.sort().join(", ")}`,
		);
	}
	if (files.length === 0) {
		warn(`adapter-demino: no .js files scanned under ${ctx.serverDir}`);
	}
}
