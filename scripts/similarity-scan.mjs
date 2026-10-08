/**
 * Measures how much of `src/` is shared, line for line, with the reference project.
 *
 * Why this exists: the first pass only compared the three modules whose comments
 * named a reference file. That established "low overlap" for those three and
 * nothing else — the reference has ~300 TypeScript files and so do we. "I
 * believe the rest is independent" is not a measurement, so this is.
 *
 * How it works:
 *   - strip comments, collapse whitespace, drop trailing semicolons, so the two
 *     projects' formatting differences (they omit semicolons, we do not) do not
 *     hide real matches;
 *   - drop lines longer-than-nothing but shorter than 12 chars as noise;
 *   - drop lines that appear across MANY reference files — `}`, `return null;`
 *     and friends are not evidence of anything;
 *   - for every one of our files, find the reference file it shares the most
 *     with, in both directions.
 *
 * Usage: node scripts/similarity-scan.mjs [--min-shared N] [--quiet]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REFERENCE =
  process.env.REFERENCE_PROJECT ?? path.resolve(root, "..", "llm_wiki-main", "src");

const MIN_LINE_LENGTH = 12;
/** A line living in more reference files than this is boilerplate, not evidence. */
const BOILERPLATE_DOC_FREQUENCY = 5;

const args = process.argv.slice(2);
const minShared = Number(
  args.includes("--min-shared") ? args[args.indexOf("--min-shared") + 1] : 5,
);
const quiet = args.includes("--quiet");

function collect(dir, extensions) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      found.push(...collect(full, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

const normalize = (line) =>
  line
    .replace(/\/\/.*$/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;$/, "");

function distinctiveLines(file) {
  return [
    ...new Set(
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map(normalize)
        .filter((line) => line.length >= MIN_LINE_LENGTH),
    ),
  ];
}

if (!fs.existsSync(REFERENCE)) {
  console.error(`Reference project not found at ${REFERENCE}\nSet REFERENCE_PROJECT.`);
  process.exit(1);
}

const referenceFiles = collect(REFERENCE, [".ts", ".tsx"]);
const ourFiles = collect(path.join(root, "src"), [".ts"]);

// How many reference files each line lives in — the boilerplate filter.
const documentFrequency = new Map();
const referenceSets = new Map();
for (const file of referenceFiles) {
  const lines = distinctiveLines(file);
  referenceSets.set(file, new Set(lines));
  for (const line of lines) {
    documentFrequency.set(line, (documentFrequency.get(line) ?? 0) + 1);
  }
}
const isDistinctive = (line) =>
  (documentFrequency.get(line) ?? 0) <= BOILERPLATE_DOC_FREQUENCY;

console.log(`reference: ${referenceFiles.length} files under ${REFERENCE}`);
console.log(`ours:      ${ourFiles.length} files under src/`);
console.log(
  `lines >= ${MIN_LINE_LENGTH} chars, appearing in <= ${BOILERPLATE_DOC_FREQUENCY} reference files\n`,
);

const results = [];
for (const ours of ourFiles) {
  const ourLines = distinctiveLines(ours).filter(isDistinctive);
  if (ourLines.length === 0) continue;

  let best = null;
  for (const reference of referenceFiles) {
    const set = referenceSets.get(reference);
    const shared = ourLines.filter((line) => set.has(line));
    const referenceDistinctive = [...set].filter(isDistinctive);
    const back = referenceDistinctive.filter((line) => ourLines.includes(line));
    if (shared.length === 0) continue;
    if (!best || shared.length > best.shared.length) {
      best = { reference, shared, referenceDistinctive: referenceDistinctive.length, back: back.length };
    }
  }
  if (!best) continue;
  results.push({
    ours: path.relative(root, ours).replace(/\\/g, "/"),
    ourDistinctive: ourLines.length,
    reference: path.relative(REFERENCE, best.reference).replace(/\\/g, "/"),
    shared: best.shared.length,
    ourPercent: (best.shared.length / ourLines.length) * 100,
    referenceDistinctive: best.referenceDistinctive,
    referencePercent:
      best.referenceDistinctive > 0 ? (best.back / best.referenceDistinctive) * 100 : 0,
    samples: best.shared,
  });
}

results.sort((a, b) => b.shared - a.shared);
const reportable = results.filter((result) => result.shared >= minShared);

console.log(
  `${results.length} of our files share ANY distinctive line with the reference; ` +
    `${reportable.length} share >= ${minShared}.\n`,
);

if (reportable.length === 0) {
  console.log(`Nothing reaches the threshold — no file pair is worth a closer look.`);
} else {
  console.log("ours".padEnd(42) + "best reference match".padEnd(40) + "shared   of ours   of theirs");
  console.log("-".repeat(112));
  for (const result of reportable) {
    console.log(
      result.ours.padEnd(42) +
        result.reference.padEnd(40) +
        String(result.shared).padStart(5) +
        `${result.ourPercent.toFixed(1)}%`.padStart(10) +
        `${result.referencePercent.toFixed(1)}%`.padStart(11),
    );
  }

  if (!quiet) {
    console.log("");
    for (const result of reportable.slice(0, 5)) {
      console.log(`--- ${result.ours}  ↔  ${result.reference}`);
      for (const line of result.samples.slice(0, 8)) {
        console.log(`      ${line.slice(0, 100)}`);
      }
    }
  }
}
