<script lang="ts">
	import favicon from "$lib/assets/favicon.svg";
	import "../reset.css";

	let { data, children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div style="padding: 1rem;">
	{@render children()}
	<hr />
	<pre>{JSON.stringify(data, null, 2)}</pre>
</div>
