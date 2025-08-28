# Site Analyzer (Playwright)


This small tool crawls a given URL using Playwright (Chromium) and extracts a frontend analysis report. It is primarily intended as an intermediate step to help generate frontend implementation artifacts (design tokens, component specs, templates).

What it produces
- A JSON report containing metadata, assets, sampled component styles/interactions, palette and font info (e.g. `frontend_report_<timestamp>.json`).
- A human-readable Markdown summary (e.g. `frontend_report_<timestamp>.md`).
- A `screenshots/` folder with viewport screenshots for different breakpoints.

Quick start (tested on Ubuntu-derived systems)

1. Ensure you have Node.js (v18+ recommended) and `npm` installed.
2. From the `site-analyzer` directory install Node dependencies:

```bash
cd /workspaces/Playwright-crawl/site-analyzer
npm install
```

3. Install system dependencies required by Playwright (may require sudo) and install browsers:

```bash
# install system deps (may use sudo)
npx playwright install-deps
# install browser binaries
npx playwright install --with-deps
```

Preferred flow (recommended for generating production-ready frontend code)

Use the crawler to produce a full report once, then run the extractor to create a compact `spec/` you can safely feed to an LLM or an automated generator. This avoids repeatedly sending huge JSON files to models and makes generation deterministic.

1) Generate the full report (one-time):

```bash
node crawl_full.js https://demos.reytheme.com/san-francisco/
# or use npm script
npm run analyze -- https://demos.reytheme.com/san-francisco/
```

2) Create compact spec files (recommended):

```bash
# run the extractor to create spec/project.json and spec/components.json
node scripts/extract_spec.js ./frontend_report_<timestamp>.json
```

3) Use the generated `spec/` files when prompting a code generator or Copilot. The compact spec contains `project.json` (meta, tokens, fonts, global styles) and `components.json` (compact per-component summaries). This is the preferred input for LLM-driven code generation.

Example: run the extractor on the current report in this repo:

```bash
cd /workspaces/Playwright-crawl/site-analyzer
node scripts/extract_spec.js ./frontend_report_2025-08-28T07-06-55-953Z.json
```

You will get:
- `spec/project.json` — short project summary (meta, tokens, fonts, global styles)
- `spec/components.json` — compact array of component summaries (selector, base styles, state diffs, priority)

Using the spec with an LLM
- Open `spec/project.json` and `spec/components.json` in your editor and use the per-component prompt pattern (see project notes) to generate templates, CSS, and small JS adapters. This chunked approach minimizes token usage and improves output quality.

If you prefer a one-shot generation (smaller projects) you can also point Copilot Chat at the full `frontend_report_*.json`, but for production readiness we recommend the `spec/` workflow.

Suggested package scripts
- `npm run analyze -- <url>` — run crawler
- `node scripts/extract_spec.js <path-to-json>` — create compact spec files

Generating production-ready output
- The crawl + spec flow is designed to produce a high-fidelity static frontend scaffold (templates, CSS variables, interaction adapters). To make it production-ready you should:
  1. Download and verify fonts and image assets (licensing).
  2. Replace placeholder data with backend data models (PHP loops / CMS integration).
  3. Add build tooling (SCSS, minification) and automated tests (visual diffs).

Security
- The crawler loads remote pages in a headless browser. Avoid running it against untrusted internal systems without isolation.

License
- This repository follows the existing project license.
