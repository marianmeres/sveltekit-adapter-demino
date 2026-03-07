<script lang="ts">
	let { form } = $props();
</script>

<h1>Form Actions Test</h1>
<form method="POST">
	<label>
		Enter text: <input type="text" name="name" />
	</label>
	<button type="submit">Reverse it</button>
</form>

{#if form}
	<p>Result: <strong>{form.reversed}</strong></p>
{/if}

<hr />
<a href="/">Home</a>
