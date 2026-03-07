import { env } from '$env/dynamic/private';

export function load() {
	return {
		home: env.HOME ?? '(not set)',
		user: env.USER ?? '(not set)',
		nodeEnv: env.NODE_ENV ?? '(not set)'
	};
}
