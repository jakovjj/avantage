<script>
	import { formatNumber } from '../utils.js';

	let { properties: p } = $props();

	// Fill colours of the Bioportal WMS style by NKS class letter (J has no fill there: the style's default grey).
	const CLASS_COLORS = {
		A: '#000080', B: '#993300', C: '#ffff00', D: '#00ff00', E: '#008000', F: '#00ffff', G: '#0000ff', I: '#ff9900', J: '#808080', K: '#0080ff'
	};

	// A polygon is a complex of up to 3 NKS habitat types, the most important first; "-" means no scientific name.
	const types = $derived(
		[1, 2, 3]
			.filter((n) => p[`nks${n}`])
			.map((n) => ({
				code: p[`nks${n}`],
				name: p[`nks${n}_naziv`],
				scientific: p[`nks${n}_znan`] !== '-' && p[`nks${n}_znan`],
				color: CLASS_COLORS[p[`nks${n}`][0]]
			}))
	);
</script>

<h5>Karta staništa 2016</h5>
<ol>
	{#each types as type, i}
		<li class:main={i === 0}>
			<span class="swatch" style:background={type.color ?? 'transparent'}></span>
			<div>
				<strong>{type.name}</strong> <span class="muted">{type.code}</span>
				{#if type.scientific}<br /><i class="muted">{type.scientific}</i>{/if}
			</div>
		</li>
	{/each}
</ol>
{#if p.area_ha != null}<p><span class="muted">Površina</span> {formatNumber(p.area_ha)} ha</p>{/if}

<style>
	h5 { margin: 0 0 6px; font-size: 12px; font-weight: normal; color: #666; }
	ol { margin: 0 0 10px; padding: 0; list-style: none; }
	li { display: flex; gap: 8px; margin: 0 0 8px; }
	li.main strong { font-size: 18px; }
	.swatch { flex: none; width: 12px; height: 12px; margin-top: 3px; border: 1px solid #0006; opacity: 0.8; }
	li.main .swatch { width: 16px; height: 16px; margin-top: 4px; }
	.muted { color: #666; }
	i { font-size: 12px; }
	p { margin: 0; }
</style>
