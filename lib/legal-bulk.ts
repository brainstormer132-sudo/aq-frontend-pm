/**
 * Printing a stack of contracts at once, and choosing which ones.
 *
 * Siraj: "work on getting all pdfs at once also instead of going one by one".
 *
 * -- WHAT THIS IS AND IS NOT ---------------------------------------
 *
 * It is NOT a second renderer. Every sheet in a batch comes out of
 * `contractSheetHtml` in lib/legal - the same function the fill screen's
 * Print button uses - and the suite asserts that a batch of one is byte for
 * byte the document that printing that contract on its own produces. The
 * moment there are two renderers, a letterhead fix lands on one of them and
 * nobody finds out until a vendor is holding the other.
 *
 * What lives here is everything AROUND that: which contracts were picked,
 * which of them can actually be printed, and how to say what was left out.
 *
 * -- WHY A CONTRACT CAN BE LEFT OUT --------------------------------
 *
 * A contract is stamped to a template VERSION, and the wording is that
 * version's blocks. If the version has no blocks - it was never published
 * with any, or the template was rebuilt around it - then the contract has no
 * body to print. That is one blank page with a letterhead on it, handed to
 * somebody as an agreement. So it is skipped and SAID, with a count and the
 * first few names, rather than printed empty.
 *
 * Pure: no React, no Supabase, no argless `new Date()`. The caller passes the
 * rows and the date.
 */

import {
  type Dir, type TemplateBlock, type PrintDoc, type PrintMeta,
  detectDir, visibleBlocks, parseOffIds, formatFingerprint, printReference,
  contractStatusLabel, kindLabel, FINGERPRINT_KEY, OPT_OFF_KEY,
} from './legal';
import type { Letterhead } from './legal-letterhead';

// Relative, not '@/lib/legal': scripts/run-tests.mjs compiles these with bare
// tsc and no tsconfig, so the path alias does not exist there. A '@/' import
// in a file on that list fails the whole suite with "cannot find module".

/** A contract as the register knows it - enough to print it and to find it. */
export interface PrintContract {
  id: string;
  version_id: string;
  title?: string | null;
  status?: string | null;
  contract_no?: string | null;
  template_name?: string | null;
  doc_kind?: string | null;
}

/** One field value row, as legal.contract_field stores it. */
export interface FieldRow {
  contract_id: string;
  key: string;
  value?: string | null;
}

/** A contract that could not be printed, and why, in words for the screen. */
export interface SkippedContract {
  id: string;
  title: string;
  why: string;
}

export interface PrintBuild {
  docs: PrintDoc[];
  skipped: SkippedContract[];
}

/** Split a list into fixed-size pieces. A read that puts four thousand ids in
 *  a URL does not fail cleanly - it 414s, or the proxy truncates it - so every
 *  `.in(...)` over a selection goes through here. */
