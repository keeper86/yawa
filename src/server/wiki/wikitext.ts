const HEADING_LINE = /^=+\s*(.*?)\s*=+$/gm;
const TABLE = /\{\|[\s\S]*?\|\}/g;
const SELF_CLOSING_REF = /<ref[^>]*\/>/g;
const REF_BLOCK = /<ref[^>]*>[\s\S]*?<\/ref>/g;
const TEMPLATE = /\{\{[^{}]*\}\}/g;
const MEDIA_LINK = /\[\[(?:File|Image|Datei|Bild):[^\]]*\]\]/gi;
const CATEGORY_LINK = /\[\[(?:Category|Kategorie):[^\]]*\]\]/gi;
const PIPED_LINK = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
const PLAIN_LINK = /\[\[([^\]]+)\]\]/g;
const MATH_TAG = /<\/?math[^>]*>/gi;
const OTHER_TAG =
    /<\/?(?:br|span|div|small|big|sub|sup|center|blockquote|gallery|nowiki|code|syntaxhighlight|chem|ce)[^>]*\/?>/gi;
const EXTERNAL_LINK = /\[https?:\/\/[^\]]*\]/g;
const LIST_MARKER = /^[*#:;]+\s*/gm;
const BOLD = /'{2,}/g;
const BLANK_RUNS = /\n{3,}/g;
const TRAILING_SPACES = /[ \t]+$/gm;

export const wikitextToText = (wikitext: string): string => {
    let text = wikitext.replace(TABLE, '').replace(REF_BLOCK, '').replace(SELF_CLOSING_REF, '');
    text = text.replace(MEDIA_LINK, '').replace(CATEGORY_LINK, '');

    let previous = '';
    while (previous !== text) {
        previous = text;
        text = text.replace(TEMPLATE, '');
    }

    text = text
        .replace(PIPED_LINK, '$2')
        .replace(PLAIN_LINK, '$1')
        .replace(EXTERNAL_LINK, '')
        .replace(MATH_TAG, '')
        .replace(OTHER_TAG, '')
        .replace(HEADING_LINE, '$1')
        .replace(LIST_MARKER, '')
        .replace(BOLD, '');

    return text.replace(TRAILING_SPACES, '').replace(BLANK_RUNS, '\n\n').trim();
};

export const looksLikeSectionHeading = (line: string): boolean =>
    line.trim().length > 0 && line.trim().length <= 80 && !/[.!?,;:]$/.test(line.trim());
