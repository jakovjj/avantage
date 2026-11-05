<script>
	import { inspect, legendUrl, providerName, rasterSource } from './ogc.js';
	import { addOverlay, removeOverlay } from './map.js';
	import { showWfs } from './wfs.js';

	let { map, url, type, title, layers = {}, open = false, onremove } = $props();
	let service = $state(), error = $state(), attempt = $state(0);
	let on = $state({}), note = $state({}); // per layer name: checked, status text
	let query = $state('');
	const hide = {}; // per layer name: removes it from the map

	// GetCapabilities runs only once the group is opened; `attempt` lets retry() re-run it.
	$effect(() => {
		if (open && !service && !error) inspect(url, type).then((s) => (service = s), (e) => (error = e.message));
		attempt;
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

	function remove(e) {
		e.preventDefault();
		e.stopPropagation();
		onremove?.();
	}

	const visible = $derived(
		(service?.layers ?? []).filter((l) => (l.title ?? l.name).toLowerCase().includes(query.toLowerCase()))
	);
</script>

<details class="source" bind:open>
	<summary>
		<span class="badge {service?.type ?? type ?? ''}">{service?.type ?? type ?? '?'}</span>
		<span class="name" title={url}>{title ?? service?.info.title ?? url}</span>
		{#if onremove}
			<button class="remove" onclick={remove} title="Ukloni servis" aria-label="Ukloni servis">✕</button>
		{/if}
		<span class="chevron">▸</span>
	</summary>

	<div class="body">
		{#if error}
			<div class="error">
				<p>{error}</p>
				<button onclick={retry}>Pokušaj ponovno</button>
			</div>
		{:else if !service}
			<div class="loading"><span class="spinner"></span> Učitavam servis…</div>
		{:else}
			<a class="provider" href={service.capabilitiesUrl} target="_blank" rel="noreferrer">
				{providerName(service)} · GetCapabilities ↗
			</a>

			{#if service.layers.length > 6}
				<input class="filter" type="search" placeholder="Filtriraj slojeve…" bind:value={query} />
			{/if}

			{#if visible.length}
				{#each visible as { name, title } (name)}
					<label class="layer">
						<input type="checkbox" bind:checked={on[name]} onchange={() => toggle(name)} />
						<span class="check"></span>
						<span class="layer-title">{title}</span>
						{#if note[name]}<span class="note">{note[name]}</span>{/if}
					</label>
					{#if on[name] && legendUrl(service, name)}
						<img class="legend" src={legendUrl(service, name)} alt="Legenda" />
					{/if}
				{/each}
			{:else}
				<p class="empty">{query ? 'Nema slojeva koji odgovaraju upitu.' : 'Servis nema slojeva.'}</p>
			{/if}
		{/if}
	</div>
</details>

<style>
	.source {
		margin-bottom: 8px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
		overflow: hidden;
	}
	.source[open] {
		border-color: #d5dde6;
		box-shadow: 0 2px 10px rgba(28, 37, 48, 0.06);
	}
	summary {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 10px;
		cursor: pointer;
		list-style: none;
		user-select: none;
	}
	summary::-webkit-details-marker { display: none; }
	summary:hover { background: #f7f9fb; }
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		font-size: 13px;
	}
	.badge {
		padding: 1px 6px;
		border-radius: 999px;
		background: #e8edf3;
		color: #47556a;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.badge.WMS { background: #e3edfb; color: #1d5bbf; }
	.badge.WFS { background: #fdeee2; color: #c05e00; }
	.badge.WMTS { background: #f0e7fb; color: #6d3db8; }
	.chevron { color: var(--muted); font-size: 11px; transition: transform 0.2s ease; }
	.source[open] .chevron { transform: rotate(90deg); }
	.remove {
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: 13px;
		line-height: 1;
		padding: 3px 7px;
		border-radius: 6px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s, background 0.15s, color 0.15s;
	}
	summary:hover .remove, .remove:focus-visible { opacity: 1; }
	.remove:hover { background: #fbe9e7; color: #b3261e; }

	.body { padding: 2px 10px 10px; }
	.provider {
		display: block;
		margin: 2px 2px 8px;
		font-size: 11.5px;
		color: var(--accent-strong);
		text-decoration: none;
	}
	.provider:hover { text-decoration: underline; }

	.loading {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 2px 8px;
		color: var(--muted);
		font-size: 12px;
	}
	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid #d3dae2;
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(1turn); } }

	.error {
		margin: 4px 2px 8px;
		padding: 8px 10px;
		border: 1px solid #f5c6c0;
		border-radius: 9px;
		background: #fdecea;
	}
	.error p {
		margin: 0 0 8px;
		color: #b3261e;
		font-size: 12px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.error button {
		border: 0;
		border-radius: 7px;
		background: #b3261e;
		color: #fff;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		padding: 5px 10px;
		cursor: pointer;
	}
	.error button:hover { background: #8f1d17; }

	.filter {
		width: 100%;
		box-sizing: border-box;
		margin: 4px 0 8px;
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		font: inherit;
		font-size: 12.5px;
		background: #f7f9fb;
	}
	.filter:focus {
		outline: 0;
		border-color: var(--accent);
		background: #fff;
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.layer {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0 8px;
		align-items: start;
		padding: 5px 4px;
		border-radius: 8px;
		cursor: pointer;
	}
	.layer:hover { background: #f5f8fa; }
	.layer input { position: absolute; opacity: 0; pointer-events: none; }
	.check {
		width: 15px;
		height: 15px;
		margin-top: 1px;
		border: 1.5px solid #b9c2cd;
		border-radius: 4px;
		background: #fff;
		display: grid;
		place-items: center;
		transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
	}
	.check::after {
		content: '';
		width: 8px;
		height: 4px;
		border-left: 2px solid #fff;
		border-bottom: 2px solid #fff;
		transform: rotate(-45deg) translate(1px, -1px);
		opacity: 0;
	}
	.layer input:checked + .check { background: var(--accent); border-color: var(--accent); }
	.layer input:checked + .check::after { opacity: 1; }
	.layer input:focus-visible + .check { box-shadow: 0 0 0 3px var(--accent-soft); }
	.layer-title { font-size: 12.5px; line-height: 1.35; word-break: break-word; }
	.note { grid-column: 2; color: #9a6700; font-size: 11px; }

	.legend {
		display: block;
		margin: 4px 0 6px 23px;
		max-width: 220px;
		max-height: 120px;
		object-fit: contain;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
	}
	.empty { margin: 4px 2px 8px; color: var(--muted); font-size: 12px; }
</style>
