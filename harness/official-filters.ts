/**
 * The built-in graph's own chrome, mounted in a plain page so it can be driven
 * with real input.
 *
 * Everything that matters here is the real thing: `OfficialGraphEnhancer`
 * attaches to a stand-in for Obsidian's graph renderer (the same shape
 * `test/official-graph.test.ts` uses, taken from the shipped `app.js`), and the
 * filters body is drawn by the real `renderFiltersBody` in `official-graph.ts`.
 * Only the host around it is invented.
 *
 * It exists because this bug is about timing, and timing only exists under real
 * input: `element.click()` neither focuses the control — which is what defers the
 * panel's re-render — nor lasts long enough for a 0ms timer to land inside the
 * press. `scripts/verify-official-filters.mjs` presses everything at human pace,
 * and `scripts/verify-click-during-rebuild.mjs` holds the measurement that makes
 * that difference decisive.
 */
import "./dom-polyfill";
import type { GraphInsights } from "../src/core/insights";
import { OfficialGraphEnhancer } from "../src/integrate/official-graph";
import type { GraphNode, PageType, WikiGraph } from "../src/types";

// Enough tags for the tag list to reach its own scroll cap, so the tags tab has
// more content than the panel can ever show.
const TAGS = Array.from({ length: 30 }, (_, index) => `tag-${String(index + 1).padStart(2, "0")}`);

function makeNode(id: string, tags: string[], community: number): GraphNode {
  return {
    id,
    label: id,
    type: "concept" as PageType,
    rawType: "concept",
    path: `${id}.md`,
    linkCount: 3,
    inLinks: 2,
    outLinks: 1,
    community,
    sources: [],
    tags,
    isStructural: false,
  };
}

// Two clusters, so the filters panel has more than one row to switch — and so the
// legend has something to explain. The panel is where they are filtered; the
// legend's cards are read-only.
const nodes = TAGS.map((tag, index) => makeNode(tag, [tag, TAGS[(index + 1) % TAGS.length]], index % 2));
const graph: WikiGraph = {
  nodes,
  edges: [],
  communities: [0, 1].map((id) => {
    const members = nodes.filter((node) => node.community === id);
    return {
      id,
      nodeCount: members.length,
      intraEdges: 0,
      cohesion: 0.5,
      meanIntraDegree: 0,
      topNodes: members.map((node) => node.label),
      isSparse: false,
      nodeIds: members.map((node) => node.id),
    };
  }),
  nodeIndex: new Map(nodes.map((node) => [node.id, node])),
  builtAt: 1,
};
const insights: GraphInsights = {
  // Enough cards that the insights tab is taller than the panel can be: the
  // ceiling is only measurable when something actually reaches it.
  connections: Array.from({ length: 6 }, (_, index) => {
    const left = nodes[index * 2];
    const right = nodes[index * 2 + 1];
    return {
      key: `${left.id}:::${right.id}`,
      source: left,
      target: right,
      score: 9 - index,
      weight: 4,
      reasons: ["cross-community"],
      contributions: { "cross-community": 4 },
    };
  }),
  gaps: [],
};

interface FakeOfficialNode {
  id: string;
  type: string;
  x: number;
  y: number;
  weight: number;
  color: { a: number; rgb: number } | null;
  forward?: Record<string, { line?: { alpha: number } }>;
}

/** The renderer surface the enhancer reads, in the shape Obsidian exposes it. */
class FakeOfficialRenderer {
  nodes: FakeOfficialNode[] = [];
  nodeLookup: Record<string, FakeOfficialNode> = {};
  colors: Record<string, { a: number; rgb: number }> = {
    fill: { a: 1, rgb: 0x999999 },
    line: { a: 0.8, rgb: 0x888888 },
    lineHighlight: { a: 1, rgb: 0xffffff },
  };
  readonly containerEl = document.createElement("div");
  highlightNode: FakeOfficialNode | null = null;
  links: Array<{ line?: { alpha: number } }> = [];
  mouseX: number | null = 12;
  mouseY: number | null = 34;
  scale = 2;
  panX = 100;
  panY = 50;
  onNodeHover: ((event: MouseEvent, id: string, type: string) => void) | null = null;
  onNodeUnhover: (() => void) | null = null;
  lastData: unknown = undefined;

