<script>
	import { onMount } from 'svelte';
	import { createMap } from '#lib/map.js';
	import Source from '#lib/Source.svelte';
	import SOURCES from '#lib/sources.js';

	const KEY = 'avantage.customSources';
	const builtins = SOURCES.map((s) => ({ ...s }));

	let container, map = $state();
	let custom = $state(loadCustom());
	let sources = $derived([...builtins, ...custom]);
	let url = $state('');
	let cursor = $state(), zoom = $state();
	let panelOpen = $state(true);
	let formError = $state('');

	function loadCustom() {
		try {
			const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
			return Array.isArray(stored) ? stored : [];
		} catch {
			return [];
		}
	}

	function persist() {
		try {
			localStorage.setItem(KEY, JSON.stringify(custom));
		} catch {}
	}

	onMount(() => {
		const ready = createMap(container).then((m) => {
			zoom = m.getZoom();
			m.on('zoom', () => (zoom = m.getZoom()));
			m.on('mousemove', (e) => (cursor = e.lngLat));
			return (map = m);
		});
		return () => ready.then((m) => m.remove());
	});

	function add(e) {
		e.preventDefault();
		let value = url.trim();
		if (!value) return;
		if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
		try {
			new URL(value);
		} catch {
			formError = 'Neispravna adresa servisa.';
			return;
		}
		formError = '';
		custom.push({ url: value, open: true });
		url = '';
		persist();
	}

	function removeCustom(source) {
		custom = custom.filter((s) => s !== source);
		persist();
	}
</script>

<svelte:head><title>Avantage · otvoreni prostorni podaci</title></svelte:head>

