import { error } from '@sveltejs/kit';

export function load({ url }) {
	const code = parseInt(url.searchParams.get('code') ?? '500');
	error(code as any, `Test error with status ${code}`);
}
