// crawl_full.js
// Usage: node crawl_full.js https://demos.reytheme.com/san-francisco/

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 768 },
  { name: "wide", width: 1440, height: 900 },
];

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node crawl_full.js <url>");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const report = {
    url,
    generatedAt: new Date().toISOString(),
    meta: {},
    palette: { colors: [], cssVariables: {}, topColors: [] },
    fonts: [],
    globalStyles: {},
    components: [],
    sticky: [],
    responsive: {},
    assets: { images: [], scripts: [], stylesheets: [] },
    summary: {},
  };

  // Helper: evaluate page for basic meta
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(600);

  // META: title, description, viewport
  const meta = await page.evaluate(() => {
    const title = document.title || "";
    const descTag = document.querySelector('meta[name="description"]');
    const description = descTag ? descTag.getAttribute("content") : "";
    const viewportTag = document.querySelector('meta[name="viewport"]');
    const viewport = viewportTag ? viewportTag.getAttribute("content") : "";
    const htmlLang = document.documentElement.lang || "";
    return { title, description, viewport, htmlLang };
  });
  report.meta = meta;

  // ASSETS: images, scripts, stylesheets
  const assets = await page.evaluate(() => {
    const imgs = Array.from(document.images || []).map(i => ({ src: i.currentSrc || i.src, alt: i.alt || "" }));
    const scripts = Array.from(document.scripts || []).map(s => ({ src: s.src || "", async: s.async || false, defer: s.defer || false }));
    const styles = Array.from(document.styleSheets || []).map(ss => ({ href: ss.href || "inline", owner: ss.ownerNode ? ss.ownerNode.tagName : "unknown" }));
    return { imgs, scripts, styles };
  });
  report.assets.images = assets.imgs;
  report.assets.scripts = assets.scripts;
  report.assets.stylesheets = assets.styles;

  // CSS vars & color palette and fonts
  const styleInfo = await page.evaluate(() => {
    // collect CSS variables (root)
    const root = getComputedStyle(document.documentElement);
    const cssVars = {};
    for (let i = 0; i < root.length; i++) {
      const name = root[i];
      if (name.startsWith("--")) {
        cssVars[name] = root.getPropertyValue(name).trim();
      }
    }

    // gather computed colors and fonts used on page (sample up to N elements to avoid exploding)
    const elements = Array.from(document.querySelectorAll("*")).slice(0, 2000);
    const colorSet = new Set();
    const bgSet = new Set();
    const fontSet = new Set();
    for (const el of elements) {
      try {
        const cs = getComputedStyle(el);
        if (cs.color) colorSet.add(cs.color);
        if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") bgSet.add(cs.backgroundColor);
        if (cs.fontFamily) fontSet.add(cs.fontFamily);
      } catch (e) {
        // ignore
      }
    }
    return {
      cssVars,
      colors: Array.from(colorSet),
      backgroundColors: Array.from(bgSet),
      fonts: Array.from(fontSet),
    };
  });
  report.palette.cssVariables = styleInfo.cssVars;
  report.palette.colors = [...new Set([...styleInfo.colors, ...styleInfo.backgroundColors])];
  report.fonts = styleInfo.fonts;

  // Global body computed style
  const global = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return {
      bodyBg: cs.backgroundColor,
      bodyColor: cs.color,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      transition: cs.transition || null,
    };
  });
  report.globalStyles = global;

  // find interactive targets: buttons, links, inputs, selects, navs, images, cards (heuristic)
  const selectors = await page.evaluate(() => {
    function uniq(a) { return Array.from(new Set(a)); }
    const buttons = Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], .btn, [role='button']"));
    const links = Array.from(document.querySelectorAll("a"));
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    const navs = Array.from(document.querySelectorAll("nav, header"));
    const cards = Array.from(document.querySelectorAll(".card, [class*='card'], .product, .post, article")).slice(0, 200);
    // produce robust selector for each element: use tag + classes + nth-of-type fallback
    function makeSel(el) {
      if (!el || !el.tagName) return null;
      let s = el.tagName.toLowerCase();
      if (el.id) s += `#${el.id}`;
      else if (el.classList && el.classList.length) {
        const cls = Array.from(el.classList).slice(0,3).map(c => c.replace(/\s+/g,"")).join(".");
        s += `.${cls}`;
      } else {
        // fallback nth-of-type
        const parent = el.parentElement;
        if (!parent) return s;
        const tag = el.tagName;
        const siblings = Array.from(parent.children).filter(ch => ch.tagName === tag);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(el)+1;
          s = `${s}:nth-of-type(${idx})`;
        }
      }
      return s;
    }
    const uniqSel = (arr) => uniq(arr.map(makeSel).filter(Boolean)).slice(0, 500);
    return {
      buttons: uniqSel(buttons),
      links: uniqSel(links),
      inputs: uniqSel(inputs),
      navs: uniqSel(navs),
      cards: uniqSel(cards),
    };
  });

  // function to capture computed style snapshot for a selector (first matched)
  async function styleSnapshotFor(sel) {
    try {
      const exists = await page.$(sel);
      if (!exists) return null;
      return await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          selector: selector,
          tag: el.tagName,
          classList: Array.from(el.classList || []),
          id: el.id || null,
          text: el.innerText ? el.innerText.trim().slice(0,120) : "",
          computed: {
            color: cs.color,
            backgroundColor: cs.backgroundColor,
            borderColor: cs.borderColor,
            borderRadius: cs.borderRadius,
            boxShadow: cs.boxShadow,
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            padding: cs.padding,
            margin: cs.margin,
            display: cs.display,
            position: cs.position,
            top: cs.top, left: cs.left,
            transition: cs.transition,
            transitionDuration: cs.transitionDuration,
            animationName: cs.animationName,
            animationDuration: cs.animationDuration,
            cursor: cs.cursor,
          },
          rect,
        };
      }, sel);
    } catch (e) {
      return { selector: sel, error: String(e) };
    }
  }

  // Inspect candidate selectors and simulate interactions
  const componentList = [];
  const inspectSelectors = [
    ...selectors.navs.slice(0,20),
    ...selectors.buttons.slice(0,200),
    ...selectors.links.slice(0,200),
    ...selectors.cards.slice(0,200),
    ...selectors.inputs.slice(0,100),
  ];

  console.log(`Inspecting ${inspectSelectors.length} selected elements...`);

  // helper to track classList changes on click/hover
  async function computeBeforeAfter(sel, action) {
    // return {before, after, classDiff, computedBefore, computedAfter}
    const before = await styleSnapshotFor(sel);
    // perform action
    try {
      if (action === "hover") {
        await page.hover(sel, { force: true, timeout: 2000 }).catch(()=>{});
        await page.waitForTimeout(150);
      } else if (action === "click") {
        // click but catch navigation
        await Promise.race([
          page.click(sel, { timeout: 2000 }).catch(()=>{}),
          page.waitForTimeout(500)
        ]);
        await page.waitForTimeout(200);
      } else if (action === "focus") {
        await page.focus(sel).catch(()=>{});
        await page.waitForTimeout(100);
      } else if (action === "mousedown") {
        await page.dispatchEvent(sel, 'mousedown').catch(()=>{});
        await page.waitForTimeout(100);
        await page.dispatchEvent(sel, 'mouseup').catch(()=>{});
      }
    } catch (e) {
      // ignore
    }
    const after = await styleSnapshotFor(sel);
    // class differences
    const beforeClasses = (before && before.classList) || [];
    const afterClasses = (after && after.classList) || [];
    const added = afterClasses.filter(c => !beforeClasses.includes(c));
    const removed = beforeClasses.filter(c => !afterClasses.includes(c));
    return { selector: sel, before, after, classAdded: added, classRemoved: removed };
  }

  // Iterate through selectors and capture states
  for (let i=0;i<inspectSelectors.length;i++) {
    const sel = inspectSelectors[i];
    try {
      // skip overly generic selectors which might be invalid
      if (!sel || sel.length > 200) continue;
      const base = await styleSnapshotFor(sel);
      if (!base) continue;

      // hover
      let hoverRes = null;
      try { hoverRes = await computeBeforeAfter(sel, "hover"); } catch(e) { hoverRes = { error: String(e) }; }

      // focus
      let focusRes = null;
      try { focusRes = await computeBeforeAfter(sel, "focus"); } catch(e) { focusRes = { error: String(e) }; }

      // click (note: may trigger navigation; we attempt but will recover by reloading url if needed)
      let clickRes = null;
      const beforeUrl = page.url();
      try {
        clickRes = await computeBeforeAfter(sel, "click");
        // if navigation happened, go back
        if (page.url() !== beforeUrl) {
          await page.goto(beforeUrl, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(400);
        }
      } catch(e) { clickRes = { error: String(e) }; }

      // mousedown (active)
      let downRes = null;
      try { downRes = await computeBeforeAfter(sel, "mousedown"); } catch(e) { downRes = { error: String(e) }; }

      // capture transitions/animations summary for element
      const transitions = (base && base.computed && base.computed.transition) || "";
      const animation = (base && base.computed && base.computed.animationName) || "";
      componentList.push({
        selector: sel,
        tag: base.tag,
        textSample: base.text,
        base: base.computed,
        transitions,
        animation,
        hoverDiff: hoverRes ? { classAdded: hoverRes.classAdded, classRemoved: hoverRes.classRemoved, after: hoverRes.after ? hoverRes.after.computed : null } : null,
        focusDiff: focusRes ? { classAdded: focusRes.classAdded, classRemoved: focusRes.classRemoved, after: focusRes.after ? focusRes.after.computed : null } : null,
        clickDiff: clickRes ? { classAdded: clickRes.classAdded, classRemoved: clickRes.classRemoved, after: clickRes.after ? clickRes.after.computed : null } : null,
        mousedownDiff: downRes ? { classAdded: downRes.classAdded, classRemoved: downRes.classRemoved, after: downRes.after ? downRes.after.computed : null } : null,
      });
    } catch (err) {
      console.warn("inspect error for", sel, err && err.message);
    }
  }

  report.components = componentList;

  // Detect sticky navs & scroll-triggered changes
  // Strategy: collect nav/header elements and detect their rect.top at multiple scroll positions
  const navSelectors = selectors.navs;
  const stickyResults = [];
  for (const nsel of navSelectors.slice(0,20)) {
    try {
      const initial = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        return { top: el.getBoundingClientRect().top, position: getComputedStyle(el).position, classList: Array.from(el.classList || []) };
      }, nsel);
      // scroll down
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight/2, behavior: 'instant' }));
      await page.waitForTimeout(300);
      const mid = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        return { top: el.getBoundingClientRect().top, position: getComputedStyle(el).position, classList: Array.from(el.classList || []) };
      }, nsel);
      // scroll bottom
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
      await page.waitForTimeout(300);
      const bottom = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        return { top: el.getBoundingClientRect().top, position: getComputedStyle(el).position, classList: Array.from(el.classList || []) };
      }, nsel);
      stickyResults.push({ selector: nsel, initial, mid, bottom });
    } catch(e) {
      // ignore
    }
  }
  report.sticky = stickyResults;

  // Scroll-triggered reveal detection:
  // For up to N elements, store visibility/opacity/translate before and after scrolling to detect reveal animations
  const revealCandidates = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('section, .section, [data-aos], [data-animate], .animate')).slice(0, 200);
    function selOf(el) {
      if (!el.tagName) return null;
      let s = el.tagName.toLowerCase();
      if (el.id) s += `#${el.id}`; else if (el.classList && el.classList.length) s += `.${Array.from(el.classList).slice(0,2).join('.')}`;
      return s;
    }
    return els.map(selOf).filter(Boolean);
  });

  const reveals = [];
  for (const rs of revealCandidates) {
    try {
      const before = await page.evaluate((s) => {
        const el = document.querySelector(s); if (!el) return null;
        const cs = getComputedStyle(el);
        return { opacity: cs.opacity, transform: cs.transform, visibility: cs.visibility, top: el.getBoundingClientRect().top };
      }, rs);
      // scroll to element
      await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return;
        el.scrollIntoView({ block: "center", behavior: "instant" });
      }, rs);
      await page.waitForTimeout(400);
      const after = await page.evaluate((s) => {
        const el = document.querySelector(s); if (!el) return null;
        const cs = getComputedStyle(el);
        return { opacity: cs.opacity, transform: cs.transform, visibility: cs.visibility, top: el.getBoundingClientRect().top };
      }, rs);
      reveals.push({ selector: rs, before, after });
    } catch(e) {}
  }
  report.reveals = reveals;

  // RESPONSES: capture responsive differences at multiple breakpoints
  for (const vp of VIEWPORTS) {
    try {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);
      // snapshot: header rect, number of columns in common grid, main nav visibility
      const snap = await page.evaluate(() => {
        const header = document.querySelector('header') || document.querySelector('nav') || document.querySelector('main');
        const headerRect = header ? header.getBoundingClientRect() : null;
        // heuristics: count columns for common grids
        const grids = Array.from(document.querySelectorAll('.row, .grid, [class*="columns"], .product-grid')).slice(0,10).map(g=>{
          const items = g.children.length;
          return { class: g.className, items };
        });
        // detect mobile menu button
        const hamburger = document.querySelector('.hamburger, .menu-toggle, .mobile-toggle, .navbar-toggler') ? true : false;
        return {
          headerRect,
          grids,
          hamburger,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight
        };
      });
      report.responsive[vp.name] = snap;

      // take a screenshot for reference
      const shotsDir = path.join(process.cwd(), "screenshots");
      if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir);
      const shotPath = path.join(shotsDir, `screenshot-${vp.name}-${nowIso()}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      report.responsive[vp.name].screenshot = shotPath;
    } catch (e) {
      console.warn("responsive snapshot error", e && e.message);
    }
  }

  // Summarize palette: top used colors frequency
  const colorCounts = {};
  for (const comp of componentList) {
    try {
      const color = comp.base && comp.base.color;
      const bg = comp.base && comp.base.backgroundColor;
      if (color) colorCounts[color] = (colorCounts[color] || 0) + 1;
      if (bg) colorCounts[bg] = (colorCounts[bg] || 0) + 1;
    } catch {}
  }
  const sortedColors = Object.entries(colorCounts).sort((a,b)=>b[1]-a[1]).map(e=>({color:e[0], count:e[1]}));
  report.palette.topColors = sortedColors.slice(0,30);

  // Fonts summary
  report.fontSummary = { fonts: report.fonts.slice(0,20) };

  // Write JSON report
  const outJson = path.join(process.cwd(), `frontend_report_${nowIso()}.json`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf-8");
  console.log("✅ JSON report:", outJson);

  // Generate simple Markdown summary
  function simpleMd() {
    const lines = [];
    lines.push(`# Frontend Report — ${url}`);
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push("");
    lines.push(`## Meta`);
    lines.push(`- Title: ${report.meta.title}`);
    lines.push(`- Description: ${report.meta.description || "-"}`);
    lines.push(`- Viewport meta: ${report.meta.viewport || "-"}`);
    lines.push("");
    lines.push(`## Top Colors (by occurrence)`);
    for (const c of report.palette.topColors.slice(0,12)) {
      lines.push(`- ${c.color} (count ${c.count})`);
    }
    lines.push("");
    lines.push(`## CSS Variables (sample)`);
    const vars = report.palette.cssVariables;
    for (const k of Object.keys(vars).slice(0,20)) lines.push(`- ${k}: ${vars[k]}`);
    lines.push("");
    lines.push(`## Fonts (sample)`);
    for (const f of report.fontSummary.fonts.slice(0,10)) lines.push(`- ${f}`);
    lines.push("");
    lines.push(`## Assets`);
    lines.push(`- Images: ${report.assets.images.length}`);
    lines.push(`- Scripts: ${report.assets.scripts.length}`);
    lines.push(`- Stylesheets: ${report.assets.stylesheets.length}`);
    lines.push("");
    lines.push(`## Sticky / Scroll-detected navs`);
    for (const s of report.sticky.slice(0,10)) {
      lines.push(`- ${s.selector} => initial.top: ${s.initial ? s.initial.top : "N/A"}, mid.top: ${s.mid ? s.mid.top : "N/A"}, bottom.top: ${s.bottom ? s.bottom.top : "N/A"}`);
    }
    lines.push("");
    lines.push(`## Components sampled (first 30)`);
    for (const c of report.components.slice(0,30)) {
      lines.push(`- ${c.selector} (${c.tag}) — text: "${(c.textSample||"").replace(/\n/g," ").slice(0,60)}"`);
      if (c.transitions) lines.push(`  - transitions: ${c.transitions}`);
      if (c.animation) lines.push(`  - animation: ${c.animation}`);
      if (c.hoverDiff && c.hoverDiff.after) {
        lines.push(`  - hover changes: color ${c.hoverDiff.after.color || "-"}, bg ${c.hoverDiff.after.backgroundColor || "-"}`);
      }
    }
    lines.push("");
    lines.push(`## Responsive snapshots`);
    for (const k of Object.keys(report.responsive)) {
      lines.push(`- ${k}: innerWidth=${report.responsive[k].innerWidth}, hamburger=${report.responsive[k].hamburger}`);
      if (report.responsive[k].screenshot) lines.push(`  - Screenshot: ${report.responsive[k].screenshot}`);
    }
    lines.push("");
    lines.push("## Notes & Next steps");
    lines.push("- This is an automated extraction. Manually verify complex interactive behaviors (e.g., carousels, auth-driven content).");
    lines.push("- To capture more elements increase selection limits in the script.");
    return lines.join("\n");
  }

  const md = simpleMd();
  const mdPath = path.join(process.cwd(), `frontend_report_${nowIso()}.md`);
  fs.writeFileSync(mdPath, md, "utf-8");
  console.log("✅ Markdown report:", mdPath);

  await browser.close();
  console.log("Done. Review JSON for full detail and screenshots folder for responsive images.");
})();
