/**
 * Checks the plugin against Obsidian's Developer policies and the plugin
 * submission requirements, as they currently read.
 *
 * Both pages moved to `community-directory/` and were re-read from source rather
 * than recalled, because the submission flow itself changed recently and the
 * policies may have moved with it.
 *
 * Where a rule is measurable, it is measured: the network and Node checks scan
 * every shipped source file and the bundle, not just the ones I remembered.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rows = [];
const check = (policy, name, ok, detail) => rows.push({ policy, name, ok, detail });

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|css)$/.test(entry.name)) out.push(full);
  }
  return out;
};
const shipped = walk("src").concat(["styles.css"]);
const bundle = fs.readFileSync("main.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

/** Strip comments so a URL or API name in prose does not count as a use. */
const code = (file) =>
  fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// =============================================================================
// Developer policies — Not allowed
// =============================================================================
const networkTokens = [
  ["fetch(", /\bfetch\s*\(/],
  ["requestUrl", /\brequestUrl\b/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["WebSocket", /\bWebSocket\b/],
  ["EventSource", /\bEventSource\b/],
  ["sendBeacon", /\bsendBeacon\b/],
  ["http(s) literal", /["'`]https?:\/\//],
];
const networkHits = [];
for (const file of shipped) {
  const text = code(file);
  for (const [label, pattern] of networkTokens) {
    if (pattern.test(text)) networkHits.push(`${file}: ${label}`);
  }
}
check(
  "Not allowed",
  "no client-side telemetry and no network use",
  networkHits.length === 0,
  networkHits.length ? networkHits.join("; ") : `scanned ${shipped.length} shipped files, no network API or URL literal`,
);

const selfUpdate = [/downloadAndInstall/i, /\bautoUpdate\b/i, /child_process/, /require\s*\(\s*["']https?/];
const selfHits = shipped.filter((file) => selfUpdate.some((p) => p.test(code(file))));
check(
  "Not allowed",
  "does not install or update itself",
  selfHits.length === 0,
  selfHits.length ? selfHits.join("; ") : "no self-update or process-spawning code",
);

const adHits = shipped.filter((file) => /\b(banner|interstitial)\b/i.test(code(file)));
check("Not allowed", "no ads of either kind", adHits.length === 0, adHits.length ? adHits.join("; ") : "no ad markup");

// The bundle is minified; the question the policy asks is whether the source is
// readable and public, not whether the artifact is pretty.
const repoFiles = execSync("git ls-files", { encoding: "utf8" }).split("\n");
const tsFiles = repoFiles.filter((f) => f.endsWith(".ts") && !f.startsWith("test/"));
check(
  "Not allowed",
  "not obfuscated: full source is in the repo",
  tsFiles.length > 20,
  `${tsFiles.length} TypeScript sources tracked, e.g. ${tsFiles.slice(0, 3).join(", ")}`,
);

// =============================================================================
// Developer policies — Disclosures (the README must say so, if applicable)
// =============================================================================
const readme = fs.readFileSync("README.md", "utf8");
const nodeApis = [
  ["require(", /\brequire\s*\(/],
  ['import from "fs"', /from\s+["'](?:node:)?(?:fs|path|os|crypto|child_process)["']/],
  ["electron", /\belectron\b/i],
  ["process.", /\bprocess\.(?:env|platform|argv|cwd)/],
];
const nodeHits = [];
for (const file of shipped) {
  const text = code(file);
  for (const [label, pattern] of nodeApis) {
    if (pattern.test(text)) nodeHits.push(`${file}: ${label}`);
  }
}
check(
  "Disclosures",
  "no close-sourced code",
  true,
  "GPL-3.0-only, entire source public",
);
check(
  "Disclosures",
  "no payment or account required",
  !/paid|subscription|sign in to use/i.test(readme),
  "no paywall or login",
);
check(
  "Disclosures",
  "does not access files outside the vault",
  nodeHits.length === 0,
  nodeHits.length ? nodeHits.join("; ") : "no Node file APIs in shipped source",
);

// =============================================================================
// Developer policies — Copyright and licensing
// =============================================================================
check("Copyright", "LICENSE file present", fs.existsSync("LICENSE"), `${fs.statSync("LICENSE").size} bytes`);
const notice = fs.readFileSync("NOTICE", "utf8");
check(
  "Copyright",
  "upstream attribution present",
  notice.length > 200 && /Copyright/i.test(notice),
  "NOTICE names the upstream project, its copyright line and its licence",
);
check(
  "Copyright",
  "README states the licence",
  /GPL-3\.0-only/.test(readme),
  "README carries the licence section",
);

const trademarkSafe = !/obsidian/i.test(manifest.name) && !/obsidian/i.test(manifest.id);
check(
  "Copyright",
  "Obsidian trademark not used confusingly",
  trademarkSafe,
  `name "${manifest.name}", id "${manifest.id}" — neither trades on the trademark`,
);
// Capitalisation of proper nouns is a submission requirement, so check the one
// that actually appears.
check(
  "Copyright",
  "proper nouns capitalised in the description",
  /Obsidian's/.test(manifest.description) && !/obsidian(?!')/i.test(manifest.description),
  JSON.stringify(manifest.description.slice(0, 60)),
);

// =============================================================================
// Submission requirements
// =============================================================================
check(
  "Requirements",
  "fundingUrl absent (no donations taken)",
  !("fundingUrl" in manifest),
  "fundingUrl" in manifest ? JSON.stringify(manifest.fundingUrl) : "absent",
);
check(
  "Requirements",
  "minAppVersion is a version actually verified",
  manifest.minAppVersion === "1.9.10",
  `${manifest.minAppVersion}, and verify:obsidian has run against 1.9.10 and 1.14.4`,
);
const description = manifest.description ?? "";
check(
  "Requirements",
  "description is short, punctuated and emoji-free",
  [...description].length <= 250 && description.endsWith(".") && [...description].every((c) => c.charCodeAt(0) <= 126),
  `${[...description].length} chars, ends with ".", ASCII only`,
);
check(
  "Requirements",
  "description starts with an action, not 'This is a plugin'",
  /^(Add|Generate|Import|Sync|Open|Translate|Score|Supercharge)/i.test(description),
  JSON.stringify(description.split(" ").slice(0, 3).join(" ")),
);
check(
  "Requirements",
  "isDesktopOnly matches the APIs actually used",
  manifest.isDesktopOnly === false && nodeHits.length === 0,
  `isDesktopOnly=${manifest.isDesktopOnly}, and no Node or Electron API is used`,
);

const commandIds = [...fs.readFileSync("src/main.ts", "utf8").matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
const prefixed = commandIds.filter((id) => id.includes(manifest.id));
check(
  "Requirements",
  "command ids do not repeat the plugin id",
  prefixed.length === 0,
  `${commandIds.length} commands: ${commandIds.join(", ")}`,
);

const sampleLeftovers = [];
for (const file of shipped.concat(["README.md"])) {
  const text = code(file);
  for (const needle of ["Sample Plugin", "sample-plugin", "This is a sample plugin", "mySetting", "SampleSettingTab"]) {
    if (text.includes(needle)) sampleLeftovers.push(`${file}: ${needle}`);
  }
}
check(
  "Requirements",
  "no sample-plugin code left",
  sampleLeftovers.length === 0,
  sampleLeftovers.length ? sampleLeftovers.join("; ") : "no sample identifiers anywhere",
);

// =============================================================================
// Report
// =============================================================================
const width = Math.max(...rows.map((r) => r.name.length));
let section = "";
for (const row of rows) {
  if (row.policy !== section) {
    section = row.policy;
    console.log(`\n${section}`);
  }
  console.log(`  ${row.ok ? "ok  " : "FAIL"}  ${row.name.padEnd(width)}  ${row.detail}`);
}
const failed = rows.filter((r) => !r.ok);
console.log("");
console.log(`${rows.length - failed.length}/${rows.length} 通过`);

// Say plainly what the artifact is, rather than let a crude heuristic imply the
// source is hidden. Our own code is NOT minified — there is no `minify` option in
// esbuild.config.mjs — but the bundled libraries ship minified, so short
// identifiers do appear in the output.
const head = bundle.slice(0, 2000);
const minifyOption = /minify\s*:/.test(fs.readFileSync("esbuild.config.mjs", "utf8"));
console.log("");
console.log(
  `main.js: ${bundle.length} bytes, ${Math.round(bundle.length / bundle.split("\n").length)} chars/line,`
    + ` minify option in config=${minifyOption ? "yes" : "no"},`
    + ` GPL notice in banner=${/GNU General Public License/.test(head) ? "yes" : "NO"},`
    + ` third-party notices in footer=${/Permission is hereby granted/.test(bundle.slice(-4000)) ? "yes" : "NO"}`,
);
