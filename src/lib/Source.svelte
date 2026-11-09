<script module>
	import { setSiteParams } from './map.js';
	import { keepKey } from './utils.js';

	// The open (i) box, one at a time across all services: { id: `${url}#${layer}`, left, top or bottom } in viewport px.
	let shownInfo = $state(null);
	export function closeLayerInfo() {
		shownInfo = null;
	}

	// Services behind a short-lived key (`authKey`: the URL that hands it out): one key per URL, kept fresh, and MapLibre
	// adds it to every request to that site.
	const keys = new Map();

	// Layers sharing an `exclusive` key work like radio buttons, also across services (one Digitalni ortofoto at a time):
	// key → { id, off } of the layer of that key that was turned on last.
	const exclusiveOn = new Map();
	function useKey(keyUrl) {
		if (!keys.has(keyUrl)) keys.set(keyUrl, keepKey(keyUrl, (key) => setSiteParams(new URL(keyUrl).origin, { authKey: key })));
		return keys.get(keyUrl);
	}
</script>

<script>
	import { getContext, onDestroy, untrack } from 'svelte';
	import { inspect, legendUrl, rasterSource } from './ogc.js';
	import { formatNumber } from './utils.js';
	import { RASTER_OPACITY, addOverlay, removeOverlay, setOpacity } from './map.js';
	import { showWfs } from './wfs.js';
	import { queryOnClick } from './wms.js';

	let { map, url, type, title, section, layers = {}, authKey, format, together, clipToCroatia, exclusive, opacity: slider, wfs, stack, part, flat = false, open = false, onremove, reset = 0, filterQuery = '' } = $props();
	// `flat`: the service's rows sit straight in a section of the page (`open` when it is), its one layer named `title`.
	// `part`: 'ready' lists only the layers marked `ready`, 'rest' only the others, none all of them.
	const inPart = (name) => !part || (part === 'ready') === Boolean(layers[name]?.ready);
	let service = $state(), error = $state(), attempt = $state(0), loading = $state(false);
	let on = $state({}), note = $state({}), legend = $state({}), opacity = $state({}); // per layer name: checked, status text, legend image, opacity
	const infoLayer = $derived(shownInfo?.id.startsWith(`${url}#`) && service?.layers.find((l) => `${url}#${l.name}` === shownInfo.id));

	// The box opens over the map, beside the sidebar, level with the layer's row: downwards from a row in the upper half
	// of the window, upwards from one in the lower half, so it stays on screen.
	function toggleInfo(e, l) {
		e.preventDefault(); // the button sits inside the layer's <label>
		const id = `${url}#${l.name}`;
		if (shownInfo?.id === id) return (shownInfo = null);
		const row = e.currentTarget.getBoundingClientRect(), sidebar = e.currentTarget.closest('aside').getBoundingClientRect();
		shownInfo = row.top < innerHeight / 2
			? { id, left: sidebar.right + 8, top: Math.max(8, row.top - 8) }
			: { id, left: sidebar.right + 8, bottom: Math.max(8, innerHeight - row.bottom - 8) };
	}
	let rootOpen = $state(untrack(() => open));
	let groupOpen = $state({});
	let searchSnapshot;
	const active = $derived(Object.values(on).some(Boolean));
	const activeLayers = getContext('avantage.activeLayers');
	const owner = Symbol();
	$effect(() => {
		activeLayers.set(owner, listed.filter((l) => on[l.name]).map((l) => ({
			id: `${url}#${l.name}`,
			sources: [l.name, ...(layers[l.name]?.members ?? [])].map((name) => `${url}#${name}`)
				.concat((together ?? []).map((_, i) => `${url}#${l.name}+${i + 1}`)),
			// Where a newly enabled layer starts in the stack: by its service's `stack` (orthophotos -1 at the bottom, then
			// flood maps, habitats, waste statistics), map-drawn layers above every image; then points over lines over areas.
			rank: (isRaster(l) ? (stack ?? 0) * 10 : 1000) + ({ points: 2, lines: 1 }[l.kind] ?? 0),
			layer: l,
			title: flat && listed.length === 1 ? [section, title].filter(Boolean).join(' - ') : layers[l.name]?.label
				? [layers[l.name].group, layers[l.name].label].filter(Boolean).join(' - ') : l.title,
			render: row
		})));
	});
	const hide = {}; // per layer name: removes it from the map
	const requests = new Map(); // stale WMS setup must not add a layer after it was toggled again
	// When the list goes away (the full list hidden, a service removed), its layers leave the map with it; they stay
	// stored, so they come back on when it's shown again.
	onDestroy(() => {
		activeLayers.delete(owner);
		for (const name in on) if (on[name]) {
			on[name] = false;
			hide[name]?.();
		}
	});

	// Grey icon of what a layer looks like on the map (12×12 SVG content).
	const KINDS = {
		points: ['markeri', '<path d="M6 11.5S2 7.2 2 4.8a4 4 0 0 1 8 0C10 7.2 6 11.5 6 11.5Z"/><circle cx="6" cy="4.8" r="1.4" fill="#fff"/>'],
		lines: ['linije', '<path d="M1 10l3.5-5 3 3L11 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'],
		areas: ['područja', '<path d="M1.5 4L6 1l4.5 3-1 6.5h-7Z" fill-opacity=".35" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'],
		heatmap: ['toplinska karta', '<rect x="1" y="1" width="3" height="3" opacity=".3"/><rect x="4.5" y="1" width="3" height="3" opacity=".6"/><rect x="8" y="1" width="3" height="3"/><rect x="1" y="4.5" width="3" height="3" opacity=".6"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="8" y="4.5" width="3" height="3" opacity=".6"/><rect x="1" y="8" width="3" height="3"/><rect x="4.5" y="8" width="3" height="3" opacity=".6"/><rect x="8" y="8" width="3" height="3" opacity=".3"/>'],
		raster: ['slika', '<rect x="1" y="1.5" width="10" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 10l3-4 2 2.5 1.5-1.5L10 10Z"/>']
	};
	// A layer's note is its feature count or a status ("…", "približi kartu", an error); a row with `members` shows their
	// total once all are counted, else the first status.
	function rowNote(name) {
		const notes = [name, ...(layers[name]?.members ?? [])].map((n) => note[n] ?? '');
		const counts = notes.every((n) => typeof n === 'number');
		return counts ? formatNumber(notes.reduce((a, b) => a + b)) : notes.find((n) => typeof n !== 'number');
	}
	const kindOf = (l) => (layers[l.name]?.heatmap ? 'heatmap' : l.kind);
	const isRaster = (l) => service.type !== 'WFS' || Boolean(layers[l.name]?.wms);

	// The page's reset button bumps `reset`: turn every layer off and clear the filter.
	$effect(() => {
		if (!reset) return;
		untrack(() => {
			for (const name in on) if (on[name]) (on[name] = false), toggle(name);
		});
	});

	// Enabled layers survive a reload: a per-user convenience, so storage may be unavailable.
	const STORED = 'avantage.enabledLayers';
	const storedIds = () => {
		try {
			return JSON.parse(localStorage.getItem(STORED) ?? '[]');
		} catch {
			return [];
		}
	};
	function store(id, enabled) {
		try {
			localStorage.setItem(STORED, JSON.stringify([...storedIds().filter((s) => s !== id), ...(enabled ? [id] : [])]));
		} catch {}
	}
	const restore = untrack(() => storedIds().filter((id) => id.startsWith(`${url}#`)).map((id) => id.slice(url.length + 1)).filter(inPart));

	$effect(() => {
		if (service) untrack(() => {
			for (const l of listed) if (restore.includes(l.name) && !on[l.name]) (on[l.name] = true), toggle(l.name);
		});
	});

	// GetCapabilities loads when the service opens, a global search needs its layers, it has layers to restore or it's in
	// the full list (which leaves out services whose layers are all listed on top).
	$effect(() => {
		attempt;
		if (((flat ? open : rootOpen) || filterQuery.trim() || restore.length || (part === 'rest' && !flat)) && !service && !error && !loading) {
			loading = true;
			inspect(url, type).then(
				(s) => (service = s, loading = false),
				(e) => (error = e.message, loading = false)
			);
		}
	});

	// Group title prefix ("2018" in "2018 - Reciklažna dvorišta"); some servers write the
	// dash without the trailing space ("2017 -Građevni otpad") or as an en dash.
	const naturalOrder = new Intl.Collator('hr', { numeric: true, sensitivity: 'base' });
	const titlePrefix = (title) => title.match(/^(.+?)\s+[-–—]\s*/)?.[1] ?? null;
	const layerGroup = (l) => layers[l.name]?.group === false ? null : layers[l.name]?.group || l.title.match(/^(.+?)\s+\d{4}\s*[-–—]\s*\d{4}$/)?.[1] || titlePrefix(l.title) || l.title.match(/^(.+?)\s+\d{4}$/)?.[1] || l.title.match(/^(MTB)\s+\d+$/i)?.[1] || null;
	const itemLabel = (l, group) => {
		if (layers[l.name]?.label) return layers[l.name].label;
		if (l.title.startsWith(`${group} `)) return l.title.slice(group.length).trim();
		const match = l.title.match(/^(.+?)\s+[-–—]\s*/);
		return match?.[1] === group ? l.title.slice(match[0].length) : l.title;
	};

	const listed = $derived((service?.layers ?? []).filter((l) => !layers[l.name]?.hide && inPart(l.name)));

	const prefixCounts = $derived.by(() => {
		const counts = {};
		for (const l of listed) {
			const g = layerGroup(l);
			if (g) counts[g] = (counts[g] || 0) + 1;
		}
		return counts;
	});

	const filtered = $derived(listed.filter((l) => l.title.toLowerCase().includes(filterQuery.trim().toLowerCase())));

	const sections = $derived.by(() => {
		const groups = new Map();
		const ungrouped = [];
		for (const l of [...filtered].sort((a, b) => naturalOrder.compare(a.title, b.title))) {
			const g = layerGroup(l);
			if (g && (layers[l.name]?.group || prefixCounts[g] >= 2)) {
				if (!groups.has(g)) groups.set(g, []);
				groups.get(g).push(l);
			} else {
				ungrouped.push(l);
			}
		}
		return {
			groups: [...groups.entries()].map(([name, items]) => ({ name, items: items.sort((a, b) => naturalOrder.compare(itemLabel(a, name), itemLabel(b, name))) })).sort((a, b) => {
				const tail = (name) => /staništ|vrst/i.test(name) ? 1 : 0;
				return tail(a.name) - tail(b.name) || naturalOrder.compare(a.name, b.name);
			}),
			ungrouped: ungrouped.sort((a, b) => naturalOrder.compare(a.title, b.title))
		};
	});

	$effect(() => {
		const searching = Boolean(filterQuery.trim());
		if (searching && !searchSnapshot) searchSnapshot = { root: rootOpen, groups: {} };
		if (!searching && searchSnapshot) {
			rootOpen = searchSnapshot.root;
			for (const [name, wasOpen] of Object.entries(searchSnapshot.groups)) groupOpen[name] = wasOpen;
			searchSnapshot = null;
			return;
		}
		if (!searching) return;
		rootOpen = true;
		for (const { name } of sections.groups) {
			if (!(name in searchSnapshot.groups)) searchSnapshot.groups[name] = Boolean(groupOpen[name]);
			groupOpen[name] = true;
		}
	});

	function retry() {
		error = null;
		attempt++;
	}

	// A WFS layer with a `wms` tweak is drawn from the WMS that publishes it, possibly without the WFS namespace prefix.
	async function wmsSource(name) {
		const wms = await inspect(layers[name].wms, 'WMS');
		return [wms, [name, name.split(':').pop()].find((n) => wms.endpoint.getLayerByName(n)) ?? name];
	}

	async function toggle(name) {
		const id = `${url}#${name}`;
		const request = Symbol();
		requests.set(name, request);
		store(id, on[name]);
		note[name] = '';
		// A row with `members` turns those (hidden) layers on and off with it.
		for (const m of layers[name]?.members ?? []) if (on[m] !== on[name]) (on[m] = on[name]), toggle(m);
		if (!on[name]) return (delete opacity[name], hide[name]?.());
		// Turning on a layer with an `exclusive` key (its own, or the service's) turns off the one that was on.
		const set = layers[name]?.exclusive ?? exclusive;
		if (set) {
			const last = exclusiveOn.get(set);
			if (last?.id !== id) last?.off();
			exclusiveOn.set(set, { id, off: () => on[name] && ((on[name] = false), toggle(name)) });
		}
		if (service.type === 'WFS' && !layers[name]?.wms) {
			hide[name] = showWfs(map, id, service, name, layers[name], (t) => (note[name] = t));
			return;
		}
		try {
			const [src, layer] = layers[name]?.wms ? await wmsSource(name) : [service, name];
			// `together`: other WMS services whose first layer is drawn with this one, as one row (each covers another part).
			const others = await Promise.all((together ?? []).map((u) => inspect(u, 'WMS')));
			// A WMS service's `wfs` publishes the same layers as WFS: their attributes keep geometry out of GetFeatureInfo.
			const twins = layers[name]?.featureInfo && wfs && (await inspect(wfs, 'WFS'));
			const twin = twins?.layers.find((l) => l.name.split(':').pop() === name);
			if (authKey) await useKey(authKey);
			if (!on[name] || requests.get(name) !== request) return;
			const kind = service.layers.find((l) => l.name === name)?.kind;
			const ids = [id, ...others.map((_, i) => `${id}+${i + 1}`)];
			const display = clipToCroatia ? { ...layers[name], clipToCroatia } : layers[name];
			addOverlay(map, id, rasterSource(src, layer, display?.tileSize, format), display, kind);
			others.forEach((o, i) => addOverlay(map, ids[i + 1], rasterSource(o, o.layers[0].name, display?.tileSize, format), display, kind));
			if (opacity[name] !== undefined) ids.forEach((o) => setOpacity(map, o, opacity[name]));
			legend[name] = legendUrl(src, layer);
			const [info, infoName, infoKind] = twin ? [twins, twin.name, twin.kind] : [service, name, kind];
			const stopQueries = layers[name]?.featureInfo && queryOnClick(map, id, src, layer, info, infoName, infoKind === 'points');
			hide[name] = () => (stopQueries?.(), ids.forEach((o) => removeOverlay(map, o)));
		} catch (e) {
			if (!on[name] || requests.get(name) !== request) return;
			note[name] = e.message;
			on[name] = false;
			store(id, false);
		}
	}
