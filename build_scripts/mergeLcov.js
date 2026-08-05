// Merge multiple lcov.info reports into one by unioning per-file coverage.
//
// Why this exists: CI produces coverage in several pieces (the unit suite, a
// source-mapped startup-provisioning supplement, and N integration shards).
// Uploading those pieces to Codecov separately and letting Codecov stitch them
// together under flags loses real coverage — a line covered by one shard but
// "not covered" (0) in the others does not reliably come out as covered in
// Codecov's cross-upload/flag combination, and mismatched file lists inflate the
// denominator. Merging here first — a line covered by ANY report counts as
// covered — reproduces the single-process `coverage:merged` number, which we
// then upload to Codecov as ONE report.
//
// Usage: node build_scripts/mergeLcov.js --dir <artifacts-dir> --out <file>
//   Recursively finds every lcov.info under <artifacts-dir> and writes the
//   merged report to <out>.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dir = getArg("--dir", "coverage-artifacts");
const out = getArg("--out", "coverage/merged.lcov");

// Recursively collect every lcov.info under `dir`.
function findLcov(root) {
  const found = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "lcov.info" || e.name.endsWith(".lcov")) found.push(p);
    }
  };
  walk(root);
  return found;
}

// Per file: line hits, function hits, branch hits — each unioned by max.
// value `-` (branch not evaluated) is kept only until a numeric value appears.
function makeRecord() {
  return { da: new Map(), fn: new Map(), fnda: new Map(), brda: new Map() };
}
const files = new Map();
const recordFor = (sf) => {
  if (!files.has(sf)) files.set(sf, makeRecord());
  return files.get(sf);
};

const maxHit = (prev, next) => (prev === undefined ? next : Math.max(prev, next));
const mergeBranch = (prev, tokenIsDash, value) => {
  if (prev === undefined) return tokenIsDash ? "-" : value;
  if (prev === "-") return tokenIsDash ? "-" : value;
  return tokenIsDash ? prev : Math.max(prev, value);
};

const inputs = findLcov(dir);
for (const input of inputs) {
  const text = fs.readFileSync(input, "utf8");
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("SF:")) {
      cur = recordFor(line.slice(3));
    } else if (!cur) {
      continue;
    } else if (line.startsWith("DA:")) {
      const [ln, cnt] = line.slice(3).split(",");
      cur.da.set(Number(ln), maxHit(cur.da.get(Number(ln)), Number(cnt)));
    } else if (line.startsWith("FN:")) {
      const idx = line.indexOf(",");
      cur.fn.set(line.slice(idx + 1), Number(line.slice(3, idx)));
    } else if (line.startsWith("FNDA:")) {
      const idx = line.indexOf(",");
      const name = line.slice(idx + 1);
      cur.fnda.set(name, maxHit(cur.fnda.get(name), Number(line.slice(5, idx))));
    } else if (line.startsWith("BRDA:")) {
      const parts = line.slice(5).split(",");
      const key = parts.slice(0, 3).join(",");
      const isDash = parts[3] === "-";
      cur.brda.set(key, mergeBranch(cur.brda.get(key), isDash, Number(parts[3])));
    } else if (line === "end_of_record") {
      cur = null;
    }
  }
}

const outLines = [];
for (const [sf, d] of files) {
  outLines.push("TN:");
  outLines.push(`SF:${sf}`);
  for (const [name, ln] of d.fn) outLines.push(`FN:${ln},${name}`);
  for (const [name, c] of d.fnda) outLines.push(`FNDA:${c},${name}`);
  outLines.push(`FNF:${d.fn.size}`);
  outLines.push(`FNH:${[...d.fnda.values()].filter((c) => c > 0).length}`);
  for (const [key, v] of d.brda) outLines.push(`BRDA:${key},${v === "-" ? "-" : v}`);
  outLines.push(`BRF:${d.brda.size}`);
  outLines.push(`BRH:${[...d.brda.values()].filter((v) => v !== "-" && v > 0).length}`);
  for (const ln of [...d.da.keys()].sort((a, b) => a - b)) {
    outLines.push(`DA:${ln},${d.da.get(ln)}`);
  }
  outLines.push(`LF:${d.da.size}`);
  outLines.push(`LH:${[...d.da.values()].filter((c) => c > 0).length}`);
  outLines.push("end_of_record");
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, outLines.join("\n") + "\n");

const totalLines = [...files.values()].reduce((n, d) => n + d.da.size, 0);
const hitLines = [...files.values()].reduce(
  (n, d) => n + [...d.da.values()].filter((c) => c > 0).length,
  0
);
console.log(
  `Merged ${inputs.length} lcov file(s) from ${dir} -> ${out}: ` +
    `${files.size} source files, ${hitLines}/${totalLines} lines covered ` +
    `(${totalLines ? ((hitLines / totalLines) * 100).toFixed(2) : "0"}%)`
);
if (inputs.length === 0) {
  console.error(`WARNING: no lcov files found under ${dir}`);
}
