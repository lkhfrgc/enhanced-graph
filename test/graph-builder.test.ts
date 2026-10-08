import { describe, expect, it } from "vitest";

import { DEFAULT_RELEVANCE_WEIGHTS, EMPTY_GRAPH } from "../src/types";
import type { GraphEdge, GraphNode, PageType, WikiGraph } from "../src/types";
import { MemoryVault } from "../src/core/vault";
import type { VaultAdapter } from "../src/core/vault";
import {
  buildLinkIndex,
  buildWikiGraph,
  collectUnresolvedLinks,
  loadNotes,
  resolveLinkTarget,
} from "../src/core/graph-builder";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Five visible pages:
 *   papers/Note One   concept, two sources          -> Note Two, Note Three, Note Two (dup)
 *   papers/Note Two   concept, same two sources     -> Note One          (mutual)
 *   entities/Note Three entity, one shared source   -> Note Two
 *   index             overview (structural)         -> Note One
 *   logs/Journal      no frontmatter, no links
 */
const FIVE_NOTE_VAULT: Record<string, string> = {
  "papers/Note One.md": [
    "---",
    "type: concept",
    'sources: ["Attention Is All You Need.pdf", "Shared Survey"]',
    "---",
    "# Note One",
    "",
    "[[Note Two]] and [[Note Three]] and [[Note Two]] again.",
  ].join("\n"),
  "papers/Note Two.md": [
    "---",
    "type: concept",
    'sources: ["attention is all you need", "Shared Survey"]',
    "---",
    "# Note Two",
    "",
    "[[Note One]]",
  ].join("\n"),
  "entities/Note Three.md": [
    "---",
    "type: entity",
    'sources: ["Shared Survey"]',
    "---",
    "# Note Three",
    "",
    "[[Note Two]]",
  ].join("\n"),
  "index.md": ["---", "type: overview", "---", "# Index", "", "[[Note One]]"].join("\n"),
  "logs/Journal.md": "# Journal\n\nNo links here yet.",
};

function edgeBetween(graph: WikiGraph, a: string, b: string): GraphEdge {
  const edge = graph.edges.find(
    (candidate) =>
      (candidate.source === a && candidate.target === b) ||
      (candidate.source === b && candidate.target === a),
  );
  if (!edge) throw new Error(`no edge between ${a} and ${b}`);
  return edge;
}

function nodeById(graph: WikiGraph, id: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
}

/** A vault where individual reads blow up, to prove one bad file cannot fail a build. */
function vaultWithBrokenRead(
  files: Record<string, string>,
  broken: readonly string[],
): VaultAdapter {
  const memory = new MemoryVault(files);
  const brokenSet = new Set(broken);
  return {
    configDir: () => ".obsidian",
    listMarkdownFiles: () => memory.listMarkdownFiles(),
    read: async (path: string) => {
      if (brokenSet.has(path)) throw new Error(`EIO: ${path}`);
      return memory.read(path);
    },
    exists: (path: string) => memory.exists(path),
    write: (path: string, content: string) => memory.write(path, content),
  };
}

// ---------------------------------------------------------------------------
// Five-note vault: counts, weights, ordering, index
// ---------------------------------------------------------------------------

