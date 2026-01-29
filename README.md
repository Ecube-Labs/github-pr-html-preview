# GitHub PR HTML Preview

A Chrome Extension that allows you to preview HTML files directly from GitHub Pull Request's "Files Changed" view.

## Features

- Automatically detects HTML files in PR file changes
- Adds a "Preview" button next to each HTML file
- Opens HTML preview in a new tab
- Supports both light and dark GitHub themes
- Handles relative URLs in HTML files

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked"
5. Select the `github-pr-html-preview` folder
6. The extension is now installed and active

## Usage

1. Navigate to any GitHub Pull Request's "Files changed" tab
   - Example: `https://github.com/owner/repo/pull/123/files`
2. For any HTML file in the changes, you'll see a green "Preview" button
3. Click the "Preview" button to open the HTML file in a new tab
4. The preview shows the rendered HTML as it would appear in a browser

## How It Works

1. **Content Script**: Scans the PR files changed page for HTML files and injects "Preview" buttons
2. **Background Service Worker**: Handles opening new tabs with the preview page
3. **Preview Page**: Fetches the raw HTML content from `raw.githubusercontent.com` and renders it in an iframe

## Project Structure

```
github-pr-html-preview/
├── manifest.json              # Extension configuration (Manifest V3)
├── src/
│   ├── content/
│   │   ├── content.js         # GitHub page content script
│   │   └── content.css        # Preview button styles
│   ├── background/
│   │   └── service-worker.js  # Background service worker
│   └── preview/
│       ├── preview.html       # Preview page template
│       └── preview.js         # Preview loading logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Permissions

The extension requires the following permissions:

- `activeTab`: To interact with the current GitHub tab
- `scripting`: To inject content scripts
- Host permissions for:
  - `https://github.com/*`: To add preview buttons on GitHub
  - `https://raw.githubusercontent.com/*`: To fetch raw HTML content

## Limitations

- Only works on public repositories or repositories you have access to
- External resources (CSS, JS, images) referenced with relative paths are rewritten to point to raw.githubusercontent.com
- Some dynamic features of the HTML may not work due to CORS restrictions

## License

MIT License
