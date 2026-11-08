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

/** Response body as text, or null once it grows past maxBytes (the download is then cancelled). */
export async function fetchText(url, { maxBytes = Infinity, signal } = {}) {
	const reader = (await fetch(url, { signal })).body.getReader();
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
}
