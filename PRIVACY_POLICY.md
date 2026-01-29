# Privacy Policy

**GitHub PR HTML Preview**
Last updated: January 29, 2026

## Overview

GitHub PR HTML Preview is a browser extension that adds preview buttons to HTML files in GitHub Pull Request diffs. This privacy policy explains how we handle your data.

## Data Collection

**We do not collect, store, or transmit any personal data.**

This extension:
- Does NOT collect any personal information
- Does NOT track your browsing history
- Does NOT store any data on external servers
- Does NOT use analytics or tracking services
- Does NOT share any data with third parties

## How the Extension Works

The extension operates entirely within your browser:

1. **On GitHub PR pages**: The extension scans the page for HTML files and adds "Preview" buttons
2. **When you click Preview**: The extension fetches the HTML file directly from GitHub using your existing browser session
3. **Rendering**: The HTML is displayed locally in your browser

## Permissions Used

| Permission | Purpose |
|------------|---------|
| `activeTab` | Detect when you're viewing a GitHub PR page |
| `scripting` | Add preview buttons to the GitHub page |
| `storage` | Save your preferences locally (preview mode setting) |
| `sidePanel` | Provide optional side-by-side preview mode |
| `github.com` | Access GitHub PR pages and fetch raw HTML files |
| `raw.githubusercontent.com` | Fetch raw HTML content for preview |
| `api.github.com` | Retrieve repository metadata for file URLs |

## Data Storage

The only data stored is your preference settings (e.g., preferred preview mode), which are saved locally in your browser using Chrome's built-in storage API. This data never leaves your device.

## Third-Party Services

This extension communicates only with GitHub's servers (`github.com`, `raw.githubusercontent.com`, `api.github.com`) to fetch the HTML files you choose to preview. These requests use your existing GitHub session and cookies.

## Open Source

This extension is open source. You can review the complete source code at:
https://github.com/Ecube-Labs/github-pr-html-preview

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date above.

## Contact

If you have questions about this privacy policy, please open an issue on our GitHub repository:
https://github.com/Ecube-Labs/github-pr-html-preview/issues
