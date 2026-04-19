// Builds the <!doctype html>…</html> scaffold that wraps each row's
// ProcessedText before it's stored in the mobile SQLite DB.
//
// Each content source (conference pre-1971, JoD, STPJS, Ensign) uses a
// slightly different head arrangement and style/script combo. The PHP
// scripts hand-roll each one, which has left small inconsistencies:
//   - order of <meta> vs <link>
//   - STPJS's <link> has no self-closing slash
//   - STPJS emits a stray </div> just before </body>
// We preserve every quirk for byte-for-byte parity with the existing
// deployed mobile databases.

export interface MobileScaffold {
    // Text to place inside <title>…</title>. Entities in the title are
    // decoded to raw UTF-8 via decodeTitleEntities() — mirrors PHP's
    // convert_raw_utf8_smart_quotes (which, in the mobile scripts, is
    // called backwards: entity → raw bytes).
    title: string;
    stylesheet: string; // "gcera.css" | "jod.css" | "stpjs.css" | "gcen.css"
    script: string;     // "sci.js"
    // Head element ordering:
    //   false → title, <link>, <script>, <meta charset>, <meta viewport>
    //           (conference pre-1971 and Ensign)
    //   true  → title, <meta charset>, <meta viewport>, <link>, <script>
    //           (JoD and STPJS)
    metaBeforeAssets: boolean;
    // STPJS omits the self-closing slash on its <link>.
    selfCloseLink: boolean;
    // STPJS closes with </div></body></html> instead of </body></html>.
    trailingDiv: boolean;
}

// Entities PHP's convert_raw_utf8_smart_quotes() turns into raw UTF-8 bytes
// when applied to titles. The mobile titles get this reverse pass so that
// rendered <title>s contain actual glyphs (e.g. "2018–O") instead of the
// literal "&ndash;" string concatenated in PHP.
const TITLE_ENTITIES: ReadonlyArray<readonly [string, string]> = [
    ["&trade;",  "\u2122"],
    ["&ndash;",  "\u2013"],
    ["&mdash;",  "\u2014"],
    ["&lsquo;",  "\u2018"],
    ["&rsquo;",  "\u2019"],
    ["&ldquo;",  "\u201C"],
    ["&rdquo;",  "\u201D"],
    ["&bull;",   "\u2022"],
    ["&hellip;", "\u2026"],
    ["&#257;",   "\u0101"],
    ["&Aring;",  "\u00C5"],
    ["&agrave;", "\u00E0"],
    ["&aacute;", "\u00E1"],
    ["&acirc;",  "\u00E2"],
    ["&atilde;", "\u00E3"],
    ["&auml;",   "\u00E4"],
    ["&aring;",  "\u00E5"],
    ["&aelig;",  "\u00E6"],
    ["&ccedil;", "\u00E7"],
    ["&egrave;", "\u00E8"],
    ["&eacute;", "\u00E9"],
    ["&ecirc;",  "\u00EA"],
    ["&euml;",   "\u00EB"],
    ["&igrave;", "\u00EC"],
    ["&iacute;", "\u00ED"],
    ["&icirc;",  "\u00EE"],
    ["&iuml;",   "\u00EF"],
    ["&ntilde;", "\u00F1"],
    ["&ograve;", "\u00F2"],
    ["&oacute;", "\u00F3"],
    ["&ocirc;",  "\u00F4"],
    ["&otilde;", "\u00F5"],
    ["&ouml;",   "\u00F6"],
    ["&divide;", "\u00F7"],
    ["&oslash;", "\u00F8"],
    ["&ugrave;", "\u00F9"],
    ["&uacute;", "\u00FA"],
    ["&ucirc;",  "\u00FB"],
    ["&uuml;",   "\u00FC"],
    ["&yacute;", "\u00FD"],
    ["&thorn;",  "\u00FE"],
    ["&yuml;",   "\u00FF"],
    ["&nbsp;",   "\u00A0"],
    ["&iexcl;",  "\u00A1"],
    ["&cent;",   "\u00A2"],
    ["&copy;",   "\u00A9"],
    ["&reg;",    "\u00AE"],
    ["&deg;",    "\u00B0"],
    ["&frac12;", "\u00BD"],
    ["&iquest;", "\u00BF"],
    ["&#xA0;",   "\u00A0"],
    ["&#x2014;", "\u2014"],
    ["&#x2018;", "\u2018"],
    ["&#x2019;", "\u2019"],
    ["&#x201C;", "\u201C"],
    ["&#x201D;", "\u201D"],
    ["&#x2026;", "\u2026"]
];

export function decodeTitleEntities(s: string): string {
    let out = s;

    for (const [entity, glyph] of TITLE_ENTITIES) {
        if (out.includes(entity)) {
            out = out.split(entity).join(glyph);
        }
    }

    return out;
}

export function wrapMobileHtml(content: string, scaffold: MobileScaffold): string {
    const title = decodeTitleEntities(scaffold.title);
    const link = scaffold.selfCloseLink
        ? `<link rel="stylesheet" type="text/css" href="${scaffold.stylesheet}"/>`
        : `<link rel="stylesheet" type="text/css" href="${scaffold.stylesheet}">`;
    const script = `<script type="text/javascript" src="${scaffold.script}" defer></script>`;
    const metaCharset = '<meta charset="utf-8"/>';
    const metaViewport = '<meta name="viewport" content="initial-scale=1.0, user-scalable=no"/>';

    const head = scaffold.metaBeforeAssets
        ? `<title>${title}</title>${metaCharset}${metaViewport}${link}${script}`
        : `<title>${title}</title>${link}${script}${metaCharset}${metaViewport}`;

    const close = scaffold.trailingDiv
        ? "</div></body></html>"
        : "</body></html>";

    return `<!doctype html>\n<html><head>${head}</head><body>${content}${close}`;
}

// Named scaffolds for the four content sources — matches PHP exactly.
export const SCAFFOLD_CONFERENCE_PRE1971: Omit<MobileScaffold, "title"> = {
    stylesheet: "gcera.css",
    script: "sci.js",
    metaBeforeAssets: false,
    selfCloseLink: true,
    trailingDiv: false
};

export const SCAFFOLD_JOD: Omit<MobileScaffold, "title"> = {
    stylesheet: "jod.css",
    script: "sci.js",
    metaBeforeAssets: true,
    selfCloseLink: true,
    trailingDiv: false
};

export const SCAFFOLD_STPJS: Omit<MobileScaffold, "title"> = {
    stylesheet: "stpjs.css",
    script: "sci.js",
    metaBeforeAssets: true,
    selfCloseLink: false,
    trailingDiv: true
};

export const SCAFFOLD_ENSIGN: Omit<MobileScaffold, "title"> = {
    stylesheet: "gcen.css",
    script: "sci.js",
    metaBeforeAssets: false,
    selfCloseLink: true,
    trailingDiv: false
};
