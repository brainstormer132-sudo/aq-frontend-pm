/**
 * The template editor, as a document rather than a list of boxes.
 *
 * Siraj: "you need to rehaul the template editor and upload its unusable
 * unless you know exactly what youre doing it should be as simple as possible."
 *
 * He is right, and the reasons are specific. The old editor showed a
 * forty-two-row list of cards, each with a type chip, an up arrow, a down
 * arrow, an "Opt" button and a delete cross. To move a clause from the end of
 * the contract to the middle took thirty-five clicks. The words on the screen
 * were ours - block, KV, sig, row_source, "Publish v3" - and the contract
 * itself was nowhere: you could not read the thing you were editing.
 *
 * -- WHAT THIS FILE IS -----------------------------------------------
 *
 * The pure half of the rebuild. Grouping a flat block list into the sections a
 * reader sees, moving a whole section at once, turning {{ merge_fields }} into
 * something with a human label on it, and the sentences the screen says at the
 * two moments that are irreversible.
 *
 * No React, no Supabase, no argless `new Date()`. Relative imports only -
 * scripts/run-tests.mjs compiles lib/*.ts with bare tsc and no tsconfig.
 */

import type { TemplateBlock } from './legal';
import { blockText, moveItem } from './legal';

/* -- sections: 42 things become 7 ------------------------------------- */

/**
 * The contract's own structure, which the flat block list has always had and
 * never shown. A HEADING starts a section and owns everything under it until
 * the next heading.
 *
 * The UGC contract is seven numbered Arabic sections. Shown as forty-two
 * equal rows, that structure is invisible and every clause looks as important
 * as every other one. Shown as seven collapsible sections, the document looks
 * like the document.
 *
 * Whatever comes BEFORE the first heading - the title, the date line, the two
 * parties, the preamble - is its own section with no heading block of its own.
 * It is not a heading and must not be made one: `headingId` is empty there,
 * and the screen knows not to offer "delete this section's heading".
 */
export interface DocSection {
  /** The heading block's id, or '' for the run before the first heading. */
  headingId: string;
  /** What the collapsed row says. */
  title: string;
  /** Every block in the section, the heading first when there is one. */
  blocks: TemplateBlock[];
}

/** What the opening run is called when it has no heading of its own. */
export const OPENING_TITLE = 'Opening';

