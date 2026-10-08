/**
 * Architecture guardrails.
 *
 * The extensibility of this project rests on a few structural rules. Rules that
 * are only written down in a README rot silently; these are asserted, so a
 * future change that breaks the shape fails CI instead of being discovered
 * months later.
 *
 * The rules, and why each one is worth a test:
 *
 *  1. `core/**` never imports `obsidian` or `sigma`. The engine is pure, which
 *     is why it can be unit-tested in Node and why it will survive any change to
 *     Obsidian's API or to the renderer.
 *  2. `view/**` never imports `integrate/**`. The standalone view must not
 *     depend on the undocumented-internals adapter; the arrow points the other
 *     way, so the adapter can be deleted without touching the view.
 *  3. No runtime import cycles. Type-only cycles are erased at build time and
 *     are reported separately, but a runtime cycle means two modules cannot be
 *     understood or replaced independently.
 *  4. Each third-party library is confined to one module. Want to swap sigma,
 *     the layout engine, the YAML parser or the community detection? Rule 4 is
 *     what makes that a one-file change.
 *  5. Nothing depends on the composition root (`main.ts`).
 *  6. Obsidian's undocumented graph view-type strings appear in exactly one
 *     file, so "Obsidian changed something" means opening one file.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

interface ModuleInfo {
  /** Relative to `src/`, without the extension. */
  readonly key: string;
  readonly source: string;
  /** Every internal reference, type-only included. */
  readonly references: ReadonlySet<string>;
  /** References that survive compilation. */
  readonly runtimeReferences: ReadonlySet<string>;
  readonly external: ReadonlySet<string>;
  readonly runtimeExternal: ReadonlySet<string>;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function keyOf(file: string): string {
  return path.relative(SRC, file).replace(/\\/g, "/").replace(/\.ts$/, "");
}

