#!/usr/bin/env node
/**
 * Turn the vendor contract DOCX into public/contracts/contract-template-ar.js.
 *
 *   node scripts/build-contract-template.mjs "C:\\path\\Rawad altathir UGC .docx"
 *
 * -- Why a generator ---------------------------------------------------
 *
 * The contract app's Preview draws the agreement itself, which means the
 * app needs the template's text. Two ways to get it there: paste the text
 * into a source file, or read it out of the DOCX. The text is Arabic and
 * this repository is edited through an ASCII-only console, so the first
 * way means hand-copying thousands of escaped characters - which is a
 * corrupted contract waiting to happen. This way nothing is retyped: the
 * bytes come from the file Word wrote.
 *
 * Re-run it whenever the DOCX changes, then commit the generated file.
 *
 * -- What it emits -----------------------------------------------------
 *
 * A JSON document of blocks - the paragraphs, the services table and the
 * signature row, with every {{ placeholder }} left exactly where Word has
 * it - base64'd into a plain <script> that also exports for the tests.
 * Base64 rather than raw UTF-8 because the generated file is passed
 * through the same ASCII console when it is delivered.
 *
 * Nothing here talks to the network or to the app; it reads one file and
 * writes one file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/contracts/contract-template-ar.js');

/* --- The DOCX is a zip; read one entry out of it --------------------- */

function unzipEntry(buf, wanted) {
  // Walk the central directory from the End Of Central Directory record.
  // Enough of the format to find one stored-or-deflated file, and no more.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad local header');
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compressedSize);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} is not in this file - is it really a .docx?`);
}

/* --- Word's XML, without an XML library ------------------------------ */
//
// docProps and styles are irrelevant here; all we need is the body's
// paragraphs and tables in order, each with its text and the two bits of
// formatting the classifier uses (centred, and how far it is indented).

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

const textOf = (xml) => {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out += unescapeXml(m[1]);
  return out;
};

function paragraph(xml) {
  const props = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml);
  const pPr = props ? props[0] : '';
  const jc = /<w:jc\s+w:val="([^"]+)"/.exec(pPr);
  const ind = /<w:ind\b[^>]*w:left="(-?\d+)"/.exec(pPr);
  const raw = textOf(xml).replace(/[\r\n\t]+/g, ' ').trim();
  return {
    // `raw` keeps its runs of spaces: the signature line is two labels
    // separated by a wide gap, and collapsing first loses the only thing
    // that tells them apart.
    raw,
    text: raw.replace(/\s+/g, ' ').trim(),
    center: Boolean(jc && jc[1] === 'center'),
    indent: ind ? Number(ind[1]) : 0,
  };
}

function bodyItems(documentXml) {
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml);
  if (!body) throw new Error('no <w:body> in document.xml');
  const items = [];
  // Top level only: a <w:p> inside a table cell must not be read twice, so
  // tables are consumed whole before paragraphs are looked for.
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(body[1])) !== null) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl')) {
      const rows = [];
      const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let r;
      while ((r = rowRe.exec(chunk)) !== null) {
        const cells = [];
        const cellRe = /<w:tc>[\s\S]*?<\/w:tc>/g;
        let c;
        while ((c = cellRe.exec(r[0])) !== null) cells.push(textOf(c[0]).replace(/\s+/g, ' ').trim());
        rows.push(cells);
      }
      items.push({ kind: 'table', rows });
    } else {
      items.push({ kind: 'p', ...paragraph(chunk) });
    }
  }
  return items;
}

/* --- Which kind of block each paragraph is --------------------------- */
//
// Arabic literals are written as escapes on purpose: this file is pasted
// through an ASCII console like everything else here.

const ORDINALS = ["\u0623\u0648\u0644", "\u062b\u0627\u0646", "\u062b\u0627\u0644\u062b",
  "\u0631\u0627\u0628\u0639", "\u062e\u0627\u0645\u0633", "\u0633\u0627\u062f\u0633",
  "\u0633\u0627\u0628\u0639"];

const STRINGS = {
  missing: "\u063a\u064a\u0631 \u0645\u062f\u062e\u0644",
  pending: "\u064a\u064f\u0636\u0627\u0641 \u0639\u0646\u062f \u0627\u0644\u0625\u0646\u0634\u0627\u0621",
  riyal: "\u0631\u064a\u0627\u0644 \u0633\u0639\u0648\u062f\u064a",
  days: "\u064a\u0648\u0645",
};

const isHeading = (t) => ORDINALS.some((word) => t.startsWith(word)) && t.includes(':');
const isBullet = (t) => t.startsWith('-');
const isRule = (t) => /^_{6,}/.test(t.replace(/\s/g, ''));
// "Bank : {{ bank_name }}" and the refund account block: a short label, a
// colon, a value. Long sentences that happen to contain a colon are not.
const isKeyValue = (t, indent) => t.length < 60
  && /^[^:]{1,20}:/.test(t)
  && (indent >= 500 || t.includes('{{'));
// The signing row: two short labels held apart by a run of spaces, one per
// party. Both halves have to be real - a bullet also splits in two.
const isSignatureRow = (raw) => {
  const parts = String(raw || '').split(/\s{3,}/).filter(Boolean);
  return parts.length === 2 && parts.every((half) => half.trim().length >= 3 && half.length <= 60);
};

function classify(items) {
  const blocks = [];
  let seenTitle = false;
  let idDone = false;
  for (const item of items) {
    if (item.kind === 'table') {
      if (item.rows.length) blocks.push({ t: 'table', rows: item.rows });
      continue;
    }
    const t = item.text;
    if (!t) continue;
    if (!idDone && t.includes('{{') && /\{\{\s*id\s*\}\}/.test(t)) {
      blocks.push({ t: 'id', v: t });
      idDone = true;
    } else if (isRule(t)) {
      // The typed underscores under the signatures. The preview draws its
      // own rules, so the characters are dropped rather than printed.
      continue;
    } else if (item.center && !seenTitle) {
      blocks.push({ t: 'title', v: t });
      seenTitle = true;
    } else if (isBullet(t)) {
      // Before the signature test: a bullet is "-" and a wide gap and then
      // the text, which otherwise reads as two columns.
      blocks.push({ t: 'li', v: t });
    } else if (isSignatureRow(item.raw)) {
      const [right, left] = item.raw.split(/\s{3,}/).filter(Boolean);
      blocks.push({ t: 'sig', right: right.trim(), left: left.trim() });
    } else if (item.center) {
      blocks.push({ t: 'center', v: t });
    } else if (isHeading(t)) {
      blocks.push({ t: 'h', v: t });
    } else if (isKeyValue(t, item.indent)) {
      blocks.push({ t: 'kv', v: t });
    } else {
      blocks.push({ t: 'p', v: t });
    }
  }
  return blocks;
}

/* --- Emit ------------------------------------------------------------ */

function render(json, sha256) {
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const chunks = (b64.match(/.{1,96}/g) || []).map((c) => `    "${c}",`).join('\n');
  return `/**
 * The vendor contract template, as data. GENERATED - do not hand-edit.
 *
 *   node scripts/build-contract-template.mjs "<path to the DOCX>"
 *
 * This is the text of the vendor agreement broken into blocks, with the
 * {{ placeholders }} left exactly where Word has them. The contract app's
 * Preview fills them from the subtask form and draws the result, so what
 * you see on screen is the document rather than a summary of it.
 *
 * The body is Arabic and this repository is edited through an ASCII-only
 * console, so the JSON is base64 here and decoded at load. To read it:
 *
 *   node -e "const t=require('./public/contracts/contract-template-ar.js'); console.log(JSON.stringify(t.template,null,2))"
 *
 * tests/cpv.test.mjs hashes the decoded JSON against SHA256 below, so a
 * truncated paste fails loudly instead of shipping half a contract.
 *
 * What this is NOT: the file that gets generated. That one is rendered by
 * aq-backend from the DOCX in template storage, which an admin can replace
 * from the Templates screen without this file knowing - which is why the
 * preview names the template on screen and says so. The durable fix is a
 * /api/contracts/preview route on the backend; until then, re-run the
 * generator whenever the DOCX changes.
 */

