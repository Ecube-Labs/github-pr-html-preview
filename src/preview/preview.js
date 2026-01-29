/**
 * GitHub PR HTML Preview - Preview Page Script
 * Loads and displays HTML content via GitHub API
 */

(function() {
  'use strict';

  // Get URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const rawUrl = urlParams.get('url');
  const filePath = urlParams.get('file');
  // Explicit params for GitHub API (avoids URL parsing issues with branch names containing slashes)
  const owner = urlParams.get('owner');
  const repo = urlParams.get('repo');
  const ref = urlParams.get('ref');
  let currentPath = urlParams.get('path');

  // DOM elements
  const filePathEl = document.getElementById('filePath');
  const rawLinkEl = document.getElementById('rawLink');
  const refreshBtn = document.getElementById('refreshBtn');
  const previewContainer = document.getElementById('previewContainer');
  const loadingState = document.getElementById('loadingState');

  /**
   * Show error state with optional action button and debug info
   */
  function showError(message, details, showSettingsLink = false, debugInfo = null) {
    let actionHtml = '';
    if (showSettingsLink) {
      actionHtml = `
        <button class="error-action" id="openSettingsBtn">
          Open Extension Settings
        </button>
      `;
    }

    let debugHtml = '';
    if (debugInfo) {
      debugHtml = `
        <div class="debug-info">
          <strong>Debug Info:</strong>
          <pre>${JSON.stringify(debugInfo, null, 2)}</pre>
        </div>
      `;
    }

    previewContainer.innerHTML = `
      <div class="error">
        <svg class="error-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94 6.03 4.97Z"/>
        </svg>
        <div class="error-message">${message}</div>
        ${details ? `<div class="error-details">${details}</div>` : ''}
        ${actionHtml}
        ${debugHtml}
      </div>
    `;

    // Add click handler for settings button
    const settingsBtn = document.getElementById('openSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        // Open extension popup by clicking on the extension icon
        // Since we can't directly open popup, show instructions
        alert('Click the extension icon in your browser toolbar to configure your GitHub token.');
      });
    }
  }

  /**
   * Fetch content via GitHub API through service worker
   * Uses explicit params (owner, repo, ref, path) to avoid URL parsing issues
   */
  async function fetchViaGitHubAPI() {
    return new Promise((resolve, reject) => {
      const message = { action: 'fetchFromGitHub' };

      // Use explicit params if available, otherwise fallback to URL
      if (owner && repo && ref && currentPath) {
        message.owner = owner;
        message.repo = repo;
        message.ref = ref;
        message.path = currentPath;
      } else {
        message.url = rawUrl;
      }

      console.log('[GitHub PR Preview] Sending request:', message);

      chrome.runtime.sendMessage(message, (response) => {
        console.log('[GitHub PR Preview] Received response:', response);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.success) {
          resolve(response.content);
        } else {
          const error = new Error(response?.error || 'Failed to fetch content');
          error.errorCode = response?.errorCode;
          error.debug = response?.debug;
          reject(error);
        }
      });
    });
  }

  /**
   * Fetch an asset file via GitHub API
   * @param {string} assetPath - Path relative to repo root or relative to current file
   * @returns {Promise<string>} - File content
   */
  async function fetchAsset(assetPath) {
    // Resolve the path relative to current HTML file
    let resolvedPath;
    if (assetPath.startsWith('/')) {
      // Absolute path from repo root - remove leading slash
      resolvedPath = assetPath.slice(1);
    } else {
      // Relative path - resolve from current file's directory
      const dirPath = currentPath.split('/').slice(0, -1).join('/');
      resolvedPath = dirPath ? `${dirPath}/${assetPath}` : assetPath;
    }

    // Normalize path (handle ../ and ./)
    const parts = resolvedPath.split('/');
    const normalized = [];
    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else if (part !== '.' && part !== '') {
        normalized.push(part);
      }
    }
    resolvedPath = normalized.join('/');

    console.log(`[GitHub PR Preview] Fetching asset: ${assetPath} -> ${resolvedPath}`);

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'fetchFromGitHub',
        owner,
        repo,
        ref,
        path: resolvedPath
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.success) {
          resolve(response.content);
        } else {
          reject(new Error(response?.error || 'Failed to fetch asset'));
        }
      });
    });
  }

  /**
   * Fetch an image file via GitHub API as base64 data URL
   * @param {string} imagePath - Path relative to repo root or relative to current file
   * @returns {Promise<string>} - Data URL
   */
  async function fetchImageAsDataUrl(imagePath) {
    // Resolve the path relative to current HTML file
    let resolvedPath;
    if (imagePath.startsWith('/')) {
      resolvedPath = imagePath.slice(1);
    } else {
      const dirPath = currentPath.split('/').slice(0, -1).join('/');
      resolvedPath = dirPath ? `${dirPath}/${imagePath}` : imagePath;
    }

    // Normalize path
    const parts = resolvedPath.split('/');
    const normalized = [];
    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else if (part !== '.' && part !== '') {
        normalized.push(part);
      }
    }
    resolvedPath = normalized.join('/');

    console.log(`[GitHub PR Preview] Fetching image: ${imagePath} -> ${resolvedPath}`);

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'fetchImageAsBase64',
        owner,
        repo,
        ref,
        path: resolvedPath
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.success) {
          const dataUrl = `data:${response.mimeType};base64,${response.content}`;
          resolve(dataUrl);
        } else {
          reject(new Error(response?.error || 'Failed to fetch image'));
        }
      });
    });
  }

  /**
   * Process HTML to inline CSS, JS, and images fetched via GitHub API
   * This avoids MIME type issues with raw.githubusercontent.com
   */
  async function processHtmlAssets(html) {
    // Process CSS: <link rel="stylesheet" href="...">
    const cssLinkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi;
    const cssLinks = html.match(cssLinkRegex) || [];

    for (const linkTag of cssLinks) {
      const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) continue;

      const href = hrefMatch[1];
      // Skip external URLs
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//') || href.startsWith('data:')) {
        continue;
      }

      try {
        const cssContent = await fetchAsset(href);
        // Replace link tag with inline style tag
        const styleTag = `<style>/* Inlined from: ${href} */\n${cssContent}</style>`;
        html = html.replace(linkTag, styleTag);
        console.log(`[GitHub PR Preview] Inlined CSS: ${href}`);
      } catch (e) {
        console.warn(`[GitHub PR Preview] Failed to fetch CSS: ${href}`, e);
        // Keep original link tag (will fail but at least won't break completely)
      }
    }

    // Process JS: <script src="...">
    const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
    let scriptMatch;
    const scriptReplacements = [];

    // Reset regex
    scriptRegex.lastIndex = 0;
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      const fullTag = scriptMatch[0];
      const src = scriptMatch[1];

      // Skip external URLs
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//') || src.startsWith('data:')) {
        continue;
      }

      scriptReplacements.push({ fullTag, src });
    }

    for (const { fullTag, src } of scriptReplacements) {
      try {
        const jsContent = await fetchAsset(src);
        // Replace script tag with inline script
        const inlineScript = `<script>/* Inlined from: ${src} */\n${jsContent}</script>`;
        html = html.replace(fullTag, inlineScript);
        console.log(`[GitHub PR Preview] Inlined JS: ${src}`);
      } catch (e) {
        console.warn(`[GitHub PR Preview] Failed to fetch JS: ${src}`, e);
      }
    }

    // Process images: <img src="...">
    const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
    let imgMatch;
    const imgReplacements = [];

    imgRegex.lastIndex = 0;
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const fullTag = imgMatch[0];
      const src = imgMatch[1];

      // Skip external URLs and data URLs
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//') || src.startsWith('data:')) {
        continue;
      }

      imgReplacements.push({ fullTag, src });
    }

    for (const { fullTag, src } of imgReplacements) {
      try {
        const dataUrl = await fetchImageAsDataUrl(src);
        // Replace src with data URL
        const newTag = fullTag.replace(src, dataUrl);
        html = html.replace(fullTag, newTag);
        console.log(`[GitHub PR Preview] Converted image to data URL: ${src}`);
      } catch (e) {
        console.warn(`[GitHub PR Preview] Failed to fetch image: ${src}`, e);
        // Keep original src (will try to load from raw URL later via rewriteImageUrls)
      }
    }

    return html;
  }

  /**
   * Create iframe with HTML content
   */
  function createPreviewIframe(htmlContent) {
    const iframe = document.createElement('iframe');
    iframe.className = 'preview-iframe';
    iframe.sandbox = 'allow-scripts allow-same-origin';

    // Clear container and add iframe
    previewContainer.innerHTML = '';
    previewContainer.appendChild(iframe);

    // Write content to iframe
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();

    // Attach navigation handler directly to iframe document (CSP-safe approach)
    attachNavigationHandler(iframeDoc);

    // Update document title
    const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      document.title = `Preview: ${titleMatch[1]}`;
    }
  }

  /**
   * Rewrite relative URLs for images and other non-CSS/JS assets
   * CSS and JS are handled separately via processHtmlAssets()
   * URL format: https://github.com/{owner}/{repo}/raw/{ref}/{path}
   */
  function rewriteImageUrls(html, baseUrl) {
    // Parse the base URL to get the directory path
    // baseUrl: https://github.com/{owner}/{repo}/raw/{ref}/{path/to/file.html}
    const urlParts = baseUrl.split('/');
    urlParts.pop(); // Remove filename
    const basePath = urlParts.join('/');

    // For absolute paths from repo root: https://github.com/{owner}/{repo}/raw/{ref}
    // That's: protocol + '' + host + owner + repo + 'raw' + ref = 7 parts (indices 0-6)
    const repoRootUrl = urlParts.slice(0, 7).join('/');

    // Rewrite src attributes for images (not href for stylesheets, those are inlined)
    // Match img src, video src, audio src, etc.
    html = html.replace(
      /<(img|video|audio|source|embed|object)\s+([^>]*?)src=["'](?!https?:\/\/|\/\/|data:|#|javascript:)([^"']+)["']([^>]*)>/gi,
      (match, tag, before, url, after) => {
        let absoluteUrl;
        if (url.startsWith('/')) {
          absoluteUrl = `${repoRootUrl}${url}`;
        } else {
          absoluteUrl = `${basePath}/${url}`;
        }
        return `<${tag} ${before}src="${absoluteUrl}"${after}>`;
      }
    );

    // Also rewrite poster attributes for video
    html = html.replace(
      /poster=["'](?!https?:\/\/|\/\/|data:|#)([^"']+)["']/gi,
      (match, url) => {
        if (url.startsWith('/')) {
          return `poster="${repoRootUrl}${url}"`;
        } else {
          return `poster="${basePath}/${url}"`;
        }
      }
    );

    return html;
  }

  /**
   * Check if an error code indicates token-related issues
   */
  function isTokenError(errorCode) {
    return ['UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED'].includes(errorCode);
  }

  /**
   * Resolve a relative path against the current file path
   * @param {string} basePath - Current file path (e.g., "docs/pages/index.html")
   * @param {string} relativePath - Relative path to resolve (e.g., "../about.html")
   * @returns {string} - Resolved absolute path from repo root
   */
  function resolvePath(basePath, relativePath) {
    // If it's already an absolute path (starts with /), remove the leading slash
    if (relativePath.startsWith('/')) {
      return relativePath.slice(1);
    }

    // Get the directory of the current file
    const dirParts = basePath.split('/').slice(0, -1);

    // Split the relative path and process each part
    const relParts = relativePath.split('/');

    for (const part of relParts) {
      if (part === '..') {
        dirParts.pop();
      } else if (part !== '.' && part !== '') {
        dirParts.push(part);
      }
    }

    return dirParts.join('/');
  }

  /**
   * Attach navigation handler directly to iframe document
   * This avoids CSP issues with inline script injection
   * @param {Document} doc - The iframe's document object
   */
  function attachNavigationHandler(doc) {
    doc.addEventListener('click', async function(e) {
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');

      // Skip external URLs, anchors, javascript:, mailto:, tel: links
      if (!href || href.startsWith('http://') || href.startsWith('https://') ||
          href.startsWith('//') || href.startsWith('#') || href.startsWith('javascript:') ||
          href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      // Intercept HTML file links
      if (href.endsWith('.html') || href.endsWith('.htm') ||
          href.includes('.html#') || href.includes('.htm#')) {
        e.preventDefault();
        e.stopPropagation();
        await handleNavigation(href);
      }
    }, true);
  }

  /**
   * Fetch content for a specific path via GitHub API
   * @param {string} targetPath - Path to fetch
   * @returns {Promise<string>} - File content
   */
  async function fetchContentForPath(targetPath) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'fetchFromGitHub',
        owner,
        repo,
        ref,
        path: targetPath
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.success) {
          resolve(response.content);
        } else {
          const error = new Error(response?.error || 'Failed to fetch content');
          error.errorCode = response?.errorCode;
          error.debug = response?.debug;
          reject(error);
        }
      });
    });
  }

  /**
   * Load and display preview for a specific path
   * @param {string} targetPath - Path to load
   */
  async function loadPreviewForPath(targetPath) {
    try {
      loadingState.style.display = 'flex';

      // Update current path
      currentPath = targetPath;

      // Construct raw URL for the new path
      const newRawUrl = `https://github.com/${owner}/${repo}/raw/${ref}/${targetPath}`;

      // Update UI
      filePathEl.textContent = targetPath;
      rawLinkEl.href = newRawUrl;
      document.title = `Preview: ${targetPath}`;

      // Fetch content
      let htmlContent = await fetchContentForPath(targetPath);

      // Process CSS and JS files
      htmlContent = await processHtmlAssets(htmlContent);

      // Rewrite image URLs
      htmlContent = rewriteImageUrls(htmlContent, newRawUrl);

      createPreviewIframe(htmlContent);
    } catch (error) {
      console.error('[GitHub PR Preview] Failed to load preview:', error);
      const showSettings = isTokenError(error.errorCode);
      showError(
        'Failed to load HTML content',
        `${error.message}`,
        showSettings,
        error.debug
      );
    }
  }

  /**
   * Handle navigation from iframe
   * @param {string} href - Relative or absolute href from link
   */
  async function handleNavigation(href) {
    // Remove any hash/anchor from href for path resolution
    const hashIndex = href.indexOf('#');
    const pathPart = hashIndex !== -1 ? href.substring(0, hashIndex) : href;
    const hashPart = hashIndex !== -1 ? href.substring(hashIndex) : '';

    // Resolve the relative path to absolute path from repo root
    const newPath = resolvePath(currentPath, pathPart);

    console.log(`[GitHub PR Preview] Navigating from ${currentPath} to ${newPath}`);

    // Update URL parameters (add to history)
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('path', newPath);
    newUrl.searchParams.set('file', newPath);
    window.history.pushState({ path: newPath }, '', newUrl);

    // Load the new HTML file
    await loadPreviewForPath(newPath);

    // If there's a hash, scroll to it after load
    if (hashPart) {
      const iframe = previewContainer.querySelector('iframe');
      if (iframe && iframe.contentDocument) {
        const target = iframe.contentDocument.querySelector(hashPart);
        if (target) {
          target.scrollIntoView();
        }
      }
    }
  }

  /**
   * Load HTML content from GitHub API
   */
  async function loadPreview() {
    if (!rawUrl) {
      showError('No URL provided', 'Missing raw content URL parameter');
      return;
    }

    // Update UI
    filePathEl.textContent = filePath || 'Unknown file';
    rawLinkEl.href = rawUrl;
    document.title = `Preview: ${filePath || 'HTML File'}`;

    try {
      loadingState.style.display = 'flex';

      // Fetch via GitHub API
      let htmlContent = await fetchViaGitHubAPI();

      // Process CSS and JS files - fetch via API and inline them
      // This avoids MIME type issues with raw.githubusercontent.com
      htmlContent = await processHtmlAssets(htmlContent);

      // Rewrite image URLs to work with github.com/raw/ endpoint
      // (Images are more lenient with MIME types)
      htmlContent = rewriteImageUrls(htmlContent, rawUrl);

      createPreviewIframe(htmlContent);
    } catch (error) {
      console.error('[GitHub PR Preview] Failed to load preview:', error);
      console.error('[GitHub PR Preview] Debug info:', error.debug);
      const showSettings = isTokenError(error.errorCode);
      showError(
        'Failed to load HTML content',
        `${error.message}`,
        showSettings,
        error.debug
      );
    }
  }

  // Initialize
  function init() {
    // Set up refresh button
    refreshBtn.addEventListener('click', () => {
      loadPreview();
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', async (event) => {
      const targetPath = event.state?.path || urlParams.get('path');
      if (targetPath && targetPath !== currentPath) {
        console.log('[GitHub PR Preview] Popstate navigation to:', targetPath);
        await loadPreviewForPath(targetPath);
      }
    });

    // Load preview
    loadPreview();
  }

  init();
})();
