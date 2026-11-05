export const escapeHtml = (v) =>
	String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** HTML table of non-empty feature properties. */
export const propsTable = (props) =>
	`<table>${Object.entries(props)
		.filter(([, v]) => v !== null && v !== '')
		.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
		.join('')}</table>`;

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
