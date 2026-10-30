import { createHash } from 'node:crypto';

export type ParsedSection = {
    heading: string;
    content: string;
    contentHash: string;
};

const HEADING_MAX_LENGTH = 80;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const looksLikeHeading = (line: string, hasMoreLines: boolean) =>
    hasMoreLines && line.length <= HEADING_MAX_LENGTH && !/[.!?:]$/.test(line);

export const splitSections = (text: string): ParsedSection[] =>
    text
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0)
        .map((block) => {
            const [firstLine, ...rest] = block.split('\n').map((line) => line.trim());
            const heading = looksLikeHeading(firstLine, rest.length > 0) ? firstLine : '';
            const content = (heading ? rest.join('\n') : block).trim();
            return { heading, content, contentHash: sha256(content) };
        })
        .filter((section) => section.content.length > 0);

export const pasteExternalId = (text: string) => `paste:${sha256(text.trim())}`;