export function documentSections(blocks: TemplateBlock[]): DocSection[] {
  const out: DocSection[] = [];
  let cur: DocSection | null = null;
  for (const b of blocks ?? []) {
    if (b?.block_type === 'h') {
      cur = { headingId: b.id, title: blockText(b).trim() || 'Untitled section', blocks: [b] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      cur = { headingId: '', title: OPENING_TITLE, blocks: [] };
      out.push(cur);
    }
    cur.blocks.push(b);
  }
  return out;
}

/** "4 lines" / "1 line", for the collapsed row. */
export function sectionSummary(s: DocSection): string {
  const n = (s?.blocks ?? []).filter((b) => b?.block_type !== 'h').length;
  return `${n} line${n === 1 ? '' : 's'}`;
}

/**
 * Move a whole SECTION one place, and return the new flat block order.
 *
 * This is the click-count fix. Reordering by line meant moving each of a
 * section's nine blocks past each of the next section's nine, one step at a
 * time. A section is one decision, so it is one move.
 *
 * The opening run cannot move and nothing can move above it: it holds the
 * title and the parties, and a contract whose parties appear halfway down is
 * not a contract. Returns the input unchanged when the move is refused, so
 * the caller can compare by identity and skip the write.
 */
export function moveSection(
  blocks: TemplateBlock[], sectionIndex: number, dir: -1 | 1,
): TemplateBlock[] {
  const secs = documentSections(blocks ?? []);
  const to = sectionIndex + dir;
  if (sectionIndex < 0 || sectionIndex >= secs.length) return blocks;
  if (to < 0 || to >= secs.length) return blocks;
  // The opening run is anchored, and so is the slot above it.
  if (!secs[sectionIndex].headingId) return blocks;
  if (!secs[to].headingId) return blocks;
  const moved = moveItem(secs, sectionIndex, dir);
  return moved.flatMap((s) => s.blocks);
}

/**
 * Move ONE line within its own section.
 *
 * Deliberately not across the boundary: a paragraph that drifts out from
 * under its heading has silently changed which clause it belongs to, and on a
 * contract that is a different document. Crossing a boundary is a section
 * move, which is the other function.
 *
 * A heading itself does not move this way - moving a heading IS moving its
 * section. Returns the input unchanged when the move is refused.
 */
export function moveLine(
  blocks: TemplateBlock[], id: string, dir: -1 | 1,
): TemplateBlock[] {
  const all = blocks ?? [];
  const secs = documentSections(all);
  for (const s of secs) {
    // Within a section, only the non-heading lines are movable, and the
    // heading always stays first.
    const head = s.headingId ? s.blocks.slice(0, 1) : [];
    const body = s.headingId ? s.blocks.slice(1) : s.blocks;
    const i = body.findIndex((b) => b.id === id);
    if (i < 0) continue;
    const to = i + dir;
    if (to < 0 || to >= body.length) return all;
    const nextBody = moveItem(body, i, dir);
    return secs.flatMap((x) => (x === s ? [...head, ...nextBody] : x.blocks));
  }
  return all;
}

/* -- fields, with a human label on them -------------------------------- */

/**
 * One run of a line: either literal text, or a field.
 *
 * `{{ license_number }}` is unreadable to somebody who did not write it, and
 * it is the single most common thing on the page - the UGC contract carries
 * sixteen. Rendered as a pill reading "Media licence number" the same line
 * becomes a sentence with a blank in it, which is what it actually is.
 *
 * The raw braces are still what is STORED and what is edited; this is the
 * reading view only. Two representations of one string is how they come to
 * disagree, so the edit box shows the truth and nothing here ever writes.
 */
export interface DocPart {
  text: string;
  /** Set when this run is a field; the key as stored. */
  field?: string;
  /** The field's registered label, or the key when it has none. */
  label?: string;
  /** True when the key is not in the registry - a typo, or not defined yet. */
  unknown?: boolean;
}

const FIELD_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function inlineParts(
  text: string, labels: Map<string, string> | null | undefined,
): DocPart[] {
  const s = String(text ?? '');
  const out: DocPart[] = [];
  const re = new RegExp(FIELD_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    const key = m[1];
    const label = labels?.get(key);
    out.push({ text: m[0], field: key, label: label || key, unknown: !label });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

/* -- plain words for the things you can add ---------------------------- */

/**
 * What the "+" between two lines offers.
 *
 * FOUR, not seven. `title` is not here because a contract has one and it is
 * already at the top; offering it again invites a second one. `table` and
 * `sig` are not here because they are structural, they exist once, and
 * building one needs the column picker - they stay available from the old
 * add-a-block row for the rare template that needs a second one.
 *
 * The names are what a person would say out loud. "Detail line" is what a kv
 * block is: a label and its value, like a bank row.
 */
export const INSERT_KINDS: { key: string; label: string; hint: string }[] = [
  { key: 'h', label: 'Section heading', hint: 'Starts a new numbered section.' },
  { key: 'p', label: 'Paragraph', hint: 'A normal block of wording.' },
  { key: 'li', label: 'Bullet', hint: 'One item in a list.' },
  { key: 'kv', label: 'Detail line', hint: 'A label and its value, like a bank row.' },
];

/** What a line is called on screen. Plain words, never the stored key. */
export function lineKindLabel(t: string | null | undefined): string {
  switch (String(t ?? '')) {
    case 'title': return 'Title';
    case 'h': return 'Section heading';
    case 'p': return 'Paragraph';
    case 'li': return 'Bullet';
    case 'kv': return 'Detail line';
    case 'table': return 'Table';
    case 'sig': return 'Signatures';
    default: return 'Line';
  }
}

/* -- the two irreversible moments -------------------------------------- */

/**
 * What Publish asks before it freezes anything.
 *
 * The old screen published on one click with the reason for the button's
 * disabled state hidden in a `title=` tooltip. Publishing is permanent - 098
 * makes the blocks immutable - and permanent things get a sentence.
 */
export function publishWarning(version: number, blockCount: number): string {
  const n = Math.max(0, Math.trunc(blockCount));
  return `Publish version ${version}? Its ${n} line${n === 1 ? '' : 's'} freeze`
    + ' and can never be edited again - that is what lets a contract prove what'
    + ' it was issued from. To change the wording later you start a new version.';
}

/**
 * What "Start a new version" asks.
 *
 * This one has already bitten. Somebody opened the UGC template, started a new
 * draft and published it, which took version 3 - and the seed that had been
 * written to land ON version 3 became a permanent no-op that printed a
 * cheerful "already exists" notice. A button that quietly creates a numbered,
 * permanent thing should say so first.
 */
export function newDraftWarning(version: number): string {
  return `Start version ${version + 1}? It copies every line of version ${version}`
    + ' so you can edit the copy. Version ' + version + ' stays exactly as it is,'
    + ' and contracts already made from it are untouched.';
}

/**
 * What "Edit template" asks, from a contract.
 *
 * Siraj: "or edit on the top of the preview to edit any part of the template".
 *
 * The button is on a contract, and everything about what it does next happens
 * somewhere else - which is precisely the sentence people skip and then are
 * surprised by. Three facts, in the order they matter:
 *
 *   1. THIS contract does not change. It is stamped to the version it was
 *      raised on and it keeps it, whatever the template becomes.
 *   2. A published version is frozen (098), so editing the wording means a
 *      NEW version.
 *   3. Only contracts raised after that new version is published use it.
 *
 * Pure. `title` is the template's name when the screen knows it.
 */
export function editTemplateWarning(title?: string | null): string {
  const name = String(title ?? '').trim();
  return `Open ${name || 'the template'} for editing?`
    + ' This contract keeps the version it was made from - editing the template'
    + ' does not change it, or any contract already raised.'
    + ' A published version is frozen, so changing the wording starts a new'
    + ' version, and only contracts made after you publish it will use it.';
}

/**
 * The unknown-field bar, in words rather than a tooltip on a greyed button.
 *
 * Returns '' when there is nothing wrong, so the caller renders nothing.
 */
export function unknownFieldsNote(unknown: string[]): string {
  const ks = (unknown ?? []).filter(Boolean);
  if (ks.length === 0) return '';
  const list = ks.slice(0, 5).join(', ');
  const rest = ks.length > 5 ? `, and ${ks.length - 5} more` : '';
  return `${ks.length} field${ks.length === 1 ? '' : 's'} in the wording `
    + `${ks.length === 1 ? 'is' : 'are'} not defined yet: ${list}${rest}.`
    + ' Add them in Fields, or fix the spelling, before publishing.';
}

/** Why Publish is unavailable, in one sentence, or '' when it is available. */
export function cannotPublish(
  blockCount: number, unknown: string[], editable: boolean,
): string {
  if (!editable) return 'This version is already published.';
  if (Math.trunc(blockCount) <= 0) return 'Add something to the document first.';
  const n = (unknown ?? []).filter(Boolean).length;
  if (n > 0) {
    return `Define the ${n} missing field${n === 1 ? '' : 's'} first - see the note above.`;
  }
  return '';
}
