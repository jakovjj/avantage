<script>
	import { onMount } from 'svelte';
	import { clearSelection, createMap, flyToCoordinates } from '#lib/map.js';
	import { propsTable, watchDownloads } from '#lib/utils.js';
	import Source from '#lib/Source.svelte';
	import SOURCES from '#lib/sources.js';

	const KEY = 'avantage.customSources';

	let container, map = $state();
	let selectedFeature = $state(null);
	let custom = $state(loadCustom());
	let url = $state('');
	let showAddForm = $state(false);
	let showAll = $state(false); // every layer of every service, not only the designed ones
	let showActiveOnly = $state(false);
	let filterQuery = $state('');
	let resets = $state(0); // bumped by the reset button, see Source.svelte
	let cursor = $state(), zoom = $state(); // debug readout
	let placeQuery = $state('');
	let placeResults = $state([]);
	let showPlaceResults = $state(false);
	let placeSearchTimer, placeSearchController;
	let downloads = $state(0), drawing = $state(false); // the loading bar shows while either is busy
	watchDownloads((n) => (downloads = n));

	function selectFeature(feature, sourceId, layer = {}) {
		selectedFeature = feature ? { feature, sourceId, layer } : null;
	}

	function searchPlaces() {
		clearTimeout(placeSearchTimer);
		placeSearchController?.abort();
		placeResults = [];
		showPlaceResults = false;
		const query = placeQuery.trim();
		if (query.length < 2) {
			return;
		}
		placeSearchTimer = setTimeout(async () => {
			const controller = new AbortController();
			placeSearchController = controller;
			const parameters = new URLSearchParams({ q: query, limit: '6', lang: 'default', countrycode: 'HR' });
			try {
				const response = await fetch(`https://photon.komoot.io/api/?${parameters}`, { signal: controller.signal });
				if (!response.ok) throw new Error('Place search failed');
				const data = await response.json();
				if (query !== placeQuery.trim()) return;
				placeResults = data.features.filter((feature) => {
					const coordinates = feature.geometry?.coordinates;
					return feature.geometry?.type === 'Point' && Number.isFinite(coordinates?.[0]) && Number.isFinite(coordinates?.[1]);
				});
				showPlaceResults = placeResults.length > 0;
			} catch {
				if (!controller.signal.aborted) {
					placeResults = [];
					showPlaceResults = false;
				}
			}
		}, 400);
	}

	function selectPlace(feature) {
		flyToCoordinates(map, feature.geometry.coordinates, feature.properties.extent);
		placeQuery = feature.properties.name;
		showPlaceResults = false;
	}

	function clearPlaceQuery() {
		placeQuery = '';
		placeResults = [];
		showPlaceResults = false;
		clearTimeout(placeSearchTimer);
		placeSearchController?.abort();
	}

	function placeContext(properties) {
		return [properties.street, properties.district, properties.city, properties.county, properties.state]
			.find((value) => value && value !== properties.name) ?? properties.country;
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
		return () => {
			clearTimeout(placeSearchTimer);
			placeSearchController?.abort();
			ready.then((m) => m.remove());
		};
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
			{#each SOURCES.filter((s) => s.category) as source}<Source {map} {...source} title={source.category} part="ready" reset={resets} {showActiveOnly} {filterQuery} />{/each}
			{#if showAll}
				<hr />
				<p class="raw-note">Niže navedeni slojevi prikazivat će se na karti bez obrade.</p>
				{#each SOURCES as source}<Source {map} {...source} part="rest" reset={resets} {showActiveOnly} {filterQuery} />{/each}
			{/if}
			{#each custom as source (source)}<Source {map} {...source} reset={resets} {showActiveOnly} {filterQuery} onremove={() => remove(source)} />{/each}
		{/if}
		<div class="manual-options">
			<label class="manual-toggle"><input type="checkbox" bind:checked={showAll} /> Prikaži sve slojeve</label>
			<label class="manual-toggle"><input type="checkbox" bind:checked={showAddForm} /> Dodaj ručno slojeve</label>
			{#if showAddForm}
				<form onsubmit={add}>
					<input type="url" bind:value={url} placeholder="WMS / WFS / WMTS URL" required />
					<button>Dodaj</button>
				</form>
			{/if}
		</div>
	</aside>
	<main bind:this={container}>
		<form class="place-search" onsubmit={(event) => { event.preventDefault(); if (placeResults[0]) selectPlace(placeResults[0]); }}>
			<input
				aria-label="Pretraži mjesta"
				aria-expanded={showPlaceResults}
				aria-controls="place-results"
				autocomplete="off"
				placeholder="Pretraži mjesto"
				bind:value={placeQuery}
				oninput={searchPlaces}
				onkeydown={(event) => { if (event.key === 'Escape') showPlaceResults = false; }}
			/>
			{#if placeQuery}
				<button class="clear-place-search" type="button" aria-label="Očisti pretragu" onclick={clearPlaceQuery}>×</button>
			{/if}
			{#if showPlaceResults}
				<div class="place-results" id="place-results">
					{#each placeResults as result (`${result.properties.osm_type ?? ''}-${result.properties.osm_id ?? ''}`)}
						<button type="button" onclick={() => selectPlace(result)}>
							<span>{result.properties.name}</span>
							{#if placeContext(result.properties)}<small>{placeContext(result.properties)}</small>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</form>
	</main>
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
	hr { width: 100%; margin: 10px 0 6px; border: 0; border-top: 1px solid #ccc; }
	.raw-note { margin: 0 0 6px; color: #666; font-size: 12px; }
	.layer-filter { flex: none; height: 1.5em; margin: 0 0 6px; padding-block: 0; }
	.manual-toggle { display: flex; align-items: center; gap: 6px; margin: 12px 0; }
	.manual-toggle input { flex: none; }
	.active-toggle { display: flex; align-items: center; gap: 6px; margin: 0 0 12px; }
	.active-toggle input { flex: none; }
	.manual-options { margin-top: auto; }
	main { position: relative; min-width: 0; min-height: 0; }
	.place-search { position: absolute; z-index: 3; top: 8px; left: 8px; display: block; width: min(360px, calc(100% - 120px)); margin: 0; }
	.place-search input { box-sizing: border-box; width: 100%; height: 32px; padding: 4px 30px 4px 8px; background: #fff; }
	.clear-place-search { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0; border: 0; background: #fff; font-size: 16px; line-height: 1; cursor: pointer; }
	.place-results { position: absolute; top: 34px; left: 0; right: 0; border: 1px solid #aaa; background: #fff; }
	.place-results button { display: flex; width: 100%; flex-direction: column; align-items: flex-start; gap: 2px; padding: 6px 8px; border: 0; border-bottom: 1px solid #ddd; background: #fff; text-align: left; cursor: pointer; }
	.place-results button:last-child { border-bottom: 0; }
	.place-results small { color: #666; }
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
