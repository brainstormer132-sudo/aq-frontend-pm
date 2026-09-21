/**
 * Reading a Word file into template blocks.
 *
 * Siraj: "i need uploading a template to be seemless and work as easy as
 * possible and as self explanitary as posiible ... in my vision we upload the
 * template then a copy of it is added then a popup apears asking what type of
 * contract it is ... and based on that it gets blocks where you can place in
 * to simulate the {{ input }} from a list then it gets stored and setup."
 *
 * Until now a template was typed into the editor block by block. There is no
 * import anywhere in the app - `grep -rn docx components/workflow/legal`
 * returns nothing. Legal has the documents already, in Word, and retyping one
 * is both the slowest way to get it in and the one that introduces the typo.
 *
 * -- WHAT THIS FILE IS AND IS NOT ------------------------------------
 *
 * It is the pure half: bytes in, blocks out, no React and no network, so the
 * hard part - does the real agreement come back out as the right blocks - is
 * answered by `npm test` rather than by uploading a file and squinting.
 *
 * It is NOT a Word renderer. A .docx can express things no contract template
 * needs and this deliberately drops them: fonts, colours, spacing, images,
 * footnotes, revision marks. What survives is what the block editor can hold
 * and the print path can draw - a title, headings, paragraphs, list items and
 * a table - because a block it cannot round-trip is a block somebody would
 * edit and then watch change shape on save.
 *
 * -- WHY THE XML IS READ WITH STRINGS AND NOT A PARSER ---------------
 *
 * No DOMParser: this has to run in Node for the suite, where there isn't one.
 * No XML dependency either. WordprocessingML's shape is regular enough for
 * what is taken from it - paragraphs, runs, table cells - and every value
 * pulled out is treated as text, never markup, so a malformed file yields
 * poor blocks rather than an exception or an injection.
 */
import type { EditorBlockType } from './legal';

/* -- 1. the container -------------------------------------------------- */

/** One file inside the .docx, located but not yet decompressed. */
export interface ZipEntry {
  name: string;
  /** Where the compressed bytes start. */
  offset: number;
  compSize: number;
  rawSize: number;
  /** 0 = stored, 8 = raw deflate. Anything else is refused. */
  method: number;
}

function u16(b: Uint8Array, i: number): number { return b[i] | (b[i + 1] << 8); }
function u32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000;
}