</script>


{#if !(part && service && !listed.length) && (!filterQuery.trim() || !service || error || filtered.length)}
{#if flat}{@render body()}{:else}
<details bind:open={rootOpen}>
	<summary>
		<span class:active>{title ?? service?.info.title ?? url}</span>
		{#if onremove}<button onclick={(e) => (e.preventDefault(), onremove())} title="Ukloni">✕</button>{/if}
	</summary>
	{@render body()}
</details>
{/if}
{/if}

{#snippet body()}
	{#if error}
		<pre>{error}</pre>
		<button onclick={retry}>Pokušaj ponovno</button>
	{:else if !service}
		<small>Učitavam…</small>
	{:else}
		{#each sections.groups as { name, items } (name)}
			<details class="group" bind:open={groupOpen[name]} class:active={items.some((l) => on[l.name])}>
				<summary><span>{name}</span> <small>({items.length})</small></summary>
				{#each items as l (l.name)}
				{@render row(l, itemLabel(l, name))}
				{/each}
			</details>
		{/each}
		{#each sections.ungrouped as l (l.name)}{@render row(l, layers[l.name]?.label ?? (flat && listed.length === 1 ? title : l.title))}{/each}
	{/if}
{/snippet}

<!-- A click outside the box or its (i), or Escape, closes it. -->
<svelte:window
	onclick={(e) => !e.target.closest('[data-info]') && (shownInfo = null)}
	onkeydown={(e) => e.key === 'Escape' && (shownInfo = null)}
/>

{#snippet row(l, text, managing = false)}
	{@const [kind, icon] = KINDS[kindOf(l)] ?? []}
	<label>
		<input type="checkbox" bind:checked={on[l.name]} onchange={() => toggle(l.name)} />
		<span>
			{text}
			<small>{rowNote(l.name)}</small>
		</span>
		{#if icon}<svg viewBox="0 0 12 12" fill="currentColor"><title>{kind}</title>{@html icon}</svg>{/if}
		{#if l.about}
			<button class="info" class:open={shownInfo?.id === `${url}#${l.name}`} onclick={(e) => toggleInfo(e, l)} title="Informacije" data-info>
				<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="6" cy="6" r="5.2" /><path d="M6 5.2V9M6 3v.9" /></svg>
			</button>
		{/if}
	</label>
	<!-- The layer's own `opacity` tweak or its service's; with `together`, the other services' halves follow. -->
	{#if on[l.name] && ((layers[l.name]?.opacity ?? slider) || (managing && isRaster(l)))}
		{@const transparency = Math.round(100 * (1 - (opacity[l.name] ?? RASTER_OPACITY)))}
		<label class="opacity-control">
			<span>Prozirnost <output>{transparency} %</output></span>
			<input type="range" min="0" max="100" step="5" aria-label={`Prozirnost - ${text}`} aria-valuetext={`${transparency} % prozirno`} value={transparency}
				oninput={(e) => {
					const id = `${url}#${l.name}`;
					opacity[l.name] = 1 - +e.currentTarget.value / 100;
					for (const o of [id, ...(together ?? []).map((_, i) => `${id}+${i + 1}`)]) setOpacity(map, o, opacity[l.name]);
				}} />
		</label>
	{/if}
	{#if on[l.name] && layers[l.name]?.members}
		<ul class="swatches">
			{#each [l.name, ...layers[l.name].members] as n}<li><span style:background={layers[n].paint.circle['circle-color']}></span>{layers[n].legend}</li>{/each}
		</ul>
	{/if}
	<!-- A legend of one unlabelled swatch (DGU orthophotos: 20 × 20 px) says nothing. -->
	{#if on[l.name] && legend[l.name]}<img src={legend[l.name]} alt={`Legenda - ${text}`} onload={(e) => e.currentTarget.naturalWidth <= 20 && e.currentTarget.naturalHeight <= 20 && (legend[l.name] = null)} />{/if}
	{#if infoLayer?.name === l.name}
		<!-- Official information only: the layer's own abstract, then its metadata record, else where the text came from. -->
		<div class="info-box" style:left="{shownInfo.left}px" style:top={shownInfo.top && `${shownInfo.top}px`} style:bottom={shownInfo.bottom && `${shownInfo.bottom}px`} data-info>
			<strong>{infoLayer.title}</strong>
			<p>{infoLayer.about.text}</p>
			{#if infoLayer.about.record}
				<a href={infoLayer.about.record} target="_blank" rel="noreferrer">Više
					<svg class="external" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><title>otvara se u novoj kartici</title><path d="M5 2H2v8h8V7M7 2h3v3M10 2L5.5 6.5" /></svg></a>
			{:else}
				<a href={service.capabilitiesUrl} target="_blank" rel="noreferrer">{service.type} endpoint</a>
			{/if}
		</div>
	{/if}
{/snippet}

<style>
	summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
	summary button { float: right; }
	summary span { padding: 2px 4px; }
	summary span.active { background: #e8eef5; }
	details.group.active > summary span { background: #eaf2e8; }
	details.group { margin: 0 0 0 12px; }
	details.group > summary { font-weight: 500; font-size: 14px; padding: 6px 0; }
	label { display: flex; gap: 6px; align-items: baseline; padding: 3px 0 3px 12px; cursor: pointer; }
	a, img, small, pre + button { display: block; margin: 0 0 6px 12px; }
	label small, summary small { display: inline; margin: 0; }
	label > span { flex: 1; }
	label > input { flex: none; }
	img { max-width: calc(100% - 12px); height: auto; }
	.swatches { display: flex; flex-wrap: wrap; gap: 2px 10px; margin: 0 0 6px 31px; padding: 0; list-style: none; font-size: 12px; color: #666; }
	.swatches span { display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 50%; }
	.opacity-control { display: block; margin: 2px 0 6px 31px; padding: 0; cursor: default; font-size: 12px; color: #666; }
	.opacity-control > span { display: flex; justify-content: space-between; }
	.opacity-control input { display: block; box-sizing: border-box; width: 100%; margin: 2px 0 0; }
	svg { flex: none; align-self: center; width: 14px; height: 14px; color: #777; }
	.info { display: flex; align-self: center; padding: 0; border: 0; background: none; cursor: pointer; }
	.info.open svg { color: #222; }
	.info-box { position: fixed; z-index: 15; box-sizing: border-box; width: 300px; max-height: calc(100dvh - 16px); overflow-y: auto; padding: 10px 12px; border: 1px solid #999; background: #fff; font-size: 13px; }
	.info-box p { margin: 6px 0; white-space: pre-line; }
	.info-box a { display: inline-flex; align-items: center; gap: 3px; margin: 0; }
	.info-box .external { width: 11px; height: 11px; color: inherit; }
	small, a { color: #666; font-size: 12px; }
	pre { white-space: pre-wrap; color: #b00; font-size: 12px; }
</style>
