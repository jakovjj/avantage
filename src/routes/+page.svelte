<script>
	import { onMount } from 'svelte';
	import { createMap } from '#lib/map.js';
	import Source from '#lib/Source.svelte';
	import SOURCES from '#lib/sources.js';

	let container, map = $state();
	let sources = $state(SOURCES);
	let url = $state('');

	onMount(() => {
		const ready = createMap(container).then((m) => (map = m));
		return () => ready.then((m) => m.remove());
	});

	function add(e) {
		e.preventDefault();
		sources.push({ url, open: true });
		url = '';
	}
</script>

<svelte:head><title>Avantage</title></svelte:head>

<aside>
	<h1>Avantage</h1>
	<form onsubmit={add}>
		<input type="url" bind:value={url} placeholder="WMS / WFS / WMTS URL" required />
		<button>Dodaj</button>
	</form>
	{#if map}
		{#each sources as source}<Source {map} {...source} />{/each}
	{/if}
</aside>
<main bind:this={container}></main>

<style>
	:global(body) { margin: 0; display: grid; grid-template-columns: 320px 1fr; height: 100dvh; font: 14px system-ui, sans-serif; color-scheme: light; background: #fff; color: #222; }
	aside { overflow-y: auto; padding: 0 16px 16px; border-right: 1px solid #ddd; }
	h1 { font-size: 20px; }
	form { display: flex; gap: 6px; margin-bottom: 12px; }
	input { flex: 1; min-width: 0; }
	:global(.maplibregl-popup-content) { max-height: 300px; overflow: auto; font-size: 12px; }
	:global(.maplibregl-popup-content th) { text-align: left; color: #666; font-weight: normal; padding-right: 8px; }
	@media (max-width: 700px) {
		:global(body) { grid-template-columns: 1fr; grid-template-rows: 40dvh 1fr; }
		aside { border: 0; border-bottom: 1px solid #ddd; }
	}
</style>
