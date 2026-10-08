/**
 * Measures the browser rule the built-in graph's panel is built around.
 *
 * `OfficialSidePanel` defers its re-renders while a control of ours is being
 * used, and the reason is stronger than "the interaction would be interrupted":
 * if the element a press is being delivered to is removed before the press ends,
 * Chromium dispatches NO `click` at all. That is what made 全部恢复 look dead on
 * the first press — the deferred re-render flushed on `focusout` (which fires on
 * mousedown, because pressing a button focuses it) and rebuilt the button out
 * from under the pointer.
 *
 * Every scenario drives real mouse input through a real browser; the numbers are
 * the evidence, so this is re-runnable rather than a claim in a comment.
 *
 * Usage: node scripts/verify-click-during-rebuild.mjs
 */
import { chromium } from "playwright-core";

const pageHtml = (scenario) => `<!doctype html><body style="margin:0">
  <div id="host" style="padding:20px">
    <label><input id="box" type="checkbox" checked> tag row</label>
    <div id="panel" style="padding:10px"><button id="btn" style="width:220px;height:44px">全部恢复</button></div>
  </div>
  <script>
    window.log = [];
    const L = (m) => window.log.push(m);
    const scenario = ${JSON.stringify("SCENARIO")};
    L("attached " + scenario);
    const wire = () => {
      const b = document.getElementById("btn");
      b.addEventListener("click", () => L("CLICK reached the button"));
      b.addEventListener("mousedown", () => {
        if (scenario === "B") { L("rebuild now (mousedown)"); rebuild(); }
      });
    };
    const rebuild = () => {
      document.getElementById("panel").innerHTML = '<button id="btn" style="width:220px;height:44px">全部恢复</button>';
      wire();
    };
    if (scenario === "C" || scenario === "D") {
      document.getElementById("host").addEventListener("focusout", () => {
        window.setTimeout(rebuild, 0);
      });
    }
    if (scenario === "E" || scenario === "F") {
      window.addEventListener("mouseup", () => {
        if (scenario === "E") window.setTimeout(rebuild, 0);
        else rebuild();
      });
      document.getElementById("host").addEventListener("focusout", () => window.setTimeout(rebuild, 0));
    }
    wire();
  </script></body>`.replace('"SCENARIO"', JSON.stringify(scenario));

const browser = await chromium.launch({ channel: process.env.HARNESS_BROWSER ?? "msedge", headless: true });

/**
 * True when a real click reached the button.
 *
 * `holdMs` is the gap between the press and the release. It is the measurement
 * that matters: an instant click loses the race against a 0ms timer (which is why
 * four earlier attempts to reproduce this with synthetic clicks all passed with
 * the bug present), while a press held for as long as a person holds one does not.
 */
async function press(which, holdMs) {
  const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
  await page.goto("about:blank");
  await page.setContent(pageHtml(which));
  await page.waitForFunction((want) => window.log?.[0] === `attached ${want}`, which);

  // A person clicks a tag checkbox first; a real click leaves it focused, which
  // is what defers the panel's re-render in the first place.
  const box = await page.locator("#box").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);

  const button = await page.locator("#btn").boundingBox();
  const x = button.x + button.width / 2;
  const y = button.y + button.height / 2;
  if (holdMs === null) {
    // One call, press and release back to back: as little time as a click can
    // take, which leaves the 0ms timer no room to run in between.
    await page.mouse.click(x, y);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(holdMs);
    await page.mouse.up();
  }
  await page.waitForTimeout(300);

  const log = await page.evaluate(() => window.log);
  await page.close();
  return { reached: log.some((line) => line.startsWith("CLICK reached")), log };
}

const scenarios = [
  ["A", "no rebuild (control)", 120],
  ["B", "rebuild on mousedown", 120],
  ["C", "rebuild 0ms after focusout, one-call click", null],
  ["D", "rebuild 0ms after focusout, 120ms press", 120],
  ["E", "rebuild 0ms after mouseup", 120],
  ["F", "rebuild on mouseup", 120],
];

const results = [];
for (const [which, label, holdMs] of scenarios) {
  const { reached } = await press(which, holdMs);
  results.push({ which, label, reached });
  console.log(`${reached ? "reached" : "DROPPED"}  ${which}  ${label}`);
}
await browser.close();

const control = results.find((entry) => entry.which === "A").reached;
const instant = results.find((entry) => entry.which === "C").reached;
const humanPace = results
  .filter((entry) => !["A", "C"].includes(entry.which))
  .every((entry) => !entry.reached);
console.log("");
console.log("The control must be delivered, and a press at human pace must be dropped;");
console.log("the instant click in C is the trap that made this look unreproducible.");
console.log(
  control && humanPace
    ? "PASS: a press that spans a rebuild is dropped; only the untouched control is delivered"
    : "FAIL: the rule this panel depends on no longer holds — see the lines above",
);
console.log(`  control delivered: ${control}; human-pace presses all dropped: ${humanPace}; instant click delivered: ${instant}`);
process.exit(control && humanPace ? 0 : 1);
