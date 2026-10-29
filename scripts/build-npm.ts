import { npmBuild } from "@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
	name: denoJson.name,
	version: denoJson.version,
	repository: denoJson.name.replace(/^@/, ""),
	// string form: npmbuild installs it (`--no-save`) before `tsc`, which also
	// reifies the devDependencies below - with no `dependencies` left, nothing
	// else would trigger an install inside `.npm-dist/`
	peerDependencies: ["@sveltejs/kit@>=2.0.0"],
	packageJsonOverrides: {
		// build-only: `tsc` type-checks the `node:*` imports; the published
		// `.d.ts` exposes no Node types, so consumers do not need it (same range
		// as demino's dev manifest)
		devDependencies: { "@types/node": "^24" },
	},
});
