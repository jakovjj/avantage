<script>
	import { onMount, setContext, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { clearSelection, createMap, flyToCoordinates, setOverlayOrder } from '#lib/map.js';
	import { propsTable, watchDownloads } from '#lib/utils.js';
	import Source, { closeLayerInfo } from '#lib/Source.svelte';
	import SOURCES from '#lib/sources.js';

	const KEY = 'avantage.customSources';
	const ORDER_KEY = 'avantage.layerOrder';

	let container, map = $state();
	let selectedFeature = $state(null);
	let shareCopied = $state(false);
	let custom = $state(loadCustom());
	let url = $state('');
	let showAddForm = $state(false);
	let showAll = $state(false); // every layer of every service, not only the designed ones
	// Services sharing a `section` (one survey each, e.g. Digitalni ortofoto) are listed together, one row per service, at
	// the top of the sidebar.
	const SECTIONS = Object.entries(Object.groupBy(SOURCES.filter((s) => s.section), (s) => s.section));
	let sectionOpen = $state({});
	let showActiveOnly = $state(false);
	const activeLayers = setContext('avantage.activeLayers', new SvelteMap());
	let layerOrder = $state(loadLayerOrder());
	let draggedLayer = $state(null), dropTarget = $state(null);
	const activeRows = $derived.by(() => {
		// A custom service can also occur in the built-in catalogue.
		const rows = [...activeLayers.values()].flat();
		const positions = new Map(layerOrder.map((id, index) => [id, index]));
		return [...new Map(rows.map((entry) => [entry.id, entry])).values()].sort((a, b) =>
			(positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) || b.rank - a.rank);
	});
	$effect(() => {
		if (map) setOverlayOrder(map, activeRows.map((entry) => entry.sources));
	});
	let addLayerButton, layerFilter;
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

	function showLayers(active) {
		closeLayerInfo();
		showActiveOnly = active;
	}

	function loadLayerOrder() {
		try {
			const stored = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]');
			return Array.isArray(stored) ? [...new Set(stored.filter((id) => typeof id === 'string'))] : [];
		} catch {
			return [];
		}
	}

	function moveLayer(id, next) {
		const ids = activeRows.map((entry) => entry.id);
		const index = ids.indexOf(id);
		if (index < 0 || next < 0 || next >= ids.length || index === next) return false;
		ids.splice(index, 1);
		ids.splice(next, 0, id);
		layerOrder = [...ids, ...layerOrder.filter((saved) => !ids.includes(saved))];
		closeLayerInfo();
		try {
			localStorage.setItem(ORDER_KEY, JSON.stringify(layerOrder));
		} catch {}
		return true;
	}

	async function reorderWithKeyboard(event, id, index) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const handle = event.currentTarget;
		if (moveLayer(id, index + (event.key === 'ArrowUp' ? -1 : 1))) {
			await tick();
			handle.focus({ preventScroll: true });
			handle.scrollIntoView({ block: 'nearest' });
		}
	}

	function startLayerDrag(event, id) {
		const row = event.currentTarget.closest('.active-layer');
		const { left, top } = row.getBoundingClientRect();
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', id);
		event.dataTransfer.setDragImage(row, event.clientX - left, event.clientY - top);
		closeLayerInfo();
		draggedLayer = id;
	}

	function layerDragOver(event, id) {
		if (!draggedLayer) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const after = dropAfter(event);
		if (dropTarget?.id !== id || dropTarget.after !== after) {
			dropTarget = id === draggedLayer ? null : { id, after };
		}
	}

	function dropAfter(event) {
		const { top, height } = event.currentTarget.getBoundingClientRect();
		return event.clientY >= top + height / 2;
	}

	function endLayerDrag() {
		draggedLayer = dropTarget = null;
	}

	function dropLayer(event, id, index) {
		if (!draggedLayer) return;
		event.preventDefault();
		const from = activeRows.findIndex((entry) => entry.id === draggedLayer);
		if (from >= 0 && draggedLayer !== id) {
			moveLayer(draggedLayer, index + Number(dropAfter(event)) - Number(from < index));
		}
		endLayerDrag();
	}

	async function focusAfterRemoval(event) {
		if (event.target.type !== 'checkbox' || event.target.checked) return;
		const row = event.target.closest('.active-layer');
		const next = row.nextElementSibling?.querySelector('input[type="checkbox"]')
			?? row.previousElementSibling?.querySelector('input[type="checkbox"]');
		await tick();
		(next?.isConnected ? next : addLayerButton).focus();
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
		const { type, coordinates: c } = feature.geometry ?? {};
		// A MultiPoint of one point (Periske 2023) is a point too.
		const coordinates = type === 'Point' ? c : type === 'MultiPoint' && c.length === 1 ? c[0] : null;
		if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return null;
		const query = `${coordinates[1]},${coordinates[0]}`;
		return `https://www.google.com/maps/search/?api=1&${new URLSearchParams({ query })}`;
	}

	async function shareGoogleMapsUrl(url) {
		if (navigator.share && window.isSecureContext) {
			try {
				await navigator.share({ url });
				return;
			} catch (error) {
				if (error.name === 'AbortError') return;
			}
		}
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			const input = document.createElement('textarea');
			input.value = url;
			input.style.position = 'fixed';
			input.style.opacity = '0';
			document.body.append(input);
			input.select();
			const copied = document.execCommand('copy');
			input.remove();
			if (!copied) return;
		}
		shareCopied = true;
		setTimeout(() => (shareCopied = false), 2000);
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

