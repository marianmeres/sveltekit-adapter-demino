<script lang="ts">
	import { page } from '$app/state';
</script>

<h1>Error {page.status}</h1>
<p>{page.error?.message}</p>
<hr />
<a href="/">Home</a>
