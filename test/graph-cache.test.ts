/**
 * The cache that stands between one file save and the views that read the graph.
 *
 * Why each group exists, because they protect different failures and one of them
 * is the whole point of the change:
 *
 *  - reuse: `getGraph()` used to share a build only while it was running and then
 *    start a new one. A rebuild awaits the build and then asks every open view to
 *    reload, and each reload calls back in — so this group is the N+1 fix, and it
 *    is the only one that fails if the cache behaves like the old guard.
 *  - requests: a rebuild requested during a build must win. If the superseded
 *    build could publish, the user's request would be silently dropped and the
 *    next reader handed pre-request data.
 *  - insights: an analysis-only change must not cost a vault read. This is the
 *    only group that catches `invalidateInsights()` rebuilding the graph too.
 *  - reset and failure: a rejected build is not a result — caching it would turn
 *    one transient vault error into a graph view that never recovers — and a build
 *    in flight across plugin unload must not repopulate a cache nobody owns.
 *
 * The fixtures are opaque tokens rather than graphs: the cache is generic and
 * imports nothing on purpose, so these tests exercise the caching rules with no
 * vault, no DOM and no clock. No fake timers either — every wait is an explicit
 * await on a promise the test controls.
 */

import { describe, expect, it } from "vitest";

import { GraphCache } from "../src/core/graph-cache";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A promise the test settles by hand, so a build can be held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A cache whose build returns a distinct token per run, with counters for the
 * calls the assertions are about.
 */
function countingCache() {
  const counts = { builds: 0, analyses: 0, requests: 0 };
  const cache = new GraphCache<string, string>({
    build: async () => {
      counts.builds += 1;
      return `graph-${counts.builds}`;
    },
    analyze: (graph) => {
      counts.analyses += 1;
      return `insights-${counts.analyses}-of-${graph}`;
    },
    onRequest: () => {
      counts.requests += 1;
    },
  });
  return { cache, counts };
}

// ---------------------------------------------------------------------------
// Reuse
// ---------------------------------------------------------------------------

