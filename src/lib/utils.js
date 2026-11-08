/** "VRSAR - ORSERA" → "Vrsar - Orsera" (for names a server writes in capitals). */
export const titleCase = (s) =>
	s.toLocaleLowerCase('hr').replace(/(^|[\s-])(\p{L})/gu, (_, before, letter) => before + letter.toLocaleUpperCase('hr'));

/**
 * 9700000 → "9 700 000", 0.3 → "0,3": a thin space between thousands, never a dot or comma, which read as decimals.
 */
export const formatNumber = (value, maximumFractionDigits = 2) =>
	Number(value).toLocaleString('hr', { maximumFractionDigits }).replaceAll('.', '\u202f');

export const escapeHtml = (v) =>
	String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** HTML table of all non-empty feature properties: the layer's labelled fields first, then the rest by key. */
export const propsTable = (props, details) => {
	if (!props || typeof props !== 'object') return '<table></table>';
	const filled = (key) => Object.hasOwn(props, key) && props[key] !== null && props[key] !== '';
	const labelled = (details?.fields ?? []).map(({ keys, label }) => [label, keys.find(filled)]).filter(([, key]) => key);
	const shown = new Set(labelled.map(([, key]) => key));
	const rows = [
		...labelled.map(([label, key]) => [label, props[key]]),
		...Object.keys(props).filter((key) => filled(key) && !shown.has(key)).map((key) => [key.replaceAll('_', ' '), props[key]])
	];
	return `<table>${rows
		.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
		.join('')}</table>`;
};

/** Whether bbox a ([w, s, e, n]) fully contains bbox b. */
export const bboxContains = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];

/** Douglas–Peucker: drops points closer than `tolerance` to the simplified line; first and last points stay, so rings stay closed. */
export function simplify(points, tolerance) {
	const [a, b] = [points[0], points.at(-1)];
	const [dx, dy] = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(dx, dy);
	let farthest = 0, index = 0;
	for (let i = 1; i < points.length - 1; i++) {
		const [x, y] = [points[i][0] - a[0], points[i][1] - a[1]];
		const distance = length ? Math.abs(dx * y - dy * x) / length : Math.hypot(x, y); // a closed ring starts where it ends
		if (distance > farthest) (farthest = distance), (index = i);
	}
	if (farthest <= tolerance) return [a, b];
	return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

let downloads = 0, onDownloads = () => {};
/** `fn(count)` hears how many tracked downloads are running, e.g. for a loading bar. */
export const watchDownloads = (fn) => (onDownloads = fn);

/** Resolves like `promise`, counted as a running download until it settles. */
export async function track(promise) {
	onDownloads(++downloads);
	try {
		return await promise;
	} finally {
		onDownloads(--downloads);
	}
}

/** Response body as text, or null once it grows past maxBytes (the download is then cancelled). */
export function fetchText(url, { maxBytes = Infinity, signal } = {}) {
	return track(fetch(url, { signal }).then(async (response) => {
		const reader = response.body.getReader();
		const chunks = [];
		let size = 0;
		for (let chunk; !(chunk = await reader.read()).done; ) {
			if ((size += chunk.value.length) > maxBytes) {
				reader.cancel();
				return null;
			}
			chunks.push(chunk.value);
		}
		return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
	}));
}
