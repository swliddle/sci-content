import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import { EN_CONFIG, EnsignConfig } from "./ensign-config.js";

const MOBILE_PREFIX = "https://mobile-cdn.lds.org/";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

// xpath.useNamespaces returns a function whose SelectReturnType spans nodes,
// strings, numbers, and booleans. Every query in this module is an element
// path, so narrow through one helper instead of repeating the guard at each
// callsite.
const selectNsRaw = xpath.useNamespaces({ h: XHTML_NS });

function selectElements(expr: string, ctx: Node): Element[] {
    const result = selectNsRaw(expr, ctx);
    if (!Array.isArray(result)) return [];
    return result.filter(xpath.isElement);
}

export interface DomProcessOptions {
    talkId: number;
    body: string;
    isNewFormat: boolean;
    cfg?: EnsignConfig;
}

export function processTalkDom(opts: DomProcessOptions): string | null {
    const { talkId, body, isNewFormat } = opts;
    const cfg = opts.cfg ?? EN_CONFIG;
    const normalized = normalizeForLibxmlParse(body);
    const doc = new DOMParser({
        errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} }
    }).parseFromString(normalized, "text/html");

    const talkContent = isNewFormat
        ? selectElements("//h:div[@class='body']", doc)[0]
        : selectElements("//h:div[@id='content']", doc)[0];

    if (!talkContent) {
        console.log(`Unable to locate talk content for talk ${talkId}`);
        return null;
    }

    if (isNewFormat) {
        removeAll(doc, "//h:iframe");
        removeAll(doc, "//h:video");
        removeFigureLazy(doc);
        removeAll(doc, "//h:div[contains(@class, 'lazy-xyQQ2')]");
    } else {
        removeAll(doc, "//h:ul[@class='prev-next large']");
        removeAll(doc, "//h:span[@id='article-id']");
        removeAll(doc, "//h:audio");
        removeAll(doc, "//h:div[@id='details']//h:ul[@class='filed-under']");
        removeAll(doc, "//h:div[@class='audio-player']");
        removeAll(doc, "//h:div[@id='secondary']");
        removeAll(doc, "//h:div[@id='references']/h:h4");
        removeAll(doc, "//h:div[@id='beta-feedback']");
        removeAll(doc, "//h:section[@class='sash-icons']");

        restructureAuthorSection(doc, talkId);
    }

    disableAnchors(doc, isNewFormat, cfg);
    inlineFootnotes(doc, talkId, isNewFormat, cfg);

    if (!isNewFormat) {
        fixImageUrls(doc, talkId, cfg);
    }

    let out = serializeXml(talkContent);
    out = out.replace(/<a[^>]*class="nolink"[^>]*>([^<]*)<\/a>/g, "$1");
    out = out.replace(/<a[^>]*class="nolink"[^>]*><div(.*)<\/div><\/a>/gs, "<div$1</div>");
    return out;
}

