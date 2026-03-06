import { npmBuild } from "@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
	name: denoJson.name,
	version: denoJson.version,
	repository: denoJson.name.replace(/^@/, ""),
	dependencies: ["@types/node", "@sveltejs/kit"],
	packageJsonOverrides: {
		peerDependencies: {
			"@sveltejs/kit": ">=2.0.0",
		},
	},
});
