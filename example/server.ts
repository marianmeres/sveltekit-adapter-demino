import { demino, deminoCompose } from "@marianmeres/demino";
import { handler as skHandler } from "./sveltekit-app/build/handler.js";

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number, host: string): Promise<boolean> {
	try {
		const listener = Deno.listen({ port, hostname: host });
		listener.close();
		return true;
	} catch (e) {
		if (e instanceof Deno.errors.AddrInUse) {
			return false;
		}
		throw e;
	}
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
		port: parseInt(Deno.env.get("SERVER_PORT") ?? "9999"),
		hostname: Deno.env.get("SERVER_HOST") || "0.0.0.0",
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

	//
	Deno.serve(
		{
			port,
			hostname,
			onListen({ hostname, port }) {
				const protocol = "http";

				if (hostname === "0.0.0.0") {
					console.log("\n ✅ %cDemino listening:", "color:green;");
					console.log(
						`    ➜  Local:   %c${protocol}://localhost:${port}/`,
						"color:cyan;",
					);

					const interfaces = Deno.networkInterfaces();
					for (const iface of interfaces) {
						if (
							iface.family === "IPv4" &&
							!iface.address.startsWith("127.")
						) {
							console.log(
								`    ➜  Network: %c${protocol}://${iface.address}:${port}/`,
								"color:cyan;",
							);
						}
					}
				} else {
					console.log(
						`%cDemino listening: %c${protocol}://${hostname}:${port}/`,
						"color:green;",
						"color:cyan;",
					);
				}
				console.log("");
			},
		},
		deminoCompose([api, sk]),
	);
}

main();
