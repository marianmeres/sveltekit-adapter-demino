import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const params = Object.fromEntries(url.searchParams);
	return json({ method: 'GET', params });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	return json({ method: 'POST', body });
};
