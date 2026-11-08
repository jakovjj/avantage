<script>
	import { formatNumber } from '../utils.js';

	let { properties: p } = $props();

	// A feature is a complex of up to 3 marine NKS types, the most important first.
	const types = $derived([1, 2, 3].filter((n) => p[`mnks_${n}`]).map((n) => ({ code: p[`mnks_${n}`], name: p[`mnks_${n}_naz`] })));
	const scale = $derived(p.izvorno_m?.match(/^1:(\d+)$/)?.[1]);
	// Polygons carry area (ha) and perimeter, lines only length (m), points neither.
	const facts = $derived([
		['Površina', p.area != null && `${formatNumber(p.area)} ha`],
		['Duljina', p.area == null && p.length != null && `${formatNumber(p.length, 0)} m`],
		['Kompleks', p.kompleks_s],
		['Metoda', p.metoda === 'Mjesovito' ? 'Mješovito' : p.metoda],
		['Mjerilo', scale ? `1:${formatNumber(scale)}` : p.izvorno_m]
	].filter(([, value]) => value));
</script>

<h5>Karta morskih staništa 2023</h5>
<ol>
	{#each types as type, i}
		<li class:main={i === 0}><strong>{type.name}</strong> <span class="muted">{type.code}</span></li>
	{/each}
</ol>
{#each facts as [label, value]}<p><span class="muted">{label}</span> {value}</p>{/each}

<style>
	h5 { margin: 0 0 6px; font-size: 12px; font-weight: normal; color: #666; }
	ol { margin: 0 0 10px; padding: 0; list-style: none; }
	li { margin: 0 0 6px; }
	li.main strong { font-size: 18px; }
	.muted { color: #666; }
	p { margin: 0 0 2px; }
</style>
