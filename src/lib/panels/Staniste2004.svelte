<script>
	let { properties: p } = $props();

	// Which of the map's 9 layers the feature is from (`tip`, written without diacritics in some layers).
	const LAYERS = {
		kopnena_stanista: 'kopnena staništa', kopnena_stanista_tocke: 'kopnena staništa', kopnene_vode: 'kopnene vode',
		'morska obala': 'morska obala', morski_bentos: 'morski bentos', 'morski bentos tocke': 'morski bentos',
		podzemlje: 'podzemlje', 'stijene i tocila': 'stijene i točila', vodotoci: 'vodotoci'
	};

	// A feature may be a combination of NKS types: "F.4./G.2.4.1." with names joined the same way. Some combinations
	// have one name for all codes, or none (663 coast lines), so codes and names are paired only when they match up.
	const codes = $derived((p.nks_kod ?? '').split('/').map((c) => c.trim()).filter(Boolean));
	const names = $derived((p.nks_ime ?? '').split(/\s*\/\s*/).map((n) => n.trim()).filter(Boolean));
	const paired = $derived(names.length === codes.length);
</script>

<h5>Karta staništa 2004{LAYERS[p.tip] ? ` · ${LAYERS[p.tip]}` : ''}</h5>
<ol>
	{#each codes as code, i}
		<li class:main={i === 0}>
			{#if paired}<strong>{names[i]}</strong>{/if} <span class:muted={paired}>{code}</span>
		</li>
	{/each}
</ol>
{#if !paired && names.length}<p>{names.join(' / ')}</p>{/if}

<style>
	h5 { margin: 0 0 6px; font-size: 12px; font-weight: normal; color: #666; }
	ol { margin: 0 0 10px; padding: 0; list-style: none; }
	li { margin: 0 0 6px; }
	li.main strong { font-size: 18px; }
	.muted { color: #666; }
	p { margin: 0; }
</style>
