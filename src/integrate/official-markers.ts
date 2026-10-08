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

/** Thickness of the dark rim that separates the dot from the node beneath it. */
export const MARKER_RIM_PX = 2;

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

  /** Redraws the rings; an empty list just clears the layer. */
  draw(points: readonly MarkerPoint[], palette: MarkerPalette): void {
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
