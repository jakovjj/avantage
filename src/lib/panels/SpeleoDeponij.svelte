<script>
	import { formatNumber } from '../utils.js';

	let { properties: p } = $props();

	// The 2021 and 2024 registers name their fields differently; "-" means not known.
	const field = (...keys) => keys.map((k) => String(p[k] ?? '').trim()).find((v) => v && v !== '-') ?? null;

	// "Jama kod Rašpora (sinonimi: Žankana jama, Abisso Bertorelli)": the name, then its other names (also misspelt
	// "sinoinim").
	const name = $derived(field('ime_obj') ?? 'Nepoznat objekt');
	const [title, synonyms] = $derived(name.match(/^(.*?)\s*\(sino\w*:\s*(.*)\)$/i)?.slice(1) ?? [name, null]);
	// Metres, as numbers ("5400") or occasionally text; numbers get the thin-space thousands.
	const metres = (v) => v && `${/^\d+([.,]\d+)?$/.test(v) ? formatNumber(Number(v.replace(',', '.'))) : v} m`;
	const length = $derived(metres(field('duljina', 'horiz')));
	const depth = $derived(metres(field('dubina', 'dub')));
	// Number first and two unlike words ("duljina" and "dubina" read alike): "18 m kanala, 14 m u dubinu".
	const size = $derived([length && `${length} kanala`, depth && `${depth} u dubinu`].filter(Boolean).join(', '));
	const cadastre = $derived(field('kat_br', 'katas'));
	// The cave's page on cistopodzemlje.info, over https (the 2021 register links with http).
	const page = $derived(field('link', 'povez')?.replace(/^http:/, 'https:'));
	// Only the 2021 register has "povez": a cave missing from the 2024 one.
	const only2021 = $derived(p.povez != null);
</script>

<h5>Divlji deponij otpada u speleološkom objektu</h5>
<h2>{title}</h2>
{#if synonyms}<p class="muted">Također: {synonyms}</p>{/if}
{#if size || cadastre}<p>{size && size[0].toUpperCase() + size.slice(1)}{#if size && cadastre}<br />{/if}{#if cadastre}<span class="muted">Katastarski broj {cadastre}</span>{/if}</p>{/if}
{#if p.izvor}<p class="muted">{p.izvor}</p>{/if}
{#if only2021}<p class="muted">Samo u popisu iz 2021.</p>{/if}
{#if page}
	<p>
		<a href={page} target="_blank" rel="noreferrer">Više na cistopodzemlje.info
			<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><title>otvara se u novoj kartici</title><path d="M5 2H2v8h8V7M7 2h3v3M10 2L5.5 6.5" /></svg></a>
	</p>
{/if}

<style>
	h5 { margin: 0 0 2px; font-size: 12px; font-weight: normal; color: #666; }
	h2 { margin: 0 0 6px; font-size: 18px; }
	p { margin: 0 0 8px; }
	.muted { color: #666; }
	a { display: inline-flex; align-items: center; gap: 3px; }
	svg { width: 11px; height: 11px; }
</style>
