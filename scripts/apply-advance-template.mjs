#!/usr/bin/env node
/**
 * Bring the vendor contract template up to "Advance INF Contract .docx".
 *
 *   node scripts/apply-advance-template.mjs "<path to the new DOCX>"
 *
 * -- Why this exists rather than just re-running the generator ---------
 *
 * `build-contract-template.mjs` reads a DOCX and writes the whole template.
 * It cannot be used here, because the DOCX Siraj sent is a BLANK form: he
 * typed over the merge fields while producing it, so `{{ license_name }}`,
 * `{{ Amount_full }}`, `{{ bank_name }}` and the rest are gone. Generating
 * from it would ship a contract with no fields in it.
 *
 * So this script does the narrow thing: it takes the NEW wording out of the
 * new DOCX, and the PLACEHOLDERS out of the template already in the repo,
 * and splices them.
 *
 * -- The rule that matters --------------------------------------------
 *
 * NO ARABIC IS TYPED HERE. Every Arabic string either comes out of the new
 * DOCX's own bytes or is carried over unchanged from the existing template.
 * The anchors this script matches on are ASCII or punctuation - the date
 * "10 -09- 2026", the blank amount "(----)(-----)". That is deliberate: the
 * repository is edited through an ASCII-only console, and a hand-retyped
 * Arabic clause is a corrupted contract waiting to happen.
 *
 * -- What changed, and what did not -----------------------------------
 *
 * Nine changes, listed in CHANGES below. Two judgement calls, both flagged
 * on the way past:
 *
 *   * The new DOCX drops the media-licence number from the second party's
 *     line. It is KEPT here. Removing a merge field is destructive and
 *     Siraj cannot put it back from the app; adding one back later is easy.
 *     The new licences clause makes the number more relevant, not less.
 *
 *   * The new DOCX's payment sentence reads "...\u063a\u064a\u0631 \u0634\u0627\u0645\u0644\u0629 \u0627\u0644\u0636\u0631\u064a\u0628\u0629\u060c . \u0648\u0630\u0644\u0643" -
 *     a comma and a full stop together, which is the scar of deleting the
 *     old clause. The orphan stop is dropped.
 *
 * The big one: `{{ duration }}` is GONE from the contract. The old payment
 * clause transferred "within {{ duration }} days after the campaign ends";
 * the new one transfers BEFORE the ad is published. That is what makes this
 * the Advance contract. Nothing else in the template uses `duration`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/contracts/contract-template-ar.js');

/* --- read one entry out of the zip ----------------------------------- */

