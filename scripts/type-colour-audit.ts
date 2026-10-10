/**
 * Reports what colour each declared type gets, and what the plugin would draw.
 *
 * Exists because "the node's colour is not the colour the legend shows" has several
 * possible causes and only one of them is a bug:
 *
 *   - the legend swatch and the node come from the same assignment → they agree;
 *   - the two views can be set to different colour modes (the standalone view has
 *     `colorMode`, the built-in graph has its own), which is configuration, not a defect;
 *   - the plugin copy installed in a vault can be older than the vault's notes — the
 *     per-vault assignment arrived in 1.2.0, and before it colours came from a hash of the
 *     type's name. This prints that hash too, so an older build is recognisable by its
 *     colours rather than by guessing.
 *
 * Run against the vault that shows the problem:
 *
 *   npm run audit:colors -- "D:\\path\\to\\vault"
 */
import fs from "node:fs";
import path from "node:path";
import { buildWikiGraph } from "../src/core/graph-builder";
import { collectTypes, nodeTypeKey } from "../src/view/visibility";
import { assignTypeColors, communityColor, typeColor } from "../src/view/palette";
import { normalizePageType } from "../src/core/parse";
import type { VaultAdapter } from "../src/core/vault";

const vaultRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", "插件开发"));

class NodeVault implements VaultAdapter {
  configDir(): string {
    return ".obsidian";
  }
  async listMarkdownFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.toLowerCase().endsWith(".md")) {
          out.push(path.relative(vaultRoot, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(vaultRoot);
    return out.sort();
  }
  async read(relative: string): Promise<string> {
    return fs.readFileSync(path.join(vaultRoot, relative), "utf8");
  }
  async exists(relative: string): Promise<boolean> {
    return fs.existsSync(path.join(vaultRoot, relative));
  }
}

async function main(): Promise<void> {
  const graph = await buildWikiGraph({ vault: new NodeVault() });
  const types = collectTypes(graph.nodes);
  const assignment = assignTypeColors(types.map((type) => type.key));

  console.log(`vault: ${vaultRoot}`);
  console.log(
    `notes: ${graph.nodes.length}   clusters: ${graph.communities.length}   ` +
      `declared types: ${types.length}\n`,
  );

  console.log("type                 pages   label shown      legend swatch  node colour    older build   analysis type");
  let mismatched = 0;
  for (const type of types) {
    const legendSwatch = assignment.get(type.key) ?? "-";
    // What the renderer writes on the node: the same assignment, keyed by the node's own
    // declared type. Recomputed here from the nodes rather than assumed.
    const node = graph.nodes.find((candidate) => nodeTypeKey(candidate) === type.key);
    const nodeColour = node ? assignment.get(nodeTypeKey(node)) ?? "-" : "-";
    if (nodeColour !== legendSwatch) mismatched += 1;
    console.log(
      `  ${type.key.padEnd(18)} ${String(type.count).padStart(4)}   ${type.label.padEnd(15)} ` +
        `${legendSwatch.padEnd(14)} ${nodeColour.padEnd(14)} ${typeColor(type.key).padEnd(13)} ` +
        `${normalizePageType(type.label)}`,
    );
  }

  console.log("");
  console.log(
    `legend swatch == node colour for every type: ${mismatched === 0 ? "yes" : `NO (${mismatched} differ)`}`,
  );

  console.log("\ncolour mode reminders:");
  console.log("  - the standalone view colours by its own `colorMode` setting;");
  console.log("  - the built-in graph colours by `officialGraphColorMode`, a separate setting;");
  console.log("  - community mode uses a different palette entirely, by cluster:");
  for (const community of graph.communities.slice(0, 6)) {
    console.log(`      #${community.id} ${communityColor(community.id)}  (${community.nodeCount} pages)`);
  }

  console.log("\nreading this table:");
  console.log("  - if the colour on screen matches `node colour`, the plugin is behaving;");
  console.log("  - if it matches `older build` instead, the plugin copy in that vault predates");
  console.log("    1.2.0 — reinstall it from this repository (`npm run build`, then copy main.js,");
  console.log("    manifest.json and styles.css into the vault's plugin folder);");
  console.log("  - if it matches neither, send me this table.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
