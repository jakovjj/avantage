<script module>
	// The AZO WMS style's colours for this layer, by status_lokacije_otpada.
	export const STATUS_COLORS = {
		'Otpad na lokaciji': '#eb321a',
		'Prijavljen otpad na lokaciji od strane javnosti': '#e29f98',
		'Uklonjen otpad': '#088888'
	};
</script>

<script>
	import Viewer from 'viewerjs';
	import 'viewerjs/dist/viewer.css';

	let { properties: p } = $props();

	// The server writes municipalities in capitals: "VRSAR - ORSERA" → "Vrsar - Orsera".
	const titleCase = (s) =>
		s.toLocaleLowerCase('hr').replace(/(^|[\s-])(\p{L})/gu, (_, before, letter) => before + letter.toLocaleUpperCase('hr'));
	// "15000.00 kg, 0.00 m3" → "15.000 kg"; most records hold only zeros, which mean "unknown".
	const amount = (value) =>
		(value ?? '').split(', ').filter((part) => parseFloat(part) > 0).map((part) => {
			const [number, unit] = part.split(' ');
			return `${Number(number).toLocaleString('hr')} ${unit.replace('m2', 'm²').replace('m3', 'm³')}`;
		}).join(', ');

	const place = $derived.by(() => {
		const town = titleCase(p.grad_opcina ?? '');
		return [p.naselje, town.toLocaleLowerCase('hr') === p.naselje?.toLocaleLowerCase('hr') ? null : town].filter(Boolean).join(', ');
	});
	const facts = $derived(
		[['Vrsta otpada', p.vrsta_otpada], ['Količina', amount(p.ukupna_kolicina_otpada)], ['Površina', amount(p.procijenjena_povrsina_otpada)]]
			.filter(([, value]) => value)
	);
	const photos = $derived([p.slika_1, p.slika_2, p.slika_3, p.slika_4].filter(Boolean));

	// Clicking a photo opens it in Viewer.js. Inside, a click (not a drag) toggles between the fitted photo and 3× that,
	// towards the clicked point; most photos are only ~1080 px tall, so their own pixel size is barely a zoom. The wheel
	// zooms in proportion to how far it turns. Dragging only pans a photo bigger than the view.
	// All zooming goes through `zoom`, which works out size and position in one go (Viewer.js' own zoom leaves the photo
	// off-centre when zooming out, and correcting that afterwards makes it jump) and animates them with its transition.
	function lightbox(grid) {
		const several = photos.length > 1; // re-created whenever the feature (and so its photos) changes
		let down;
		const fitted = () => viewer.initialImageData.ratio;
		const fits = () => viewer.imageData.width <= viewer.viewerData.width && viewer.imageData.height <= viewer.viewerData.height;
		// Zooms keeping the point `at` (client px; default the view's centre) still. A photo smaller than the view sits
		// where the fitted one does (Viewer.js leaves room for its toolbar), a bigger one never leaves a gap at its edges.
		function zoom(ratio, at) {
			const d = viewer.imageData, start = viewer.initialImageData, view = viewer.canvas.getBoundingClientRect();
			ratio = Math.min(Math.max(ratio, fitted()), fitted() * 10);
			const scale = ratio / d.ratio;
			const place = (pos, size, viewSize, pointer, centre) =>
				size <= viewSize ? centre - size / 2 : Math.min(0, Math.max(viewSize - size, pointer - (pointer - pos) * scale));
			const width = d.naturalWidth * ratio, height = d.naturalHeight * ratio;
			const x = place(d.x, width, view.width, (at?.clientX ?? view.left + view.width / 2) - view.left, start.x + start.width / 2);
			const y = place(d.y, height, view.height, (at?.clientY ?? view.top + view.height / 2) - view.top, start.y + start.height / 2);
			Object.assign(d, { ratio, width, height, x, y, left: x, top: y });
			viewer.image.classList.add('viewer-transition'); // Viewer.js removes it again when a drag starts
			viewer.renderImage();
		}
		const viewer = new Viewer(grid, {
			title: false,
			navbar: several,
			// Viewer.js would fade in an empty viewer and only then show the photo, so the fade-in is a CSS animation below
			// and its transition is kept for the fade-out alone.
			transition: { view: false, show: false },
			shown: () => viewer.viewer.classList.add('viewer-transition'),
			// Otherwise Viewer.js first shrinks the photo to nothing before fading out.
			hide: () => viewer.image?.classList.remove('viewer-transition'),
			zoomOnWheel: false,
			slideOnWheel: false,
			toggleOnDblclick: false,
			minZoomRatio: () => fitted(), // for pinch zoom, still Viewer.js' own
			maxZoomRatio: () => fitted() * 10,
			toolbar: {
				zoomIn: { show: true, click: () => zoom(viewer.imageData.ratio * 1.5) },
				zoomOut: { show: true, click: () => zoom(viewer.imageData.ratio / 1.5) },
				reset: { show: true, click: () => zoom(fitted()) },
				prev: several,
				next: several
			},
			move: (e) => fits() && e.preventDefault(),
			ready() {
				viewer.canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
				viewer.canvas.addEventListener('click', (e) => {
					if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; // a drag
					// Viewer.js ignores a click on the backdrop if the mouse moved even 1 px while pressed.
					if (e.target === viewer.canvas) viewer.hide();
					else if (e.target === viewer.image) zoom(viewer.imageData.ratio > fitted() * 1.01 ? fitted() : fitted() * 3, e);
				});
				viewer.canvas.addEventListener('wheel', (e) => {
					e.preventDefault();
					const pixels = e.deltaY * (e.deltaMode === 1 ? 33 : 1); // Firefox may report lines
					zoom(viewer.imageData.ratio * Math.exp(-Math.max(-300, Math.min(300, pixels)) * 0.0025), e);
				}, { passive: false });
			}
		});
		return () => viewer.destroy();
	}
