/**
 * GitHub PR HTML Preview - Background Service Worker
 * Handles opening preview tabs and fetching content via GitHub API
 */

/**
 * Update extension icon based on system color scheme
 */
function updateIconForColorScheme(isDark) {
  const suffix = isDark ? '-dark' : '-light';
  chrome.action.setIcon({
    path: {
      16: `/icons/icon16${suffix}.png`,
      48: `/icons/icon48${suffix}.png`
    }
  });
}

/**
 * Initialize icon based on system theme
 */
function initThemeIcon() {
  // Check if matchMedia is available (Chrome 131+)
  if (typeof matchMedia !== 'undefined') {
    const darkModeQuery = matchMedia('(prefers-color-scheme: dark)');
    updateIconForColorScheme(darkModeQuery.matches);

    // Listen for theme changes
    darkModeQuery.addEventListener('change', (e) => {
      updateIconForColorScheme(e.matches);
    });
  }
}

// Initialize theme icon on service worker start
initThemeIcon();

/**
 * Parse a GitHub raw URL to extract owner, repo, ref, and path
 * URL format: https://github.com/{owner}/{repo}/raw/{ref}/{path}
 */
function parseGitHubRawUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    ref: match[3],
    path: decodeURIComponent(match[4])
  };
}

/**
 * Fetch content from GitHub API
 * Uses Personal Access Token for authentication if available
 */
async function fetchFromGitHubAPI(url) {
  const parsed = parseGitHubRawUrl(url);
  if (!parsed) {
    return { success: false, error: 'Invalid GitHub URL format' };
  }

  const { owner, repo, ref, path } = parsed;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;

  // Get stored GitHub token
  const { githubToken } = await chrome.storage.local.get('githubToken');

  const headers = {
    'Accept': 'application/vnd.github.v3.raw'
  };

  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }

  try {
    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
      // Handle specific error cases
      if (response.status === 401) {
        return {
          success: false,
          error: 'Invalid or expired GitHub token. Please update your token in extension settings.',
          errorCode: 'UNAUTHORIZED'
        };
      }
      if (response.status === 403) {
        // Check if it's rate limiting
        const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
        if (rateLimitRemaining === '0') {
          const resetTime = response.headers.get('X-RateLimit-Reset');
          const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000).toLocaleTimeString() : 'soon';
          return {
            success: false,
            error: `GitHub API rate limit exceeded. Resets at ${resetDate}. Add a GitHub token in extension settings for higher limits.`,
            errorCode: 'RATE_LIMITED'
          };
        }
        return {
          success: false,
          error: 'Access forbidden. This may be a private repository. Please set a GitHub token with repo scope in extension settings.',
          errorCode: 'FORBIDDEN'
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: 'File not found. The file may have been deleted or the branch/commit may not exist.',
          errorCode: 'NOT_FOUND'
        };
      }
      return {
        success: false,
        error: `GitHub API error: HTTP ${response.status}`,
        errorCode: 'API_ERROR'
      };
    }

    const content = await response.text();
    return { success: true, content };
  } catch (error) {
    return {
      success: false,
      error: `Network error: ${error.message}`,
      errorCode: 'NETWORK_ERROR'
    };
  }
}

// Listen for messages from content script and preview page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateColorScheme') {
    updateIconForColorScheme(message.isDark);
    return true;
  }

  if (message.action === 'openPreview') {
    openPreview(message, sender);
    return true;
  }

  // Fetch content via GitHub API
  if (message.action === 'fetchFromGitHub') {
    // Use explicit params if provided, otherwise try to parse URL (for backwards compatibility)
    if (message.owner && message.repo && message.ref && message.path) {
      fetchFromGitHubAPIWithParams(message.owner, message.repo, message.ref, message.path)
        .then(sendResponse);
    } else {
      fetchFromGitHubAPI(message.url).then(sendResponse);
    }
    return true; // Keep message channel open for async response
  }

  // Fetch image as base64 via GitHub API
  if (message.action === 'fetchImageAsBase64') {
    fetchImageAsBase64(message.owner, message.repo, message.ref, message.path)
      .then(sendResponse);
    return true;
  }

  // Fetch external resource (CSS/JS/images from CDN etc.)
  if (message.action === 'fetchExternalResource') {
    fetchExternalResource(message.url, message.responseType || 'text')
      .then(sendResponse);
    return true;
  }

  // Clear pending preview badge
  if (message.action === 'clearPendingPreview') {
    chrome.storage.session.remove(['pendingPreview', 'pendingPreviewParams']);
    chrome.action.setBadgeText({ text: '' });
    return true;
  }

  return true;
});

/**
 * Fetch content from GitHub API using explicit parameters
 */
