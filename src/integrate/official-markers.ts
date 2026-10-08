/**
 * Rings the focused notes in Obsidian's **built-in** graph.
 *
 * The built-in renderer draws everything into PIXI, so there is no per-node hook
 * to attach a decoration to. This uses the same approach as the standalone view:
 * a transparent 2D canvas layered over the graph, redrawn by the caller on a
 * frame tick while a focus is active.
 *
 * Two things matter for it not to break the graph underneath:
 *  - `pointer-events: none`, so sigma's own picking canvas stays the top hit
 *    target for hovering and right-clicking (see `styles.css`);
 *  - it is removed on detach, leaving the container exactly as it was found.
 */

export interface MarkerPoint {
  x: number;
  y: number;
  radius: number;
}

/** One edge of the focus, in the same CSS-pixel space as {@link MarkerPoint}. */
export interface MarkerLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** How strongly a highlighted edge is drawn, relative to full opacity. */
export const EDGE_OPACITY = 0.55;

/** Thickness of the dark rim that separates the dot from the node beneath it. */
export const MARKER_RIM_PX = 2;

/** Stroke width of a highlighted edge. Thin: the graph's own lines are hairlines. */
export const EDGE_WIDTH_PX = 1.5;

export interface MarkerPalette {
  readonly ring: string;
  readonly halo: string;
}

export class OfficialMarkerLayer {
  private readonly canvas: HTMLCanvasElement;
  private mounted = false;

  constructor(private readonly container: HTMLElement) {
    this.canvas = document.createElement("canvas");
  }

  mount(): void {
    if (this.mounted) return;
    this.canvas.className = "enhanced-graph-marker-layer";
    this.container.appendChild(this.canvas);
    this.mounted = true;
  }

  destroy(): void {
    if (!this.mounted) return;
    this.canvas.remove();
    this.mounted = false;
  }

  /** Redraws the edges and rings; empty lists just clear the layer. */
  draw(points: readonly MarkerPoint[], lines: readonly MarkerLine[], palette: MarkerPalette): void {
    if (!this.mounted) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;

    const ratio = window.devicePixelRatio || 1;
    const backingWidth = Math.round(width * ratio);
    const backingHeight = Math.round(height * ratio);
    if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (points.length === 0 && lines.length === 0) return;

    // The edges are drawn here rather than left to the built-in graph.
    //
    // The built-in graph owns its own edge alpha, and what it ends up drawing is
    // not something this plugin can reliably drive: measured on a real vault, a
    // link with `alpha: 1` was written and stayed written, the render loop was
    // shown not to touch it, and the line still did not read as lit against the
    // ones beside it. Rather than keep chasing the renderer's own state, the
    // focus draws its edges itself — the same choice the marker already makes for
    // the node itself, and for the same reason: the position transform is known
    // and correct, and everything else is ours to decide.
    //
    // Two strokes, matching the marker: a wider dark one that separates the edge
    // from whatever is underneath, and a narrower bright one that carries it.
    if (lines.length > 0) {
      context.lineCap = "round";
      context.beginPath();
      for (const line of lines) {
        if (![line.x1, line.y1, line.x2, line.y2].every(Number.isFinite)) continue;
        context.moveTo(line.x1, line.y1);
        context.lineTo(line.x2, line.y2);
      }
      // One bright stroke, no dark outline.
      //
      // The outline was there to separate the edge from whatever is under it, but
      // at 5px against a 2.5px core the dark stroke dominated and the focus came
      // out as black spokes. A single bright line is what the built-in graph's own
      // highlighted edges look like, which is what these are standing in for.
      // `ring` is the theme-aware one, and that is the whole requirement: light
      // ink on a dark canvas, dark ink on a light one. The palette already sets it
      // that way — #f4f8fa in dark, #0a141c in light — so the edge colour follows
      // the theme without anything further here.
      //
      // `halo` is the opposite of it by design (the marker needs a disc that
      // separates it from the node underneath), and using it for the edges made
      // them white on a light background, where they disappeared entirely.
      context.lineWidth = EDGE_WIDTH_PX;
      context.strokeStyle = palette.ring;
      // Not at full strength: the edges are a background to the nodes, and at full
      // opacity they read as the loudest thing on screen.
      context.globalAlpha = EDGE_OPACITY;
      context.stroke();
      context.globalAlpha = 1;
    }

    if (points.length === 0) return;

    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      // A dot pinned at the node's centre, not a ring around it.
      //
      // A ring has to be exactly the node's radius, and that radius is not
      // readable: `renderer.nodeLookup` holds a data record with no drawn
      // geometry on it, so every formula for it was guesswork against what was
      // on screen. A marker at the CENTRE has no such requirement — the position
      // is computed correctly and the size is ours to choose — which removes the
      // problem instead of approximating it.
      //
      // Two discs, for the same reason the ring had two colours: the dark outer
      // one separates the marker from the node underneath whatever colour that
      // node is, and the bright inner one carries the mark itself.
      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fillStyle = palette.halo;
      context.fill();

      context.beginPath();
      context.arc(point.x, point.y, Math.max(1, point.radius - MARKER_RIM_PX), 0, Math.PI * 2);
      context.fillStyle = palette.ring;
      context.fill();
    }
  }
}
