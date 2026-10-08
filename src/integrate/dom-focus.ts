/**
 * One rule, shared by everything we mount on the built-in graph.
 *
 * Rebuilding a container removes the element an interaction is attached to, so
 * the chrome defers its re-renders while a control of ours has focus. The scope
 * matters: only controls whose interaction SURVIVES a rebuild being skipped are
 * inputs — a colour dialog, a half-typed search, a checkbox mid-toggle. A button
 * is not one of them, and treating it as one meant clicking a toolbar button
 * deferred the very re-render that had to move the highlight.
 */
export function isEditingWithin(container: HTMLElement): boolean {
  const active = document.activeElement;
  if (!active || !container.contains(active)) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
