import adapter from '@marianmeres/sveltekit-adapter-demino';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter()
	}
};

export default config;
