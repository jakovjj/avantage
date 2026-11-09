<script>
	import { formatDate, formatNumber, plural } from '../utils.js';

	let { properties: p } = $props();

	// Each year's layer names its fields differently ("val_im", "val_ime", "validno_im"…): the first one present wins.
	// Reports fill gaps with placeholders, which aren't worth showing.
	const PLACEHOLDER = /^(nije navedeno|0)$/i;
	const field = (...keys) => keys.map((k) => String(p[k] ?? '').trim()).find((v) => v && !PLACEHOLDER.test(v)) ?? null;
	const upper = (text) => text && text[0].toLocaleUpperCase('hr') + text.slice(1);

	// Croatian names as ZZOP's yearly call for reports gives them.
	const NAMES = { 'Lucanus cervus': 'Jelenak', 'Rosalia alpina': 'Alpinska strizibuba', 'Morimus funereus': 'Velika četveropjega strizibuba' };
	const species = $derived(field('validno_im', 'val_im', 'val_ime'));
	const uncertainty = $derived(Number(field('nesig', 'nesigur', 'nesigurnos', 'nesigu')));
	const count = $derived(Number(field('br_jed', 'br_jedi')) || 0);
	// "Mužjak", "Par"…; a count above one follows it, unless the sex is only "jedinka"/"jedinke".
	const finding = $derived.by(() => {
		const sex = field('spol');
		const many = count > 1 && `${count} ${plural(count, 'jedinka', 'jedinke', 'jedinki')}`;
		return /^jedink[ae]$/i.test(sex ?? '') ? many || 'Jedinka' : [upper(sex), many].filter(Boolean).join(', ');
	});
	const when = $derived([formatDate(field('dat_nal')), field('vrije_pron', 'vrij_pr', 'vri_pro', 'vri_pron')].filter(Boolean).join(', '));
	const who = $derived(field('im_pre_op') ?? [field('ime_op', 'im_op'), field('prez_op')].filter(Boolean).join(' '));
	const reported = $derived(
		[field('dat_doj', 'dat_obj', 'dat_op') && `Dojavljeno ${formatDate(field('dat_doj', 'dat_obj', 'dat_op'))}`,
			{ da: 's fotografijom', ne: 'bez fotografije' }[field('foto')]].filter(Boolean).join(', ')
	);
</script>

<h5>Saproksilni kornjaš - dojava građana</h5>
<h2>{NAMES[species] ?? species ?? 'Nepoznata vrsta'}{#if NAMES[species]}{' '}<i>{species}</i>{/if}</h2>
<p class="place">{field('lok', 'lokal') ?? 'Nepoznat lokalitet'}</p>
{#if field('opis_lok')}<p class="place">{upper(field('opis_lok'))}</p>{/if}
<p class="muted">{[when, who].filter(Boolean).join(', ')}</p>
{#if finding}<p class="finding">{finding}</p>{/if}
{#if reported}<p>{upper(reported)}</p>{/if}
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