/**
 * The files inside a zip, read from its central directory.
 *
 * Read backwards from the End Of Central Directory record rather than by
 * walking local headers forward: a local header may carry a zero size with the
 * real one in a trailing descriptor, which is exactly what several Word
 * versions write. The central directory always has the true numbers. Pure.
 */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  // The EOCD is at the end, after a comment of up to 64k.
  let eocd = -1;
  const from = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b
      && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) break;
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const rawSize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localAt = u32(bytes, p + 42);
    let name = '';
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(bytes[p + 46 + i]);
    // The local header's own name/extra lengths decide where the data starts,
    // and they are NOT always the same as the central directory's.
    const lNameLen = u16(bytes, localAt + 26);
    const lExtraLen = u16(bytes, localAt + 28);
    out.push({
      name, method, compSize, rawSize,
      offset: localAt + 30 + lNameLen + lExtraLen,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The still-compressed bytes of one entry. Pure. */
export function entryBytes(bytes: Uint8Array, e: ZipEntry): Uint8Array {
  return bytes.subarray(e.offset, e.offset + e.compSize);
}

/**
 * One file out of a .docx, as text.
 *
 * `inflate` is passed in rather than imported so this stays testable without
 * a runtime: the app hands it DecompressionStream('deflate-raw'), the suite
 * hands it whatever it likes. A stored (uncompressed) entry needs neither.
 */
export async function readDocxFile(
  bytes: Uint8Array,
  name: string,
  inflate: (b: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const e = zipEntries(bytes).find((x) => x.name === name);
  if (!e) throw new Error(`${name} is not in this file - it may not be a Word document.`);
  if (e.method !== 0 && e.method !== 8) {
    throw new Error(`${name} uses an unsupported compression method (${e.method}).`);
  }
  const raw = e.method === 0 ? entryBytes(bytes, e) : await inflate(entryBytes(bytes, e));
  return new TextDecoder('utf-8').decode(raw);
}

/* -- 2. the document --------------------------------------------------- */

/** One paragraph, with only what the mapping below actually needs. */
export interface DocxPara {
  text: string;
  /** The same text with its runs of spaces intact. See the signing rule. */
  raw: string;
  /** w:pStyle, lower-cased. '' when the paragraph carries none. */
  style: string;
  /** Inside a numbered or bulleted list. */
  listed: boolean;
  /** At least 70% of its characters were bold. See boldShare. */
  bold: boolean;
  /** w:jc - 'center', 'both', 'left', 'right' or ''. */
  align: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Last, so an escaped ampersand cannot resurrect another entity.
    .replace(/&amp;/g, '&');
}

/**
 * A paragraph's visible text.
 *
 * Word splits a single word across runs whenever anything changes mid-word -
 * a spell-check mark, a language switch, an undo - so "{{ license_name }}"
 * routinely arrives as five runs. Joining the runs BEFORE looking for
 * placeholders is the only reason they are found at all; matching run by run
 * finds none of them. `w:tab` becomes a space and `w:br` a newline so a line
 * break inside a paragraph does not weld two words together.
 */
export function paraText(xml: string): string {
  let out = '';
  const re = /<w:(t|tab|br|cr)(\s[^>]*)?(\/>|>([\s\S]*?)<\/w:\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1] === 't') out += decodeXml(m[4] ?? '');
    else if (m[1] === 'tab') out += ' ';
    else out += '\n';
  }
  return out;
}

/**
 * How much of a paragraph's text is bold, 0 to 1.
 *
 * Measured in CHARACTERS, not runs. "Every run is bold" was the first rule and
 * it was wrong: Word splits a heading into a bold run and a trailing run
 * holding one unbold space, and a heading in the real agreement came out as a
 * paragraph because of that space. Weighting by how much text each run carries
 * makes a stray empty run irrelevant, which is what a reader would say too.
 */
export function boldShare(paraXml: string): number {
  let bold = 0;
  let total = 0;
  const re = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paraXml))) {
    const run = m[1];
    const n = paraText(run).trim().length;
    if (!n) continue;
    total += n;
    const props = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(run)?.[0] ?? '';
    if (/<w:b\/>|<w:b\s[^>]*\/>|<w:b>/.test(props)) bold += n;
  }
  return total ? bold / total : 0;
}

/** Split the body into paragraphs, skipping any inside a table. Pure. */
export function docxParagraphs(xml: string): DocxPara[] {
  const body = /<w:body[\s\S]*?<\/w:body>/.exec(xml)?.[0] ?? xml;
  // Tables are handled separately; their paragraphs must not appear twice.
  const flat = body.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '');
  const out: DocxPara[] = [];
  const re = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const inner = m[1];
    // Two texts: the tidy one everything reads, and the raw one, whose runs
    // of spaces are the only thing that says where one signing column ends
    // and the next begins.
    const raw = paraText(inner).trim();
    const text = raw.replace(/[ \t]+/g, ' ').trim();
    const props = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(inner)?.[0] ?? '';
    out.push({
      text,
      raw,
      style: (/<w:pStyle w:val="([^"]*)"/.exec(props)?.[1] ?? '').toLowerCase(),
      listed: /<w:numPr>/.test(props),
      bold: boldShare(inner) >= 0.7,
      align: /<w:jc w:val="([^"]*)"/.exec(props)?.[1] ?? '',
    });
  }
  return out;
}

/** A table, as the header labels and the rows under them. */
export interface DocxTable {
  headers: string[];
  rows: string[][];
}

/** Every table in the document, in order. Pure. */
export function docxTables(xml: string): DocxTable[] {
  const out: DocxTable[] = [];
  const tbls = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
  for (const t of tbls) {
    const rows = (t.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g) ?? []).map((r) =>
      (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [])
        .map((c) => paraText(c).replace(/\s+/g, ' ').trim()));
    if (!rows.length) continue;
    out.push({ headers: rows[0], rows: rows.slice(1) });
  }
  return out;
}