describe("buildWikiGraph — five-note vault", () => {
  it("builds one node per page and one edge per unique undirected pair", async () => {
    const graph = await buildWikiGraph({ vault: new MemoryVault(FIVE_NOTE_VAULT) });

    expect(graph.nodes).toHaveLength(5);
    // Note One↔Note Two, Note One–Note Three, Note Two–Note Three, Index–Note One.
    expect(graph.edges).toHaveLength(4);
    expect(graph.edges.every((edge) => edge.hasDirectLink)).toBe(true);
    expect(graph.builtAt).toBeGreaterThan(0);
  });

  it("counts linkCount as inbound + outbound over de-duplicated directed links", async () => {
    const graph = await buildWikiGraph({ vault: new MemoryVault(FIVE_NOTE_VAULT) });

    const noteOne = nodeById(graph, "papers/note one");
    expect(noteOne.outLinks).toBe(2); // Note Two (twice, counted once) + Note Three
    expect(noteOne.inLinks).toBe(2); // Note Two + index
    expect(noteOne.linkCount).toBe(4);

    expect(nodeById(graph, "papers/note two").linkCount).toBe(3);
    expect(nodeById(graph, "entities/note three").linkCount).toBe(2);
    expect(nodeById(graph, "index").linkCount).toBe(1);
    expect(nodeById(graph, "logs/journal").linkCount).toBe(0);
  });

  it("carries the parsed metadata onto the nodes", async () => {
    const graph = await buildWikiGraph({ vault: new MemoryVault(FIVE_NOTE_VAULT) });

    const noteOne = nodeById(graph, "papers/note one");
    expect(noteOne.label).toBe("Note One");
    expect(noteOne.type).toBe("concept");
    expect(noteOne.rawType).toBe("concept");
    expect(noteOne.path).toBe("papers/Note One.md");
    expect(noteOne.sources).toEqual(["attention is all you need", "shared survey"]);
    expect(noteOne.isStructural).toBe(false);

    // `index` is structural through both its slug and its `overview` type.
    expect(nodeById(graph, "index").isStructural).toBe(true);
  });

  it("scores a specific edge with the hand-computed association total", async () => {
    const graph = await buildWikiGraph({ vault: new MemoryVault(FIVE_NOTE_VAULT) });
    const edge = edgeBetween(graph, "papers/note one", "papers/note two");

    // directLink: mutual link -> (1 + 1) / 2 = 1.0, the signal's maximum
    // sourceOverlap: both cite two of the same papers -> saturate(2)
    // adamicAdar: the only shared neighbour is entities/note three, degree 2
    //   -> saturate(1 / ln 2)

    const saturate = (x: number) => (x > 0 ? x / (1 + x) : 0);
    const expected =
      DEFAULT_RELEVANCE_WEIGHTS.directLink +
      saturate(2) * DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap +
      saturate(1 / Math.log(2)) * DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor;

    expect(edge.signals.directLink).toBe(DEFAULT_RELEVANCE_WEIGHTS.directLink);
    expect(edge.signals.sourceOverlap).toBeCloseTo(
      saturate(2) * DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap,
      10,
    );
    expect(edge.signals.adamicAdar).toBeCloseTo(
      saturate(1 / Math.log(2)) * DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor,
      10,
    );
    expect(edge.weight).toBeCloseTo(expected, 6);
    expect(edge.weight).toBeCloseTo(edge.signals.total, 10);
  });

  it("sorts nodes by linkCount desc then id and edges by weight desc", async () => {
    const graph = await buildWikiGraph({ vault: new MemoryVault(FIVE_NOTE_VAULT) });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "papers/note one",
      "papers/note two",
      "entities/note three",
      "index",
      "logs/journal",
    ]);
    for (let i = 1; i < graph.nodes.length; i += 1) {
      expect(graph.nodes[i - 1].linkCount).toBeGreaterThanOrEqual(graph.nodes[i].linkCount);
    }
    for (let i = 1; i < graph.edges.length; i += 1) {
      expect(graph.edges[i - 1].weight).toBeGreaterThanOrEqual(graph.edges[i].weight);
    }
  });

  it("indexes nodes by both the lower-cased id and the original-case rawId", async () => {
    const graph = await buildWikiGraph({ vault: new MemoryVault(FIVE_NOTE_VAULT) });
    const node = nodeById(graph, "papers/note one");

    expect(graph.nodeIndex.get("papers/note one")).toBe(node);
    expect(graph.nodeIndex.get("papers/Note One")).toBe(node);
    expect(graph.nodeIndex.get("papers/note one.md")).toBeUndefined();
  });

  it("rebuilds byte-identical nodes and edges", async () => {
    const vault = new MemoryVault(FIVE_NOTE_VAULT);
    // Louvain runs a random walk (community ids may differ between builds), so
    // only the structural fields — which the view caches on — are compared.
    const shape = (graph: WikiGraph): unknown => ({
      nodes: graph.nodes.map((node) => [node.id, node.linkCount, node.inLinks, node.outLinks]),
      edges: graph.edges.map((edge) => [edge.source, edge.target, edge.weight, edge.commonNeighbors]),
    });

    expect(shape(await buildWikiGraph({ vault }))).toEqual(shape(await buildWikiGraph({ vault })));
  });
});

