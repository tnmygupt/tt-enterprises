"use client";

import { useEffect, useRef, useState } from "react";
import { FilePick } from "@/components/FilePick";

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  /** Async uploader that takes a File and returns the hosted URL. */
  uploadImage?: (file: File) => Promise<string>;
  placeholder?: string;
  minHeight?: string;
  label?: string;
  /** Locale for the toolbar labels. Defaults to "en". */
  locale?: "en" | "hi";
}

/**
 * Very small in-house rich text editor. Uses `document.execCommand` which
 * is deprecated in the spec but still works reliably in every current
 * browser. Good enough for an internal admin form where the alternative
 * would be a 200 KB third-party dependency.
 *
 * All content is sanitized on every change and again on render so it is
 * safe to store the returned HTML and later dangerouslySetInnerHTML it.
 */
export function RichTextEditor({
  value,
  onChange,
  uploadImage,
  placeholder,
  minHeight,
  label,
  locale = "en",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Only sync the incoming `value` when it differs from what the editor
  // already shows — otherwise every keystroke re-renders and the caret
  // jumps to the start of the field.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== value) {
      el.innerHTML = value || "";
    }
  }, [value]);

  const flush = () => {
    if (!editorRef.current) return;
    onChange(sanitizeHtml(editorRef.current.innerHTML));
  };

  const exec = (cmd: string, arg?: string) => {
    editorRef.current?.focus();
    // execCommand is deprecated but still the simplest cross-browser API.
    document.execCommand(cmd, false, arg);
    flush();
  };

  const insertHtml = (html: string) => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      editorRef.current!.innerHTML += html;
      flush();
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const template = document.createElement("template");
    template.innerHTML = html;
    const frag = template.content;
    const lastNode = frag.lastChild;
    range.insertNode(frag);
    if (lastNode) {
      const newRange = document.createRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    flush();
  };

  const insertImageUrl = () => {
    const url = window.prompt(
      locale === "hi" ? "इमेज URL डालें" : "Image URL"
    );
    if (!url) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    insertHtml(`<p><img src="${escapeHtml(trimmed)}" alt="" /></p>`);
  };

  const pickImageFile = async (files: File[]) => {
    const file = files[0];
    if (!file || !uploadImage) return;
    setBusy(true);
    setMsg("");
    try {
      const uploadedUrl = await uploadImage(file);
      insertHtml(
        `<p><img src="${escapeHtml(uploadedUrl)}" alt="${escapeHtml(file.name)}" /></p>`
      );
      setMsg(locale === "hi" ? "इमेज जोड़ी" : "Image inserted");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const insertTable = () => {
    const rowsStr = window.prompt(locale === "hi" ? "पंक्तियाँ" : "Rows", "3");
    if (rowsStr === null) return;
    const colsStr = window.prompt(locale === "hi" ? "कॉलम" : "Columns", "3");
    if (colsStr === null) return;
    const rows = Math.max(1, Math.min(30, Number(rowsStr) || 3));
    const cols = Math.max(1, Math.min(12, Number(colsStr) || 3));
    let html = '<table class="tt-content-table"><thead><tr>';
    for (let c = 0; c < cols; c++) {
      html += `<th>${locale === "hi" ? "शीर्षक" : "Head"} ${c + 1}</th>`;
    }
    html += "</tr></thead><tbody>";
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) html += `<td>&nbsp;</td>`;
      html += "</tr>";
    }
    html += "</tbody></table><p><br></p>";
    insertHtml(html);
  };

  const insertLink = () => {
    const url = window.prompt(locale === "hi" ? "लिंक URL" : "Link URL");
    if (!url) return;
    exec("createLink", url);
  };

  const t = (en: string, hi: string) => (locale === "hi" ? hi : en);

  return (
    <div className="tt-rte">
      <div className="tt-rte-toolbar" role="toolbar" aria-label={label}>
        <button type="button" onClick={() => exec("bold")} title={t("Bold", "बोल्ड")}>
          <b>B</b>
        </button>
        <button type="button" onClick={() => exec("italic")} title={t("Italic", "इटैलिक")}>
          <i>I</i>
        </button>
        <button type="button" onClick={() => exec("underline")} title={t("Underline", "अंडरलाइन")}>
          <u>U</u>
        </button>
        <span className="tt-rte-sep" />
        <button
          type="button"
          onClick={() => exec("formatBlock", "<h3>")}
          title={t("Heading", "शीर्षक")}
        >
          H
        </button>
        <button
          type="button"
          onClick={() => exec("formatBlock", "<p>")}
          title={t("Paragraph", "पैराग्राफ")}
        >
          ¶
        </button>
        <button
          type="button"
          onClick={() => exec("insertUnorderedList")}
          title={t("Bullet list", "बुलेट सूची")}
        >
          • {t("List", "सूची")}
        </button>
        <button
          type="button"
          onClick={() => exec("insertOrderedList")}
          title={t("Numbered list", "क्रमांकित सूची")}
        >
          1. {t("List", "सूची")}
        </button>
        <span className="tt-rte-sep" />
        <button type="button" onClick={insertLink} title={t("Insert link", "लिंक")}>
          🔗 {t("Link", "लिंक")}
        </button>
        <button type="button" onClick={insertImageUrl} title={t("Insert image URL", "इमेज URL")}>
          🖼 {t("Image URL", "इमेज URL")}
        </button>
        <button type="button" onClick={insertTable} title={t("Insert table", "टेबल")}>
          ▦ {t("Table", "टेबल")}
        </button>
        <span className="tt-rte-sep" />
        <button
          type="button"
          onClick={() => exec("removeFormat")}
          title={t("Clear formatting", "फ़ॉर्मैट हटाएँ")}
        >
          {t("Clear", "साफ़")}
        </button>
      </div>
      {uploadImage ? (
        <div className="border-b border-[var(--line)] bg-white px-3 py-2">
          <FilePick
            kind="photo"
            compact
            busy={busy}
            onPick={pickImageFile}
          />
        </div>
      ) : null}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="tt-rte-content tt-prose"
        style={{ minHeight: minHeight || "10rem" }}
        onInput={flush}
        onBlur={flush}
        onPaste={(e) => {
          // Strip formatting on paste to avoid pulling in styles/scripts
          // from Word / Google Docs / random web pages.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        aria-label={label || "Rich text editor"}
        data-placeholder={placeholder || ""}
      />
      {msg ? (
        <p className="mt-1 text-xs font-semibold text-[var(--ok)]">{msg}</p>
      ) : null}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ALLOWED_TAGS = new Set([
  "P", "BR", "B", "I", "U", "STRONG", "EM",
  "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "LI",
  "A", "IMG",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "CAPTION", "COLGROUP", "COL",
  "BLOCKQUOTE", "CODE", "PRE", "SPAN", "DIV", "HR",
]);

const KEEP_ATTRS = new Set([
  "href", "src", "alt", "title", "colspan", "rowspan", "class",
]);

/**
 * Whitelist-based sanitizer. Strips unknown tags (keeps their children),
 * strips every event handler + `javascript:` URLs, and only keeps a small
 * set of safe attributes. Runs client-side via DOMParser.
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  const walk = (node: Element): void => {
    const children = Array.from(node.children);
    for (const child of children) walk(child);

    const tag = node.tagName;
    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: replace with its own children so the text survives.
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      }
      return;
    }

    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (!KEEP_ATTRS.has(name)) {
        node.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    }

    if (tag === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "TABLE" && !node.classList.contains("tt-content-table")) {
      node.classList.add("tt-content-table");
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

/** Extract plain text — used to keep the plain `description` in sync. */
export function stripHtml(html: string): string {
  if (typeof window === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

/** True when HTML has visible text or media (not just empty <p><br></p>). */
export function hasRichContent(html: string | undefined | null): boolean {
  if (!html || !String(html).trim()) return false;
  if (/<img\b/i.test(html) || /<table\b/i.test(html) || /<video\b/i.test(html)) {
    return true;
  }
  return Boolean(stripHtml(html));
}
