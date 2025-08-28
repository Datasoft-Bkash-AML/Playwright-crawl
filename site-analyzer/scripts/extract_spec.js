// scripts/extract_spec.js
// Usage: node scripts/extract_spec.js <path-to-frontend_report.json>
const fs = require('fs');
const path = require('path');

if (!process.argv[2]) {
  console.error('Usage: node scripts/extract_spec.js <path-to-frontend_report.json>');
  process.exit(1);
}
const src = process.argv[2];
if (!fs.existsSync(src)) {
  console.error('File not found:', src);
  process.exit(1);
}
const outDir = path.join(path.dirname(src), 'spec');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));

// project summary
const project = {
  url: raw.url,
  generatedAt: raw.generatedAt,
  meta: raw.meta,
  palette: { topColors: raw.palette && raw.palette.topColors ? raw.palette.topColors.slice(0, 8) : [] },
  cssVariables: raw.palette && raw.palette.cssVariables ? raw.palette.cssVariables : {},
  fonts: raw.fonts || [],
  globalStyles: raw.globalStyles || {},
  responsiveKeys: Object.keys(raw.responsive || {}),
  assets: raw.assets || {}
};
fs.writeFileSync(path.join(outDir, 'project.json'), JSON.stringify(project, null, 2));

function safeName(sel, i) {
  if (!sel) return `component-${i}`;
  const s = sel.replace(/[^a-z0-9\-_]+/ig, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `comp-${i}`;
  return s.toLowerCase();
}

const compsRaw = raw.components || [];
const MAX = 60; // configurable: how many components to export
const comps = compsRaw.slice(0, MAX).map((c, i) => {
  return {
    id: i + 1,
    name: c.selector ? safeName(c.selector, i + 1) : `component-${i + 1}`,
    selector: c.selector,
    tag: c.tag,
    sampleText: (c.textSample || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    base: c.base || {},
    hoverAfter: (c.hoverDiff && c.hoverDiff.after) ? c.hoverDiff.after : null,
    focusAfter: (c.focusDiff && c.focusDiff.after) ? c.focusDiff.after : null,
    clickAdded: (c.clickDiff && c.clickDiff.classAdded) ? c.clickDiff.classAdded : [],
    clickAfter: (c.clickDiff && c.clickDiff.after) ? c.clickDiff.after : null,
    transitions: c.transitions || '',
    animation: c.animation || '',
    priority: (i < 10) ? 'high' : (i < 30) ? 'medium' : 'low'
  };
});
fs.writeFileSync(path.join(outDir, 'components.json'), JSON.stringify(comps, null, 2));
console.log('Wrote spec/project.json and spec/components.json to', outDir);
