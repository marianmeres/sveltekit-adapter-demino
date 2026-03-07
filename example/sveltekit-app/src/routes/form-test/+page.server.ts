export const actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const name = formData.get('name') as string ?? '';
		return { reversed: name.split('').reverse().join('') };
	}
};