async function fetchFromGitHubAPIWithParams(owner, repo, ref, path) {
  // Encode path segments (preserve directory structure) and ref for the API URL
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

  // Debug logging
  console.log('[GitHub PR Preview] API Request:', { owner, repo, ref, path, apiUrl });

  // Get stored GitHub token
  const { githubToken } = await chrome.storage.local.get('githubToken');

  const headers = {
    'Accept': 'application/vnd.github.v3.raw'
  };

  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }

  try {
    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
      // Debug info for error responses
      const debugInfo = { apiUrl, owner, repo, ref, path, status: response.status };
      console.log('[GitHub PR Preview] API Error:', debugInfo);

      // Handle specific error cases
      if (response.status === 401) {
        return {
          success: false,
          error: 'Invalid or expired GitHub token. Please update your token in extension settings.',
          errorCode: 'UNAUTHORIZED',
          debug: debugInfo
        };
      }
      if (response.status === 403) {
        // Check if it's rate limiting
        const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
        if (rateLimitRemaining === '0') {
          const resetTime = response.headers.get('X-RateLimit-Reset');
          const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000).toLocaleTimeString() : 'soon';
          return {
            success: false,
            error: `GitHub API rate limit exceeded. Resets at ${resetDate}. Add a GitHub token in extension settings for higher limits.`,
            errorCode: 'RATE_LIMITED',
            debug: debugInfo
          };
        }
        return {
          success: false,
          error: 'Access forbidden. This may be a private repository. Please set a GitHub token with repo scope in extension settings.',
          errorCode: 'FORBIDDEN',
          debug: debugInfo
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: 'File not found. The file may have been deleted or the branch/commit may not exist.',
          errorCode: 'NOT_FOUND',
          debug: debugInfo
        };
      }
      return {
        success: false,
        error: `GitHub API error: HTTP ${response.status}`,
        errorCode: 'API_ERROR',
        debug: debugInfo
      };
    }

    console.log('[GitHub PR Preview] API Success:', { apiUrl, owner, repo, ref, path });
    const content = await response.text();
    return { success: true, content };
  } catch (error) {
    const debugInfo = { apiUrl, owner, repo, ref, path, error: error.message };
    console.log('[GitHub PR Preview] Network Error:', debugInfo);
    return {
      success: false,
      error: `Network error: ${error.message}`,
      errorCode: 'NETWORK_ERROR',
      debug: debugInfo
    };
  }
}

/**
 * Fetch image from GitHub API as base64
 * Uses the standard GitHub Contents API which returns base64-encoded content
 */
async function fetchImageAsBase64(owner, repo, ref, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

  console.log('[GitHub PR Preview] Fetching image as base64:', { owner, repo, ref, path, apiUrl });

  const { githubToken } = await chrome.storage.local.get('githubToken');

  const headers = {
    'Accept': 'application/vnd.github.v3+json'
  };

  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }

  try {
    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
      console.log('[GitHub PR Preview] Image fetch failed:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (data.content && data.encoding === 'base64') {
      // Determine MIME type from file extension
      const ext = path.split('.').pop().toLowerCase();
      const mimeTypes = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'webp': 'image/webp',
        'ico': 'image/x-icon',
        'bmp': 'image/bmp'
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      console.log('[GitHub PR Preview] Image fetched successfully:', { path, mimeType });
      return {
        success: true,
        content: data.content.replace(/\n/g, ''), // Remove newlines from base64
        mimeType
      };
    }

    return { success: false, error: 'Invalid response format' };
  } catch (error) {
    console.log('[GitHub PR Preview] Image fetch error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Open preview in Side Panel or new tab based on user settings
 */
async function openPreview(message, sender) {
  // Get display mode setting
  const { displayMode } = await chrome.storage.local.get('displayMode');

  // Preview data for both modes
  const previewData = {
    owner: message.owner,
    repo: message.repo,
    ref: message.ref,
    path: message.path,
    rawUrl: message.rawUrl,
    tabId: sender.tab.id
  };

  // Encode parameters for the preview page
  const params = new URLSearchParams({
    owner: message.owner,
    repo: message.repo,
    ref: message.ref,
    path: message.path,
    url: message.rawUrl,
    file: message.path
  });

  const paramsString = params.toString();

  // Check if Side Panel API is available and user wants side panel mode
  if (displayMode === 'sidepanel' && chrome.sidePanel) {
    // Store pending preview data for the popup to use
    await chrome.storage.session.set({
      pendingPreview: previewData,
      pendingPreviewParams: paramsString
    });

    // Set badge to indicate pending preview
    await chrome.action.setBadgeText({ text: '1' });
    await chrome.action.setBadgeBackgroundColor({ color: '#0969da' });

    // Configure side panel path (but don't open - requires user gesture)
    await chrome.sidePanel.setOptions({
      tabId: sender.tab.id,
      path: 'src/preview/preview.html?' + paramsString,
      enabled: true
    });

    // Send response back to content script to show notification
    chrome.tabs.sendMessage(sender.tab.id, {
      action: 'showSidePanelNotification'
    });
  } else {
    // Default: open in new tab
    openPreviewInNewTab(paramsString);
  }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Fetch an external resource (CDN scripts, stylesheets, images, fonts, etc.)
 * Used to proxy external resources for CSP-compliant inlining
 * @param {string} url - The external URL to fetch
 * @param {string} responseType - 'text' for CSS/JS, 'base64' for images/fonts
 * @returns {Promise<{success: boolean, content?: string, mimeType?: string, error?: string}>}
 */
async function fetchExternalResource(url, responseType = 'text') {
  // Validate protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, error: 'Only http/https URLs are allowed' };
  }

  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  const TIMEOUT_MS = 15000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': '*/*'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status} for ${url}` };
    }

    // Check content length if available
    const contentLength = response.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength) > MAX_SIZE) {
      return { success: false, error: `Resource too large (${contentLength} bytes): ${url}` };
    }

    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

    if (responseType === 'base64') {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_SIZE) {
        return { success: false, error: `Resource too large (${buffer.byteLength} bytes): ${url}` };
      }
      const base64 = arrayBufferToBase64(buffer);
      const mimeType = contentType.split(';')[0].trim();
      return { success: true, content: base64, mimeType };
    } else {
      const text = await response.text();
      if (text.length > MAX_SIZE) {
        return { success: false, error: `Resource too large (${text.length} bytes): ${url}` };
      }
      return { success: true, content: text };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, error: `Timeout fetching ${url}` };
    }
    return { success: false, error: `Failed to fetch ${url}: ${error.message}` };
  }
}

/**
 * Open preview in a new tab
 */
async function openPreviewInNewTab(paramsString) {
  const previewPageUrl = chrome.runtime.getURL('src/preview/preview.html');
  await chrome.tabs.create({
    url: `${previewPageUrl}?${paramsString}`
  });
}