// ---------------------------------------------------------------------------
// Type filtering
// ---------------------------------------------------------------------------

describe("hidden page types", () => {
  const vault = new MemoryVault({
    "kept.md": "---\ntype: concept\n---\n# Kept\n\n[[Research Q]] [[Missing]]",
    "queries/Research Q.md": "---\ntype: query\n---\n# Research Q\n\n[[Kept]]",
  });

  it("drops query pages and turns links into them into unresolved targets", async () => {
    const graph = await buildWikiGraph({ vault });

    expect(graph.nodes.map((node) => node.id)).toEqual(["kept"]);
    expect(graph.edges).toHaveLength(0);

    // The filtered note is absent from the index, so the link never resolves.
    const notes = await loadNotes(vault);
    const index = buildLinkIndex(notes);
    expect(collectUnresolvedLinks(notes, index).get("kept")).toEqual(["Research Q", "Missing"]);
  });

  it("keeps query pages when hiddenTypes is empty", async () => {
    const graph = await buildWikiGraph({ vault, hiddenTypes: new Set<PageType>() });

    expect(graph.nodes.map((node) => node.id)).toEqual(["kept", "queries/research q"]);
    expect(graph.edges).toHaveLength(1);
    const edge = edgeBetween(graph, "kept", "queries/research q");
    expect(edge.hasDirectLink).toBe(true);
    expect(edge.signals.directLink).toBe(DEFAULT_RELEVANCE_WEIGHTS.directLink); // mutual link
  });
});

// ---------------------------------------------------------------------------
// Link resolution
// ---------------------------------------------------------------------------

