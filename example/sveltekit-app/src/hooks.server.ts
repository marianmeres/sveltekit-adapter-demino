import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.hookTimestamp = Date.now();
	const resolved = await resolve(event);
	// `resolve()` can return a raw `fetch()` response with immutable headers: while
	// rendering the 404 page, the root layout's `fetch('/api/hello')` is a route
	// SvelteKit doesn't own, so it forwards it uncloned. Copy before mutating.
	const response = new Response(resolved.body, resolved);
	response.headers.set('x-custom-hook', 'active');
	return response;
};
