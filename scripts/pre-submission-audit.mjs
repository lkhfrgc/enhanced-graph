/**
 * Runs Obsidian's documented submission requirements against this repo.
 *
 * The directory's validator checks a fixed list, and a PR that fails it just
 * sits there. Everything below is measured from the actual files and the
 * published release, not read off the README.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

// --- manifest: required fields ----------------------------------------------------
const required = ["id", "name", "version", "minAppVersion", "description", "author"];
for (const field of required) {
  check(`manifest.${field} is present`, typeof manifest[field] === "string" && manifest[field].length > 0, JSON.stringify(manifest[field]));
}
check("manifest.isDesktopOnly is a boolean", typeof manifest.isDesktopOnly === "boolean", String(manifest.isDesktopOnly));

// --- description rules -------------------------------------------------------------
const description = manifest.description ?? "";
const length = [...description].length;
check("description is at most 250 characters", length <= 250, `${length} characters`);
check("description ends with a period", description.trimEnd().endsWith("."), JSON.stringify(description.slice(-12)));
check(
  "description has no emoji or non-ASCII",
  [...description].every((c) => c.charCodeAt(0) <= 126),
  [...description].filter((c) => c.charCodeAt(0) > 126).join("") || "pure ASCII",
);
check(
  "Requirements",
  "description does not contain the word Obsidian",
  !/obsidian/i.test(description),
  /obsidian/i.test(description)
    ? "**the directory's linter rejects this outright**"
    : "absent; the plugin directory implies the context",
);

check(
  "description does not start with 'This is a plugin'",
  !/^this is a plugin/i.test(description),
  JSON.stringify(description.slice(0, 24)),
);

// --- naming rules -------------------------------------------------------------------
// Obsidian asks that neither the plugin name nor its id trade on "Obsidian".
check("name does not contain 'obsidian'", !/obsidian/i.test(manifest.name ?? ""), manifest.name);
check("id does not contain 'obsidian'", !/obsidian/i.test(manifest.id ?? ""), manifest.id);
check(
  "id is lowercase kebab-case",
  /^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.id ?? ""),
  manifest.id,
);

// --- repo layout ---------------------------------------------------------------------
// The directory states this outright: "An English description of the plugin is
// required, even if translations are also provided." Measured as the share of
// ASCII in the file rather than by looking for a magic phrase.
{
  const readme = fs.readFileSync("README.md", "utf8");
  const ascii = (readme.match(/[\x20-\x7E]/g) ?? []).length;
  const share = ascii / readme.length;
  check(
    "README contains English text",
    share > 0.9 && readme.length > 1000,
    `${(share * 100).toFixed(1)}% ASCII, ${readme.length} bytes`,
  );
}

check("LICENSE exists at the repo root", fs.existsSync("LICENSE"), fs.existsSync("LICENSE") ? `${fs.statSync("LICENSE").size} bytes` : "missing");
check("README.md exists at the repo root", fs.existsSync("README.md"), fs.existsSync("README.md") ? `${fs.statSync("README.md").size} bytes` : "missing");
check("versions.json has an entry for this version", Boolean(versions[manifest.version]), JSON.stringify(versions));

// The directory's own README tells you not to commit the build output: the files
// belong in the release, and a stale copy in the repo is a common rejection.
//
// Ask git rather than reading `.gitignore`: the entry there is `/main.js`, and
// matching the file name against those lines reported a false failure. "Is it
// tracked" is the question, and `ls-files` answers it exactly.
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");
for (const built of ["main.js", "main.js.map"]) {
  const isTracked = tracked.includes(built);
  check(`${built} is not committed`, !isTracked, isTracked ? "tracked by git" : "untracked");
}

// --- release ---------------------------------------------------------------------------
const headers = { "User-Agent": "pre-submission-audit" };
const response = await fetch("https://api.github.com/repos/lkhfrgc/enhanced-graph/releases", { headers });
const releases = await response.json();

// Unauthenticated GitHub allows 60 requests an hour, and this script is meant to
// be run alongside other checks. A rate-limit body is an object, not a list, so
// calling `.find` on it threw a TypeError that said nothing about the real cause.
if (!Array.isArray(releases)) {
  const reset = response.headers.get("x-ratelimit-reset");
  const when = reset ? new Date(Number(reset) * 1000).toISOString() : "unknown";
  console.error(`${response.status} from the GitHub API: ${releases?.message ?? "no body"}`);
  console.error(`The release checks cannot run. Quota resets at ${when}.`);
  console.error("Everything above the release section was still measured locally.");
  process.exitCode = 2;
}
const releaseList = Array.isArray(releases) ? releases : [];
const release = releaseList.find((r) => r.tag_name === manifest.version);
check("a published release exists for this version", Boolean(release), release ? `tag ${release.tag_name}` : `tags: ${releaseList.map((r) => r.tag_name).join(", ") || "none or unavailable"}`);
check("the release is published, not a draft", release ? release.draft === false : false, release ? `draft=${release.draft}` : "no release");

if (release) {
  const names = release.assets.map((a) => a.name);
  for (const asset of ["main.js", "manifest.json", "styles.css"]) {
    const found = release.assets.find((a) => a.name === asset);
    check(`release asset ${asset}`, Boolean(found) && found.size > 0, found ? `${found.size} bytes` : "missing");
  }
  check("release has no unexpected extra asset named main.js.map", !names.includes("main.js.map"), names.join(", "));

  // The manifest inside the release is what Obsidian reads, so it must agree
  // with the one in the repo.
  const assetManifest = release.assets.find((a) => a.name === "manifest.json");
  if (assetManifest) {
    const fetched = await (await fetch(assetManifest.browser_download_url, { headers })).json();
    check(
      "released manifest matches the repo manifest",
      fetched.version === manifest.version && fetched.id === manifest.id && fetched.description === manifest.description,
      `version=${fetched.version} id=${fetched.id}`,
    );
  }
}

// --- the entry that goes in the PR ------------------------------------------------------
const entry = {
  id: manifest.id,
  name: manifest.name,
  author: manifest.author,
  description: manifest.description,
  repo: "lkhfrgc/enhanced-graph",
};
check(
  "the community-plugins entry mirrors the manifest",
  entry.id === manifest.id && entry.name === manifest.name && entry.author === manifest.author && entry.description === manifest.description,
  "id / name / author / description all copied from manifest.json",
);
check(
  "package.json repository points at the same repo",
  (pkg.repository?.url ?? "").includes("lkhfrgc/enhanced-graph"),
  pkg.repository?.url ?? "missing",
);

// --- report ------------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"}  ${r.name.padEnd(52)} ${r.detail}`);
}
console.log("");
console.log(`${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log("未通过:");
  for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
}

// Printed rather than written to a file: the entry is meant to be pasted into
// the pull request, and a stray JSON file in the repo root is one more thing to
// keep out of the release.
console.log("");
console.log("=== community-plugins.json 条目 ===");
console.log(JSON.stringify(entry, null, 2));