(function (root) {
  "use strict";

  var SHA256 = "${sha256}";

  var CHUNKS = [
${chunks}
  ];

  function decodeBase64(b64) {
    if (typeof atob === "function") {
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }
    return Buffer.from(b64, "base64").toString("utf8");
  }

  var json = decodeBase64(CHUNKS.join(""));
  var template = JSON.parse(json);
  template.sha256 = SHA256;

  var api = { template: template, json: json, sha256: SHA256 };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AQContractTemplateAr = api;
})(typeof window !== "undefined" ? window : null);
`;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node scripts/build-contract-template.mjs "<path to the DOCX>"');
    process.exit(1);
  }
  // The label is what the preview prints above the page ("Wording from
  // the X vendor template"), so it defaults to the file's own name -
  // wrong-file mistakes then announce themselves on screen. The key is
  // the app's contract_type and is left blank unless given: claiming a
  // type this file may not be would put a red warning on every preview.
  const key = process.argv[3] || '';
  const label = process.argv[4]
    || basename(path).replace(/\.docx$/i, '').replace(/\s+/g, ' ').trim();

  const buf = readFileSync(resolve(path));
  const documentXml = unzipEntry(buf, 'word/document.xml').toString('utf8');
  const blocks = classify(bodyItems(documentXml));

  const placeholders = new Set();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let m;
  const all = JSON.stringify(blocks);
  while ((m = re.exec(all)) !== null) placeholders.add(m[1]);

  // A template the preview cannot fill is worse than no preview, so the
  // things the app knows how to supply must actually be in the file.
  for (const required of ['license_name', 'brand_name', 'Amount_full', 'iban']) {
    if (!placeholders.has(required)) {
      throw new Error(`{{ ${required} }} is not in this DOCX - wrong file, or the template changed shape`);
    }
  }

  const json = JSON.stringify({ key, label, blocks, strings: STRINGS });
  const sha256 = createHash('sha256').update(json, 'utf8').digest('hex');
  writeFileSync(OUT, render(json, sha256), 'utf8');

  const kinds = blocks.reduce((acc, b) => { acc[b.t] = (acc[b.t] || 0) + 1; return acc; }, {});
  console.log(`wrote ${OUT}`);
  console.log(`  ${blocks.length} blocks:`, Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', '));
  console.log(`  ${placeholders.size} placeholders:`, [...placeholders].sort().join(', '));
  console.log(`  label   ${label}${key ? ` (contract type ${key})` : ''}`);
  console.log(`  sha256 ${sha256}`);
}

main();
