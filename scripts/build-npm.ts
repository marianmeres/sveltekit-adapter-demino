import { npmBuild, versionizeDeps } from "@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
	name: denoJson.name,
	version: denoJson.version,
	repository: denoJson.name.replace(/^@/, ""),
	dependencies: versionizeDeps(["@types/node", "@sveltejs/kit"], "../deno.json"),
	packageJsonOverrides: {
		peerDependencies: {
			"@sveltejs/kit": ">=2.0.0",
		},
	},
});