<div class="app" class:closed={!panelOpen}>
	<aside>
		<header class="brand">
			<span class="logo">A</span>
			<div class="brand-text">
				<h1>Avantage</h1>
				<p>Otvoreni prostorni podaci Hrvatske</p>
			</div>
			<button class="close" onclick={() => (panelOpen = false)} title="Sakrij panel" aria-label="Sakrij panel">‹</button>
		</header>

		<section class="add">
			<h2>Dodaj servis</h2>
			<form onsubmit={add}>
				<input type="text" inputmode="url" autocomplete="url" spellcheck="false" bind:value={url} placeholder="https://primjer.hr/wms" />
				<button type="submit">Dodaj</button>
			</form>
			{#if formError}<p class="error">{formError}</p>{/if}
			<p class="hint">Podržani su WMS, WFS i WMTS. Servis mora slati CORS zaglavlja, a WMS/WMTS mora podržavati EPSG:3857.</p>
		</section>

		<section class="sources">
			<h2>Servisi <span class="count">{sources.length}</span></h2>
			{#if map}
				{#each sources as source (source)}
					<Source map={map} {...source} onremove={custom.includes(source) ? () => removeCustom(source) : null} />
				{/each}
			{:else}
				<p class="hint loading-note"><span class="spinner"></span> Učitavam kartu…</p>
			{/if}
		</section>

		<footer>
			<p>Podloga © <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · podaci © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></p>
		</footer>
	</aside>

	<div class="map-pane">
		<main bind:this={container}></main>
		{#if !panelOpen}
			<button class="open" onclick={() => (panelOpen = true)}>☰ Servisi</button>
		{/if}
		{#if map}
			<div class="coords">
				{cursor ? `${cursor.lat.toFixed(4)}, ${cursor.lng.toFixed(4)} · ` : ''}z {zoom.toFixed(1)}
			</div>
		{/if}
	</div>
	<button class="scrim" onclick={() => (panelOpen = false)} aria-label="Zatvori panel"></button>
</div>

<style>
	:global(body) {
		margin: 0;
		height: 100dvh;
		overflow: hidden;
		font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
		color: var(--text);
		color-scheme: light;
	}

	.app {
		--accent: #0e7a56;
		--accent-strong: #0a5e42;
		--accent-soft: #e6f4ee;
		--bg: #eef1f4;
		--panel: #ffffff;
		--text: #1c2530;
		--muted: #5f6b7a;
		--line: #e1e6ec;
		display: grid;
		grid-template-columns: minmax(0, 340px) 1fr;
		height: 100dvh;
		transition: grid-template-columns 0.25s ease;
	}
	.app.closed { grid-template-columns: 0 1fr; }

	aside {
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow-x: hidden;
		overflow-y: auto;
		background: var(--panel);
		border-right: 1px solid var(--line);
		scrollbar-width: thin;
		scrollbar-color: #c6cdd6 transparent;
	}
	.app.closed aside { visibility: hidden; border-right: 0; }

	/* brand */
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
		position: sticky;
		top: 0;
		background: var(--panel);
		z-index: 1;
	}
	.logo {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: linear-gradient(135deg, var(--accent), #17a06b);
		color: #fff;
		font-weight: 800;
		font-size: 18px;
		box-shadow: 0 2px 6px rgba(14, 122, 86, 0.35);
	}
	.brand-text { flex: 1; min-width: 0; }
	.brand h1 { margin: 0; font-size: 17px; }
	.brand p { margin: 0; font-size: 11.5px; color: var(--muted); }
	.close {
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: 20px;
		line-height: 1;
		padding: 4px 8px;
		border-radius: 8px;
		cursor: pointer;
	}
	.close:hover { background: var(--bg); color: var(--text); }

	/* section headers */
	h2 {
		margin: 0 0 8px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--muted);
	}

	/* add form */
	.add { padding: 14px 16px 12px; border-bottom: 1px solid var(--line); }
	.add form { display: flex; gap: 8px; }
	.add input {
		flex: 1;
		min-width: 0;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 9px;
		font: inherit;
		background: var(--bg);
		transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
	}
	.add input:focus {
		outline: 0;
		border-color: var(--accent);
		background: #fff;
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.add button, .open {
		border: 0;
		border-radius: 9px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		padding: 8px 14px;
		cursor: pointer;
		transition: background 0.15s;
	}
	.add button:hover, .open:hover { background: var(--accent-strong); }
	.error { margin: 8px 0 0; color: #b3261e; font-size: 12px; }
	.hint { margin: 8px 0 0; color: var(--muted); font-size: 11.5px; }

	.sources { padding: 14px 16px; flex: 1; }
	.count {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		margin-left: 4px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 10.5px;
		vertical-align: 1px;
	}

	.loading-note { display: flex; align-items: center; gap: 8px; }
	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid #d3dae2;
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(1turn); } }

	footer {
		padding: 10px 16px 14px;
		border-top: 1px solid var(--line);
		color: var(--muted);
		font-size: 11px;
	}
	footer p { margin: 0; }
	footer a { color: var(--accent-strong); text-decoration: none; }
	footer a:hover { text-decoration: underline; }

	/* map */
	.map-pane { position: relative; min-width: 0; height: 100dvh; }
	main { width: 100%; height: 100%; }
	.open {
		position: absolute;
		top: 12px;
		left: 12px;
		z-index: 10;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
	}
	.coords {
		position: absolute;
		right: 12px;
		bottom: 28px;
		z-index: 10;
		padding: 3px 8px;
		border-radius: 999px;
		background: rgba(20, 26, 33, 0.72);
		color: #fff;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}

	/* maplibre */
	:global(.maplibregl-popup-content) {
		max-height: 300px;
		overflow: auto;
		font-size: 12px;
		border-radius: 10px;
		box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
		padding: 10px 14px;
	}
	:global(.maplibregl-popup-content th) {
		text-align: left;
		color: var(--muted);
		font-weight: 500;
		padding-right: 8px;
		vertical-align: top;
	}
	:global(.maplibregl-ctrl-group) {
		border-radius: 10px;
		overflow: hidden;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	/* mobile: sidebar kao ladica preko karte */
	.scrim {
		display: none;
		border: 0;
		padding: 0;
		cursor: default;
	}
	@media (max-width: 720px) {
		.app, .app.closed { grid-template-columns: 1fr; }
		aside {
			position: fixed;
			inset: 0 auto 0 0;
			width: min(320px, 86vw);
			z-index: 30;
			box-shadow: 0 0 30px rgba(0, 0, 0, 0.25);
			transform: translateX(-105%);
			transition: transform 0.25s ease;
			visibility: visible;
		}
		.app:not(.closed) aside { transform: none; }
		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 25;
			background: rgba(12, 18, 26, 0.4);
		}
		.app.closed .scrim { display: none; }
	}
</style>
