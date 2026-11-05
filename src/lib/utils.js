export const escapeHtml = (v) =>
	String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** HTML table of non-empty feature properties. */
export const propsTable = (props) =>
	`<table>${Object.entries(props)
		.filter(([, v]) => v !== null && v !== '')
		.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
		.join('')}</table>`;
