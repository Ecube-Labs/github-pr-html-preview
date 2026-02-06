/**
 * GitHub PR HTML Preview - Content Script
 * Detects HTML files in PR file changes and adds preview buttons
 */

(function() {
  'use strict';

  const PREVIEW_BUTTON_CLASS = 'gh-pr-html-preview-btn';
  const PROCESSED_ATTR = 'data-html-preview-processed';
  const TOAST_ID = 'gh-pr-html-preview-toast';
  let extensionContextInvalidToastShown = false;

  /**
   * Send a runtime message and gracefully handle extension reload/update races
   * where the current content script context has been invalidated.
   */
  function sendMessageSafe(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (!chrome.runtime) return;
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = err.message || '';
          if (msg.includes('Extension context invalidated')) {
            if (!extensionContextInvalidToastShown) {
              extensionContextInvalidToastShown = true;
              showToast('Extension was updated. Refresh this GitHub page and try again.', 5000);
            }
            return;
          }
          console.warn('[GitHub PR Preview] sendMessage error:', msg);
          return;
        }
        if (typeof callback === 'function') {
          callback(response);
        }
      });
    } catch (error) {
      const msg = error?.message || String(error);
      if (msg.includes('Extension context invalidated')) {
        if (!extensionContextInvalidToastShown) {
          extensionContextInvalidToastShown = true;
          showToast('Extension was updated. Refresh this GitHub page and try again.', 5000);
        }
        return;
      }
      console.warn('[GitHub PR Preview] sendMessage exception:', error);
    }
  }

  /**
   * Check if GitHub token exists in storage
   */
  async function checkTokenExists() {
    const { githubToken } = await chrome.storage.local.get('githubToken');
    return !!githubToken;
  }

  /**
   * Update all preview buttons based on token availability
   */
  function updateAllButtonStates(hasToken) {
    const buttons = document.querySelectorAll(`.${PREVIEW_BUTTON_CLASS}`);
    buttons.forEach(btn => {
      if (hasToken) {
        btn.disabled = false;
        btn.removeAttribute('data-no-token');
        btn.title = btn.getAttribute('data-file-path') ? `Preview ${btn.getAttribute('data-file-path')}` : '';
      } else {
        btn.disabled = true;
        btn.setAttribute('data-no-token', 'true');
        btn.title = 'Set up GitHub token in extension settings';
      }
    });
  }

  // Listen for storage changes to update button states
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.githubToken) {
      const hasToken = !!changes.githubToken.newValue;
      updateAllButtonStates(hasToken);
    }
  });

  /**
   * Check if current URL is a PR files or changes page
   */
  function isTargetPage() {
    const pathname = window.location.pathname;
    // Match /owner/repo/pull/123/files or /owner/repo/pull/123/changes
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/.test(pathname);
  }

  /**
   * Extract repository info and PR details from the current URL
   */
  function getPRInfo() {
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;

    return {
      owner: match[1],
      repo: match[2],
      prNumber: match[3]
    };
  }

  /**
   * Get the current commit SHA from the PR page
   */
  function getCurrentCommitSha() {
    // Method 1: Extract from blob/{sha}/ pattern in CODEOWNERS or .github file links (new GitHub UI)
    const blobLink = document.querySelector('a[href*="/blob/"][href*="CODEOWNERS"], a[href*="/blob/"][href*=".github"]');
    if (blobLink) {
      const match = blobLink.href.match(/\/blob\/([a-f0-9]{40})\//);
      if (match) return match[1];
    }

    // Method 2: Extract from "View file" links in diff headers
    const viewFileLink = document.querySelector('a[href*="/blob/"][aria-label*="View file"], a[href*="/blob/"][title*="View file"]');
    if (viewFileLink) {
      const match = viewFileLink.href.match(/\/blob\/([a-f0-9]{40})\//);
      if (match) return match[1];
    }

    // Method 3: Try any blob link with 40-char hex SHA
    const anyBlobLink = document.querySelector('a[href*="/blob/"]');
    if (anyBlobLink) {
      const match = anyBlobLink.href.match(/\/blob\/([a-f0-9]{40})\//);
      if (match) return match[1];
    }

    // Legacy method 1: Try to get from the permalink button or commit selector
    const permalinkBtn = document.querySelector('a[href*="/pull/"][href*="/files/"]');
    if (permalinkBtn) {
      const match = permalinkBtn.href.match(/\/files\/([a-f0-9]+)/);
      if (match) return match[1];
    }

    // Legacy method 2: Try to get from the commit dropdown or display
    const commitEl = document.querySelector('.js-commits-filtered [data-commit-sha]');
    if (commitEl) {
      return commitEl.getAttribute('data-commit-sha');
    }

    // Legacy method 3: Try to get from URL if viewing specific commit
    const urlMatch = window.location.pathname.match(/\/files\/([a-f0-9]+)/);
    if (urlMatch) return urlMatch[1];

    // Legacy method 4: Fallback - try to find in various elements
    const commitLink = document.querySelector('a[href*="/commit/"]');
    if (commitLink) {
      const commitMatch = commitLink.href.match(/\/commit\/([a-f0-9]+)/);
      if (commitMatch) return commitMatch[1];
    }

    return null;
  }

  /**
   * Get the head branch ref from the PR page
   */
  function getHeadRef() {
    // Method 1: Find "from {branch}" link in new GitHub UI
    // Pattern: "wants to merge X commits into main from branch-name"
    const treeLinks = document.querySelectorAll('a[href*="/tree/"]');
    for (const link of treeLinks) {
      const treeMatch = link.href.match(/\/tree\/([^/?#]+)/);
      if (treeMatch) {
        // Check if this link follows "from" text (indicating head branch)
        const prevText = link.previousSibling?.textContent?.trim();
        if (prevText === 'from' || prevText?.endsWith('from')) {
          return decodeURIComponent(treeMatch[1]);
        }
      }
    }

    // Method 2: Find branch link near "Copy head branch" button
    const copyBtn = document.querySelector('button[aria-label*="Copy head branch"], clipboard-copy[aria-label*="Copy head branch"]');
    if (copyBtn) {
      // Check clipboard-copy value attribute
      if (copyBtn.tagName === 'CLIPBOARD-COPY') {
        const value = copyBtn.getAttribute('value');
        if (value) return value;
      }
      // Check previous sibling link
      const branchLink = copyBtn.previousElementSibling;
      if (branchLink?.tagName === 'A') {
        const match = branchLink.href.match(/\/tree\/([^/?#]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
    }

    // Method 3: Look for branch name in description text near tree links
    for (const link of treeLinks) {
      const treeMatch = link.href.match(/\/tree\/([^/?#]+)/);
      if (treeMatch) {
        const branchName = decodeURIComponent(treeMatch[1]);
        // Skip common base branches
        if (!['main', 'master', 'develop', 'dev'].includes(branchName.toLowerCase())) {
          return branchName;
        }
      }
    }

    // Legacy method 1: Try to get from the PR head branch reference
    const headRef = document.querySelector('.head-ref a, .head-ref span');
    if (headRef) {
      return headRef.textContent.trim().split(':').pop();
    }

    // Legacy method 2: Try from clipboard-copy element
    const clipboardCopy = document.querySelector('.head-ref clipboard-copy');
    if (clipboardCopy) {
      return clipboardCopy.getAttribute('value');
    }

    return null;
  }

  /**
   * Build github.com/raw/ URL for a file
   * Uses github.com domain instead of raw.githubusercontent.com to allow cookie-based authentication
   */
  function buildRawUrl(prInfo, filePath, ref) {
    // Use the ref (commit SHA or branch name) to get the raw content
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    // github.com/raw/ endpoint allows cookie authentication for private repos
    return `https://github.com/${prInfo.owner}/${prInfo.repo}/raw/${ref}/${encodedPath}`;
  }

  /**
   * Create a preview button element
   */
  function createPreviewButton(prInfo, filePath, ref, rawUrl, hasToken) {
    const button = document.createElement('button');
    button.className = PREVIEW_BUTTON_CLASS;
    button.type = 'button';
    button.setAttribute('data-file-path', filePath);
    button.setAttribute('data-raw-url', rawUrl);

    // Set button state based on token availability
    if (hasToken) {
      button.title = `Preview ${filePath}`;
    } else {
      button.disabled = true;
      button.setAttribute('data-no-token', 'true');
      button.title = 'Set up GitHub token in extension settings';
    }

    // Add eye icon (Octicon eye-16)
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'octicon');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('fill', 'currentColor');
    icon.innerHTML = '<path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.824.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"></path>';

    const text = document.createElement('span');
    text.textContent = 'Preview';

    button.appendChild(icon);
    button.appendChild(text);

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPreview(prInfo, filePath, ref, rawUrl);
    });

    return button;
  }

  /**
   * Show a toast notification
   */
  function showToast(message, duration = 4000) {
    // Remove existing toast if any
    const existingToast = document.getElementById(TOAST_ID);
    if (existingToast) {
      existingToast.remove();
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #0969da 0%, #0550ae 100%);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 9999999;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
        animation: slideIn 0.3s ease-out;
      ">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287ZM8 5.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/>
        </svg>
        <span>${message}</span>
      </div>
      <style>
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      </style>
    `;

    document.body.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Open the preview in a new tab
   */
  function openPreview(prInfo, filePath, ref, rawUrl) {
    // Debug logging
    console.log('[GitHub PR Preview] Opening preview:', {
      owner: prInfo.owner,
      repo: prInfo.repo,
      ref: ref,
      path: filePath,
      rawUrl: rawUrl
    });

    // Send message to background script to open preview
    // Pass all parameters separately to avoid URL parsing issues with branch names containing slashes
    sendMessageSafe({
      action: 'openPreview',
      owner: prInfo.owner,
      repo: prInfo.repo,
      ref: ref,
      path: filePath,
      rawUrl: rawUrl
    });
  }

  /**
   * Find all HTML file entries in the PR files changed view
   */
  function findHtmlFileEntries() {
    const fileEntries = [];

    // New GitHub UI: Find file headers with the DiffFileHeader module class
    const newUIHeaders = document.querySelectorAll('div[class*="DiffFileHeader-module__diff-file-header"]');

    newUIHeaders.forEach(header => {
      if (header.hasAttribute(PROCESSED_ATTR)) return;

      // File path is in h3 > a.Link--primary > code structure
      const codeEl = header.querySelector('h3 a.Link--primary code');
      if (!codeEl) return;

      // Remove special characters (like left-to-right marks) and trim
      const filePath = codeEl.textContent.replace(/[\u200E\u200F\u202A-\u202E]/g, '').trim();
      if (!filePath.toLowerCase().endsWith('.html')) return;

      fileEntries.push({
        header: header,
        filePath: filePath
      });
    });

    // Classic GitHub UI: Find file headers with data-path attribute (most reliable)
    const classicHeaders = document.querySelectorAll('.file-header[data-path]');

    classicHeaders.forEach(header => {
      if (header.hasAttribute(PROCESSED_ATTR)) return;

      // 1. Extract file path directly from data-path attribute (most reliable)
      let filePath = header.getAttribute('data-path');

      // 2. Fallback: Extract from Truncate-text link (avoid CODEOWNERS link)
      if (!filePath) {
        const filePathEl = header.querySelector('.file-info a.Link--primary.Truncate-text, .file-info .Truncate-text a');
        if (filePathEl) {
          filePath = filePathEl.getAttribute('title') || filePathEl.textContent.trim();
        }
      }

      if (!filePath || !filePath.toLowerCase().endsWith('.html')) return;

      fileEntries.push({
        header: header,
        filePath: filePath,
        isClassicUI: true
      });
    });

    // Legacy GitHub UI fallback: Find file headers without data-path attribute
    const legacyHeaders = document.querySelectorAll('[data-file-header]:not(.file-header[data-path])');

    legacyHeaders.forEach(header => {
      if (header.hasAttribute(PROCESSED_ATTR)) return;

      const filePathEl = header.querySelector('.file-info a.Link--primary, [data-path], .Link--primary');
      if (!filePathEl) return;

      const filePath = filePathEl.getAttribute('title') ||
                       filePathEl.getAttribute('data-path') ||
                       filePathEl.textContent.trim();

      if (!filePath || !filePath.toLowerCase().endsWith('.html')) return;

      fileEntries.push({
        header: header,
        filePath: filePath,
        element: filePathEl
      });
    });

    return fileEntries;
  }

  /**
   * Add preview buttons to HTML file entries
   */
  async function addPreviewButtons() {
    const prInfo = getPRInfo();
    if (!prInfo) return;

    // Get the ref to use for raw URLs
    // Prefer branch name (headRef) over commit SHA, since branch name always points to latest
    // Commit SHA from blob links may reference wrong commits (e.g., CODEOWNERS from different branch)
    const headRef = getHeadRef();
    const commitSha = getCurrentCommitSha();
    const ref = headRef || commitSha;

    if (!ref) {
      console.warn('GitHub PR HTML Preview: Could not determine commit/branch reference');
      return;
    }

    // Check if token exists
    const hasToken = await checkTokenExists();

    const htmlFiles = findHtmlFileEntries();

    htmlFiles.forEach(({ header, filePath, isClassicUI }) => {
      // Mark as processed
      header.setAttribute(PROCESSED_ATTR, 'true');

      // Build raw URL
      const rawUrl = buildRawUrl(prInfo, filePath, ref);

      // Create and insert button (pass all params for API call)
      const button = createPreviewButton(prInfo, filePath, ref, rawUrl, hasToken);

      // New GitHub UI: Find Viewed button's parent container (div.d-flex.flex-items-center.gap-2)
      const viewedBtn = header.querySelector('button[aria-label*="Viewed"]');
      let inserted = false;

      if (viewedBtn) {
        const actionsContainer = viewedBtn.parentElement;
        if (actionsContainer && actionsContainer.classList.contains('d-flex')) {
          actionsContainer.insertBefore(button, actionsContainer.firstChild);
          inserted = true;
        }
      }

      // New GitHub UI fallback: Find the right-side container with flex-order class
      if (!inserted) {
        const rightActions = header.querySelector('div[class*="DiffFileHeader-module__container-flex-order"]');
        if (rightActions) {
          // Find the inner flex container for buttons
          const innerFlex = rightActions.querySelector('div.d-flex.flex-items-center.gap-2');
          if (innerFlex) {
            innerFlex.insertBefore(button, innerFlex.firstChild);
            inserted = true;
          } else {
            rightActions.insertBefore(button, rightActions.firstChild);
            inserted = true;
          }
        }
      }

      // Classic UI: Insert before Viewed checkbox in file-actions
      if (!inserted && isClassicUI) {
        const fileActions = header.querySelector('.file-actions .d-flex.flex-justify-end');
        if (fileActions) {
          const reviewToggle = fileActions.querySelector('.js-replace-file-header-review, .js-reviewed-toggle');
          if (reviewToggle) {
            // Insert before the Viewed checkbox container
            fileActions.insertBefore(button, reviewToggle);
            inserted = true;
          } else {
            // Insert at the beginning of file-actions
            fileActions.insertBefore(button, fileActions.firstChild);
            inserted = true;
          }
        } else {
          // Fallback: just find .file-actions
          const simpleFileActions = header.querySelector('.file-actions');
          if (simpleFileActions) {
            simpleFileActions.insertBefore(button, simpleFileActions.firstChild);
            inserted = true;
          }
        }
      }

      // Legacy GitHub UI fallback
      if (!inserted) {
        const actionsArea = header.querySelector('.file-actions, .BtnGroup, .d-flex');
        if (actionsArea) {
          actionsArea.insertBefore(button, actionsArea.firstChild);
        } else {
          const fileInfo = header.querySelector('.file-info');
          if (fileInfo) {
            fileInfo.appendChild(button);
          }
        }
      }
    });
  }

  /**
   * Handle URL changes and run preview buttons if on target page
   */
  function handleUrlChange() {
    if (isTargetPage()) {
      // Debounce to allow DOM to update after SPA navigation
      clearTimeout(window._htmlPreviewScanTimeout);
      window._htmlPreviewScanTimeout = setTimeout(addPreviewButtons, 300);
    }
  }

  /**
   * Set up History API monitoring for SPA navigation
   */
  function setupHistoryMonitoring() {
    // Monitor pushState
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      handleUrlChange();
    };

    // Monitor replaceState
    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      handleUrlChange();
    };

    // Monitor popstate (back/forward navigation)
    window.addEventListener('popstate', handleUrlChange);
  }

  /**
   * Initialize the extension
   */
  function init() {
    // Set up History API monitoring for SPA navigation
    setupHistoryMonitoring();

    // Initial scan only if on target page
    if (isTargetPage()) {
      addPreviewButtons();
    }

    // Observe for dynamic content changes (GitHub uses SPA navigation)
    const observer = new MutationObserver((mutations) => {
      // Only scan if on target page
      if (!isTargetPage()) return;

      let shouldScan = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }

      if (shouldScan) {
        // Debounce the scan
        clearTimeout(window._htmlPreviewScanTimeout);
        window._htmlPreviewScanTimeout = setTimeout(addPreviewButtons, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also handle navigation events (still useful as fallback)
    document.addEventListener('turbo:load', handleUrlChange);
    document.addEventListener('pjax:success', handleUrlChange);
  }

  // Listen for messages from service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'showSidePanelNotification') {
      showToast('Click the extension icon to open Side Panel preview');
    }
  });

  /**
   * Detect and sync system color scheme with service worker
   */
  function syncColorScheme() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    sendMessageSafe({ action: 'updateColorScheme', isDark });

    // Listen for changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      sendMessageSafe({ action: 'updateColorScheme', isDark: e.matches });
    });
  }

  // Sync color scheme on load
  syncColorScheme();

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
