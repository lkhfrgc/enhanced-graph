/**
 * The cache between one vault read and every caller that wants its result.
 *
 * Why it exists: the composition root used to keep the graph as three loose
 * fields, one of them the in-flight promise, and cleared that promise in a
 * `finally`. The guard was real — concurrent callers did share a build — but it
 * was not a cache: the moment a build finished, the next caller started another
 * one. Since a rebuild awaits the build and then asks every open view to reload,
 * and each reload calls back in for the graph, one file save cost a full vault
 * read plus a full analysis for every open view, on top of the one the rebuild
 * itself had already started. Every analyser added later would be multiplied by
 * that factor, so the reuse below is a prerequisite, not an optimisation.
 *
 * Deliberately generic and dependency-free: it knows nothing about Obsidian,
 * about graphs, or about insights. That is what lets the caching rules be tested
 * with no vault, no DOM and no clock, and it is why this module imports nothing
 * at all.
 *
 * Three rules, and why each one is not optional:
 *
 *  1. A finished build is kept and reused until a rebuild is requested.
 *  2. Callers that arrive while a build runs share it — they asked for the same
 *     thing, so a second vault read would be pure waste.
 *  3. A build publishes only under the generation it started in. A request that
 *     lands mid-build must win; if the superseded build could publish, the
 *     request would be silently dropped and the next reader would be handed
 *     pre-request data.
 */

/** How a build reports progress; mirrors `BuildGraphOptions["onProgress"]`. */
export type GraphCacheProgress = (done: number, total: number) => void;

export interface GraphCacheOptions<G, I> {
  /** Read the vault and derive the graph. At most one attempt runs at a time. */
  readonly build: (onProgress?: GraphCacheProgress) => Promise<G>;
  /**
   * Derive the insights for a graph. Vault-free by contract, which is what makes
   * an analysis-only option changeable without a re-read.
   */
  readonly analyze: (graph: G) => I;
  /** Fired by `invalidate()` so the owner can schedule the rebuild it needs. */
  readonly onRequest?: () => void;
}

export interface InvalidateOptions {
  /**
   * Also fire `onRequest`. The vault-change path passes `false`: it owns a
   * debounced rebuild already, and a request per keystroke would replace the
   * debounce with one rebuild per keystroke.
   */
  readonly request?: boolean;
}

/** Both halves of a completed build. The insights describe this graph only. */
export interface BuiltPair<G, I> {
  readonly graph: G;
  readonly insights: I;
}

/**
 * What the cache holds right now. `insights` is null while only the graph is
 * cached — after `invalidateInsights()`, or after a request dropped them.
 */
export interface CachedGraph<G, I> {
  readonly graph: G;
  readonly insights: I | null;
}

interface InFlight<G> {
  readonly generation: number;
  /** Identity of this attempt, so a superseded build cannot publish. */
  readonly token: object;
  readonly promise: Promise<G>;
}

export class GraphCache<G, I> {
  private readonly options: GraphCacheOptions<G, I>;

  /**
   * The last successful build, kept across `invalidate()` on purpose: it is what
   * the next build reads its previous community ids from, and what a synchronous
   * reader (the built-in graph) still has to work with while the rebuild runs.
   */
  private graph: G | null = null;
  /** Which generation produced `graph`; null when nothing is cached. */
  private graphGeneration: number | null = null;
  private insights: I | null = null;
  /** Bumped by every request; makes older builds unpublishable. */
  private generation = 0;
  private inFlight: InFlight<G> | null = null;

  constructor(options: GraphCacheOptions<G, I>) {
    this.options = options;
  }

  /** The cached pair, or null before the first successful build. */
  get cached(): CachedGraph<G, I> | null {
    if (this.graph === null) return null;
    return { graph: this.graph, insights: this.insights };
  }