<svelte:head><title>IKOP - Interaktivna karta okolišnih podataka</title></svelte:head>

{#if downloads || drawing}<div class="loading"><div></div></div>{/if}

<div class="layout" class:with-details={selectedFeature}>
	<aside class="sidebar">
		<header>
			<h1>IKOP - Interaktivna karta okolišnih podataka</h1>
			{#if activeRows.length}<button onclick={() => (resets++, filterQuery = '')}>Resetiraj</button>{/if}
		</header>
		<nav aria-label="Slojevi">
			<button aria-pressed={!showActiveOnly} onclick={() => showLayers(false)}>Svi slojevi</button>
			<button aria-pressed={showActiveOnly} onclick={() => showLayers(true)}>Aktivni slojevi</button>
		</nav>
		<div class="catalogue" hidden={showActiveOnly}>
			<input class="layer-filter" type="search" placeholder="Filtriraj slojeve" aria-label="Filtriraj slojeve" bind:this={layerFilter} bind:value={filterQuery} />
			{#if map}
				{#each SECTIONS as [name, services] (name)}
					<details class="section" bind:open={sectionOpen[name]}>
						<summary><span>{name}</span></summary>
						{#each services as source}<Source {map} {...source} flat open={sectionOpen[name]} reset={resets} {filterQuery} />{/each}
					</details>
				{/each}
				{#each SOURCES.filter((s) => s.category) as source}<Source {map} {...source} title={source.category} part="ready" reset={resets} {filterQuery} />{/each}
				{#if showAll}
					<hr />
					<p class="raw-note">Niže navedeni slojevi prikazivat će se na karti bez obrade.</p>
					{#each SOURCES.filter((s) => !s.section) as source}<Source {map} {...source} part="rest" reset={resets} {filterQuery} />{/each}
				{/if}
				{#each custom as source (source)}<Source {map} {...source} reset={resets} {filterQuery} onremove={() => remove(source)} />{/each}
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
		</div>
		<div class="active-layers" hidden={!showActiveOnly} onchange={focusAfterRemoval}>
			<ul class="layer-stack" aria-label="Redoslijed slojeva">
				{#each activeRows as entry, index (entry.id)}
					<li class="active-layer" class:dragging={draggedLayer === entry.id}
						class:drop-before={dropTarget?.id === entry.id && !dropTarget.after}
						class:drop-after={dropTarget?.id === entry.id && dropTarget.after}
						ondragover={(event) => layerDragOver(event, entry.id)}
						ondragleave={(event) => {
							if (dropTarget?.id === entry.id && !event.currentTarget.contains(event.relatedTarget)) dropTarget = null;
						}}
						ondrop={(event) => dropLayer(event, entry.id, index)}>
						{#if activeRows.length > 1}
							<button class="drag-handle" type="button" draggable="true"
								aria-label={`Promijeni redoslijed sloja ${entry.title}`} aria-keyshortcuts="ArrowUp ArrowDown"
								title="Povuci za promjenu redoslijeda"
								ondragstart={(event) => startLayerDrag(event, entry.id)} ondragend={endLayerDrag}
								onkeydown={(event) => reorderWithKeyboard(event, entry.id, index)}>
								<svg viewBox="0 0 12 16" width="12" height="16" fill="currentColor" aria-hidden="true">
									<circle cx="4" cy="3" r="1.25" /><circle cx="8" cy="3" r="1.25" />
									<circle cx="4" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" />
									<circle cx="4" cy="13" r="1.25" /><circle cx="8" cy="13" r="1.25" />
								</svg>
							</button>
						{/if}
						<div class="active-layer-content">{@render entry.render(entry.layer, entry.title, true)}</div>
					</li>
				{/each}
			</ul>
			<button class="add-layer" bind:this={addLayerButton} onclick={async () => { showLayers(false); await tick(); layerFilter.focus(); }}>Dodaj sloj</button>
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
				{#if layer.panel}<layer.panel properties={feature.properties} {layer} />{:else}{@html propsTable(feature.properties, layer.details)}{/if}
			</div>
			{#if googleMapsUrl(feature)}
				<div class="maps">
					<a href={googleMapsUrl(feature)} target="_blank" rel="noopener noreferrer" aria-label="Otvori u Google Maps">
						<img src="google-maps.svg" alt="Google Maps" />
					</a>
					<button class:copied={shareCopied} type="button" onclick={() => shareGoogleMapsUrl(googleMapsUrl(feature))}>{shareCopied ? 'Kopirano' : 'Podijeli'}</button>
				</div>
			{/if}
		</aside>
	{/if}
</div>
{#if map}
	<code class:details-open={selectedFeature}>{cursor ? `${cursor.lat.toFixed(2)}, ${cursor.lng.toFixed(2)}, ` : ''}z {zoom.toFixed(2)}</code>
{/if}

<style>
	:global(body) { margin: 0; height: 100dvh; font: 14px system-ui, sans-serif; color-scheme: light; background: #fff; color: #222; }
	.layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); height: 100%; }
	.sidebar { display: flex; flex-direction: column; min-height: 0; padding: 0 16px; border-right: 1px solid #ddd; user-select: none; }
	nav { display: flex; flex: none; border-bottom: 1px solid #ddd; }
	nav button { flex: 1; padding: 8px 4px; border: 0; border-bottom: 2px solid transparent; background: #fff; color: #666; font: inherit; cursor: pointer; }
	nav button[aria-pressed='true'] { border-bottom-color: #222; color: #222; }
	nav button:hover { background: #f5f5f5; }
	.catalogue, .active-layers { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 0 16px; }
	.catalogue { display: flex; flex-direction: column; }
	[hidden] { display: none; }
	.layer-stack { list-style: none; padding: 0; margin: 0; }
	.active-layer { position: relative; display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #ddd; }
	.active-layer-content { flex: 1; min-width: 0; }
	.drag-handle { flex: 0 0 24px; display: grid; place-items: center; height: 28px; padding: 0; border: 0; background: none; color: #666; cursor: grab; }
	.drag-handle svg { pointer-events: none; }
	.drag-handle:hover { color: #222; background: #f5f5f5; }
	.drag-handle:active { cursor: grabbing; }
	.active-layer.dragging { opacity: 0.5; }
	.drop-before::after, .drop-after::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: #222; pointer-events: none; }
	.drop-before::after { top: 0; }
	.drop-after::after { bottom: -1px; }
	.add-layer { display: block; margin: 12px auto 0; }
	/* Overlays the map: resizing the map container would move and re-centre the map. */
	/* border-box: the controls and readout are shifted by exactly this 320px, padding included. */
	.details { position: fixed; top: 0; right: 0; bottom: 0; width: 320px; box-sizing: border-box; z-index: 10; display: flex; flex-direction: column; overflow-y: auto; padding: 12px 12px 0; border-left: 1px solid #ddd; background: #fff; }
	/* The content fills the panel, so the link sits at its bottom; when the panel scrolls, the link sticks there. */
	.details > div { flex: 1 0 auto; padding-bottom: 12px; }
	.maps { position: sticky; bottom: 0; display: flex; justify-content: center; align-items: center; gap: 12px; padding: 10px 0; background: #fff; }
	.maps img { display: block; width: 44px; height: 44px; }
	.maps button { padding: 8px 16px; border: 1px solid #222; border-radius: 8px; background: #fff; color: #222; font: inherit; cursor: pointer; transition: background-color 180ms ease, box-shadow 180ms ease; }
	.maps button:hover { box-shadow: 0 2px 7px #0003; }
	.maps button.copied { background: #eaf4ff; }
	header { display: flex; justify-content: space-between; align-items: center; }
	h1 { font-size: 20px; }
	form { display: flex; gap: 6px; margin-bottom: 12px; }
	input { flex: 1; min-width: 0; }
	hr { width: 100%; margin: 10px 0 6px; border: 0; border-top: 1px solid #ccc; }
	.section > summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
	.section > summary span { padding: 2px 4px; } /* like a service's title (Source.svelte) */
	.raw-note { margin: 0 0 6px; color: #666; font-size: 12px; }
	.layer-filter { flex: none; box-sizing: border-box; width: 100%; height: 28px; margin: 0 0 6px; }
	.manual-toggle { display: flex; align-items: center; gap: 6px; margin: 12px 0; }
	.manual-toggle input { flex: none; }
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
