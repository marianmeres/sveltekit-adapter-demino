import { demino, deminoCompose, logListenInfo } from "@marianmeres/demino";
import { serve } from "@marianmeres/demino/node";
import { createServer } from "node:net";
import process from "node:process";
import { handler as skHandler } from "./sveltekit-app/build/handler.js";

/**
 * Check if a port is available
 */
function isPortAvailable(port: number, host: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", (e: Error & { code?: string }) => {
			if (e.code === "EADDRINUSE") resolve(false);
			else reject(e);
		});
		probe.listen(port, host, () => probe.close(() => resolve(true)));
	});
}

/**
 * Find the next available port starting from the given port
 */
async function findAvailablePort(
	startPort: number,
	host: string,
): Promise<number> {
	let port = startPort;
	const maxAttempts = 100;

	for (let i = 0; i < maxAttempts; i++) {
		if (await isPortAvailable(port, host)) {
			return port;
		}
		port++;
	}

	throw new Error(
		`Could not find an available port after ${maxAttempts} attempts`,
	);
}

async function main(): Promise<void> {
	const options = {
		port: parseInt(process.env.SERVER_PORT ?? "9999", 10),
		hostname: process.env.SERVER_HOST || "0.0.0.0",
	};

	// Find available port
	let { port, hostname } = options;
	if (!(await isPortAvailable(port, hostname))) {
		console.log(`Port ${port} is in use, searching for available port...`);
		port = await findAvailablePort(port, hostname);
	}

	// Actual demino app
	const api = demino("/api");
	api.get("/hello", () => ({ hello: "world" }));

	// SvelteKit handles everything that the API doesn't
	const sk = demino();
	sk.all("/*", skHandler);

	// No WebSocket routes here, so the optional `ws` peer is not needed.
	await serve(deminoCompose([api, sk]), {
		port,
		hostname,
		onListen: logListenInfo,
		webSockets: false,
	});
}

main();