describe("link resolution", () => {
  const vault = new MemoryVault({
    "folder/Note Two.md": "# Note Two",
    "a.md": "# A\n\n[[Note Two]]",
    "b.md": "# B\n\n[[folder/Note Two]]",
    "c.md": "# C\n\n[[note-two]]",
    "d.md": "# D\n\n[[NOTE TWO]]",
    "e.md": "# E\n\n[[./folder/Note Two.md]]",
  });

  it("resolves basename, path, separator and case variants onto one node", async () => {
    const graph = await buildWikiGraph({ vault });
    const target = "folder/note two";

    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(5);
    for (const linker of ["a", "b", "c", "d", "e"]) {
      expect(edgeBetween(graph, linker, target).hasDirectLink).toBe(true);
    }
    expect(nodeById(graph, target).inLinks).toBe(5);
    expect(nodeById(graph, target).outLinks).toBe(0);
  });

  it("exposes the same resolution through resolveLinkTarget", async () => {
    const notes = await loadNotes(vault);
    const index = buildLinkIndex(notes);

    for (const raw of [
      "Note Two",
      "note two",
      "NOTE TWO",
      "folder/Note Two",
      "folder/note two",
      "note-two",
      "note two.md",
      "./folder/Note Two.md",
      "folder/Note Two#Heading",
      "Note Two|alias",
      "folder\\Note Two",
    ]) {
      expect(resolveLinkTarget(raw, index), raw).toBe("folder/note two");
    }

    expect(resolveLinkTarget("Not In The Vault", index)).toBeNull();
    expect(resolveLinkTarget("", index)).toBeNull();
    expect(resolveLinkTarget("   ", index)).toBeNull();
  });

  it("prefers a longer exact id over a same-named basename elsewhere", async () => {
    const graph = await buildWikiGraph({
      vault: new MemoryVault({
        "folder/Note.md": "# Folder Note",
        "other/Note.md": "# Other Note",
        "linker.md": "# Linker\n\n[[Note]] [[other/Note]]",
      }),
    });

    // `[[Note]]` falls back to the first basename claim (sorted discovery order),
    // while `[[other/Note]]` still reaches its exact id.
    expect(graph.edges).toHaveLength(2);
    expect(edgeBetween(graph, "linker", "folder/note").hasDirectLink).toBe(true);
    expect(edgeBetween(graph, "linker", "other/note").hasDirectLink).toBe(true);
  });

  it("resolves frontmatter aliases, but never in front of a real file name", async () => {
    const aliased = await buildWikiGraph({
      vault: new MemoryVault({
        "real/Page.md": "---\naliases: [Alias Name]\n---\n# Page",
        "other.md": "# Other\n\n[[Alias Name]] [[alias-name]]",
      }),
    });
    expect(aliased.edges).toHaveLength(1); // both spellings collapse onto one pair
    expect(edgeBetween(aliased, "other", "real/page").hasDirectLink).toBe(true);

    const shadowed = await buildWikiGraph({
      vault: new MemoryVault({
        "Alias Name.md": "# Real file",
        "other/Target.md": "---\naliases: [Alias Name]\n---\n# Target",
        "linker.md": "# Linker\n\n[[Alias Name]]",
      }),
    });
    expect(edgeBetween(shadowed, "linker", "alias name").hasDirectLink).toBe(true);
    expect(shadowed.edges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Edge collapse rules
// ---------------------------------------------------------------------------

describe("edge collapse", () => {
  it("drops self-links and counts duplicate references once", async () => {
    const graph = await buildWikiGraph({
      vault: new MemoryVault({
        "a.md": "# A\n\n[[a]] [[b]] [[B]] [[b|aliased]]",
        "b.md": "# B",
      }),
    });

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].source).toBe("a");
    expect(graph.edges[0].target).toBe("b");
    expect(nodeById(graph, "a").outLinks).toBe(1); // self-link dropped, b/B/b|alias merged
    expect(nodeById(graph, "a").linkCount).toBe(1);
    expect(nodeById(graph, "b").linkCount).toBe(1);
  });

  it("collapses a mutual link into exactly one edge", async () => {
    const graph = await buildWikiGraph({
      vault: new MemoryVault({ "x.md": "# X\n\n[[y]]", "y.md": "# Y\n\n[[x]]" }),
    });

    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0];
    expect(edge.hasDirectLink).toBe(true);
    expect(edge.signals.directLink).toBe(DEFAULT_RELEVANCE_WEIGHTS.directLink);
    // Forward + backward direct link, no sources, no shared neighbour,

    expect(edge.weight).toBeCloseTo(DEFAULT_RELEVANCE_WEIGHTS.directLink, 10);
    expect(nodeById(graph, "x").linkCount).toBe(2);
    expect(nodeById(graph, "y").linkCount).toBe(2);
  });

  it("populates sharedSources and commonNeighbors on a triangle", async () => {
    const graph = await buildWikiGraph({
      vault: new MemoryVault({
        "a.md": "---\ntype: concept\nsources: [shared-source]\n---\n# A\n\n[[b]] [[c]]",
        "b.md": "---\ntype: concept\nsources: [shared-source, b-only]\n---\n# B\n\n[[a]] [[c]]",
        "c.md": "---\ntype: concept\nsources: [shared-source, b-only]\n---\n# C\n\n[[a]] [[b]]",
      }),
    });

    expect(graph.edges).toHaveLength(3); // six directed links, three unique pairs

    const ab = edgeBetween(graph, "a", "b");
    expect(ab.commonNeighbors).toBe(1); // both touch c
    expect(ab.sharedSources).toEqual(["shared-source"]);

    expect(edgeBetween(graph, "b", "c").sharedSources).toEqual(["b-only", "shared-source"]);
    expect(edgeBetween(graph, "b", "c").commonNeighbors).toBe(1); // both touch a
    expect(edgeBetween(graph, "a", "c").sharedSources).toEqual(["shared-source"]);

    for (const edge of graph.edges) {
      expect(edge.hasDirectLink).toBe(true);
      expect(edge.weight).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Communities
// ---------------------------------------------------------------------------

describe("communities", () => {
  it("assigns every node and re-indexes communities from 0, largest first", async () => {
    const graph = await buildWikiGraph({ vault: new MemoryVault(FIVE_NOTE_VAULT) });

    expect(graph.communities.length).toBeGreaterThan(0);
    expect(graph.communities[0].id).toBe(0);
    expect(graph.communities.map((community) => community.id)).toEqual(
      graph.communities.map((_, position) => position),
    );

    const sizes = graph.communities.map((community) => community.nodeCount);
    expect(sizes[0]).toBe(Math.max(...sizes));
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i - 1]).toBeGreaterThanOrEqual(sizes[i]);
    }
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(graph.nodes.length);

    for (const node of graph.nodes) {
      const community = graph.communities.find((entry) => entry.id === node.community);
      expect(community, `community ${node.community} of ${node.id}`).toBeDefined();
      expect(community?.nodeIds).toContain(node.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Unresolved links
// ---------------------------------------------------------------------------

describe("collectUnresolvedLinks", () => {
  it("groups dangling targets by the referencing note, de-duplicated", async () => {
    const vault = new MemoryVault({
      "notes/Alpha.md": "# Alpha\n\n[[Beta]] [[Missing Page]] [[Nowhere/At All]] [[Missing Page]]",
      "notes/Beta.md": "# Beta\n\n[[Alpha]]",
    });
    const notes = await loadNotes(vault);
    const unresolved = collectUnresolvedLinks(notes, buildLinkIndex(notes));

    expect([...unresolved.keys()]).toEqual(["notes/alpha"]);
    expect(unresolved.get("notes/alpha")).toEqual(["Missing Page", "Nowhere/At All"]);
  });
});

// ---------------------------------------------------------------------------
// Discovery, loading and robustness
// ---------------------------------------------------------------------------

describe("discovery and loading", () => {
  it("returns EMPTY_GRAPH for an empty vault", async () => {
    expect(await buildWikiGraph({ vault: new MemoryVault() })).toBe(EMPTY_GRAPH);
  });

  it("ignores Obsidian's own folders and excludeFolders prefixes", async () => {
    const hiddenOnly = new MemoryVault({
      ".obsidian/plugins/x.md": "# Plugin notes",
      ".trash/old.md": "# Deleted",
      ".git/notes.md": "# Git",
    });
    expect(await buildWikiGraph({ vault: hiddenOnly })).toBe(EMPTY_GRAPH);

    const graph = await buildWikiGraph({
      vault: new MemoryVault({
        "keep.md": "# Keep",
        "templates/daily.md": "# Template",
        "archive/2020/x.md": "# Archived",
      }),
      excludeFolders: ["templates", "/archive/"],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(["keep"]);
  });

  it("skips oversized notes by UTF-8 byte count, not character count", async () => {
    const ascii = "# Big\n\n" + "x".repeat(400);
    const cjk = "# 标题\n\n" + "知".repeat(40); // 46 chars, 130 UTF-8 bytes

    const byBytes = await buildWikiGraph({
      vault: new MemoryVault({ "cjk.md": cjk, "ascii.md": ascii }),
      maxFileBytes: 100,
    });
    expect(byBytes).toBe(EMPTY_GRAPH);

    const fits = await buildWikiGraph({
      vault: new MemoryVault({ "cjk.md": cjk }),
      maxFileBytes: 200,
    });
    expect(fits.nodes.map((node) => node.id)).toEqual(["cjk"]);
  });

  it("survives a file that cannot be read", async () => {
    const vault = vaultWithBrokenRead(
      { "good.md": "# Good\n\n[[Broken]]", "broken.md": "# Broken" },
      ["broken.md"],
    );
    const graph = await buildWikiGraph({ vault });

    expect(graph.nodes.map((node) => node.id)).toEqual(["good"]);
    expect(graph.edges).toHaveLength(0);
  });

  it("reports progress once per candidate file", async () => {
    const calls: Array<[number, number]> = [];
    const graph = await buildWikiGraph({
      vault: new MemoryVault({ "a.md": "# A", "b.md": "# B", "c.md": "# C" }),
      concurrency: 2,
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(graph.nodes).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(calls.every(([, total]) => total === 3)).toBe(true);
    expect(calls.map(([done]) => done).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("falls back to EMPTY_GRAPH when the vault cannot even be listed", async () => {
    const unlistable: VaultAdapter = {
      configDir: () => ".obsidian",
      listMarkdownFiles: async () => {
        throw new Error("EACCES");
      },
      read: async () => "",
      exists: async () => false,
      write: async () => undefined,
    };
    expect(await buildWikiGraph({ vault: unlistable })).toBe(EMPTY_GRAPH);
  });
});