  /**
   * The graph and its insights, building only when the cached graph is stale.
   *
   * Reuse is the whole point: after a rebuild has warmed this, the N open views
   * that reload behind it all land here and none of them reads the vault again.
   */
  async getGraph(onProgress?: GraphCacheProgress): Promise<BuiltPair<G, I>> {
    const graph = await this.ensureGraph(onProgress);
    return { graph, insights: this.ensureInsights(graph) };
  }

  /**
   * The cached insights, re-derived from the cached graph when they are missing.
   *
   * Null when nothing is cached: there is no graph to analyse, and this never
   * reads the vault — a caller in that state wants `getGraph()`.
   */
  getInsights(): I | null {
    if (this.insights !== null) return this.insights;
    if (this.graph === null) return null;
    return this.ensureInsights(this.graph);
  }

  /** Drop only the insights: an option that affects the analysis changed. */
  invalidateInsights(): void {
    this.insights = null;
  }

  /**
   * Mark the cached graph stale — the next `getGraph()` rebuilds — and drop the
   * insights, which described the graph that is now out of date.
   *
   * The graph itself is deliberately kept. It is the source of the previous
   * community ids that keep cluster colours stable across a rebuild, so blanking
   * it here is exactly the silent stability regression this path invites; it also
   * leaves synchronous readers, the built-in graph among them, with something to
   * colour by until the rebuild lands.
   */
  invalidate(options: InvalidateOptions = {}): void {
    this.generation += 1;
    this.insights = null;
    if (options.request !== false) this.options.onRequest?.();
  }

  /** Back to the state a fresh instance is in; for plugin unload. */
  reset(): void {
    this.generation = 0;
    this.graph = null;
    this.graphGeneration = null;
    this.insights = null;
    this.inFlight = null;
  }

  /** A build for the current generation, shared by everyone who asks for it. */
  private ensureGraph(onProgress?: GraphCacheProgress): Promise<G> {
    const cached = this.graph;
    if (cached !== null && this.graphGeneration === this.generation) return Promise.resolve(cached);

    const pending = this.inFlight;
    // Same generation: they want the same graph, so they wait for the same read.
    // A build from an older generation is deliberately NOT awaited — it can no
    // longer publish, and waiting for it would only delay the rebuild the caller
    // actually asked for.
    if (pending !== null && pending.generation === this.generation) return pending.promise;

    const generation = this.generation;
    const token = {};
    const promise = this.options.build(onProgress).then(
      (graph) => {
        const owned = this.ownsBuild(token, generation);
        // The attempt is over either way. A settled promise left in `inFlight`
        // would answer later callers with the build it already produced, which
        // makes the reuse above unreachable and hides a cache that has stopped
        // caching; it is also exactly the `finally` that used to clear the old
        // guard. Reuse lives in `graph` + `graphGeneration`, in one place.
        if (this.inFlight?.token === token) this.inFlight = null;
        if (owned) {
          this.graph = graph;
          this.graphGeneration = generation;
          // The old analysis described the old graph; `getGraph` derives the new
          // one immediately after this resolves.
          this.insights = null;
        }
        return graph;
      },
      (error: unknown) => {
        // A failure is not a result: clear it so the next caller retries rather
        // than inheriting a rejection for as long as the generation lasts.
        if (this.inFlight?.token === token) this.inFlight = null;
        throw error;
      },
    );
    this.inFlight = { generation, token, promise };
    return promise;
  }

  private ensureInsights(graph: G): I {
    if (this.insights !== null && this.graph === graph) return this.insights;
    const insights = this.options.analyze(graph);
    // A graph that is not the cached one — a build superseded mid-flight, handed
    // to whoever started it — still gets its insights, because the caller asked
    // for the pair; they are just not cached, since the next build's analysis
    // will describe the next graph.
    if (this.graph === graph) this.insights = insights;
    return insights;
  }

  /** Only the current generation's own build may write to the cache. */
  private ownsBuild(token: object, generation: number): boolean {
    return this.inFlight?.token === token && this.generation === generation;
  }
}
