<script lang="ts">
	let { data } = $props();
</script>

<h1>$env Access Test</h1>
<ul>
	<li>HOME: <strong>{data.home}</strong></li>
	<li>USER: <strong>{data.user}</strong></li>
	<li>NODE_ENV: <strong>{data.nodeEnv}</strong></li>
</ul>
<hr />
<a href="/">Home</a>