</script>

<h2>Odbačeni otpad</h2>
<p class="status"><span style:background={STATUS_COLORS[p.status_lokacije_otpada]}></span>{p.status_lokacije_otpada}</p>
<p>{place}</p>
{#if p.nazivi_lokacije}<p class="muted">{p.nazivi_lokacije}</p>{/if}
<p>{p.opis_lokacije}</p>
{#if facts.length}
	<dl>
		{#each facts as [label, value]}<dt>{label}</dt><dd>{value}</dd>{/each}
	</dl>
{/if}
{#if photos.length}
	<h3>Fotografije</h3>
	<div class="photos" {@attach lightbox}>
		<!-- Keyed: a new feature gets new <img> elements, so the grey background shows until its photos load. -->
		{#each photos as src (src)}
			<div title="Povećaj">
				<img {src} alt="" loading="lazy" />
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5" /><path d="M10.3 10.3L14 14M5 7h4M7 5v4" /></svg>
			</div>
		{/each}
	</div>
{/if}

<style>
	h2 { margin: 0 0 6px; font-size: 18px; }
	h3 { margin: 12px 0 6px; font-size: 14px; }
	p { margin: 0 0 8px; }
	.status { display: flex; align-items: center; gap: 6px; font-weight: 600; }
	.status span { flex: none; width: 10px; height: 10px; border: 1px solid #000; border-radius: 50%; }
	.muted, dt { color: #666; }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; margin: 0 0 8px; }
	dd { margin: 0; }
	.photos { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 120px; gap: 4px; }
	.photos div { position: relative; background: #eee; }
	.photos img { display: block; width: 100%; height: 100%; object-fit: cover; cursor: pointer; }
	/* Short enough that quick wheel turns still feel direct (Viewer.js uses 0.3s). */
	:global(.viewer-canvas > img.viewer-transition), :global(.viewer-container.viewer-transition) { transition-duration: 0.2s; }
	:global(.viewer-container.viewer-in) { animation: viewer-fade-in 0.2s; }
	@keyframes -global-viewer-fade-in { from { opacity: 0; } }
	/* Clicks fall through the icon to the photo, which Viewer.js listens on. */
	.photos svg { position: absolute; right: 4px; bottom: 4px; width: 16px; height: 16px; padding: 2px; color: #fff; background: #0009; pointer-events: none; }
</style>
