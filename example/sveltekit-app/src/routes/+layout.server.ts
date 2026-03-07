export async function load({ fetch, locals }) {
	const res = await fetch('/api/hello');
	const data = await res.json();
	return { apiHello: data, hookTimestamp: locals.hookTimestamp };
}