/* -- 3. the mapping ---------------------------------------------------- */

/** What the importer produces: one block, ready for legal.doc_template_block. */
export interface ImportedBlock {
  block_type: EditorBlockType;
  content: Record<string, unknown>;
  /** What it was in the Word file, so the review screen can explain itself. */
  note: string;
}

/** A heading is short, and a contract's headings end in a colon. */
function looksLikeHeading(p: DocxPara): boolean {
  if (!p.text) return false;
  if (/^heading\d/.test(p.style)) return true;
  if (p.listed) return false;
  if (p.text.length > 90) return false;
  // Bold on its own is not enough - whole bold paragraphs are common in these
  // documents. Bold AND ending on a colon is what a section heading looks
  // like, in Arabic and in English alike.
  return p.bold && /[:\u061b\u060c]\s*$/.test(p.text);
}

/**
 * A row of underscores is somewhere to sign, not a sentence.
 *
 * Word has no "signature block", so these documents draw one: a line with the
 * two parties on it, and under it a line of underscores with a wide gap in the
 * middle. Both are dropped and replaced by one `sig` block, which the print
 * path already knows how to draw with proper rules - otherwise the imported
 * template carries a literal row of underscores that nothing can align.
 */
export function isSigningRule(text: string): boolean {
  const t = String(text ?? '').trim();
  return t.length >= 6 && /^[_\u2014\u2013\-\s.]+$/.test(t) && /_{4,}|-{6,}/.test(t);
}

/**
 * The two sides of a signing line, split on the gap that separates them.
 *
 * The gap is three or more spaces, or a tab: it is how the line was laid out
 * in Word, and it is the only signal there is. A line with no such gap is not
 * a signing line and comes back null. Pure.
 */
export function splitSignatories(raw: string): { right: string; left: string } | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const parts = t.split(/\s{3,}|\t+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  return { right: parts[0], left: parts[1] };
}

/**
 * A Word document as template blocks, in order.
 *
 * The title is the first centred line, or the first Heading1, whichever comes
 * first - not "the first paragraph", because these documents open with a
 * contract number above the title.
 *
 * Anything that is only a placeholder on its own line, like the "{{ id }}"
 * this file opens with, is DROPPED: the app stamps its own contract number and
 * two of them on one page is the sort of thing a vendor asks about. Pure.
 */
export function docxToBlocks(xml: string): ImportedBlock[] {
  const paras = docxParagraphs(xml);
  const tables = docxTables(xml);
  const out: ImportedBlock[] = [];
  let titleTaken = false;
  let tableAt = 0;

  // Where each table sits relative to the paragraphs, so a table lands where
  // it was rather than after all of them - which a mutation of this line
  // proves the suite catches. Whole elements are matched, not opening tags:
  // an opening-tag scan also counts the paragraphs INSIDE a cell, and while
  // that happens to come out in the same order, a reader has to work that out
  // before believing it.
  const body = /<w:body[\s\S]*?<\/w:body>/.exec(xml)?.[0] ?? xml;
  const seq: ('p' | 't')[] = [];
  const walk = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let w: RegExpExecArray | null;
  while ((w = walk.exec(body))) seq.push(w[0].startsWith('<w:tbl>') ? 't' : 'p');

  let paraAt = 0;
  for (const kind of seq) {
    if (kind === 't') {
      const t = tables[tableAt++];
      if (!t || !t.headers.length) continue;
      out.push({
        block_type: 'table',
        content: {
          columns: t.headers.map((h, i) => ({ key: `col_${i + 1}`, label: h })),
          rows: t.rows.map((r) => Object.fromEntries(r.map((c, i) => [`col_${i + 1}`, c]))),
        },
        note: `table, ${t.headers.length} columns`,
      });
      continue;
    }
    const p = paras[paraAt++];
    if (!p || !p.text) continue;

    // The row of underscores under a signing line. The line itself has
    // already become a sig block; this is the rule it was drawn with.
    if (isSigningRule(p.text)) continue;

    // A signing line is recognised by what FOLLOWS it: the next non-empty
    // paragraph is a row of underscores. Guessing from the line alone would
    // turn any two-column paragraph into a signature block.
    const next = paras.slice(paraAt).find((x) => x.text);
    if (next && isSigningRule(next.text)) {
      const sides = splitSignatories(p.raw);
      if (sides) {
        out.push({
          block_type: 'sig',
          content: { right: sides.right, left: sides.left },
          note: 'a place to sign',
        });
        continue;
      }
    }

    // A line that is nothing but a merge field is a slot the app already
    // fills - the contract number above the title in the file he sent.
    if (/^\{\{\s*[A-Za-z_0-9]+\s*\}\}$/.test(p.text)) continue;

    if (!titleTaken && (p.align === 'center' || /^heading1$/.test(p.style))) {
      out.push({ block_type: 'title', content: { text: p.text }, note: 'the title' });
      titleTaken = true;
      continue;
    }
    if (looksLikeHeading(p)) {
      out.push({ block_type: 'h', content: { text: p.text }, note: 'a heading' });
      continue;
    }
    if (p.listed) {
      out.push({ block_type: 'li', content: { text: p.text }, note: 'a list item' });
      continue;
    }
    out.push({ block_type: 'p', content: { text: p.text }, note: 'a paragraph' });
  }
  return out;
}

