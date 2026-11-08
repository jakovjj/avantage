<script>
	import { untrack } from 'svelte';
	import { inspect, legendUrl, rasterSource } from './ogc.js';
	import { addOverlay, removeOverlay } from './map.js';
	import { showWfs } from './wfs.js';

	let { map, url, type, title, layers = {}, open = false, onremove, onLimit, reset = 0 } = $props();
	let service = $state(), error = $state(), attempt = $state(0);
	let on = $state({}), note = $state({}), legend = $state({}); // per layer name: checked, status text, legend image
	let query = $state('');
	let groupOpen = $state({});
	const active = $derived(Object.values(on).some(Boolean));
	const hide = {}; // per layer name: removes it from the map

	// Grey icon of what a layer looks like on the map (12×12 SVG content).
	const KINDS = {
		points: ['markeri', '<path d="M6 11.5S2 7.2 2 4.8a4 4 0 0 1 8 0C10 7.2 6 11.5 6 11.5Z"/><circle cx="6" cy="4.8" r="1.4" fill="#fff"/>'],
		lines: ['linije', '<path d="M1 10l3.5-5 3 3L11 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'],
		areas: ['područja', '<path d="M1.5 4L6 1l4.5 3-1 6.5h-7Z" fill-opacity=".35" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'],
		heatmap: ['toplinska karta', '<rect x="1" y="1" width="3" height="3" opacity=".3"/><rect x="4.5" y="1" width="3" height="3" opacity=".6"/><rect x="8" y="1" width="3" height="3"/><rect x="1" y="4.5" width="3" height="3" opacity=".6"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="8" y="4.5" width="3" height="3" opacity=".6"/><rect x="1" y="8" width="3" height="3"/><rect x="4.5" y="8" width="3" height="3" opacity=".6"/><rect x="8" y="8" width="3" height="3" opacity=".3"/>'],
		raster: ['slika', '<rect x="1" y="1.5" width="10" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 10l3-4 2 2.5 1.5-1.5L10 10Z"/>']
	};
	const kindOf = (l) => (layers[l.name]?.heatmap ? 'heatmap' : l.kind);

	// The page's reset button bumps `reset`: turn every layer off and clear the filter.
	$effect(() => {
		if (!reset) return;
		untrack(() => {
			query = '';
			for (const name in on) if (on[name]) (on[name] = false), toggle(name);
		});
	});

	// GetCapabilities runs only once the group is opened; `attempt` lets a retry re-run it.
	$effect(() => {
		attempt;
		if (open && !service && !error) inspect(url, type).then((s) => (service = s), (e) => (error = e.message));
	});

	// Group title prefix ("2018" in "2018 - Reciklažna dvorišta"); some servers write the
	// dash without the trailing space ("2017 -Građevni otpad") or as an en dash.
	const naturalOrder = new Intl.Collator('hr', { numeric: true, sensitivity: 'base' });
	const titlePrefix = (title) => title.match(/^(.+?)\s+[-–—]\s*/)?.[1] ?? null;
	const layerGroup = (l) => layers[l.name]?.group || l.title.match(/^(.+?)\s+\d{4}\s*[-–—]\s*\d{4}$/)?.[1] || titlePrefix(l.title) || l.title.match(/^(.+?)\s+\d{4}$/)?.[1] || l.title.match(/^(MTB)\s+\d+$/i)?.[1] || null;
	const itemLabel = (l, group) => {
		if (l.title.startsWith(`${group} `)) return l.title.slice(group.length).trim();
		const match = l.title.match(/^(.+?)\s+[-–—]\s*/);
		return match?.[1] === group ? l.title.slice(match[0].length) : l.title;
	};

	const prefixCounts = $derived.by(() => {
		const counts = {};
		for (const l of service?.layers ?? []) {
			const g = layerGroup(l);
			if (g) counts[g] = (counts[g] || 0) + 1;
		}
		return counts;
	});

	const filtered = $derived((service?.layers ?? []).filter((l) => l.title.toLowerCase().includes(query.toLowerCase())));

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
			groups: [...groups.entries()].map(([name, items]) => ({ name, items })).sort((a, b) => {
				const tail = (name) => /staništ|vrst/i.test(name) ? 1 : 0;
				return tail(a.name) - tail(b.name) || naturalOrder.compare(a.name, b.name);
			}),
			ungrouped: ungrouped.sort((a, b) => naturalOrder.compare(a.title, b.title))
		};
	});

	$effect(() => {
		if (query) for (const { name } of sections.groups) groupOpen[name] = true;
	});

	function retry() {
		error = null;
		attempt++;
	}

	// A heatmap layer is drawn from the WMS that publishes it, possibly without the WFS namespace prefix.
	async function heatmapSource(name) {
		const wms = await inspect(layers[name].heatmap, 'WMS');
		return [wms, [name, name.split(':').pop()].find((n) => wms.endpoint.getLayerByName(n)) ?? name];
	}

	async function toggle(name) {
		const id = `${url}#${name}`;
		note[name] = '';
		if (!on[name]) return hide[name]?.();
		if (service.type === 'WFS' && !layers[name]?.heatmap) {
			hide[name] = showWfs(map, id, service, name, layers[name], (t) => (note[name] = t), (limited, zoomToFit, impossible = false) =>
				onLimit?.(limited ? { id, title: service.layers.find((layer) => layer.name === name)?.title ?? name, zoomToFit, impossible } : null, id)
			);
			return;
		}
		try {
			const [src, layer] = layers[name]?.heatmap ? await heatmapSource(name) : [service, name];
			if (!on[name]) return; // turned off while the WMS capabilities were loading
			addOverlay(map, id, rasterSource(src, layer));
			legend[name] = legendUrl(src, layer);
			hide[name] = () => removeOverlay(map, id);
		} catch (e) {
			note[name] = e.message;
			on[name] = false;
		}
	}
