import type { Lang } from "./args.js";

// Content direction is the same two-letter tag as Lang; the separate name
// reads better in citation / DOM code that's direction-sensitive.
export type Direction = Lang;

export interface EnsignConfig {
    direction: Direction;
    bookTable: string;
    langParam: string;
    langAlt: string;
    oldFormatCutoff: number;
    flagJst: string;
    flagEndnote: string;
    flagHeadnote: string;
    newFormatDetectsNoteRefClass: boolean;
    oldFormatAlwaysWrapsSup: boolean;
    oldFormatAcceptsOnclickOrTarget: boolean;
}

export const EN_CONFIG: EnsignConfig = {
    direction: "en",
    bookTable: "book",
    langParam: "eng",
    langAlt: "eng",
    oldFormatCutoff: 8293,
    flagJst: " (JST)",
    flagEndnote: " Endnote",
    flagHeadnote: " Headnote",
    newFormatDetectsNoteRefClass: true,
    oldFormatAlwaysWrapsSup: false,
    oldFormatAcceptsOnclickOrTarget: false
};

export const ES_CONFIG: EnsignConfig = {
    direction: "es",
    bookTable: "book_es",
    langParam: "spa",
    langAlt: "(?:spa|eng)",
    oldFormatCutoff: 8258,
    flagJst: " (TJS)",
    flagEndnote: " Nota al Pie de P\u00e1gina",
    flagHeadnote: " Encabezamiento",
    newFormatDetectsNoteRefClass: false,
    oldFormatAlwaysWrapsSup: true,
    oldFormatAcceptsOnclickOrTarget: true
};