export function chunk<T>(list: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < (list ?? []).length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** The distinct version ids the selected contracts are stamped to, so the
 *  blocks are read once per VERSION rather than once per contract. Fifty
 *  contracts off one template is one read, not fifty. */
export function versionIdsOf(contracts: PrintContract[]): string[] {
  const seen = new Set<string>();
  for (const c of contracts ?? []) {
    const v = String(c?.version_id ?? '').trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

/** Field rows folded into one map per contract, the shape the printer wants. */
export function valuesByContract(rows: FieldRow[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const r of rows ?? []) {
    const id = String(r?.contract_id ?? '');
    if (!id) continue;
    if (!out[id]) out[id] = {};
    out[id][String(r.key)] = r.value ?? '';
  }
  return out;
}

/**
 * Blocks folded by version and put back in position order.
 *
 * Sorted here rather than trusted from the read: the blocks arrive from a
 * paged `.in(version_id, ...)`, so rows for one version can straddle two
 * pages and come back interleaved with another version's. Printing them in
 * arrival order would silently reorder the clauses of an agreement.
 */
export function blocksByVersion(rows: TemplateBlock[]): Record<string, TemplateBlock[]> {
  const out: Record<string, TemplateBlock[]> = {};
  for (const b of rows ?? []) {
    const v = String((b as { version_id?: string })?.version_id ?? '');
    if (!v) continue;
    (out[v] ||= []).push(b);
  }
  for (const v of Object.keys(out)) {
    out[v] = out[v].slice().sort((a, b) => {
      const d = (a.position ?? 0) - (b.position ?? 0);
      return d !== 0 ? d : String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
  }
  return out;
}

/**
 * Turn the raw rows into printable documents, in the order the contracts were
 * given. Each one is built exactly the way the fill screen builds its own:
 * the version's blocks minus the optional clauses this contract turned off,
 * its saved values, its direction, its number and its fingerprint.
 */
export function buildPrintDocs(input: {
  contracts: PrintContract[];
  blocks: TemplateBlock[];
  fields: FieldRow[];
  letterhead?: Letterhead;
  generatedOn?: string;
}): PrintBuild {
  const byVersion = blocksByVersion(input.blocks ?? []);
  const byContract = valuesByContract(input.fields ?? []);
  const docs: PrintDoc[] = [];
  const skipped: SkippedContract[] = [];

  for (const c of input.contracts ?? []) {
    const name = String(c?.title ?? '').trim() || '(untitled)';
    const all = byVersion[String(c?.version_id ?? '')] ?? [];
    if (!all.length) {
      skipped.push({ id: c.id, title: name, why: 'its template version has no content' });
      continue;
    }
    const values = byContract[c.id] ?? {};
    // The optional clauses this contract switched off. Printing a clause the
    // operator removed is worse than printing nothing: it is a term in a
    // signed agreement that nobody agreed to.
    const visible = visibleBlocks(all, parseOffIds(values[OPT_OFF_KEY]));
    if (!visible.length) {
      skipped.push({ id: c.id, title: name, why: 'every clause in it is switched off' });
      continue;
    }
    const fp = values[FINGERPRINT_KEY] || '';
    const meta: PrintMeta = {
      org: 'AQ Creativity',
      status: String(c?.status ?? ''),
      reference: printReference(c),
      fingerprint: fp ? formatFingerprint(fp) : undefined,
    };
    if (input.generatedOn) meta.generatedOn = input.generatedOn;
    if (input.letterhead) meta.letterhead = input.letterhead;
    docs.push({
      title: name,
      blocks: visible,
      values,
      // Direction is read from ALL the version's blocks, not the visible ones.
      // An Arabic contract whose only optional clause is switched off is still
      // an Arabic contract, and deciding otherwise would flip a document's
      // whole layout on a tick box.
      dir: detectDir(all) as Dir,
      meta,
    });
  }
  return { docs, skipped };
}

/**
 * One line for what was left out: the count, then the first few by name.
 *
 * "Group before you cap" - five hundred contracts on a version with no blocks
 * is one fact, not five hundred rows of screen. Null when nothing was left
 * out, so the caller has nothing to render.
 */
export function skippedNote(skipped: SkippedContract[], show = 3): string | null {
  const list = skipped ?? [];
  if (!list.length) return null;
  const head = list.slice(0, Math.max(1, show)).map((s) => s.title);
  const rest = list.length - head.length;
  const names = head.join(', ') + (rest > 0 ? `, and ${rest} more` : '');
  const why = list.every((s) => s.why === list[0].why) ? ` - ${list[0].why}` : '';
  return list.length === 1
    ? `${names} was left out${why}.`
    : `${list.length} contracts were left out (${names})${why}.`;
}

/**
 * Narrow the register to what was typed and the status that was chosen.
 *
 * Matches the contract's number, its title, its template's name and its KIND
 * AND STATUS AS LABELLED - typing "influencer" or "issued" has to find what
 * the screen calls influencer and issued, not the keys `vendor_contract` and
 * a status nobody sees. The same rule as searchMatters in legal-matters.
 */
export function filterContracts<T extends PrintContract>(
  rows: T[], query: string, status: string,
): T[] {
  const q = String(query ?? '').trim().toLowerCase();
  const st = String(status ?? '').trim().toLowerCase();
  return (rows ?? []).filter((r) => {
    if (st && String(r?.status ?? '').toLowerCase() !== st) return false;
    if (!q) return true;
    const hay = [
      r?.contract_no ?? '', r?.title ?? '', r?.template_name ?? '',
      kindLabel(String(r?.doc_kind ?? '')), contractStatusLabel(r?.status),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** Add or remove one id, keeping the rest in order. */
export function toggleId(ids: string[], id: string): string[] {
  const cur = ids ?? [];
  return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
}

/**
 * The selection, in the order the rows are on screen.
 *
 * The tick boxes remember the order they were TICKED in, which is not the
 * order anybody expects a printed stack to be in. Ordering by the list means
 * the PDF comes out in the order of the register he is looking at.
 */
export function selectedInOrder<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const want = new Set(ids ?? []);
  return (rows ?? []).filter((r) => want.has(r.id));
}

/**
 * How many contracts is too many to throw at one print dialog.
 *
 * Not a cap - refusing to print what he asked for is not help. It is a number
 * to warn on: the browser lays out every page of the batch before the dialog
 * opens, and a hundred contracts is several hundred pages of that. Null when
 * there is nothing worth saying.
 */
export const BULK_PRINT_WARN_AT = 40;

export function bulkPrintNote(n: number): string | null {
  if (n < BULK_PRINT_WARN_AT) return null;
  return `${n} contracts is a big print - the page may sit still for a few seconds `
    + 'while the browser lays them all out before the dialog opens.';
}
