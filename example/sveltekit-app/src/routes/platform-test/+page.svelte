<script lang="ts">
	let { data } = $props();
</script>

<h1>Platform & Client Address Test</h1>
<ul>
	<li>Client address: <strong>{data.clientAddress}</strong></li>
	<li>Platform info available: <strong>{data.hasPlatformInfo}</strong></li>
</ul>
<hr />
<a href="/">Home</a>
