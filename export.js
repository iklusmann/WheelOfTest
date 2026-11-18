// Export a spin's tasks and testers for Confluence. Pure: no DOM, network or storage.
//
// Two formats, because Confluence takes tables in two different ways:
//   * a rich HTML table on the clipboard: pasted into a page, it becomes a native Confluence
//     table, in Cloud and in Data Center/Server alike (and in Word, Excel, Google Sheets);
//   * Confluence wiki markup: Data Center/Server turn it into a table through Insert → Markup →
//     Confluence wiki. The current Cloud editor has no markup insert, so Cloud uses the table.

import { DEVICES, BROWSERS, MAC_BROWSER, USER_LEVELS, THEMES } from "./tasks.js";
import { normalizeAssignment, taskBrowsers } from "./domain.js";

export const EXPORT_COLUMNS = Object.freeze(["Task", "Theme", "Team", "Devices", "Browsers", "User levels", "Testers"]);

const labelIn = (options, value) => options.find((o) => o.value === value)?.label ?? value;
const labelsIn = (options, values) => values.map((v) => labelIn(options, v)).join(", ");

/** "Ada (AF), Bob (PB)", or "Unassigned – <reason>". */
function testersText(a) {
  if (a.owners.length === 0) return a.reason ? `Unassigned – ${a.reason}` : "Unassigned";
  return a.owners.map((o) => (o.team ? `${o.name} (${o.team})` : o.name)).join(", ");
}

/**
 * One row of plain strings per task, in the order of the spin, matching EXPORT_COLUMNS.
 * Assignments may be in any stored shape (they are normalized here).
 */
export function exportRows(assignments) {
  return (Array.isArray(assignments) ? assignments : []).map((raw) => {
    const a = normalizeAssignment(raw);
    const t = a.task;
    return [
      t.what,
      labelIn(THEMES, t.theme),
      t.team ?? "All teams",
      labelsIn(DEVICES, t.devices),
      labelsIn([...BROWSERS, MAC_BROWSER], taskBrowsers(t)),
      labelsIn(USER_LEVELS, t.users),
      testersText(a)
    ];
  });
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** A plain <table> with a header row: what Confluence (and office apps) turn into a native table on paste. */
export function toHtmlTable(rows) {
  const head = `<tr>${EXPORT_COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/**
 * Escape text for a wiki markup table cell: characters that start markup get a backslash, so a
 * task called "Smoke-test *new*" stays text. An empty cell needs a space, or the row breaks.
 */
export function escapeWiki(text) {
  const s = String(text).replace(/[|{}[\]*_+^~?!-]/g, (c) => `\\${c}`).trim();
  return s === "" ? " " : s;
}

/** Confluence wiki markup: ||header|| row, then |cell| rows. */
export function toWikiMarkup(rows) {
  const head = `||${EXPORT_COLUMNS.map(escapeWiki).join("||")}||`;
  return [head, ...rows.map((r) => `|${r.map(escapeWiki).join("|")}|`)].join("\n");
}

/** The markup file: a heading and the line of context, then the table (all of it goes into Insert → Markup). */
export function toWikiDocument(rows, { title, meta = "" }) {
  const line = (text) => String(text).replace(/[{}[\]*_+^~?!|-]/g, (c) => `\\${c}`);
  return `h2. ${line(title)}\n\n${meta ? `${line(meta)}\n\n` : ""}${toWikiMarkup(rows)}\n`;
}

/** Tab-separated text: the plain-text side of the clipboard (spreadsheets read it as a table). */
export function toTsv(rows) {
  const clean = (c) => String(c).replace(/[\t\r\n]+/g, " ");
  return [EXPORT_COLUMNS, ...rows].map((r) => r.map(clean).join("\t")).join("\n");
}

/** A standalone HTML page with a title, a line of context and the table (the downloadable file). */
export function toHtmlDocument(rows, { title, meta = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #172B4D; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: #5E6C84; margin: 0 0 16px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #C1C7D0; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #F4F5F7; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${meta ? `<p>${escapeHtml(meta)}</p>\n` : ""}${toHtmlTable(rows)}
</body>
</html>
`;
}

/** "wheeloftest-ABC234-final.html": room code and which spin, safe as a file name. */
export function exportFileName(code, spinLabel, extension) {
  const safe = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `wheeloftest-${String(code ?? "").replace(/[^A-Za-z0-9]/g, "")}-${safe(spinLabel) || "result"}.${extension}`;
}
