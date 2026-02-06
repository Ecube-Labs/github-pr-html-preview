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
  const historyDebugEnabled =
    urlParams.get('debugHistory') === '1' ||
    localStorage.getItem('ghPreviewDebugHistory') === '1';
  let historyDebugSeq = 0;

  // DOM elements
  const filePathEl = document.getElementById('filePath');
  const rawLinkEl = document.getElementById('rawLink');
  const refreshBtn = document.getElementById('refreshBtn');
  const previewContainer = document.getElementById('previewContainer');
  const loadingState = document.getElementById('loadingState');

  function debugHistoryLog(stage, payload = {}) {
    if (!historyDebugEnabled) return;
    historyDebugSeq += 1;
    console.log(`[GH Preview][History#${historyDebugSeq}] ${stage}`, {
      time: new Date().toISOString(),
      currentPath,
      url: window.location.href,
      historyLength: window.history.length,
      ...payload
    });
  }

  function installHistoryDebugHooks() {
    if (!historyDebugEnabled) return;
    if (window.__ghPreviewHistoryDebugHooked) return;
    window.__ghPreviewHistoryDebugHooked = true;

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = function(state, title, url) {
      debugHistoryLog('history.pushState', {
        state,
        title,
        url,
        stack: new Error().stack
      });
      return originalPushState(state, title, url);
    };

    window.history.replaceState = function(state, title, url) {
      debugHistoryLog('history.replaceState', {
        state,
        title,
        url,
        stack: new Error().stack
      });
      return originalReplaceState(state, title, url);
    };
  }

  function setLoadingState(visible, message) {
    if (!loadingState || !loadingState.isConnected) return;
    if (typeof message === 'string') {
      const messageEl = document.getElementById('loadingMessage');
      if (messageEl) messageEl.textContent = message;
    }
    loadingState.style.display = visible ? 'block' : 'none';
  }

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

    setLoadingState(false);

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

  // Session-level cache for fetched external resources
  const externalResourceCache = new Map();

  /**
   * Fetch an external resource via the service worker proxy
   * @param {string} url - The external URL to fetch
   * @param {string} responseType - 'text' for CSS/JS, 'base64' for images/fonts
   * @returns {Promise<{success: boolean, content?: string, mimeType?: string, error?: string}>}
   */
  async function fetchExternalResource(url, responseType = 'text') {
    const cacheKey = `${responseType}:${url}`;
    if (externalResourceCache.has(cacheKey)) {
      return externalResourceCache.get(cacheKey);
    }

    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'fetchExternalResource',
        url,
        responseType
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    });

    externalResourceCache.set(cacheKey, result);
    return result;
  }

  /**
   * Resolve a URL that may be relative to a base URL
   * Handles protocol-relative URLs (//), absolute, and relative URLs
   * @param {string} relativeUrl - URL to resolve
   * @param {string} baseUrl - Base URL to resolve against
   * @returns {string} - Fully resolved URL
   */
  function resolveExternalUrl(relativeUrl, baseUrl) {
    if (!relativeUrl) return relativeUrl;
    // Protocol-relative URL
    if (relativeUrl.startsWith('//')) {
      return 'https:' + relativeUrl;
    }
    // Already absolute
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
      return relativeUrl;
    }
    // Data URLs - return as-is
    if (relativeUrl.startsWith('data:')) {
      return relativeUrl;
    }
    try {
      return new URL(relativeUrl, baseUrl).href;
    } catch {
      return relativeUrl;
    }
  }

  /**
   * Escape special regex characters in a string
   */
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Convert UTF-8 text into base64 safely (supports non-ASCII characters).
   */
  function toBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const CHUNK_SIZE = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.subarray(i, i + CHUNK_SIZE);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  /**
   * Build a JavaScript data URL to avoid parser edge cases caused by
   * literal </script> sequences inside inline script bodies.
   */
  function createJavaScriptDataUrl(jsContent) {
    const base64 = toBase64Utf8(jsContent);
    return `data:text/javascript;charset=utf-8;base64,${base64}`;
  }

  function isBareSpecifier(specifier) {
    return (
      typeof specifier === 'string' &&
      !specifier.startsWith('/') &&
      !specifier.startsWith('./') &&
      !specifier.startsWith('../') &&
      !specifier.startsWith('http://') &&
      !specifier.startsWith('https://') &&
      !specifier.startsWith('//')
    );
  }

  function getBarePackageParent(specifier) {
    if (!isBareSpecifier(specifier)) return null;

    const parts = specifier.split('/');
    if (specifier.startsWith('@')) {
      if (parts.length < 3) return null;
      return `${parts[0]}/${parts[1]}`;
    }
    if (parts.length < 2) return null;
    return parts[0];
  }

  function deriveParentImportTarget(childTarget, childSpecifier, parentSpecifier) {
    if (typeof childTarget !== 'string') return null;

    const suffix = childSpecifier.slice(parentSpecifier.length);
    if (!suffix.startsWith('/')) return null;
    if (!childTarget.endsWith(suffix)) return null;

    return childTarget.slice(0, childTarget.length - suffix.length);
  }

  /**
   * Normalize import maps so bare parent package specifiers are available
   * when only subpath mappings are declared (e.g., react-dom/client only).
   */
  function normalizeImportMaps(html) {
    const importMapRegex = /(<script\b[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/gi;

    return html.replace(importMapRegex, (fullMatch, openTag, jsonText, closeTag) => {
      let mapData;
      try {
        mapData = JSON.parse(jsonText.trim());
      } catch {
        return fullMatch;
      }

      if (!mapData || typeof mapData !== 'object' || !mapData.imports || typeof mapData.imports !== 'object') {
        return fullMatch;
      }

      const imports = mapData.imports;
      const additions = {};

      for (const [specifier, target] of Object.entries(imports)) {
        const parent = getBarePackageParent(specifier);
        if (!parent || imports[parent] || additions[parent]) continue;
        const parentTarget = deriveParentImportTarget(target, specifier, parent);
        if (parentTarget) {
          additions[parent] = parentTarget;
        }
      }

      if (Object.keys(additions).length === 0) {
        return fullMatch;
      }

      mapData.imports = { ...additions, ...imports };
      const normalizedJson = JSON.stringify(mapData, null, 2);
      return `${openTag}\n${normalizedJson}\n${closeTag}`;
    });
  }

  /**
   * Process external CSS content: resolve @import rules and url() references
   * @param {string} cssContent - The CSS text content
   * @param {string} cssUrl - The URL the CSS was fetched from (for relative URL resolution)
   * @param {Set} visited - Set of already-visited URLs (circular reference detection)
   * @returns {Promise<string>} - Processed CSS content
   */
  async function processExternalCssContent(cssContent, cssUrl, visited = new Set()) {
    if (visited.has(cssUrl)) {
      console.warn(`[GitHub PR Preview] Circular @import detected: ${cssUrl}`);
      return cssContent;
    }
    visited.add(cssUrl);

    // Remove sourceMappingURL comments
    cssContent = cssContent.replace(/\/\*#\s*sourceMappingURL=.*?\*\//g, '');
    cssContent = cssContent.replace(/\/\/#\s*sourceMappingURL=.*/g, '');

    // Process @import rules
    const importRegex = /@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"]);?/g;
    let importMatch;
    const importReplacements = [];

    while ((importMatch = importRegex.exec(cssContent)) !== null) {
      const importUrl = importMatch[1] || importMatch[2];
      if (!importUrl) continue;
      const resolvedUrl = resolveExternalUrl(importUrl, cssUrl);
      importReplacements.push({
        fullMatch: importMatch[0],
        resolvedUrl
      });
    }

    // Fetch all @import CSS in parallel
    if (importReplacements.length > 0) {
      const importResults = await Promise.allSettled(
        importReplacements.map(async ({ resolvedUrl }) => {
          const result = await fetchExternalResource(resolvedUrl, 'text');
          if (result.success) {
            return processExternalCssContent(result.content, resolvedUrl, new Set(visited));
          }
          return `/* Failed to load @import: ${resolvedUrl} */`;
        })
      );

      for (let i = importReplacements.length - 1; i >= 0; i--) {
        const replacement = importReplacements[i];
        const result = importResults[i];
        const inlinedCss = result.status === 'fulfilled' ? result.value : `/* Failed to load @import: ${replacement.resolvedUrl} */`;
        cssContent = cssContent.replace(replacement.fullMatch, inlinedCss);
      }
    }

    // Process url() references (fonts, background images, etc.)
    const urlRegex = /url\(\s*['"]?(?!data:)([^'")]+?)['"]?\s*\)/g;
    let urlMatch;
    const urlReplacements = [];

    while ((urlMatch = urlRegex.exec(cssContent)) !== null) {
      const resourceUrl = urlMatch[1];
      if (!resourceUrl || resourceUrl.startsWith('#')) continue;
      const resolvedUrl = resolveExternalUrl(resourceUrl, cssUrl);
      if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) continue;
      urlReplacements.push({
        original: urlMatch[0],
        resourceUrl,
        resolvedUrl
      });
    }

    // Fetch all url() resources in parallel as base64
    if (urlReplacements.length > 0) {
      const urlResults = await Promise.allSettled(
        urlReplacements.map(({ resolvedUrl }) => fetchExternalResource(resolvedUrl, 'base64'))
      );

      // Replace in reverse to preserve positions
      const uniqueReplacements = new Map();
      for (let i = 0; i < urlReplacements.length; i++) {
        const { original, resolvedUrl } = urlReplacements[i];
        const result = urlResults[i];
        if (result.status === 'fulfilled' && result.value.success) {
          const dataUrl = `data:${result.value.mimeType};base64,${result.value.content}`;
          uniqueReplacements.set(original, `url("${dataUrl}")`);
        } else {
          // Fallback: use absolute URL instead of relative
          uniqueReplacements.set(original, `url("${resolvedUrl}")`);
        }
      }

      for (const [original, replacement] of uniqueReplacements) {
        const escaped = escapeRegExp(original);
        cssContent = cssContent.replace(new RegExp(escaped, 'g'), replacement);
      }
    }

    return cssContent;
  }

  /**
   * Update loading state with progress information
   */
  function updateLoadingProgress(loaded, total) {
    setLoadingState(true, `Loading external resources... (${loaded}/${total})`);
  }

  /**
   * Detect <base href="..."> tag and return its href if present
   */
  function detectBaseHref(html) {
    const baseMatch = html.match(/<base\s+[^>]*href=["']([^"']+)["'][^>]*>/i);
    return baseMatch ? baseMatch[1] : null;
  }

  /**
   * Check if a URL is external (http/https/protocol-relative)
   */
  function isExternalUrl(url) {
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
  }

  /**
   * Normalize a URL: convert protocol-relative to https
   */
  function normalizeExternalUrl(url) {
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  }

  /**
   * Process HTML to inline CSS, JS, and images fetched via GitHub API or external CDN
   * Handles both repo-local assets (via GitHub API) and external CDN resources (via service worker proxy)
   */
  async function processHtmlAssets(html) {
    html = normalizeImportMaps(html);

    // Detect <base href> for URL resolution
    const baseHref = detectBaseHref(html);

    // Remove <link rel="preload/prefetch"> tags (all resources will be inlined)
    html = html.replace(/<link\s+[^>]*rel=["'](?:preload|prefetch|dns-prefetch|preconnect)["'][^>]*>/gi, '');

    // ── Phase 1: Collect all resource references ──

    const cssEntries = [];    // { linkTag, href, isExternal }
    const scriptEntries = []; // { fullTag, src, isExternal, typeAttr }
    const imgEntries = [];    // { fullTag, src, isExternal }

    // Collect CSS links
    const cssLinkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi;
    const cssLinks = html.match(cssLinkRegex) || [];
    for (const linkTag of cssLinks) {
      const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) continue;
      const href = hrefMatch[1];
      if (href.startsWith('data:')) continue;
      cssEntries.push({ linkTag, href, isExternal: isExternalUrl(href) });
    }

    // Collect script tags
    const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
    let scriptMatch;
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      const fullTag = scriptMatch[0];
      const src = scriptMatch[1];
      if (src.startsWith('data:')) continue;
      // Extract type attribute if present
      const typeMatch = fullTag.match(/type=["']([^"']+)["']/i);
      const typeAttr = typeMatch ? typeMatch[1] : null;
      scriptEntries.push({ fullTag, src, isExternal: isExternalUrl(src), typeAttr });
    }

    // Collect image tags
    const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const fullTag = imgMatch[0];
      const src = imgMatch[1];
      if (src.startsWith('data:')) continue;
      imgEntries.push({ fullTag, src, isExternal: isExternalUrl(src) });
    }

    const totalResources = cssEntries.length + scriptEntries.length + imgEntries.length;
    if (totalResources === 0) return html;

    let loadedCount = 0;
    updateLoadingProgress(loadedCount, totalResources);

    // ── Phase 2: Fetch all resources in parallel ──

    const cssResults = await Promise.allSettled(
      cssEntries.map(async (entry) => {
        try {
          let cssContent;
          if (entry.isExternal) {
            const url = normalizeExternalUrl(entry.href);
            const result = await fetchExternalResource(url, 'text');
            if (!result.success) throw new Error(result.error);
            cssContent = await processExternalCssContent(result.content, url);
          } else {
            cssContent = await fetchAsset(entry.href);
          }
          return { success: true, content: cssContent };
        } catch (e) {
          console.warn(`[GitHub PR Preview] Failed to fetch CSS: ${entry.href}`, e);
          return { success: false, error: e.message, href: entry.href };
        } finally {
          loadedCount++;
          updateLoadingProgress(loadedCount, totalResources);
        }
      })
    );

    const scriptResults = await Promise.allSettled(
      scriptEntries.map(async (entry) => {
        try {
          let jsContent;
          if (entry.isExternal) {
            const url = normalizeExternalUrl(entry.src);
            const result = await fetchExternalResource(url, 'text');
            if (!result.success) throw new Error(result.error);
            jsContent = result.content;
          } else {
            jsContent = await fetchAsset(entry.src);
          }
          const MAX_SCRIPT_BYTES = 8 * 1024 * 1024; // 8MB safety limit per script

          // Remove sourceMappingURL
          jsContent = jsContent.replace(/\/\/[#@]\s*sourceMappingURL=.*/g, '');

          const scriptSize = new TextEncoder().encode(jsContent).byteLength;
          if (scriptSize > MAX_SCRIPT_BYTES) {
            throw new Error(`Script too large to embed (${scriptSize} bytes)`);
          }

          return { success: true, content: jsContent };
        } catch (e) {
          console.warn(`[GitHub PR Preview] Failed to fetch JS: ${entry.src}`, e);
          return { success: false, error: e.message, src: entry.src };
        } finally {
          loadedCount++;
          updateLoadingProgress(loadedCount, totalResources);
        }
      })
    );

    const imgResults = await Promise.allSettled(
      imgEntries.map(async (entry) => {
        try {
          let dataUrl;
          if (entry.isExternal) {
            const url = normalizeExternalUrl(entry.src);
            const result = await fetchExternalResource(url, 'base64');
            if (!result.success) throw new Error(result.error);
            dataUrl = `data:${result.mimeType};base64,${result.content}`;
          } else {
            dataUrl = await fetchImageAsDataUrl(entry.src);
          }
          return { success: true, dataUrl };
        } catch (e) {
          console.warn(`[GitHub PR Preview] Failed to fetch image: ${entry.src}`, e);
          return { success: false, error: e.message, src: entry.src };
        } finally {
          loadedCount++;
          updateLoadingProgress(loadedCount, totalResources);
        }
      })
    );

    // ── Phase 3: Apply replacements ──

    // Replace CSS links with inline styles
    for (let i = 0; i < cssEntries.length; i++) {
      const entry = cssEntries[i];
      const result = cssResults[i];
      if (result.status === 'fulfilled' && result.value.success) {
        const styleTag = `<style>/* Inlined from: ${entry.href} */\n${result.value.content}</style>`;
        html = html.replace(entry.linkTag, styleTag);
        console.log(`[GitHub PR Preview] Inlined CSS: ${entry.href}`);
      } else {
        const errorMsg = result.status === 'fulfilled' ? result.value.error : result.reason?.message;
        html = html.replace(entry.linkTag, `<!-- Failed to load CSS: ${entry.href} (${errorMsg}) -->`);
      }
    }

    // Replace script tags with data URL sources
    for (let i = 0; i < scriptEntries.length; i++) {
      const entry = scriptEntries[i];
      const result = scriptResults[i];
      if (result.status === 'fulfilled' && result.value.success) {
        // Build script tag preserving type attribute (e.g., type="module")
        const typeStr = entry.typeAttr ? ` type="${entry.typeAttr}"` : '';
        const dataUrl = createJavaScriptDataUrl(result.value.content);
        const scriptTag = `<script${typeStr} src="${dataUrl}"><\/script>`;
        html = html.replace(entry.fullTag, scriptTag);
        console.log(`[GitHub PR Preview] Embedded JS as data URL: ${entry.src}`);
      } else {
        const errorMsg = result.status === 'fulfilled' ? result.value.error : result.reason?.message;
        html = html.replace(entry.fullTag, `<!-- Failed to load JS: ${entry.src} (${errorMsg}) -->`);
      }
    }

    // Replace image tags with data URLs
    for (let i = 0; i < imgEntries.length; i++) {
      const entry = imgEntries[i];
      const result = imgResults[i];
      if (result.status === 'fulfilled' && result.value.success) {
        const newTag = entry.fullTag.replace(entry.src, result.value.dataUrl);
        html = html.replace(entry.fullTag, newTag);
        console.log(`[GitHub PR Preview] Converted image to data URL: ${entry.src}`);
      } else {
        // Keep original tag for non-external images (rewriteImageUrls may fix them)
        if (entry.isExternal) {
          console.warn(`[GitHub PR Preview] Failed to inline external image: ${entry.src}`);
        }
      }
    }

    return html;
  }

  /**
   * Build a proxy script that intercepts dynamic resource loading inside the iframe.
   * Overrides document.createElement, window.fetch, and XMLHttpRequest to proxy
   * external resource requests via postMessage to the parent (preview.js).
   */
  function buildProxyScript() {
    return `
(function() {
  'use strict';
  var PROXY_TIMEOUT = 30000;
  var pendingRequests = {};
  var requestCounter = 0;

  function generateId() {
    return '__proxy_' + (++requestCounter) + '_' + Date.now();
  }

  function isExternalUrl(url) {
    return /^(https?:)?\\/\\//.test(url);
  }

  function normalizeUrl(url) {
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  }

  function proxyFetch(url, responseType) {
    return new Promise(function(resolve, reject) {
      var id = generateId();
      var timer = setTimeout(function() {
        delete pendingRequests[id];
        reject(new Error('Proxy timeout for ' + url));
      }, PROXY_TIMEOUT);

      pendingRequests[id] = function(response) {
        clearTimeout(timer);
        delete pendingRequests[id];
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || 'Proxy fetch failed'));
        }
      };

      window.parent.postMessage({
        type: '__ghPreviewProxy',
        id: id,
        url: normalizeUrl(url),
        responseType: responseType
      }, '*');
    });
  }

  // Listen for proxy responses from parent
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (data && data.type === '__ghPreviewProxyResponse' && pendingRequests[data.id]) {
      pendingRequests[data.id](data);
    }
  });

  // Override document.createElement to intercept script/link creation
  var origCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName) {
    var el = origCreateElement(tagName);
    var tag = tagName.toLowerCase();

    if (tag === 'script') {
      var origSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src') ||
                               Object.getOwnPropertyDescriptor(el.__proto__, 'src');
      Object.defineProperty(el, 'src', {
        get: function() { return el.getAttribute('src') || ''; },
        set: function(val) {
          if (isExternalUrl(val)) {
            proxyFetch(val, 'text').then(function(res) {
              el.removeAttribute('src');
              el.textContent = res.content;
              // Dispatch load event
              el.dispatchEvent(new Event('load'));
            }).catch(function(err) {
              console.warn('[GH Preview Proxy] Failed to proxy script:', val, err);
              el.dispatchEvent(new Event('error'));
            });
          } else {
            el.setAttribute('src', val);
          }
        },
        configurable: true
      });
    }

    if (tag === 'link') {
      var origSetAttribute = el.setAttribute.bind(el);
      el.setAttribute = function(name, value) {
        origSetAttribute(name, value);
        if (name === 'href' && el.getAttribute('rel') === 'stylesheet' && isExternalUrl(value)) {
          proxyFetch(value, 'text').then(function(res) {
            var style = origCreateElement('style');
            style.textContent = res.content;
            if (el.parentNode) {
              el.parentNode.replaceChild(style, el);
            }
          }).catch(function(err) {
            console.warn('[GH Preview Proxy] Failed to proxy CSS:', value, err);
          });
        }
      };
    }

    return el;
  };

  // Override window.fetch for external URLs
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (isExternalUrl(url)) {
      return proxyFetch(url, 'text').then(function(res) {
        return new Response(res.content, {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'text/plain' }
        });
      });
    }
    return origFetch.call(window, input, init);
  };

  // Override XMLHttpRequest for external URLs
  var OrigXHR = window.XMLHttpRequest;
  function ProxyXHR() {
    var xhr = new OrigXHR();
    var _url = '';
    var _isExternal = false;
    var _onreadystatechange = null;
    var _onload = null;
    var _onerror = null;

    var proxy = Object.create(OrigXHR.prototype);

    proxy.open = function(method, url) {
      _url = url;
      _isExternal = isExternalUrl(url);
      if (!_isExternal) {
        xhr.open.apply(xhr, arguments);
      }
    };

    proxy.send = function(body) {
      if (_isExternal) {
        proxyFetch(_url, 'text').then(function(res) {
          Object.defineProperties(proxy, {
            readyState: { value: 4, writable: false, configurable: true },
            status: { value: 200, writable: false, configurable: true },
            statusText: { value: 'OK', writable: false, configurable: true },
            responseText: { value: res.content, writable: false, configurable: true },
            response: { value: res.content, writable: false, configurable: true }
          });
          if (_onreadystatechange) _onreadystatechange.call(proxy);
          if (_onload) _onload.call(proxy);
        }).catch(function(err) {
          Object.defineProperties(proxy, {
            readyState: { value: 4, writable: false, configurable: true },
            status: { value: 0, writable: false, configurable: true },
            statusText: { value: '', writable: false, configurable: true }
          });
          if (_onreadystatechange) _onreadystatechange.call(proxy);
          if (_onerror) _onerror.call(proxy);
        });
      } else {
        xhr.send.apply(xhr, arguments);
      }
    };

    proxy.setRequestHeader = function() {
      if (!_isExternal) xhr.setRequestHeader.apply(xhr, arguments);
    };
    proxy.getResponseHeader = function(h) {
      return _isExternal ? null : xhr.getResponseHeader(h);
    };
    proxy.getAllResponseHeaders = function() {
      return _isExternal ? '' : xhr.getAllResponseHeaders();
    };
    proxy.abort = function() {
      if (!_isExternal) xhr.abort();
    };

    Object.defineProperty(proxy, 'onreadystatechange', {
      get: function() { return _isExternal ? _onreadystatechange : xhr.onreadystatechange; },
      set: function(v) { if (_isExternal) _onreadystatechange = v; else xhr.onreadystatechange = v; }
    });
    Object.defineProperty(proxy, 'onload', {
      get: function() { return _isExternal ? _onload : xhr.onload; },
      set: function(v) { if (_isExternal) _onload = v; else xhr.onload = v; }
    });
    Object.defineProperty(proxy, 'onerror', {
      get: function() { return _isExternal ? _onerror : xhr.onerror; },
      set: function(v) { if (_isExternal) _onerror = v; else xhr.onerror = v; }
    });

    return proxy;
  }
  window.XMLHttpRequest = ProxyXHR;

  // Prevent iframe runtime from polluting browser history stack.
  // Use replaceState semantics for pushState so URL/state can update
  // without creating extra back-stack entries.
  (function patchHistoryInRuntime() {
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    var origReplaceState = window.history.replaceState.bind(window.history);
    window.history.pushState = function(state, title, url) {
      try {
        origReplaceState(state, title, url);
      } catch (err) {
        // Ignore runtime history mutation errors in preview sandbox.
      }
    };
    window.history.replaceState = function(state, title, url) {
      try {
        origReplaceState(state, title, url);
      } catch (err) {
        // Ignore runtime history mutation errors in preview sandbox.
      }
    };
  })();

  // Navigation interceptor: capture clicks on internal HTML links
  document.addEventListener('click', function(e) {
    var link = e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href) return;
    var loweredHref = href.toLowerCase();
    if (
      loweredHref.startsWith('http://') ||
      loweredHref.startsWith('https://') ||
      loweredHref.startsWith('//') ||
      loweredHref.startsWith('#') ||
      loweredHref.startsWith('javascript:') ||
      loweredHref.startsWith('mailto:') ||
      loweredHref.startsWith('tel:')
    ) return;
    if (link.hasAttribute('download')) return;
    // Route all internal relative navigations through host so iframe browsing
    // context does not create extra session-history entries.
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: '__ghPreviewNavigation',
      href: href
    }, '*');
  }, true);

  // Hash scroll listener: parent sends scroll-to-hash requests via postMessage
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === '__ghPreviewScrollToHash') {
      var target = document.querySelector(event.data.hash);
      if (target) target.scrollIntoView();
    }
  });
})();
`;
  }

  /**
   * Inject the proxy script into HTML content, right after <head> or at the start of <body>
   */
  function injectProxyScript(html) {
    const proxyScript = `<script>${buildProxyScript()}<\/script>`;
    // Try to inject after <head>
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
      const insertPos = headMatch.index + headMatch[0].length;
      return html.slice(0, insertPos) + proxyScript + html.slice(insertPos);
    }
    // Fallback: inject after <html> or at the start
    const htmlMatch = html.match(/<html[^>]*>/i);
    if (htmlMatch) {
      const insertPos = htmlMatch.index + htmlMatch[0].length;
      return html.slice(0, insertPos) + proxyScript + html.slice(insertPos);
    }
    // Last resort: prepend
    return proxyScript + html;
  }

  /**
   * Host <-> sandbox renderer bridge
   */
  let sandboxFrame = null;
  let sandboxReady = false;
  let pendingRenderPayload = null;
  let sandboxMessageListenerSetup = false;
  let historyInitialized = false;
  let lastNavigationKey = '';
  let lastNavigationTime = 0;
  let navigationInFlightKey = null;

  function ensureSandboxFrame() {
    if (sandboxFrame?.isConnected) return sandboxFrame;
    const existingFrame = previewContainer.querySelector('.preview-iframe');
    if (existingFrame) {
      sandboxFrame = existingFrame;
      return sandboxFrame;
    }

    sandboxFrame = document.createElement('iframe');
    sandboxFrame.className = 'preview-iframe';
    sandboxFrame.sandbox = 'allow-scripts';
    sandboxFrame.src = chrome.runtime.getURL('src/sandbox/renderer.html');
    sandboxReady = false;

    if (loadingState?.isConnected) {
      previewContainer.insertBefore(sandboxFrame, loadingState);
    } else {
      previewContainer.appendChild(sandboxFrame);
    }
    return sandboxFrame;
  }

  function sendRenderToSandbox(payload) {
    if (!sandboxFrame?.contentWindow) return;
    sandboxFrame.contentWindow.postMessage({
      type: 'host-render',
      htmlContent: payload.htmlContent,
      scrollToHash: payload.scrollToHash || null
    }, '*');
  }

  function scrollSandboxToHash(hash) {
    if (!hash || !sandboxFrame?.contentWindow) return;
    sandboxFrame.contentWindow.postMessage({
      type: 'host-scroll-to-hash',
      hash
    }, '*');
  }

  function setupSandboxMessageListener() {
    if (sandboxMessageListenerSetup) return;
    sandboxMessageListenerSetup = true;

    window.addEventListener('message', async (event) => {
      if (!sandboxFrame || event.source !== sandboxFrame.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'renderer-ready') {
        sandboxReady = true;
        if (pendingRenderPayload) {
          sendRenderToSandbox(pendingRenderPayload);
        }
        return;
      }

      if (data.type === 'renderer-render-start') {
        setLoadingState(true, 'Running page scripts...');
        return;
      }

      if (data.type === 'renderer-render-complete') {
        setLoadingState(false);
        return;
      }

      if (data.type === 'renderer-fetch-external') {
        const result = await fetchExternalResource(data.url, data.responseType || 'text');
        sandboxFrame.contentWindow.postMessage({
          type: 'host-fetch-response',
          id: data.id,
          success: result.success,
          content: result.content,
          mimeType: result.mimeType,
          error: result.error
        }, '*');
        return;
      }

      if (data.type === 'renderer-navigate' && data.href) {
        debugHistoryLog('renderer-navigate', {
          href: data.href,
          relayId: data.relayId,
          relayTime: data.relayTime
        });
        await handleNavigation(data.href);
      }
    });
  }

  /**
   * Render HTML through sandbox runtime
   * @param {string} htmlContent - Processed HTML to render
   * @param {string} [scrollToHash] - Optional hash (e.g., "#section") to scroll to after load
   */
  function createPreviewIframe(htmlContent, scrollToHash) {
    htmlContent = injectProxyScript(htmlContent);

    ensureSandboxFrame();
    setupSandboxMessageListener();

    pendingRenderPayload = {
      htmlContent,
      scrollToHash: scrollToHash || null
    };
    setLoadingState(true, 'Preparing preview...');

    if (sandboxReady) {
      sendRenderToSandbox(pendingRenderPayload);
    }

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
   * @param {string} [scrollToHash] - Optional hash to scroll to after load
   */
  async function loadPreviewForPath(targetPath, scrollToHash) {
    try {
      setLoadingState(true, 'Loading preview...');

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

      createPreviewIframe(htmlContent, scrollToHash);
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
    debugHistoryLog('handleNavigation:start', { href, inFlight: navigationInFlightKey });

    // Remove any hash/anchor from href for path resolution
    const hashIndex = href.indexOf('#');
    const pathPart = hashIndex !== -1 ? href.substring(0, hashIndex) : href;
    const hashPart = hashIndex !== -1 ? href.substring(hashIndex) : '';

    // Resolve the relative path to absolute path from repo root
    const newPath = resolvePath(currentPath, pathPart);
    const newHash = hashPart || '';
    const navigationKey = `${newPath}::${newHash}`;
    const now = Date.now();
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set('path', newPath);
    targetUrl.searchParams.set('file', newPath);
    targetUrl.hash = newHash;
    const currentUrlKey = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const targetUrlKey = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;

    // If URL is already the target, do not create another history entry.
    if (targetUrlKey === currentUrlKey) {
      debugHistoryLog('handleNavigation:skip-same-url', {
        href,
        targetUrl: targetUrl.href,
        targetUrlKey,
        currentUrlKey
      });
      if (newHash) {
        scrollSandboxToHash(newHash);
      }
      return;
    }

    // Guard against duplicate navigate events emitted in quick succession.
    if (navigationKey === lastNavigationKey && now - lastNavigationTime < 500) {
      debugHistoryLog('handleNavigation:skip-rapid-duplicate', {
        href,
        navigationKey,
        lastNavigationKey,
        elapsedMs: now - lastNavigationTime
      });
      return;
    }
    if (navigationInFlightKey === navigationKey) {
      debugHistoryLog('handleNavigation:skip-inflight-duplicate', {
        href,
        navigationKey
      });
      return;
    }
    lastNavigationKey = navigationKey;
    lastNavigationTime = now;

    console.log(`[GitHub PR Preview] Navigating from ${currentPath} to ${newPath}${newHash}`);

    // Same-page hash navigation: keep page, update history, then scroll only.
    if (newPath === currentPath) {
      debugHistoryLog('handleNavigation:pushState-hash-only', {
        href,
        targetUrl: targetUrl.href,
        navigationKey
      });
      window.history.pushState({ path: newPath, hash: newHash }, '', targetUrl);
      if (newHash) {
        scrollSandboxToHash(newHash);
      }
      return;
    }

    // Update URL parameters (add to history) for page navigation
    navigationInFlightKey = navigationKey;
    debugHistoryLog('handleNavigation:pushState-page', {
      href,
      targetUrl: targetUrl.href,
      navigationKey
    });
    window.history.pushState({ path: newPath, hash: newHash }, '', targetUrl);
    try {
      // Load the new HTML file, passing hash for post-load scrolling
      await loadPreviewForPath(newPath, newHash || undefined);
    } finally {
      debugHistoryLog('handleNavigation:complete', {
        href,
        navigationKey
      });
      if (navigationInFlightKey === navigationKey) {
        navigationInFlightKey = null;
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
      setLoadingState(true, 'Loading preview...');

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
    installHistoryDebugHooks();

    // Set up refresh button
    refreshBtn.addEventListener('click', () => {
      loadPreview();
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', async (event) => {
      const currentUrl = new URL(window.location.href);
      const targetPath = event.state?.path ||
        currentUrl.searchParams.get('path') ||
        currentUrl.searchParams.get('file');
      const targetHash = event.state?.hash || currentUrl.hash || '';

      if (targetPath && targetPath !== currentPath) {
        debugHistoryLog('popstate:load-path', {
          state: event.state,
          targetPath,
          targetHash
        });
        console.log('[GitHub PR Preview] Popstate navigation to:', targetPath, targetHash);
        await loadPreviewForPath(targetPath, targetHash || undefined);
      } else if (targetPath && targetHash) {
        debugHistoryLog('popstate:hash-only', {
          state: event.state,
          targetPath,
          targetHash
        });
        // Same page path but different hash in history
        scrollSandboxToHash(targetHash);
      } else {
        debugHistoryLog('popstate:no-action', {
          state: event.state,
          targetPath,
          targetHash
        });
      }
    });

    // Ensure the initial entry has state so back/forward can reliably restore path/hash.
    if (!historyInitialized) {
      const initialPath = currentPath || filePath || '';
      window.history.replaceState(
        { path: initialPath, hash: window.location.hash || '' },
        '',
        window.location.href
      );
      debugHistoryLog('init:replaceState', {
        initialPath,
        initialHash: window.location.hash || ''
      });
      historyInitialized = true;
    }

    // Load preview
    loadPreview();
  }

  init();
})();
