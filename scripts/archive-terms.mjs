/**
 * Archives the Obsidian legal pages this plugin's design decisions rest on, and
 * reports whether any of them has changed since the last snapshot.
 *
 * Why this exists: the reverse-engineering carve-out that makes it legitimate to
 * read Obsidian's undocumented internals lives in its Terms of Service, and the
 * terms say they may be amended at any time — with notice by email **only to
 * people who have an account**. Downloading and using Obsidian needs no account,
 * so the terms you relied on can change without you ever being told. A dated
 * copy is the only way to show what you actually relied on.
 *
 * This script only ARCHIVES. It does not interpret, summarise, or decide
 * anything — reading these documents correctly is a lawyer's job, and the
 * clause wording here is ambiguous enough (the ToS still contains a stale
 * "Personal Use" paragraph that contradicts the current commercial-use one)
 * that a summary would do more harm than good.
 *
 * Usage: npm run archive:terms
 *
 * Not part of `npm run verify`: it needs the network, and a verification run
 * should be offline and deterministic.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(root, "docs", "legal-snapshots");

const SOURCES = [
  { name: "obsidian-terms", url: "https://obsidian.md/terms", title: "Obsidian Terms of Service" },
  { name: "obsidian-license", url: "https://obsidian.md/license", title: "Obsidian License Overview" },
  { name: "obsidian-brand", url: "https://obsidian.md/brand", title: "Obsidian Brand Guidelines" },
];

/** UTC date, so two people archiving the same day produce the same filename. */
const today = new Date().toISOString().slice(0, 10);

/**
 * The page's readable text, with the chrome (nav, footer, language list) gone.
 *
 * The main content sits in `<article>` on these pages; falling back to the whole
 * body keeps the script working if that changes, at the cost of a noisier
 * snapshot — a noisy snapshot is still better than a silent failure.
 */
function extract(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  for (const selector of ["script", "style", "nav", "footer", "header"]) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }
  const main = document.querySelector("article") ?? document.body;
  return (main?.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** The site's own "Last updated …" line, which is the date that matters. */
function declaredDate(text) {
  const match = /Last updated\s+([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(text);
  return match ? match[1] : "(not found)";
}

const digest = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

function previousSnapshot(name) {
  if (!fs.existsSync(OUT_DIR)) return null;
  const candidates = fs
    .readdirSync(OUT_DIR)
    .filter((file) => file.startsWith(`${name}-`) && file.endsWith(".md"))
    .sort();
  if (candidates.length === 0) return null;
  const file = path.join(OUT_DIR, candidates[candidates.length - 1]);
  return { file, name: candidates[candidates.length - 1], text: fs.readFileSync(file, "utf8") };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];

  for (const source of SOURCES) {
    let html;
    try {
      const response = await fetch(source.url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
    } catch (error) {
      results.push({ ...source, status: `FETCH FAILED: ${error.message}` });
      continue;
    }

    const text = extract(html);
    const declared = declaredDate(text);
    const hash = digest(text);
    const body =
      `# ${source.title}\n\n` +
      `- **Source**: ${source.url}\n` +
      `- **Archived**: ${today} (UTC)\n` +
      `- **Page declares**: ${declared}\n` +
      `- **Content digest**: \`${hash}\` (sha256, first 16 hex chars of the extracted text)\n\n` +
      `> Archived automatically by \`npm run archive:terms\`. This is a copy of the page as\n` +
      `> served on the archive date; it is not legal advice and not an interpretation.\n\n` +
      `---\n\n${text}\n`;

    // Read the previous snapshot BEFORE writing today's, or the lookup finds the
    // file this run just created and every first run reports "refreshed".
    const previous = previousSnapshot(source.name);

    const file = path.join(OUT_DIR, `${source.name}-${today}.md`);
    fs.writeFileSync(file, body, "utf8");
    let status;
    if (!previous || previous.name === `${source.name}-${today}.md`) {
      status = previous ? "snapshot refreshed (same day)" : "first snapshot";
    } else {
      const previousHash = /Content digest\*\*: `([0-9a-f]+)`/.exec(previous.text)?.[1];
      status =
        previousHash === hash
          ? `UNCHANGED since ${previous.name}`
          : `CHANGED since ${previous.name} — diff the two files`;
    }
    results.push({ ...source, declared, hash, status });
  }

  console.log(`snapshots in docs/legal-snapshots/\n`);
  for (const result of results) {
    console.log(`  ${result.name}`);
    console.log(`    ${result.status}`);
    if (result.declared) console.log(`    page declares: ${result.declared}`);
  }

  const changed = results.filter((result) => result.status.startsWith("CHANGED"));
  const failed = results.filter((result) => result.status.startsWith("FETCH FAILED"));
  if (failed.length > 0) {
    console.log(`\n${failed.length} page(s) could not be fetched; nothing was written for them.`);
    process.exitCode = 1;
  }
  if (changed.length > 0) {
    console.log(
      `\n${changed.length} page(s) changed. Re-read the affected clause before relying on it —` +
        ` the terms may be amended without notice to users who have no account.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
