<script>
	import { onMount } from 'svelte';
	import { clearSelection, createMap } from '#lib/map.js';
	import { propsTable } from '#lib/utils.js';
	import Source from '#lib/Source.svelte';
	import SOURCES from '#lib/sources.js';

	const KEY = 'avantage.customSources';

	let container, map = $state();
	let selectedFeature = $state(null);
	let custom = $state(loadCustom());
	let url = $state('');
	let resets = $state(0); // bumped by the reset button, see Source.svelte
	let cursor = $state(), zoom = $state(); // debug readout

	function selectFeature(feature, sourceId, details) {
		selectedFeature = feature ? { feature, sourceId, details } : null;
	}

	// Custom services are a per-user convenience; storage may be unavailable.
	function loadCustom() {
		try {
			const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
			return Array.isArray(stored) ? stored : [];
		} catch {
			return [];
		}
	}

	function saveCustom() {
		try {
			localStorage.setItem(KEY, JSON.stringify(custom));
		} catch {}
	}

	onMount(() => {
		const ready = createMap(container, selectFeature).then((m) => {
			zoom = m.getZoom();
			m.on('zoom', () => (zoom = m.getZoom()));
			m.on('mousemove', (e) => (cursor = e.lngLat));
			return (map = m);
		});
		return () => ready.then((m) => m.remove());
	});

	function add(e) {
		e.preventDefault();
		custom.push({ url, open: true });
		url = '';
		saveCustom();
	}

	function remove(source) {
		custom = custom.filter((s) => s !== source);
		saveCustom();
	}
</script>

<svelte:head><title>Avantage</title></svelte:head>

<div class="layout" class:with-details={selectedFeature}>
	<aside class="sidebar">
		<header>
			<h1>Avantage</h1>
			<button onclick={() => resets++}>Resetiraj</button>
		</header>
		<form onsubmit={add}>
			<input type="url" bind:value={url} placeholder="WMS / WFS / WMTS URL" required />
			<button>Dodaj</button>
		</form>
		{#if map}
			{#each SOURCES as source}<Source {map} {...source} reset={resets} />{/each}
			{#each custom as source (source)}<Source {map} {...source} reset={resets} onremove={() => remove(source)} />{/each}
		{/if}
	</aside>
	<main bind:this={container}></main>
	{#if selectedFeature}
		<aside class="details">
			<button class="close" aria-label="Zatvori" onclick={() => clearSelection(map)}>✕</button>
			{@html propsTable(selectedFeature.feature.properties, selectedFeature.details)}
		</aside>
	{/if}
</div>
{#if map}
	<code class:details-open={selectedFeature}>{cursor ? `${cursor.lat.toFixed(2)}, ${cursor.lng.toFixed(2)} · ` : ''}z {zoom.toFixed(2)}</code>
{/if}

<style>
	:global(body) { margin: 0; height: 100dvh; font: 14px system-ui, sans-serif; color-scheme: light; background: #fff; color: #222; }
	.layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); height: 100%; }
	.sidebar { overflow-y: auto; padding: 0 16px 16px; border-right: 1px solid #ddd; }
	/* Overlays the map: resizing the map container would move and re-centre the map. */
	.details { position: fixed; top: 0; right: 0; bottom: 0; width: 320px; z-index: 10; overflow-y: auto; padding: 12px; border-left: 1px solid #ddd; background: #fff; }
	header { display: flex; justify-content: space-between; align-items: center; }
	h1 { font-size: 20px; }
	form { display: flex; gap: 6px; margin-bottom: 12px; }
	input { flex: 1; min-width: 0; }
	main { min-width: 0; min-height: 0; }
	:global(.details table) { width: 100%; border-collapse: collapse; font-size: 12px; }
	:global(.details th) { text-align: left; color: #666; font-weight: normal; padding: 4px 8px 4px 0; vertical-align: top; }
	:global(.details td) { padding: 4px 0; overflow-wrap: anywhere; }
	.close { float: right; margin: 0 0 8px 8px; }
	code { position: fixed; top: 8px; right: 8px; padding: 2px 6px; background: #fffc; font-size: 12px; pointer-events: none; }
	code.details-open { right: 328px; }
	/* Map controls move aside so the panel doesn't cover them. */
	.layout.with-details :global(.maplibregl-ctrl-bottom-right) { right: 320px; }
</style>