</script>

<details bind:open>
	<summary>
		<span class:active>{title ?? service?.info.title ?? url}</span> <small>{service?.type ?? type ?? ''}</small>
		{#if onremove}<button onclick={(e) => (e.preventDefault(), onremove())} title="Ukloni">✕</button>{/if}
	</summary>
	{#if error}
		<pre>{error}</pre>
		<button onclick={retry}>Pokušaj ponovno</button>
	{:else if !service}
		<small>Učitavam…</small>
	{:else}
		<a href={service.capabilitiesUrl} target="_blank" rel="noreferrer">{service.type} endpoint</a>
		{#if service.layers.length > 10}<input type="search" placeholder="Filtriraj" bind:value={query} />{/if}
		{#each sections.groups as { name, items } (name)}
			<details class="group" bind:open={groupOpen[name]} class:active={items.some((l) => on[l.name])}>
				<summary><span>{name}</span> <small>({items.length})</small></summary>
				{#each items as l (l.name)}
				{@render row(l, itemLabel(l, name))}
				{/each}
			</details>
		{/each}
		{#each sections.ungrouped as l (l.name)}{@render row(l, l.title)}{/each}
	{/if}
</details>

{#snippet row(l, text)}
	{@const [kind, icon] = KINDS[kindOf(l)] ?? []}
	<label>
		<input type="checkbox" bind:checked={on[l.name]} onchange={() => toggle(l.name)} />
		<span>
			{text}
			{#if icon}<svg viewBox="0 0 12 12" fill="currentColor"><title>{kind}</title>{@html icon}</svg>{/if}
			<small>{note[l.name] ?? ''}</small>
		</span>
	</label>
	{#if on[l.name] && legend[l.name]}<img src={legend[l.name]} alt="" />{/if}
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
	a, img, small, input[type='search'], pre + button { display: block; margin: 0 0 6px 12px; }
	label small, summary small { display: inline; margin: 0; }
	svg { width: 14px; height: 14px; margin-left: 3px; vertical-align: -2px; color: #777; }
	small, a { color: #666; font-size: 12px; }
	pre { white-space: pre-wrap; color: #b00; font-size: 12px; }
</style>
