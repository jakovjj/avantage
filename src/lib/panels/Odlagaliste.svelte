<script module>
	const COUNTIES = {
		'Bjelovarsko-bilogorska županija': 'Bjelovarsko-bilogorskoj županiji',
		'Brodsko-posavska županija': 'Brodsko-posavskoj županiji',
		'Dubrovačko-neretvanska županija': 'Dubrovačko-neretvanskoj županiji',
		'Grad Zagreb': 'Gradu Zagrebu',
		'Istarska županija': 'Istarskoj županiji',
		'Karlovačka županija': 'Karlovačkoj županiji',
		'Koprivničko-križevačka županija': 'Koprivničko-križevačkoj županiji',
		'Krapinsko-zagorska županija': 'Krapinsko-zagorskoj županiji',
		'Ličko-senjska županija': 'Ličko-senjskoj županiji',
		'Međimurska županija': 'Međimurskoj županiji',
		'Osječko-baranjska županija': 'Osječko-baranjskoj županiji',
		'Požeško-slavonska županija': 'Požeško-slavonskoj županiji',
		'Primorsko-goranska županija': 'Primorsko-goranskoj županiji',
		'Sisačko-moslavačka županija': 'Sisačko-moslavačkoj županiji',
		'Splitsko-dalmatinska županija': 'Splitsko-dalmatinskoj županiji',
		'Varaždinska županija': 'Varaždinskoj županiji',
		'Virovitičko-podravska županija': 'Virovitičko-podravskoj županiji',
		'Vukovarsko-srijemska županija': 'Vukovarsko-srijemskoj županiji',
		'Zadarska županija': 'Zadarskoj županiji',
		'Zagrebačka županija': 'Zagrebačkoj županiji',
		'Šibensko-kninska županija': 'Šibensko-kninskoj županiji'
	};

	export const landfillShareText = (p) =>
		`Pogledaj ovo odlagalište otpada ${p.naziv_odlagalista} u ${COUNTIES[p.zupanija_odlagalista] ?? 'Hrvatskoj'}!`;

	// Markers of the AZO WMS style, by status_operativnosti: a red triangle for active landfills, circles for closed ones.
	// Drawn at 2× (the map shows them at half size) so their edges stay sharp.
	export const MARKERS = {
		aktivno: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M14 2L27 26H1Z" fill="#f00" fill-opacity=".7" stroke="#000" stroke-width="2"/></svg>',
		zatvoreno: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#0f0" fill-opacity=".7" stroke="#000" stroke-width="2"/></svg>',
		'zatvoreno ex-situ': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#0ff" fill-opacity=".7" stroke="#000" stroke-width="2"/></svg>'
	};
</script>

<script>
	import { formatNumber, titleCase } from '../utils.js';

	let { properties: p } = $props();

	// The legend's wording for each status.
	const STATUS = { aktivno: 'Aktivno', zatvoreno: 'Zatvoreno', 'zatvoreno ex-situ': 'Zatvoreno (otpad uklonjen)' };
	const REMEDIATION = { završena: 'završena', priprema: 'u pripremi', 'u tijeku sanacija': 'u tijeku' };
	const tonnes = (value) => `${formatNumber(value, 0)} t`;

	// Nearest settlement, then the municipality unless it repeats a name already shown ("Koritna, Semeljci" /
	// "Vrgorac"; Zagreb's municipality is also its county).
	const place = $derived.by(() => {
		const town = titleCase(p.grad_opcina_odlagalista ?? '');
		const same = (name) => name?.toLocaleLowerCase('hr') === town.toLocaleLowerCase('hr');
		return [p.najblize_naselje, same(p.najblize_naselje) || same(p.zupanija_odlagalista) ? null : town].filter(Boolean).join(', ');
	});
	const facts = $derived(
		[
			['Sanacija', REMEDIATION[p.status_sanacije] ?? p.status_sanacije],
			['Dozvola za odlaganje', p.dozbola_za_odlaganje == null ? null : p.dozbola_za_odlaganje ? 'da' : 'ne'],
			['Godina podataka', p.godina]
		].filter(([, value]) => value != null)
	);
	// 80 managers have the text "NULL" as their address.
	const address = $derived(p.adresa_upravitelja === 'NULL' ? null : p.adresa_upravitelja);
	const manager = $derived([address, p.mjesto_upravitelja && titleCase(p.mjesto_upravitelja)].filter(Boolean).join(', '));
</script>

<h5>Odlagalište otpada</h5>
<h2>{p.naziv_odlagalista}</h2>
<p class="status">{@html MARKERS[p.status_operativnosti] ?? ''}{STATUS[p.status_operativnosti] ?? p.status_operativnosti}</p>
<p>{place}<br /><span class="muted">{p.zupanija_odlagalista}</span></p>
{#if p.kolicina_odlozenog_otpada != null}
	<p class="amount">
		<strong>{tonnes(p.kolicina_odlozenog_otpada)}</strong> odloženog otpada
		{#if p.kolicina_odlozenog_biorazgr_tone}<br /><span class="muted">od toga biorazgradivog {tonnes(p.kolicina_odlozenog_biorazgr_tone)}</span>{/if}
	</p>
{/if}
<dl>
	{#each facts as [label, value]}<dt>{label}</dt><dd>{value}</dd>{/each}
	{#if p.upravitelj}<dt>Upravitelj</dt><dd>{p.upravitelj}{#if manager}<br /><span class="muted">{manager}</span>{/if}</dd>{/if}
</dl>

<style>
	h5 { margin: 0 0 2px; font-size: 12px; font-weight: normal; color: #666; }
	h2 { margin: 0 0 6px; font-size: 18px; }
	p { margin: 0 0 10px; }
	.status { display: flex; align-items: center; gap: 6px; font-weight: 600; }
	.status :global(svg) { flex: none; width: 14px; height: 14px; }
	.muted, dt { color: #666; }
	.amount strong { font-size: 20px; }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; margin: 0; }
	dd { margin: 0; }
</style>
