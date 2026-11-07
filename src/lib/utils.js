export const escapeHtml = (v) =>
	String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TECHNICAL_FIELD = /^(?:ogc_fid|gml_id|fid|id_rel|x_(?:htrs|wgs)|y_(?:htrs|wgs)|the_geom|geom(?:etry)?|shape_(?:area|leng)|nesig\w*|.*_style)$/i;

/** HTML table of selected feature properties, using layer labels when provided. */
export const propsTable = (props, details) => {
	if (!props || typeof props !== 'object') return '<table></table>';
	const rows = details?.fields
		? details.fields.map(({ keys, label }) => {
			const key = keys.find((candidate) => Object.hasOwn(props, candidate) && props[candidate] !== null && props[candidate] !== '');
			return key ? [label, props[key]] : null;
		}).filter(Boolean)
		: Object.entries(props)
			.filter(([key, value]) => value !== null && value !== '' && !TECHNICAL_FIELD.test(key))
			.map(([key, value]) => [key.replaceAll('_', ' '), value]);
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
