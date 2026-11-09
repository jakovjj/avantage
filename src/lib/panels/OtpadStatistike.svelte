<script>
	import { formatNumber, titleCase } from '../utils.js';

	let { properties: p, layer } = $props();
	const statistics = $derived(layer.statistics);
	const municipality = $derived(p.jls_ime && titleCase(p.jls_ime));
	const county = $derived(p.zup_naziv ?? p.zupanija ?? p.zu_ime);
	const countyName = $derived(county && (/župan|grad zagreb/i.test(county) ? county : `${county} županija`));
	const hasValue = (key) => p[key] != null && String(p[key]).trim() !== '' && Number.isFinite(Number(p[key]));
	const metric = $derived(statistics.metric);
	const facts = $derived((statistics.fields ?? []).filter(([key]) => key !== metric[0] && hasValue(key)));
</script>

<h5>Otpad (statistike) - {statistics.year}.</h5>
<h2>{municipality ?? countyName}</h2>
{#if municipality && countyName}<p class="muted">{countyName}</p>{/if}

<div class="metric">
	<p class="metric-label">{metric[1]}</p>
	{#if hasValue(metric[0])}
		<p class="amount"><strong>{formatNumber(p[metric[0]])}</strong> <span>{metric[2]}</span></p>
	{:else}
		<p class="muted">Podatak nije dostupan</p>
	{/if}
</div>

{#if facts.length}
	<dl>
		{#each facts as [key, label, unit]}
			<div>
				<dt>{label}</dt>
				<dd>{formatNumber(p[key])}{unit ? ` ${unit}` : ''}</dd>
			</div>
		{/each}
	</dl>
{/if}

<style>
	h5 { margin: 0 0 2px; font-size: 12px; font-weight: normal; color: #666; }
	h2 { margin: 0 0 6px; font-size: 18px; }
	p { margin: 0; }
	.muted, dt, .metric-label { color: #666; }
	.metric { margin: 16px 0; }
	.metric-label { margin-bottom: 4px; }
	.amount strong { font-size: 24px; }
	.amount span { white-space: nowrap; }
	dl { margin: 0; }
	dl > div { padding: 8px 0; border-top: 1px solid #eee; }
	dt { font-size: 12px; }
	dd { margin: 2px 0 0; overflow-wrap: anywhere; }
</style>
