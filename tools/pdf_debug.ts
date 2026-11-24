import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pdfToMarkdownPages } from '../src/server/pdf2md';

const usage = `Usage:
  npm run pdf:debug -- "/path/document.pdf"
  npm run pdf:debug -- "/path/document.pdf" --out "/path/document.md"

Prints readable Markdown with page headings and separators. --out saves it to a file.
Use -- before a PDF path that starts with --.`;

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        console.log(usage);
        return;
    }
    let input: string | undefined;
    let output: string | undefined;
    let positionalOnly = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!positionalOnly && arg === '--') {
            positionalOnly = true;
        } else if (!positionalOnly && arg === '--out') {
            const value = args[++index];
            if (output !== undefined || !value || value.startsWith('--')) {
                throw new Error(`Provide --out once with a file path.\n${usage}`);
            }
            output = value;
        } else if ((!positionalOnly && arg.startsWith('--')) || input !== undefined) {
            throw new Error(`Unexpected argument: ${arg}.\n${usage}`);
        } else {
            input = arg;
        }
    }
    if (!input) {
        throw new Error(`Provide one PDF path.\n${usage}`);
    }
    if (output && resolve(output) === resolve(input)) {
        throw new Error('Output must not overwrite the input PDF.');
    }
    const pages = await pdfToMarkdownPages(await readFile(input));
    const markdown = `${pages
        .map(({ pageNumber, markdown }) => `## Page ${pageNumber}\n\n${markdown}`.trimEnd())
        .join('\n\n---\n\n')}\n`;
    if (output) {
        await writeFile(output, markdown, { flag: 'wx' });
        console.error(`Saved ${pages.length} pages to ${output}.`);
    } else {
        process.stdout.write(markdown);
    }
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'PDF conversion failed.');
    process.exitCode = 1;
});
