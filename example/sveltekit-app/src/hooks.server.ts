import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.hookTimestamp = Date.now();
	const response = await resolve(event);
	response.headers.set('x-custom-hook', 'active');
	return response;
};