function normalizeForLibxmlParse(body: string): string {
    let out = body;

    // libxml2's loadHTML tolerates junk content before <!DOCTYPE> (it simply
    // ignores or folds it into <body>). xmldom returns an empty document when
    // given a leading stray tag, so trim anything before the first doctype/html.
    const doctypeIdx = out.search(/<!DOCTYPE|<!doctype|<html\b/);
    if (doctypeIdx > 0) {
        out = out.slice(doctypeIdx);
    }

    // Some hand-edited files contain malformed attrs like `<li data-marker"1." id="note1">`.
    // PHP's libxml2 parses these as `data-marker=""` and drops `"1."`; xmldom reads
    // `data-marker"1."` as `data-marker="1."`. Rewrite to match libxml2.
    out = out.replace(/ data-marker"[^"]*"/g, ' data-marker=""');

    // New-format ES note anchors appear with unquoted attributes:
    //   <a class=note-ref href=/#note1>
    //   <a class=note-ref href=#note1>
    // libxml2 parses these; xmldom escapes the tag as text. Rewrite to quoted form
    // so downstream disableAnchors/inlineFootnotes operate on real elements.
    out = out.replace(
        /<a class=note-ref href=\/?#note(\d+)>/g,
        '<a class="note-ref" href="#note$1">'
    );

    // Hand-edited author blocks nest <p> inside <h2>: libxml2 auto-closes the
    // heading on the first <p>, producing <h2></h2><p>...</p>. xmldom keeps the
    // <p> nested, so lift it out to match libxml2.
    out = out.replace(
        /(<h2\b[^>]*>)(\s*)(<p\b[^>]*>[\s\S]*?<\/p>)(\s*)<\/h2>/g,
        "$1$2</h2>$3$4"
    );

    // Balance unclosed <sup> inside <p>...</p>. libxml2 auto-closes at </p>;
    // xmldom treats the sup as empty and makes siblings of the trailing content,
    // which breaks inlineFootnotes' parent-is-sup check.
    out = out.replace(/<p\b[^>]*>[\s\S]*?<\/p>/g, (para) => {
        const opens = (para.match(/<sup\b[^>]*>/g) || []).length;
        const closes = (para.match(/<\/sup>/g) || []).length;
        if (opens <= closes) return para;
        const deficit = opens - closes;
        return para.replace(/<\/p>$/, "</sup>".repeat(deficit) + "</p>");
    });

    // Unterminated closing tag: `</p\n\t\t<p uri="...">` lacks the first `>`.
    // libxml2 consumes everything until the next `>`, dropping the next opening
    // <p>; xmldom recovers by inserting `>` and keeping both paragraphs. Match
    // libxml2: collapse `</p\s+<p ...>` into just `</p>`.
    out = out.replace(/<\/p\s+<p\b[^>]*>/g, "</p>");

    // Some ES paragraphs lack a closing </p> (ending with a stray </a> or no
    // close at all). libxml2 auto-closes at the next <p> open; xmldom keeps the
    // paragraph open and swallows subsequent siblings. Explicitly insert </p>
    // before the next <p> open when the current paragraph has no </p>.
    // Greedy inner group so trailing whitespace stays inside the paragraph
    // (matches libxml2's behavior of absorbing whitespace into the open <p>).
    out = out.replace(
        /(<p\b[^>]*>(?:(?!<\/p\b)(?!<p\b)[\s\S])*)(<p\b[^>]*>)/g,
        (_m, open, next) => open + "</p>" + next
    );

    // Hand-edited ES pages have `<span class="emphasis">text</a>` with a stray
    // `</a>` and no matching `</span>`. libxml2 discards the stray close and
    // auto-closes the span at </p>; xmldom instead lets the span swallow the
    // rest of the document. Within each <p>, drop any stray `</a>` inside an
    // emphasis span and explicitly close the span before </p>.
    out = out.replace(/<p\b[^>]*>[\s\S]*?<\/p>/g, (para) => {
        const match = para.match(/<span class="emphasis">/);
        if (!match) return para;
        const anchorOpens = (para.match(/<a\b/g) || []).length;
        const anchorCloses = (para.match(/<\/a>/g) || []).length;
        if (anchorCloses <= anchorOpens) return para;
        // Drop one stray </a> from the emphasis-span prefix, then close the
        // span just before </p>.
        let fixed = para.replace(/(<span class="emphasis">[^<]*)<\/a>/, "$1");
        if (fixed !== para) {
            fixed = fixed.replace(/<\/p>$/, "</span></p>");
        }
        return fixed;
    });

    return out;
}

function removeAll(doc: Document, xpathExpr: string): void {
    for (const node of selectElements(xpathExpr, doc)) {
        node.parentNode?.removeChild(node);
    }
}

function removeFigureLazy(doc: Document): void {
    const nodes = selectElements(
        "//h:figure[contains(@class, 'image')]/h:div[contains(@class, 'lazy-xyQQ2')]",
        doc
    );
    for (const node of nodes) {
        const parent = node.parentNode;
        const grandparent = parent?.parentNode;
        if (parent && grandparent) grandparent.removeChild(parent);
    }
}

