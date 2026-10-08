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
      // Two rings: a dark halo so the marker reads against a bright node, and a
      // bright ring so it reads against a dark one — the same treatment the
      // standalone view gives a focused note.
      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.lineWidth = 5;
      context.strokeStyle = palette.halo;
      context.stroke();

      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.lineWidth = 2.5;
      context.strokeStyle = palette.ring;
      context.stroke();
    }
  }
}