function analyze(): Map<string, ModuleInfo> {
  const modules = new Map<string, ModuleInfo>();
  for (const file of listTsFiles(SRC)) {
    const source = fs.readFileSync(file, "utf8");
    const references = new Set<string>();
    const runtimeReferences = new Set<string>();
    const external = new Set<string>();
    const runtimeExternal = new Set<string>();

    // `import type` / `export type` are erased by esbuild and cannot couple
    // anything at runtime, so they are tracked separately.
    const re = /(?:^|\n)\s*(?:import|export)(\s+type)?\b[^;]*?from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const typeOnly = Boolean(match[1]);
      const spec = match[2];
      if (!spec.startsWith(".")) {
        external.add(spec);
        if (!typeOnly) runtimeExternal.add(spec);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), spec);
      const key = keyOf(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`);
      references.add(key);
      if (!typeOnly) runtimeReferences.add(key);
    }
    modules.set(keyOf(file), {
      key: keyOf(file),
      source,
      references,
      runtimeReferences,
      external,
      runtimeExternal,
    });
  }
  return modules;
}

const modules = analyze();
const keys = [...modules.keys()].sort();

/** Runtime dependency edges as `[from, to]` pairs. */
function runtimeEdges(): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  for (const info of modules.values()) {
    for (const to of info.runtimeReferences) {
      if (modules.has(to)) edges.push([info.key, to]);
    }
  }
  return edges;
}

function findCycles(edges: ReadonlyArray<[string, string]>): string[][] {
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  const found: string[][] = [];
  const visit = (node: string): void => {
    if (state.get(node) === "done") return;
    if (state.get(node) === "open") {
      const at = stack.indexOf(node);
      if (at >= 0) found.push([...stack.slice(at), node]);
      return;
    }
    state.set(node, "open");
    stack.push(node);
    for (const [from, to] of edges) if (from === node) visit(to);
    stack.pop();
    state.set(node, "done");
  };
  for (const key of keys) visit(key);
  return found;
}

describe("architecture: layering", () => {
  it("scans every source module", () => {
    // A guard on the guard: if the scanner silently finds nothing, every other
    // assertion below would pass vacuously.
    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(keys).toContain("main");
    expect(keys).toContain("view/graph-view");
    expect(keys).toContain("core/insights");
  });

  it("keeps core/ free of Obsidian and of the renderer", () => {
    const offenders = [...modules.values()]
      .filter((info) => info.key.startsWith("core/"))
      .filter((info) => info.external.has("obsidian") || info.external.has("sigma"))
      .map((info) => `${info.key} → ${[...info.external].join(", ")}`);

    expect(offenders).toEqual([]);
  });

  it("keeps the portable view free of the internals adapter", () => {
    const offenders = [...modules.values()]
      .filter((info) => info.key.startsWith("view/"))
      .filter((info) => [...info.references].some((ref) => ref.startsWith("integrate/")))
      .map((info) => `${info.key} → ${[...info.references].filter((r) => r.startsWith("integrate/")).join(", ")}`);

    expect(offenders).toEqual([]);
  });

  it("has no runtime import cycles", () => {
    const cycles = findCycles(runtimeEdges()).map((cycle) => cycle.join(" → "));
    expect([...new Set(cycles)]).toEqual([]);
  });

  it("has no type-only import cycles either", () => {
    // Not fatal — these are erased — but they still make two modules hard to
    // reason about separately, so they are kept out as well.
    const all: Array<[string, string]> = [];
    for (const info of modules.values()) {
      for (const to of info.references) if (modules.has(to)) all.push([info.key, to]);
    }
    const cycles = findCycles(all).map((cycle) => cycle.join(" → "));
    expect([...new Set(cycles)]).toEqual([]);
  });

  it("makes nothing depend on the composition root", () => {
    const offenders = [...modules.values()]
      .filter((info) => info.key !== "main")
      .filter((info) => info.references.has("main"))
      .map((info) => info.key);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: third-party confinement", () => {
  const CONFINEMENT: Array<{ pkg: string; allowed: string[] }> = [
    { pkg: "sigma", allowed: ["view/renderer"] },
    { pkg: "sigma/types", allowed: ["view/renderer"] },
    { pkg: "graphology-layout-forceatlas2", allowed: ["view/layout"] },
    { pkg: "graphology-communities-louvain", allowed: ["core/communities"] },
    { pkg: "js-yaml", allowed: ["core/parse"] },
  ];

  for (const { pkg, allowed } of CONFINEMENT) {
    it(`confines ${pkg} to ${allowed.join(", ")}`, () => {
      const users = [...modules.values()]
        .filter((info) => info.external.has(pkg))
        .map((info) => info.key)
        .sort();
      expect(users).toEqual(allowed);
    });
  }

  it("keeps the pure vocabulary modules dependency-free", () => {
    // These are the bottom of the stack: everything may import them, so they
    // must import nothing themselves.
    for (const key of ["types", "i18n"]) {
      const info = modules.get(key);
      expect(info, `${key}.ts should exist`).toBeDefined();
      expect([...info!.references], `${key}.ts must not import project modules`).toEqual([]);
      expect([...info!.external], `${key}.ts must not import packages`).toEqual([]);
    }
  });
});

describe("architecture: Obsidian's undocumented surface", () => {
  const INTERNALS = "integrate/official-internals";

  it("declares the graph view types in exactly one module", () => {
    const offenders = [...modules.values()]
      .filter((info) => info.key !== INTERNALS)
      .filter((info) => /"localgraph"|'localgraph'/.test(info.source))
      .map((info) => info.key);

    expect(offenders).toEqual([]);
  });

  it("only reads leaves by view type through the internals module", () => {
    // `getLeavesOfType` itself is public API, but calling it with the graph's
    // type strings is the fragile part — keep that knowledge in one place.
    const offenders = [...modules.values()]
      .filter((info) => info.key !== INTERNALS)
      .filter((info) => /getLeavesOfType\(\s*["']/.test(info.source))
      .map((info) => info.key);

    expect(offenders).toEqual([]);
  });

  it("exposes a probe that reports which seams are missing", () => {
    const internals = modules.get(INTERNALS);
    expect(internals).toBeDefined();
    expect(internals!.source).toContain("export function probeOfficialGraph");
    expect(internals!.source).toContain("missing");
  });
});