  constructor(ids: string[]) {
    // Positioned by the page's stylesheet (`.harness-official-graph`), not from
    // here: assigning styles directly is what the plugin guidelines forbid, and the
    // harness is scanned along with the plugin.
    this.containerEl.className = "harness-official-graph";
    for (const id of ids) {
      const node: FakeOfficialNode = { id, type: "concept", x: 10, y: 20, weight: 1, color: null };
      this.nodes.push(node);
      this.nodeLookup[id] = node;
    }
  }

  setData(data: unknown): string {
    this.lastData = data;
    return "set";
  }

  changed(): void {
    /* nothing to repaint in a page with no canvas */
  }
}

/** The plugin's settings, in the shape `main.ts` reads and writes them. */
const settings = {
  hiddenTags: [] as string[],
  includedTags: null as string[] | null,
  tagFilterMode: "exclude" as "exclude" | "include",
  hiddenTypes: [] as string[],
  hiddenCommunities: [] as number[],
  hideIsolated: false,
  hideStructural: false,
};

const renderer = new FakeOfficialRenderer(nodes.map((node) => `${node.id}.md`));
document.body.appendChild(renderer.containerEl);

const leaf = {
  view: {
    renderer,
    engine: {
      render: () =>
        renderer.setData({
          nodes: Object.fromEntries(nodes.map((node) => [`${node.id}.md`, { type: "concept" }])),
        }),
    },
  },
};

let enhancer: OfficialGraphEnhancer | null = null;
enhancer = new OfficialGraphEnhancer({
  app: { workspace: { getLeavesOfType: (type: string) => (type === "graph" ? [leaf] : []) } } as never,
  getData: () => ({ graph, insights }),
  getMode: () => "community",
  getDismissed: () => [],
  onDismiss: () => undefined,
  onOpenNode: () => undefined,
  // Fresh sets every call, exactly like `main.ts`: the panel's own state is its
  // problem, and a shared object here would hide the stale copy it used to keep.
  getVisibility: () => ({
    hiddenTypes: new Set(settings.hiddenTypes as never[]),
    hiddenCommunities: new Set(settings.hiddenCommunities),
    hiddenTags: new Set(settings.hiddenTags),
    includedTags: settings.includedTags === null ? null : new Set(settings.includedTags),
    tagFilterMode: settings.tagFilterMode,
    hideStructural: settings.hideStructural,
    hideIsolated: settings.hideIsolated,
  }),
  getTagFilterMode: () => settings.tagFilterMode,
  onSetVisibility: async (patch) => {
    Object.assign(settings, patch);
    // `main.ts` awaits the settings write and only then re-renders the views. The
    // wait is part of the behaviour under test, so it is kept.
    await new Promise((resolve) => setTimeout(resolve, 0));
    enhancer?.refresh();
  },
  getTypeColors: () => ({}),
  getCommunityColors: () => ({}),
  onSetTypeColor: () => undefined,
  onSetCommunityColor: () => undefined,
  onSetLineColor: () => undefined,
  getLineColor: () => null,
  onSetMode: () => undefined,
  getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
  getFocusIntermediates: () => 0,
  onSetFocusIntermediates: () => undefined,
  getHiddenTypes: () => settings.hiddenTypes,
  onToggleType: () => undefined,
});

enhancer.start();

interface OfficialFiltersApi {
  settings: typeof settings;
  enhancer: OfficialGraphEnhancer;
  /** How many distinct tags the fixture's graph carries. */
  tagCount: number;
  /** Each page's tags, so a check can work out what a filter should keep. */
  nodeTags: Record<string, readonly string[]>;
  /** The stand-in renderer, so a check can move its camera. */
  renderer: FakeOfficialRenderer;
}

(window as unknown as { __OFFICIAL_FILTERS__: OfficialFiltersApi }).__OFFICIAL_FILTERS__ = {
  settings,
  enhancer,
  tagCount: TAGS.length,
  nodeTags: Object.fromEntries(nodes.map((node) => [node.id, node.tags])),
  renderer,
};
(window as unknown as { __OFFICIAL_FILTERS_READY__: boolean }).__OFFICIAL_FILTERS_READY__ = true;
