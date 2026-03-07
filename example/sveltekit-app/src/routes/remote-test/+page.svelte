<script lang="ts">
	import { getServerTime } from './data.remote';

	let result = $state<{ serverTime: string } | null>(null);

	async function fetchTime() {
		result = await getServerTime();
	}
</script>

<h1>Remote Functions Test</h1>

<button onclick={fetchTime}>Get Server Time</button>

{#if result}
	<p>Server time: <strong>{result.serverTime}</strong></p>
{/if}

<hr />
<a href="/">Home</a>