function unzipEntry(buf, name) {
  const target = Buffer.from(name, 'utf8');
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    let off = buf.readUInt32LE(i + 16);
    const count = buf.readUInt16LE(i + 10);
    for (let n = 0; n < count; n += 1) {
      const nameLen = buf.readUInt16LE(off + 28);
      const extraLen = buf.readUInt16LE(off + 30);
      const commentLen = buf.readUInt16LE(off + 32);
      const local = buf.readUInt32LE(off + 42);
      const entry = buf.subarray(off + 46, off + 46 + nameLen);
      if (entry.equals(target)) {
        const method = buf.readUInt16LE(local + 8);
        const size = buf.readUInt32LE(local + 18);
        const ln = buf.readUInt16LE(local + 26);
        const le = buf.readUInt16LE(local + 28);
        const start = local + 30 + ln + le;
        const raw = buf.subarray(start, start + size);
        return method === 0 ? raw : inflateRawSync(raw);
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
  }
  throw new Error(`${name} is not in this file - is it really a .docx?`);
}

/* --- the new document's paragraphs, in order ------------------------- */

const ws = (s) => String(s).replace(/[\s\u00a0]+/g, ' ').trim();

function paragraphs(xml) {
  const body = xml.slice(xml.indexOf('<w:body>'));
  const out = [];
  for (const m of body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const t = ws([...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join(''));
    if (t) out.push(t);
  }
  return out;
}

/* --- the changes ------------------------------------------------------ */

/**
 * Each entry names the block being replaced, the paragraph of the new DOCX
 * its wording comes from, and any splices that put the merge fields back.
 *
 * `block` is the index AFTER the new clause has been inserted, which is why
 * the insert runs first. `was` is asserted against the block currently in the repo. If it does not
 * match, the template has moved underneath this script and nothing is
 * written - the same reasoning as an anchored patch.
 */
const CHANGES = [
  {
    block: 1,
    para: 0,
    // "agreement" becomes "contract" throughout; this is the title.
    was: /\u0627\u062a\u0641\u0627\u0642\u064a\u0629 \u062a\u0633\u0648\u064a\u0642/,
    want: /\u0639\u0642\u062f \u062a\u0633\u0648\u064a\u0642/,
  },
  {
    block: 3,
    para: 2,
    // He filled the date in before sending it, so put the fields back. Both
    // anchors are digits and brackets - no Arabic is matched or typed.
    splice: [
      [/\s*10\s*[\u2013\u2014-]\s*09\s*[\u2013\u2014-]\s*2026\s*/, ' {{ date }} '],
      [/\([^()]*\)(?=\s*\u062d\u0631\u0631)/, '{{ day }}'],
    ],
    was: /\{\{ date \}\}/,
    want: /\{\{ date \}\}[\s\S]*\{\{ day \}\}/,
  },
  { block: 7, para: 6, was: /\u0627\u0644\u0627\u062a\u0641\u0627\u0642\u064a\u0629/, want: /\u0627\u0644\u0639\u0642\u062f/ },
  {
    block: 13,
    para: 15,
    // The blank amount he typed over, and the orphan full stop left behind
    // by deleting the old "within N days" clause.
    splice: [
      [/\(-+\)\(-+\)\s*\u0631\u064a\u0627\u0644 \u0633\u0639\u0648\u062f\u064a/, '{{ Amount_full }}'],
      [/\u060c\s*\.\s*/, '\u060c '],
    ],
    was: /\{\{ duration \}\}/,
    want: /^(?!.*\{\{ duration \}\}).*\{\{ Amount_full \}\}/s,
  },
  { block: 15, para: 17, was: /:$/, want: /:$/ },
  { block: 31, para: 33, was: /:$/, want: /:$/ },
  { block: 39, para: 41, was: /\.$/, want: /\.$/ },
];

/** The one genuinely new clause: inserted into section 4, after the first. */
const INSERT = { after: 21, para: 24, type: 'li' };

/* --- render, byte-identical to build-contract-template.mjs ------------ */

function render(json, sha256) {
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const chunks = (b64.match(/.{1,100}/g) || []).map((c) => `    "${c}"`).join(',\n');
  const head = readFileSync(OUT, 'utf8');
  const preamble = head.slice(0, head.indexOf('(function (root) {'));
  const tail = head.slice(head.indexOf('  function decodeBase64(b64) {'));
  return `${preamble}(function (root) {\n  "use strict";\n\n  var SHA256 = "${sha256}";\n\n  var CHUNKS = [\n${chunks}\n  ];\n\n${tail}`;
}

/* --- main ------------------------------------------------------------- */

function main() {
  const src = process.argv[2];
  if (!src) throw new Error('usage: node scripts/apply-advance-template.mjs <new .docx>');

  const req = createRequire(import.meta.url);
  delete req.cache?.[req.resolve(OUT)];
  const mod = req(OUT);
  if (createHash('sha256').update(mod.json, 'utf8').digest('hex') !== mod.sha256) {
    throw new Error('the template in the repo does not hash to its own SHA256 - refusing to build on it');
  }
  const tpl = JSON.parse(mod.json);
  const blocks = tpl.blocks;

  const paras = paragraphs(unzipEntry(readFileSync(resolve(src)), 'word/document.xml').toString('utf8'));
  console.log(`new docx: ${paras.length} paragraphs`);

  let applied = 0;

  // The new clause. Inserted, not replaced, so it is checked separately:
  // it must not already be there, or a re-run would add a second copy.
  const clause = paras[INSERT.para];
  if (!clause) throw new Error(`paragraph ${INSERT.para} is missing from the new docx`);
  if (blocks.some((b) => b.v === clause)) {
    console.log('  the licences clause is already in the template');
  } else {
    blocks.splice(INSERT.after + 1, 0, { t: INSERT.type, v: clause });
    applied += 1;
  }


  for (const c of CHANGES) {
    const b = blocks[c.block];
    if (!b || typeof b.v !== 'string') throw new Error(`block ${c.block} is not a text block`);
    let next = paras[c.para];
    if (!next) throw new Error(`paragraph ${c.para} is missing from the new docx`);
    for (const [re, to] of c.splice ?? []) {
      if (!re.test(next)) throw new Error(`block ${c.block}: splice ${re} matched nothing`);
      next = ws(next.replace(re, to));
    }
    if (!c.want.test(next)) {
      throw new Error(`block ${c.block}: the result does not satisfy ${c.want} - nothing written`);
    }
    // Idempotent: a second run is a no-op, not a failure. The `was` guard is
    // only meaningful while the block is still the one being replaced.
    if (next === b.v) { console.log(`  block ${c.block}: already current`); continue; }
    if (!c.was.test(b.v)) {
      throw new Error(`block ${c.block} is neither the old text nor the new one - nothing written`);
    }
    b.v = next;
    applied += 1;
  }

  const json = JSON.stringify(tpl);
  const sha256 = createHash('sha256').update(json, 'utf8').digest('hex');
  writeFileSync(OUT, render(json, sha256), 'utf8');

  const keys = new Set([...json.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
  console.log(`applied ${applied} change(s)`);
  console.log(`  ${blocks.length} blocks`);
  console.log(`  ${keys.size} placeholders: ${[...keys].sort().join(', ')}`);
  console.log(`  sha256 ${sha256}`);
}

main();
