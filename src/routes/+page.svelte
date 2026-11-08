<script>
	import { onMount } from 'svelte';
	import { clearSelection, createMap } from '#lib/map.js';
	import { propsTable, watchDownloads } from '#lib/utils.js';
	import Source from '#lib/Source.svelte';
	import SOURCES from '#lib/sources.js';

	const KEY = 'avantage.customSources';

	let container, map = $state();
	let selectedFeature = $state(null);
	let custom = $state(loadCustom());
	let url = $state('');
	let showAddForm = $state(false);
	let showActiveOnly = $state(false);
	let filterQuery = $state('');
	let resets = $state(0); // bumped by the reset button, see Source.svelte
	let cursor = $state(), zoom = $state(); // debug readout
	let downloads = $state(0), drawing = $state(false); // the loading bar shows while either is busy
	watchDownloads((n) => (downloads = n));

	function selectFeature(feature, sourceId, layer = {}) {
		selectedFeature = feature ? { feature, sourceId, layer } : null;
	}

	function googleMapsUrl(feature) {
		const coordinates = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
		if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return null;
		const query = `${coordinates[1]},${coordinates[0]}`;
		return `https://www.google.com/maps/search/?api=1&${new URLSearchParams({ query })}`;
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
		const ready = createMap(container, selectFeature, (busy) => (drawing = busy)).then((m) => {
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

{#if downloads || drawing}<div class="loading"><div></div></div>{/if}

<div class="layout" class:with-details={selectedFeature}>
	<aside class="sidebar">
		<header>
			<h1>Avantage</h1>
			<button onclick={() => (resets++, filterQuery = '')}>Resetiraj</button>
		</header>
		<label class="active-toggle"><input type="checkbox" bind:checked={showActiveOnly} /> Pokaži aktivne slojeve</label>
		<input class="layer-filter" type="search" placeholder="Filtriraj slojeve" bind:value={filterQuery} />
		{#if map}
			{#each SOURCES as source}<Source {map} {...source} reset={resets} {showActiveOnly} {filterQuery} />{/each}
			{#each custom as source (source)}<Source {map} {...source} reset={resets} {showActiveOnly} {filterQuery} onremove={() => remove(source)} />{/each}
		{/if}
		<div class="manual-options">
			<label class="manual-toggle"><input type="checkbox" bind:checked={showAddForm} /> Dodaj ručno slojeve</label>
			{#if showAddForm}
				<form onsubmit={add}>
					<input type="url" bind:value={url} placeholder="WMS / WFS / WMTS URL" required />
					<button>Dodaj</button>
				</form>
			{/if}
		</div>
	</aside>
	<main bind:this={container}></main>
	{#if selectedFeature}
		{@const { feature, layer } = selectedFeature}
		<aside class="details">
			<div>
				<button class="close" aria-label="Zatvori" onclick={() => clearSelection(map)}>✕</button>
				{#if layer.panel}<layer.panel properties={feature.properties} />{:else}{@html propsTable(feature.properties, layer.details)}{/if}
			</div>
			{#if googleMapsUrl(feature)}
				<a class="maps" href={googleMapsUrl(feature)} target="_blank" rel="noopener noreferrer">Google Maps</a>
			{/if}
		</aside>
	{/if}
</div>
{#if map}
	<code class:details-open={selectedFeature}>{cursor ? `${cursor.lat.toFixed(2)}, ${cursor.lng.toFixed(2)} · ` : ''}z {zoom.toFixed(2)}</code>
{/if}

<style>
	:global(body) { margin: 0; height: 100dvh; font: 14px system-ui, sans-serif; color-scheme: light; background: #fff; color: #222; }
	.layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); height: 100%; }
	.sidebar { display: flex; flex-direction: column; overflow-y: auto; padding: 0 16px 16px; border-right: 1px solid #ddd; user-select: none; }
	/* Overlays the map: resizing the map container would move and re-centre the map. */
	/* border-box: the controls and readout are shifted by exactly this 320px, padding included. */
	.details { position: fixed; top: 0; right: 0; bottom: 0; width: 320px; box-sizing: border-box; z-index: 10; display: flex; flex-direction: column; overflow-y: auto; padding: 12px 12px 0; border-left: 1px solid #ddd; background: #fff; }
	/* The content fills the panel, so the link sits at its bottom; when the panel scrolls, the link sticks there. */
	.details > div { flex: 1 0 auto; padding-bottom: 12px; }
	.maps { position: sticky; bottom: 0; padding: 10px 0; text-align: center; background: #fff; }
	header { display: flex; justify-content: space-between; align-items: center; }
	h1 { font-size: 20px; }
	form { display: flex; gap: 6px; margin-bottom: 12px; }
	input { flex: 1; min-width: 0; }
	.layer-filter { flex: none; height: 1.5em; margin: 0 0 6px; padding-block: 0; }
	.manual-toggle { display: flex; align-items: center; gap: 6px; margin: 12px 0; }
	.manual-toggle input { flex: none; }
	.active-toggle { display: flex; align-items: center; gap: 6px; margin: 0 0 12px; }
	.active-toggle input { flex: none; }
	.manual-options { margin-top: auto; }
	main { position: relative; min-width: 0; min-height: 0; }
	:global(.details table) { width: 100%; border-collapse: collapse; font-size: 12px; }
	:global(.details th) { text-align: left; color: #666; font-weight: normal; padding: 4px 8px 4px 0; vertical-align: top; }
	:global(.details td) { padding: 4px 0; overflow-wrap: anywhere; }
	.close { float: right; margin: 0 0 8px 8px; }
	/* Loading bar along the top edge: a green block sweeping left to right, above everything. */
	.loading { position: fixed; top: 0; left: 0; right: 0; z-index: 20; height: 0.33rem; overflow: hidden; pointer-events: none; }
	.loading div { width: 50%; height: 100%; background: #4caf50; animation: sweep 2s cubic-bezier(0.39, 0.15, 0.47, 0.56) infinite; }
	@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
	code { position: fixed; top: 8px; right: 8px; padding: 2px 6px; background: #fffc; font-size: 12px; pointer-events: none; }
	code.details-open { right: 328px; }
	/* Map controls move aside so the panel doesn't cover them. */
	.layout.with-details :global(.maplibregl-ctrl-bottom-right) { right: 320px; }
</style>
