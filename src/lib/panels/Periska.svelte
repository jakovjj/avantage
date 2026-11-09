<script>
	import { formatDate, formatNumber, plural } from '../utils.js';

	let { properties: p, layer } = $props();

	// Each year's layer names its fields differently ("lok", "lokal", "lokalitet"…): the first one present wins.
	// Reports fill gaps with placeholders, which aren't worth showing.
	const PLACEHOLDER = /^(nepoznato( stanje)?|nije navedeno|ne|nije provjereno( stanje)?)$/i;
	const field = (...keys) => keys.map((k) => String(p[k] ?? '').trim()).find((v) => v && !PLACEHOLDER.test(v)) ?? null;
	const upper = (text) => text && text[0].toLocaleUpperCase('hr') + text.slice(1);

	// What the record is, by its layer (`legend`): the archive, experts' reports, or a year of citizens' reports.
	const KIND = { arhiv: 'arhivski podatak', stručnjaci: 'dojava stručnjaka' };
	// Counts are numbers, ranges ("2-3") or words ("Veći broj"): the noun follows the last number in them.
	const individuals = (count) => {
		const last = Number(count.match(/\d+(?=\D*$)/)?.[0] ?? NaN);
		return `${count.replace('-', '–')} ${plural(last, 'jedinka', 'jedinke', 'jedinki')}`;
	};
	const uncertainty = $derived(Number(field('nesig_koor', 'nesigurno', 'nesigu', 'nes')));
	const count = $derived(field('br_jedinki', 'br_jedi', 'br_jed'));
	const dead = $derived(field('br_ugi', 'br_ugin', 'br_uginul'));
	const depth = $derived(field('dubina_m', 'dubina'));
	const details = $derived(
		[count && upper(individuals(count)), depth && `na ${depth.replace('-', '–')} m dubine`].filter(Boolean).join(' ') +
			(dead ? `, od toga ${dead} ${plural(Number(dead), 'uginula', 'uginule', 'uginulih')}` : '')
	);
	const when = $derived(p.god_op ?? formatDate(field('dat_opaza', 'dat_op')));
	const who = $derived(upper(field('opazac', 'prom', 'promat')) ?? field('ime_ust'));
	const checked = $derived(field('prov_stanj', 'provjera', 'provjer'));
</script>

<h5>Periska - {KIND[layer?.legend] ?? 'dojava građana'}</h5>
<h2>Plemenita periska <i>Pinna nobilis</i></h2>
<p class="place">{field('lokalitet', 'lok', 'lokal', 'naziv_lok') ?? 'Nepoznat lokalitet'}</p>
<p class="muted">{[when, who].filter(Boolean).join(', ')}</p>
{#if field('dojav_stan', 'stanje')}<p class="finding">{upper(field('dojav_stan', 'stanje'))}</p>{/if}
{#if details}<p>{details}</p>{/if}
{#if checked}<p>{checked === 'da' ? 'Provjereno' : `Provjera: ${checked[0].toLocaleLowerCase('hr')}${checked.slice(1)}`}</p>{/if}
{#if p.napomena}<p>{upper(p.napomena)}</p>{/if}
{#if p.referenca}<p class="muted">{p.referenca}</p>{/if}
{#if uncertainty >= 1}<p class="small">Točnost lokacije ±{formatNumber(uncertainty, 0)} m</p>{/if}

<style>
	h5 { margin: 0 0 2px; font-size: 12px; font-weight: normal; color: #666; }
	h2 { margin: 0 0 10px; font-size: 18px; }
	h2 i { font-size: 13px; font-weight: normal; color: #666; }
	p { margin: 0 0 6px; }
	.place { margin: 0; font-size: 15px; }
	.muted { margin-bottom: 12px; color: #666; }
	.finding { font-size: 15px; font-weight: 600; }
	.small { margin-top: 12px; font-size: 12px; color: #666; }
</style>
