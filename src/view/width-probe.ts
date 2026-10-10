/**
 * A one-shot width report, for diagnosing a layout that a harness cannot reproduce.
 *
 * The insight panel's width was declared, measured correct in the browser harness, and
 * still changed in the graph view inside Obsidian. Two causes were found and fixed that
 * way — `box-sizing` drawing 337px for a declared 320, and `flex-shrink` letting the
 * host pane pull it narrower — and the width still moved, which means the remaining
 * cause lives in the host's layout and not in a fixture.
 *
 * So rather than guess a third time, the panel can be asked. `reportPanelWidth` walks
 * up from the panel and returns the facts that decide a CSS width: what the panel
 * measured, what the stylesheet asked for, whether the stylesheet is even applied, and
 * which ancestor is the first to be narrower than the panel — the last one is the key,
 * because a flex item cannot be wider than the space its parent gives it however loudly
 * its own rule insists.
 *
 * A custom event rather than a command, so it costs no UI: paste one line into the
 * developer console, and the answer comes back as a string to copy.
 */

/** The event a console one-liner dispatches to ask the panel for its numbers. */
export const WIDTH_PROBE_EVENT = "enhanced-graph:width-probe";

/**
 * Every panel currently in the DOM, not just the first.
 *
 * Obsidian can hold more than one graph leaf — a split, a second window, a reopened view
 * — and the two can be at different widths. Reporting only the first is how a probe can
 * answer "320px, fine" while the reader is looking at a different panel that is not.
 */
export function allPanels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".enhanced-graph-panel"));
}

/** Report every panel, one after another, so a mismatch between two is visible. */
export function reportAllPanels(): string {
  const panels = allPanels();
  if (panels.length === 0) return "enhanced-graph: no insight panel in the DOM";
  return panels
    .map((panel, index) => `[panel ${index + 1} of ${panels.length}]\n${reportPanelWidth(panel)}`)
    .join("\n\n");
}

/**
 * Log the panel's geometry once, unprompted, after the first layout.
 *
 * A self-report rather than something the reader has to know to ask for. The defect this
 * exists for could not be reproduced outside Obsidian: three successive fixes measured
 * correct in the browser harness and none of them held in the app, and every round trip
 * spent the reader's patience on a request I could have answered myself. So the numbers
 * are printed on the first render, in the console they already know how to open, and the
 * answer arrives without a question.
 *
 * Once per session on purpose: a panel that logs on every rebuild would bury the reader's
 * own console output, and the first layout is the one that answers the question.
 */
let reported = false;

