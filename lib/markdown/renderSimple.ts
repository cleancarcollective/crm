/**
 * Minimal markdown renderer for sales-playbook content (script, objection
 * cards, service descriptions). Intentionally small: we own the input, the
 * audience is internal, and adding a full markdown library + sanitiser to
 * the dependency tree for this is not worth it.
 *
 * Supports:
 *   - # / ## / ### headings
 *   - **bold** and *italic* / _italic_
 *   - `inline code`
 *   - > blockquotes (single-line, joined when consecutive)
 *   - - / * bullet lists
 *   - 1. ordered lists
 *   - [text](url) links - http(s) and internal paths only
 *   - blank lines = paragraph breaks
 *
 * Output is HTML-escaped before transformation, so user input can never
 * inject raw HTML. Use with dangerouslySetInnerHTML safely.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineFormat(s: string): string {
  // Inline code first so its contents are not further transformed.
  let out = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // Bold then italic. Order matters so ** doesn't get eaten by *.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^\w])\*([^*\n]+)\*(?=[^\w]|$)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  // Links - only http(s) and internal (starts with /) URLs allowed.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    const safe = /^(https?:\/\/|\/)/.test(url) ? url : "#";
    const external = safe.startsWith("http");
    const rel = external ? ' rel="noopener noreferrer" target="_blank"' : "";
    return `<a href="${safe}"${rel}>${text}</a>`;
  });
  return out;
}

export function renderSimpleMarkdown(md: string): string {
  if (!md) return "";
  const escaped = escapeHtml(md);
  const lines = escaped.split(/\r?\n/);

  const out: string[] = [];
  let paragraph: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let blockquote: string[] = [];

  function flushParagraph() {
    if (paragraph.length) {
      out.push(`<p>${inlineFormat(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  }
  function flushList() {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  }
  function flushBlockquote() {
    if (blockquote.length) {
      out.push(`<blockquote>${inlineFormat(blockquote.join(" "))}</blockquote>`);
      blockquote = [];
    }
  }
  function flushAll() {
    flushParagraph();
    flushList();
    flushBlockquote();
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith("&gt; ")) {
      flushParagraph();
      flushList();
      blockquote.push(line.slice(5));
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      flushBlockquote();
      if (listKind !== "ul") {
        flushList();
        out.push("<ul>");
        listKind = "ul";
      }
      out.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      flushBlockquote();
      if (listKind !== "ol") {
        flushList();
        out.push("<ol>");
        listKind = "ol";
      }
      out.push(`<li>${inlineFormat(olMatch[1])}</li>`);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(line);
  }

  flushAll();
  return out.join("\n");
}
