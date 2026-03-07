export function load({ getClientAddress, platform }) {
	return {
		clientAddress: getClientAddress(),
		hasPlatformInfo: !!platform?.info
	};
}
