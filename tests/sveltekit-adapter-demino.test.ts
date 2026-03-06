import { assertEquals } from "@std/assert";
import adapter from "../src/sveltekit-adapter-demino.ts";

Deno.test("adapter factory returns valid Adapter object", () => {
	const a = adapter();
	assertEquals(a.name, "adapter-demino");
	assertEquals(typeof a.adapt, "function");
});

Deno.test("adapter respects custom out option", () => {
	const a = adapter({ out: "custom-build" });
	assertEquals(a.name, "adapter-demino");
});

Deno.test("adapter defaults are applied", () => {
	const a = adapter({});
	assertEquals(a.name, "adapter-demino");
});
