# Site Analyzer (Playwright)

This small tool crawls a given URL using Playwright (Chromium) and extracts a frontend analysis report.

What it produces
- A JSON report containing metadata, assets, sampled component styles/interactions, palette and font info.
- A human-readable Markdown summary.
- A `screenshots/` folder with viewport screenshots for different breakpoints.

Quick start (tested on Ubuntu-derived systems)

1. Ensure you have Node.js (v18+ recommended) and `npm` installed.
2. From the `site-analyzer` directory install dependencies:

```bash
cd /workspaces/Playwright-crawl/site-analyzer
npm install
```

3. Install system dependencies required by Playwright (may require sudo):

```bash
# Recommended (will attempt to run apt installs where needed)
npx playwright install-deps

# Alternatively on Debian/Ubuntu you can run (if you prefer apt explicit):
sudo apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libasound2
```

4. Install Playwright browser binaries (Chromium/Firefox/WebKit):

```bash
npx playwright install --with-deps
```

5. Run the analyzer against a URL:

```bash
node crawl_full.js https://example.com/
```

Outputs will be written to the `site-analyzer` folder: a `frontend_report_<timestamp>.json`, `frontend_report_<timestamp>.md`, and a `screenshots/` directory.

Notes & troubleshooting
- If you see an error referencing missing system libraries ("Host system is missing dependencies to run browsers"), run step 3.
- In containerized CI environments consider using the official Playwright Docker images which contain required libraries.
- If you need visible (non-headless) browser runs, adjust `chromium.launch({ headless: true })` to `headless: false` but ensure a display server (or xvfb) is available.

Suggested package scripts
- An `analyze` npm script is added to `package.json` to run the crawler easily:

```bash
npm run analyze -- https://example.com/
```

Security
- The crawler loads remote web pages and executes their scripts in a headless browser. Avoid running it against untrusted internal sites without proper isolation.

License
- This repository follows the existing project license.