describe("graph-cache: reuse", () => {
  it("serves the rebuild and every view reload behind it from one build", async () => {
    const { cache, counts } = countingCache();

    // What a rebuild does: request, then build once on the call the timer makes.
    cache.invalidate();
    const applied = await cache.getGraph();
    // Then each open view reloads and asks for the graph again. Three of them.
    const viewA = await cache.getGraph();
    const viewB = await cache.getGraph();
    const viewC = await cache.getGraph();

    expect(counts.builds).toBe(1);
    expect(counts.analyses).toBe(1);
    expect(applied).toEqual({ graph: "graph-1", insights: "insights-1-of-graph-1" });
    expect(viewA).toEqual(applied);
    expect(viewB).toEqual(applied);
    expect(viewC).toEqual(applied);
  });

  it("shares one build between callers that arrive while it runs", async () => {
    let builds = 0;
    let analyses = 0;
    const gate = deferred<string>();
    const cache = new GraphCache<string, string>({
      build: () => {
        builds += 1;
        return gate.promise;
      },
      analyze: (graph) => {
        analyses += 1;
        return `insights-${analyses}-of-${graph}`;
      },
    });

    const callers = [0, 1, 2, 3, 4].map(() => cache.getGraph());
    gate.resolve("graph-1");
    const pairs = await Promise.all(callers);

    expect(builds).toBe(1);
    // One build means one analysis too: the analysis is part of what a build
    // produces, so sharing the build but not the analysis would still be N+1.
    expect(analyses).toBe(1);
    expect(pairs).toEqual(
      Array.from({ length: 5 }, () => ({ graph: "graph-1", insights: "insights-1-of-graph-1" })),
    );
  });

  it("rebuilds only after a request, not on every call", async () => {
    const { cache, counts } = countingCache();

    const first = await cache.getGraph();
    const reused = await cache.getGraph();
    expect(counts.builds).toBe(1);
    expect(reused).toEqual(first);

    cache.invalidate();
    const rebuilt = await cache.getGraph();

    expect(counts.builds).toBe(2);
    expect(counts.analyses).toBe(2);
    expect(rebuilt).toEqual({ graph: "graph-2", insights: "insights-2-of-graph-2" });
  });

  it("costs one build for one file save, however many views are open", async () => {
    const { cache, counts } = countingCache();

    // The exact production sequence, in order:
    //  1. `vault.on("modify")` → `cache.invalidate({ request: false })`. No
    //     request, because the 1200 ms debounce in main.ts owns the rebuild.
    cache.invalidate({ request: false });
    //  2. The debounce fires → `applyRebuiltGraph()` → `getGraph()` — the one
    //     build a save is allowed to cost.
    const applied = await cache.getGraph();
    //  3. Every open view: `setGraphFromPlugin()` → `reload()` → `getGraph()`.
    const reloads = await Promise.all([0, 1, 2].map(() => cache.getGraph()));

    // Before the cache this was 1 + N builds and 1 + N analyses for N views, and
    // that is the regression this whole group exists to prevent.
    expect(counts.builds).toBe(1);
    expect(counts.analyses).toBe(1);
    for (const pair of reloads) expect(pair).toEqual(applied);
  });

  it("counts one build per view when a request precedes each reload", async () => {
    // The negative control for the test above: the same fan-out with the request
    // main.ts does NOT make between view reloads. The count has to rise — if it
    // could not, "builds === 1" would hold for a cache that rebuilds per caller.
    const { cache, counts } = countingCache();
    cache.invalidate({ request: false });
    await cache.getGraph();

    for (const _view of [0, 1, 2]) {
      cache.invalidate({ request: false });
      await cache.getGraph();
    }

    expect(counts.builds).toBeGreaterThan(1);
    expect(counts.builds).toBe(4);
    expect(counts.analyses).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Requests and generations
// ---------------------------------------------------------------------------

describe("graph-cache: requests", () => {
  it("fires onRequest once per invalidate()", () => {
    const { cache, counts } = countingCache();

    cache.invalidate();
    expect(counts.requests).toBe(1);
    cache.invalidate();
    expect(counts.requests).toBe(2);
  });

  it("does not fire onRequest when the caller already owns the rebuild", () => {
    const { cache, counts } = countingCache();

    // The vault-change path: it has a debounced rebuild queued already, so a
    // request per keystroke would replace that debounce with a rebuild per save.
    cache.invalidate({ request: false });

    expect(counts.requests).toBe(0);
    expect(counts.builds).toBe(0);
  });

  it("keeps the last successful graph readable across invalidate()", async () => {
    const { cache } = countingCache();
    const built = await cache.getGraph();

    cache.invalidate();

    // What keeps cluster colours stable: the next build reads its previous
    // community ids from here, so blanking the graph on a request is the silent
    // regression to avoid. The insights, which described that graph, go.
    const held = cache.cached;
    expect(held?.graph).toBe("graph-1");
    expect(held?.insights).toBeNull();
    expect(held?.graph).toBe(built.graph);
  });

  it("lets the newer build win when a request lands mid-build", async () => {
    let builds = 0;
    const gates = [deferred<string>(), deferred<string>()];
    const cache = new GraphCache<string, string>({
      build: () => {
        builds += 1;
        const gate = gates[builds - 1];
        if (!gate) throw new Error(`unexpected build ${builds}`);
        return gate.promise;
      },
      analyze: (graph) => `insights-of-${graph}`,
    });

    const superseded = cache.getGraph();
    cache.invalidate();
    const requested = cache.getGraph();
    expect(builds).toBe(2);

    // The requested build finishes first, then the one it superseded resolves.
    gates[1].resolve("graph-new");
    await expect(requested).resolves.toEqual({ graph: "graph-new", insights: "insights-of-graph-new" });
    gates[0].resolve("graph-old");
    await expect(superseded).resolves.toEqual({ graph: "graph-old", insights: "insights-of-graph-old" });

    // The late arrival must not overwrite the newer entry, and the next caller
    // must still get what the request asked for.
    expect(cache.cached?.graph).toBe("graph-new");
    const next = await cache.getGraph();
    expect(next.graph).toBe("graph-new");
    expect(builds).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

describe("graph-cache: insights", () => {
  it("recomputes only the insights after invalidateInsights()", async () => {
    const { cache, counts } = countingCache();
    const warm = await cache.getGraph();
    expect(warm.insights).toBe("insights-1-of-graph-1");

    cache.invalidateInsights();
    expect(cache.cached).toEqual({ graph: "graph-1", insights: null });

    // An analysis-only option changed: the vault is not read again, which is the
    // whole reason the two halves are cached separately.
    expect(cache.getInsights()).toBe("insights-2-of-graph-1");
    expect(counts.builds).toBe(1);
    expect(counts.analyses).toBe(2);

    // And the graph stays valid for the next caller: dropping the insights must
    // not leave the cache looking stale, or the separation buys nothing.
    const after = await cache.getGraph();
    expect(after.graph).toBe("graph-1");
    expect(counts.builds).toBe(1);
  });

  it("reuses the insights that are already cached", async () => {
    const { cache, counts } = countingCache();
    await cache.getGraph();

    expect(cache.getInsights()).toBe("insights-1-of-graph-1");
    expect(counts.analyses).toBe(1);
  });

  it("has no insights to return before anything is cached", () => {
    const { cache, counts } = countingCache();

    expect(cache.getInsights()).toBeNull();
    expect(cache.cached).toBeNull();
    expect(counts.builds).toBe(0);
    expect(counts.analyses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reset and failure
// ---------------------------------------------------------------------------

describe("graph-cache: reset and failure", () => {
  it("builds again after reset()", async () => {
    const { cache, counts } = countingCache();
    await cache.getGraph();
    cache.getInsights();

    cache.reset();

    expect(cache.cached).toBeNull();
    expect(cache.getInsights()).toBeNull();
    expect(counts.builds).toBe(1);

    const after = await cache.getGraph();
    expect(after).toEqual({ graph: "graph-2", insights: "insights-2-of-graph-2" });
    expect(counts.builds).toBe(2);
  });

  it("does not cache a failed build, so the next caller retries", async () => {
    let builds = 0;
    const cache = new GraphCache<string, string>({
      build: async () => {
        builds += 1;
        if (builds === 1) throw new Error("vault unavailable");
        return "graph-2";
      },
      analyze: (graph) => `insights-of-${graph}`,
    });

    await expect(cache.getGraph()).rejects.toThrow("vault unavailable");
    expect(cache.cached).toBeNull();

    // The retry is a real build, not a replay of the rejection.
    await expect(cache.getGraph()).resolves.toEqual({ graph: "graph-2", insights: "insights-of-graph-2" });
    expect(builds).toBe(2);
  });

  it("does not let a build that was in flight across reset() publish", async () => {
    let builds = 0;
    const gate = deferred<string>();
    const cache = new GraphCache<string, string>({
      build: () => {
        builds += 1;
        return gate.promise;
      },
      analyze: (graph) => `insights-of-${graph}`,
    });

    const started = cache.getGraph();
    cache.reset();
    gate.resolve("graph-old");
    await expect(started).resolves.toEqual({ graph: "graph-old", insights: "insights-of-graph-old" });

    // Plugin unload: the instance is dropped, but the cache must not come back
    // holding a graph built for the previous session.
    expect(cache.cached).toBeNull();
    expect(cache.getInsights()).toBeNull();
    expect(builds).toBe(1);
  });
});