/* -- 4. the fields ----------------------------------------------------- */

/**
 * Every {{ key }} the imported blocks use, in the order they first appear.
 *
 * First-appearance order, not alphabetical: the review screen lists them so
 * somebody can check them off against the document, and the document is what
 * they will be reading down. Pure.
 */
export function usedPlaceholders(blocks: ImportedBlock[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: unknown) => {
    for (const m of String(s ?? '').matchAll(/\{\{\s*([A-Za-z_][A-Za-z_0-9]*)\s*\}\}/g)) {
      if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
    }
  };
  for (const b of blocks ?? []) {
    add(b.content?.text);
    for (const c of (b.content?.columns as { label?: string }[] | undefined) ?? []) add(c?.label);
    for (const r of (b.content?.rows as Record<string, string>[] | undefined) ?? []) {
      for (const v of Object.values(r ?? {})) add(v);
    }
  }
  return out;
}

/** What the review screen says about an import, before anything is saved. */
export interface ImportSummary {
  blocks: number;
  headings: number;
  paragraphs: number;
  listItems: number;
  tables: number;
  placeholders: string[];
  title: string;
  /** What is worth saying out loud before somebody presses save. */
  warnings: string[];
}

/**
 * The import, described in the words the screen shows.
 *
 * Siraj asked for this to be "as self explanitary as posiible", so the screen
 * does not show a block tree - it says what came out and what is worth a look.
 * Pure.
 */
export function summarise(blocks: ImportedBlock[]): ImportSummary {
  const count = (t: EditorBlockType) => blocks.filter((b) => b.block_type === t).length;
  const placeholders = usedPlaceholders(blocks);
  const warnings: string[] = [];
  if (!blocks.length) warnings.push('Nothing came out of that file - is it a Word document?');
  if (!blocks.some((b) => b.block_type === 'title')) {
    warnings.push('No title line was found. The first centred line becomes the title.');
  }
  if (!placeholders.length) {
    warnings.push('No {{ fields }} in this document yet. You can add them in the editor.');
  }
  const longest = blocks.reduce((n, b) => Math.max(n, String(b.content?.text ?? '').length), 0);
  if (longest > 1500) {
    warnings.push('One paragraph is very long - check it did not swallow a page break.');
  }
  return {
    blocks: blocks.length,
    headings: count('h'),
    paragraphs: count('p'),
    listItems: count('li'),
    tables: count('table'),
    placeholders,
    title: String(blocks.find((b) => b.block_type === 'title')?.content?.text ?? ''),
    warnings,
  };
}
