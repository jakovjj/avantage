<script>
	import { inspect, legendUrl, rasterSource } from './ogc.js';
	import { addOverlay, removeOverlay } from './map.js';
	import { showWfs } from './wfs.js';

	let { map, url, type, title, layers = {}, open = false, onremove } = $props();
	let service = $state(), error = $state(), attempt = $state(0);
	let on = $state({}), note = $state({}); // per layer name: checked, status text
	let query = $state('');
	const hide = {}; // per layer name: removes it from the map

	// GetCapabilities runs only once the group is opened; `attempt` lets a retry re-run it.
	$effect(() => {
		attempt;
		if (open && !service && !error) inspect(url, type).then((s) => (service = s), (e) => (error = e.message));
	});

	const layerGroup = (l) => layers[l.name]?.group || (l.title.includes(' - ') ? l.title.split(' - ')[0].trim() : null);

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
		for (const l of filtered) {
			const g = layerGroup(l);
			if (g && (layers[l.name]?.group || prefixCounts[g] >= 2)) {
				if (!groups.has(g)) groups.set(g, []);
				groups.get(g).push(l);
			} else {
				ungrouped.push(l);
			}
		}
		return { groups: [...groups.entries()].map(([name, items]) => ({ name, items })), ungrouped };
	});

	function retry() {
		error = null;
		attempt++;
	}

	function toggle(name) {
		const id = `${url}#${name}`;
		note[name] = '';
		if (!on[name]) return hide[name]?.();
		if (service.type === 'WFS') {
			hide[name] = showWfs(map, id, service, name, layers[name], (t) => (note[name] = t));
			return;
		}
		try {
			addOverlay(map, id, rasterSource(service, name));
			hide[name] = () => removeOverlay(map, id);
		} catch (e) {
			note[name] = e.message;
			on[name] = false;
		}
	}
</script>

<details bind:open>
	<summary>
		{title ?? service?.info.title ?? url} <small>{service?.type ?? type ?? ''}</small>
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
			<details class="group" open={query ? true : undefined}>
				<summary>{name} <small>({items.length})</small></summary>
				{#each items as { name: id, title: t } (id)}
					<label>
						<input type="checkbox" bind:checked={on[id]} onchange={() => toggle(id)} />
						{t.startsWith(name + ' - ') ? t.slice(name.length + 3) : t} <small>{note[id] ?? ''}</small>
					</label>
					{#if on[id] && legendUrl(service, id)}<img src={legendUrl(service, id)} alt="" />{/if}
				{/each}
			</details>
		{/each}
		{#each sections.ungrouped as { name, title } (name)}
			<label>
				<input type="checkbox" bind:checked={on[name]} onchange={() => toggle(name)} />
				{title} <small>{note[name] ?? ''}</small>
			</label>
			{#if on[name] && legendUrl(service, name)}<img src={legendUrl(service, name)} alt="" />{/if}
		{/each}
	{/if}
</details>

<style>
	summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
	summary button { float: right; }
	details.group { margin: 0 0 0 12px; }
	details.group > summary { font-weight: 500; font-size: 14px; padding: 6px 0; }
	label { display: flex; gap: 6px; align-items: baseline; padding: 3px 0 3px 12px; cursor: pointer; }
	a, img, small, input[type='search'], pre + button { display: block; margin: 0 0 6px 12px; }
	label small, summary small { display: inline; margin: 0; }
	small, a { color: #666; font-size: 12px; }
	pre { white-space: pre-wrap; color: #b00; font-size: 12px; }
</style>
