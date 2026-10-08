/**
 * Canonical identity for an undirected edge.
 *
 * The plugin keys edges by their two node ids in sorted order in several
 * places — insight dismiss keys, renderer highlight sets, path results — so the
 * rule lives here rather than being re-derived at each call site.
 */

/** Order-independent key for the edge between two nodes. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}:::${b}` : `${b}:::${a}`;
}

/** The two endpoints encoded in an {@link edgeKey}, in the same order. */
export function edgeKeyEndpoints(key: string): [string, string] {
  const at = key.indexOf(":::");
  return at < 0 ? [key, key] : [key.slice(0, at), key.slice(at + 3)];
}
