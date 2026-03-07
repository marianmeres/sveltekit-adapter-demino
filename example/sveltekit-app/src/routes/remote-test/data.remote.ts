import { query } from '$app/server';

export const getServerTime = query(() => {
	return { serverTime: new Date().toISOString() };
});