function restructureAuthorSection(doc: Document, talkId: number): void {
    let imageSrc = "";
    let imageAlt = "";
    let imageFound = false;

    for (const img of selectElements("//h:section[@class='author']//h:img", doc)) {
        if (imageFound) {
            console.log(`>>>>> Too many img nodes in author section for talk ${talkId}`);
        }
        imageFound = true;
        imageSrc = img.getAttribute("src") ?? "";
        imageAlt = img.getAttribute("alt") ?? "";
        img.parentNode?.removeChild(img);
    }

    let nameNode: Element | null = null;
    let callingNode: Element | null = null;

    for (const p of selectElements("//h:section[@class='author']//h:p", doc)) {
        if (!nameNode) nameNode = p;
        else if (!callingNode) callingNode = p;
        else console.log(`>>>>> Too many p nodes in author section for talk ${talkId}`);
        p.parentNode?.removeChild(p);
    }

    const authorSections = selectElements("//h:section[@class='author']", doc);
    if (authorSections.length > 1) {
        console.log(`>>>>> Too many author section nodes for talk ${talkId}`);
    }

    const authorSection = authorSections[0];
    if (!authorSection) return;

    while (authorSection.firstChild) authorSection.removeChild(authorSection.firstChild);

    if (nameNode) {
        const bylineDiv = createElement(doc, "div");
        bylineDiv.setAttribute("class", "byline");
        bylineDiv.appendChild(nameNode);
        if (callingNode) bylineDiv.appendChild(callingNode);
        authorSection.appendChild(bylineDiv);
        authorSection.appendChild(createElement(doc, "hr"));
    }

    const introDiv = createElement(doc, "blockquote");
    introDiv.setAttribute("class", "intro dontHighlight");

    if (imageFound) {
        if (imageSrc.startsWith(MOBILE_PREFIX)) {
            imageSrc = "/images/cache/" + imageSrc.slice(MOBILE_PREFIX.length).replace(/\//g, "_");
        }
        const newImage = createElement(doc, "img");
        newImage.setAttribute("id", "talkPhoto");
        newImage.setAttribute("src", imageSrc);
        newImage.setAttribute("alt", imageAlt);
        newImage.setAttribute("class", "img-decor");
        introDiv.appendChild(newImage);
    }

    for (const p of selectElements("//h:p[@class='intro']", doc)) {
        p.parentNode?.removeChild(p);
        introDiv.appendChild(p);
    }

    authorSection.appendChild(introDiv);
}

function createElement(doc: Document, tag: string): Element {
    if (typeof doc.createElementNS === "function") {
        return doc.createElementNS(XHTML_NS, tag);
    }
    return doc.createElement(tag);
}

const SCRIPTURE_PREFIXES = [
    "www.lds.org/scriptures/ot",
    "www.lds.org/scriptures/nt",
    "www.lds.org/scriptures/bofm",
    "www.lds.org/scriptures/dc-testament",
    "www.lds.org/scriptures/pgp",
    "www.lds.org/scriptures/jst",
    "lds.org/scriptures/ot",
    "lds.org/scriptures/nt",
    "lds.org/scriptures/bofm",
    "lds.org/scriptures/dc-testament",
    "lds.org/scriptures/pgp",
    "lds.org/scriptures/jst",
    "/scriptures/ot",
    "/scriptures/nt",
    "/scriptures/bofm",
    "/scriptures/dc-testament",
    "/scriptures/pgp",
    "/scriptures/jst"
];

const NEW_SCRIPTURE_PREFIXES = [
    "/scriptures/ot",
    "/scriptures/nt",
    "/scriptures/bofm",
    "/scriptures/dc-testament",
    "/scriptures/pgp",
    "/scriptures/jst"
];

function disableAnchors(doc: Document, isNewFormat: boolean, cfg: EnsignConfig): void {
    for (const a of selectElements("//h:a[@href]", doc)) {
        const onclick = a.getAttribute("onclick") ?? "";
        if (onclick.includes("gs(") || onclick.includes("sx(")) continue;

        const href = a.getAttribute("href") ?? "";
        const cls = a.getAttribute("class") ?? "";
        const prefixes = isNewFormat ? NEW_SCRIPTURE_PREFIXES : SCRIPTURE_PREFIXES;

        const hasScripture = prefixes.some((p) => href.includes(p));
        const hasByu = href.includes("scriptures.byu.edu/getscrip");

        if (isNewFormat) {
            const hasHashNote = href.includes("#note");
            const hasNoteRefClass = cfg.newFormatDetectsNoteRefClass && cls.includes("note-ref");
            if (hasScripture || hasByu || hasHashNote || hasNoteRefClass) continue;
        } else {
            const hasFootnote = href.includes("#footnote") || href.includes("#note");
            if (hasScripture || hasByu || hasFootnote) continue;
        }

        a.setAttribute("target", "_blank");
        a.setAttribute("href", "javascript:void(0);");
        a.setAttribute("class", "nolink");
    }
}

function inlineFootnotes(
    doc: Document,
    talkId: number,
    isNewFormat: boolean,
    cfg: EnsignConfig
): void {
    for (const node of selectElements("//h:a[@href]", doc)) {
        const href = node.getAttribute("href") ?? "";
        const cls = node.getAttribute("class") ?? "";

        const isFootnote = isNewFormat
            ? href.includes("#note") ||
              (cfg.newFormatDetectsNoteRefClass && cls.includes("note-ref"))
            : href.includes("#footnote") || href.includes("#note");

        if (!isFootnote) continue;

        const footnoteId = footnoteIdForNode(node, href, isNewFormat);

        const inlineSpan = createElement(doc, "span");
        inlineSpan.setAttribute("class", "footnote");
        inlineSpan.appendChild(doc.createTextNode("["));

        const parent = node.parentNode;
        if (!parent) continue;

        if (isNewFormat) {
            parent.appendChild(doc.createTextNode(" "));
            const footnoteMarker = createElement(doc, "sup");
            footnoteMarker.setAttribute("class", "noteMarker");
            const hrefNode = createElement(doc, "a");
            hrefNode.setAttribute("href", `#${footnoteId}`);
            hrefNode.appendChild(doc.createTextNode(footnoteId.slice(4)));
            footnoteMarker.appendChild(hrefNode);
            footnoteMarker.appendChild(doc.createTextNode(" "));
            footnoteMarker.appendChild(inlineSpan);
            parent.replaceChild(footnoteMarker, node);
        } else if (cfg.oldFormatAlwaysWrapsSup) {
            // ES: wrap the original <a> in a new <sup class="noteMarker"> (if not
            // already inside one), then append space + span to the <sup>.
            const hrefIsWrappedInSup = parent.nodeName.toLowerCase() === "sup";
            if (!hrefIsWrappedInSup) {
                wrapNodeInSup(doc, node);
            }
            const supParent = node.parentNode;
            if (!supParent) continue;
            supParent.appendChild(doc.createTextNode(" "));
            supParent.appendChild(inlineSpan);
        } else if (talkId >= cfg.oldFormatCutoff) {
            parent.appendChild(doc.createTextNode(" "));
            const footnoteMarker = createElement(doc, "sup");
            footnoteMarker.setAttribute("class", "noteMarker");
            const hrefNode = createElement(doc, "a");
            hrefNode.setAttribute("href", href);
            hrefNode.appendChild(
                doc.createTextNode(footnoteId.slice(4, footnoteId.length - 1))
            );
            footnoteMarker.appendChild(hrefNode);
            footnoteMarker.appendChild(doc.createTextNode(" "));
            footnoteMarker.appendChild(inlineSpan);
            parent.replaceChild(footnoteMarker, node);
        } else {
            parent.appendChild(doc.createTextNode(" "));
            parent.appendChild(inlineSpan);
        }

        const paragraphs = footnoteParagraphs(doc, talkId, footnoteId, isNewFormat, cfg);
        let firstParagraph = true;

        for (const p of paragraphs) {
            if (firstParagraph) firstParagraph = false;
            else inlineSpan.appendChild(doc.createTextNode(" "));

            for (const child of Array.from(p.childNodes)) {
                inlineSpan.appendChild(child.cloneNode(true));
            }
        }

        inlineSpan.appendChild(doc.createTextNode("]"));
    }
}

function wrapNodeInSup(doc: Document, node: Element): void {
    // If the <a> has a leading <sup> child, unwrap it first: move its children
    // onto the <a>, then remove the inner <sup>. Finally, wrap <a> in a new
    // <sup class="noteMarker">.
    const firstChild = node.firstChild;
    const firstTag = firstChild ? firstChild.nodeName.toLowerCase() : "";
    if (firstChild && firstTag === "sup") {
        while (firstChild.firstChild) {
            node.appendChild(firstChild.removeChild(firstChild.firstChild));
        }
        node.removeChild(firstChild);
    }

    const sup = createElement(doc, "sup");
    sup.setAttribute("class", "noteMarker");
    const parent = node.parentNode;
    if (!parent) return;
    parent.replaceChild(sup, node);
    sup.appendChild(node);
}

function footnoteIdForNode(node: Element, href: string, isNewFormat: boolean): string {
    if (isNewFormat) {
        const idx = href.indexOf("#note");
        if (idx !== -1) return href.slice(idx + 1);
        return "note" + (node.firstChild?.textContent ?? "");
    }

    if (href.includes("#footnote") || href.includes("#note")) {
        return href.slice(1);
    }

    return "note" + (node.firstChild?.textContent ?? "");
}

function footnoteParagraphs(
    doc: Document,
    talkId: number,
    footnoteId: string,
    isNewFormat: boolean,
    cfg: EnsignConfig
): Element[] {
    if (isNewFormat) {
        return selectElements(`//h:li[@id=${xpathLiteral(footnoteId)}]//h:p`, doc);
    }

    // ES old-format cascade: try <li id=fid>, then <li id=fid->, then
    // <a name=fid.slice(8)>/../p, then <a name=fid>/../../p.
    if (cfg.direction === "es") {
        let paragraphs = selectElements(
            `//h:li[@id=${xpathLiteral(footnoteId)}]//h:p`,
            doc
        );
        if (paragraphs.length > 0) return paragraphs;

        paragraphs = selectElements(
            `//h:li[@id=${xpathLiteral(footnoteId + "-")}]//h:p`,
            doc
        );
        if (paragraphs.length > 0) return paragraphs;

        if (footnoteId.length > 8) {
            const innerId = footnoteId.slice(8);
            const anchors = selectElements(
                `//h:a[@name=${xpathLiteral(innerId)}]`,
                doc
            );
            const firstParent = anchors[0]?.parentNode;
            if (firstParent) {
                paragraphs = selectElements(".//h:p", firstParent);
                if (paragraphs.length > 0) return paragraphs;
            }
        }

        const anchors = selectElements(
            `//h:a[@name=${xpathLiteral(footnoteId)}]`,
            doc
        );
        const grandparent = anchors[0]?.parentNode?.parentNode;
        if (!grandparent) return [];
        return selectElements(".//h:p", grandparent);
    }

    // EN old-format: branches by talkId.
    if (talkId >= cfg.oldFormatCutoff) {
        return selectElements(
            `//h:li[@id=${xpathLiteral(footnoteId)}]//h:p`,
            doc
        );
    }

    if (talkId >= 8000) {
        const innerId = footnoteId.slice(8);
        const anchors = selectElements(`//h:a[@name=${xpathLiteral(innerId)}]`, doc);
        const parent = anchors[0]?.parentNode;
        if (!parent) return [];
        return selectElements(".//h:p", parent);
    }

    const anchors = selectElements(`//h:a[@name=${xpathLiteral(footnoteId)}]`, doc);
    const grandparent = anchors[0]?.parentNode?.parentNode;
    if (!grandparent) return [];
    return selectElements(".//h:p", grandparent);
}

function xpathLiteral(s: string): string {
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    const parts = s.split("'").map((p) => `'${p}'`);
    return `concat(${parts.join(",\"'\",")})`;
}

function fixImageUrls(doc: Document, talkId: number, cfg: EnsignConfig): void {
    const primaryImgs = selectElements("//h:div[@id='primary']//h:img", doc);
    const authorImgs = selectElements("//h:section[@class='author']//h:img", doc);

    for (const img of [...primaryImgs, ...authorImgs]) {
        const imgPath = img.getAttribute("src") ?? "";

        if (talkId < cfg.oldFormatCutoff) {
            const pos = imgPath.lastIndexOf("/");
            if (pos !== -1) {
                img.setAttribute("src", `/images/cache/${imgPath.slice(pos + 1)}`);
            }
            continue;
        }

        if (talkId < 8329 || talkId === 8352) {
            const pos = imgPath.indexOf("/images/");
            if (pos !== -1) {
                img.setAttribute(
                    "src",
                    `/images/cache/${imgPath.slice(pos + 8).replace(/\//g, "_")}`
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Custom XML-style serializer that mirrors PHP DOMDocument::saveXML:
// - Empty elements self-close (<hr/>)
// - Empty attribute values preserved (class="")
// - Strips the xmlns="http://www.w3.org/1999/xhtml" that xmldom injects
// ---------------------------------------------------------------------------

interface MinimalAttr {
    name: string;
    value: string;
}

interface MinimalNode {
    nodeType: number;
    nodeName?: string;
    nodeValue?: string | null;
    tagName?: string;
    localName?: string;
    childNodes?: ArrayLike<MinimalNode>;
    attributes?: ArrayLike<MinimalAttr>;
}

function serializeXml(node: MinimalNode): string {
    return serializeInner(node);
}

function serializeInner(node: MinimalNode): string {
    if (node.nodeType === 3) {
        return escapeText(node.nodeValue ?? "");
    }

    if (node.nodeType === 8) {
        return `<!--${node.nodeValue ?? ""}-->`;
    }

    if (node.nodeType === 4) {
        return `<![CDATA[${node.nodeValue ?? ""}]]>`;
    }

    if (node.nodeType !== 1) {
        return "";
    }

    const tag = (node.localName ?? node.tagName ?? node.nodeName ?? "").toLowerCase();
    let attrs = "";

    if (node.attributes) {
        for (let i = 0; i < node.attributes.length; i++) {
            const attr = node.attributes[i]!;
            if (attr.name === "xmlns" && attr.value === XHTML_NS) continue;
            attrs += ` ${attr.name.toLowerCase()}="${escapeAttr(attr.value ?? "")}"`;
        }
    }

    const children = node.childNodes;
    if (!children || children.length === 0) {
        return `<${tag}${attrs}/>`;
    }

    // libxml2's saveXML wraps <script>/<style> text children in CDATA. Mirror that:
    // if the element is script/style and contains any non-CDATA text, wrap the
    // concatenated text payload in a single <![CDATA[...]]> block.
    if (tag === "script" || tag === "style") {
        let allText = "";
        let hasText = false;
        let hasCdata = false;
        for (let i = 0; i < children.length; i++) {
            const c = children[i]!;
            if (c.nodeType === 4) hasCdata = true;
            else if (c.nodeType === 3) {
                hasText = true;
                allText += c.nodeValue ?? "";
            }
        }
        if (hasText && !hasCdata) {
            return `<${tag}${attrs}><![CDATA[${allText}]]></${tag}>`;
        }
    }

    let body = "";
    for (let i = 0; i < children.length; i++) {
        body += serializeInner(children[i]!);
    }

    return `<${tag}${attrs}>${body}</${tag}>`;
}

function escapeText(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