export function reportPanelGeometryOnce(getPanel: () => HTMLElement | null): void {
  if (reported) return;
  reported = true;
  const run = (): void => {
    const panel = getPanel();
    if (!panel || panel.getBoundingClientRect().width === 0) {
      // Laid out as nothing yet — put it back and try after the next frame, or the
      // report would be a page of zeroes that looks like a layout failure.
      reported = false;
      return;
    }
    // eslint-disable-next-line no-console
    console.log(reportPanelWidth(panel));
  };
  // Two frames: one for the DOM the caller just built, one for layout to settle.
  requestAnimationFrame(() => requestAnimationFrame(run));
}
/** What the probe learned, as a line of text for the console. */
export function reportPanelWidth(panel: HTMLElement | null): string {
  if (!panel) return "enhanced-graph: the insight panel is not in the DOM (is the view open?)";

  const rect = panel.getBoundingClientRect();
  const style = getComputedStyle(panel);
  const parts: string[] = [
    `panel: ${Math.round(rect.width)}x${Math.round(rect.height)}px`,
    `panel boxes: client ${panel.clientWidth}px, offset ${panel.offsetWidth}px, ` +
      `gutter ${panel.offsetWidth - panel.clientWidth}px ` +
      `(scrollbar-gutter: ${style.scrollbarGutter}; scrollHeight ${panel.scrollHeight} ` +
      `vs client ${panel.clientHeight})`,
    `declared: width=${style.width} min=${style.minWidth} max=${style.maxWidth}`,
    `flex: ${style.flexGrow} ${style.flexShrink} ${style.flexBasis}`,
    `box-sizing: ${style.boxSizing}`,
    `display: ${style.display}; parent display: ${panel.parentElement ? getComputedStyle(panel.parentElement).display : "-"}`,
    `classes: ${panel.className}`,
  ];

  // The cards, which is where the width the reader notices actually lives. A panel holds
  // one width while its cards vary — a scrollbar taking the gutter, a wide child setting
  // a floor — so reporting only the panel is what made this defect invisible: every
  // previous probe said 320px and was right.
  const cards = Array.from(panel.querySelectorAll<HTMLElement>(".enhanced-graph-card"));
  if (cards.length > 0) {
    const widths = cards.map((card) => Math.round(card.getBoundingClientRect().width));
    const unique = [...new Set(widths)].sort((a, b) => a - b);
    const widest = cards.reduce((best, card) =>
      card.scrollWidth > best.scrollWidth ? card : best,
    );
    parts.push(
      `cards: ${cards.length}, widths ${unique.join("/")}px, ` +
        `max scrollWidth ${Math.max(...cards.map((card) => card.scrollWidth))}px`,
    );
    // The card whose content overflows its own box is the one setting the width, and
    // naming it saves a round trip: the fix is in that element, not in the panel.
    if (widest.scrollWidth > widest.clientWidth) {
      parts.push(
        `OVERFLOWING CARD: ${widest.className} scrollWidth ${widest.scrollWidth} > ` +
          `clientWidth ${widest.clientWidth}; text: ${(widest.textContent ?? "").trim().slice(0, 80)}`,
      );
    }
  } else {
    parts.push("cards: none in this group");
  }

  // The descendant tree, outdented by depth. A card that is wider than its siblings is
  // wider because of something *inside* it, and the class names are what make that
  // identifiable from a pasted report instead of another round of guessing.
  const rows: string[] = [];
  let budget = 60;
  const walk = (node: Element, depth: number): void => {
    if (budget <= 0) return;
    budget -= 1;
    const el = node as HTMLElement;
    const box = el.getBoundingClientRect();
    rows.push(
      `${"  ".repeat(depth)}${el.className || el.tagName} ` +
        `${Math.round(box.width)}x${Math.round(box.height)} ` +
        `(scroll ${el.scrollWidth}, client ${el.clientWidth})`,
    );
    for (const child of Array.from(node.children)) walk(child, depth + 1);
  };
  for (const child of Array.from(panel.children)) walk(child, 1);
  parts.push(`tree:\n    ${rows.join("\n    ")}`);

  // Is the stylesheet loaded at all? A panel with no rule is a different bug from a
  // panel whose rule is being overridden, and the two look identical on screen.
  const stylesheetLoaded = Array.from(document.styleSheets).some((sheet) => {
    try {
      return Array.from(sheet.cssRules).some(
        (rule) => rule instanceof CSSStyleRule && rule.selectorText === ".enhanced-graph-panel",
      );
    } catch {
      // A cross-origin sheet cannot be read; treat it as "not ours".
      return false;
    }
  });
  parts.push(`stylesheet rule present: ${stylesheetLoaded}`);

  // The ancestor chain, and the first link narrower than the panel: that is where the
  // space runs out, and no rule on the panel itself can win against it.
  const chain: string[] = [];
  let firstNarrower = "";
  let node: HTMLElement | null = panel;
  while (node && node !== document.body) {
    const width = Math.round(node.getBoundingClientRect().width);
    const parentStyle = getComputedStyle(node);
    chain.push(`${node.className || node.tagName}:${width}`);
    if (firstNarrower === "" && width < rect.width) {
      firstNarrower =
        `${node.className || node.tagName} is ${width}px, narrower than the panel's ` +
        `${Math.round(rect.width)}px (display: ${parentStyle.display}, ` +
        `flex: ${parentStyle.flexGrow} ${parentStyle.flexShrink} ${parentStyle.flexBasis}, ` +
        `min-width: ${parentStyle.minWidth}, overflow-x: ${parentStyle.overflowX})`;
    }
    node = node.parentElement;
  }
  parts.push(`ancestors: ${chain.join(" < ")}`);
  if (firstNarrower !== "") parts.push(`FIRST NARROWER ANCESTOR: ${firstNarrower}`);

  return `enhanced-graph width probe\n  ${parts.join("\n  ")}`;
}

/**
 * Answer the probe event, and return a detach function.
 *
 * Listening on `document` means the console does not need a reference to the view, which
 * is the whole point — the person running it should not have to find the instance first.
 */
export function listenForWidthProbe(): () => void {
  const handler = (): void => {
    // Every panel, not just the view's own: a probe that reports one of two is how a
    // measurement can be right while the reader is still looking at the wrong thing.
    // eslint-disable-next-line no-console
    console.log(reportAllPanels());
  };
  document.addEventListener(WIDTH_PROBE_EVENT, handler);
  return () => document.removeEventListener(WIDTH_PROBE_EVENT, handler);
}
