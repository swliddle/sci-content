// Small wrappers that absorb `as any` boundary casts around
// node-html-parser. The library's public `HTMLElement`/`Node` types don't
// expose `.rawText`/`.text` uniformly across node kinds, so callsites had
// to cast each access. Centralize here.

// node-html-parser types are imported from its public entry; we deliberately
// accept `unknown` so callers don't need to import HTMLElement just to get
// text out.

interface TextualNode {
    text?: string;
    rawText?: string;
}

// Prefer `.text` (entities decoded) over `.rawText` (entities preserved)
// — matches PHP DOMDocument's decode-on-load behavior that the JoD
// pipeline was originally ported from.
export function nodeText(node: unknown): string {
    const n = node as TextualNode;
    return n.text ?? n.rawText ?? "";
}

// Inverse of nodeText: prefer `.rawText` so downstream re-serialization
// emits numeric entity refs (matches PHP saveXML) rather than re-decoding
// `&mdash;`/`&ldquo;` back to raw Unicode.
export function nodeRawText(node: unknown): string {
    const n = node as TextualNode;
    return n.rawText ?? n.text ?? "";
}
