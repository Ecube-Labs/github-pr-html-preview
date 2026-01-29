/**
 * GitHub PR HTML Preview - Popup Script
 * Handles GitHub token configuration
 */

(function() {
  'use strict';

  const tokenInput = document.getElementById('token');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');
  const displayModeSelect = document.getElementById('displayMode');
  const pendingPreviewBanner = document.getElementById('pendingPreviewBanner');
  const pendingPreviewPath = document.getElementById('pendingPreviewPath');
  const openSidePanelBtn = document.getElementById('openSidePanelBtn');

  /**
   * Show status message
   */
  function showStatus(message, type = 'info') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';
  }

  /**
   * Hide status message
   */
  function hideStatus() {
    statusEl.style.display = 'none';
  }

  /**
   * Load saved token on popup open
   */
  async function loadToken() {
    const { githubToken } = await chrome.storage.local.get('githubToken');
    if (githubToken) {
      // Show masked token
      tokenInput.value = githubToken;
      tokenInput.placeholder = 'Token saved';
    }
  }

  /**
   * Save token to storage
   */
  async function saveToken() {
    const token = tokenInput.value.trim();

    if (!token) {
      showStatus('Please enter a token', 'error');
      return;
    }

    // Validate token format
    if (!token.match(/^(ghp_|github_pat_)/)) {
      showStatus('Token should start with "ghp_" or "github_pat_"', 'error');
      return;
    }

    await chrome.storage.local.set({ githubToken: token });
    showStatus('Token saved successfully', 'success');
  }

  /**
   * Test token by fetching user info
   */
  async function testToken() {
    const { githubToken } = await chrome.storage.local.get('githubToken');

    if (!githubToken) {
      showStatus('No token saved. Please save a token first.', 'error');
      return;
    }

    showStatus('Testing connection...', 'info');

    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          showStatus('Invalid or expired token', 'error');
        } else {
          showStatus(`GitHub API error: ${response.status}`, 'error');
        }
        return;
      }

      const user = await response.json();

      // Also check rate limit
      const rateLimit = await fetch('https://api.github.com/rate_limit', {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      const rateLimitData = await rateLimit.json();
      const remaining = rateLimitData.resources?.core?.remaining || 'N/A';
      const limit = rateLimitData.resources?.core?.limit || 'N/A';

      showStatus(
        `Connected as ${user.login}. Rate limit: ${remaining}/${limit}`,
        'success'
      );
    } catch (error) {
      showStatus(`Connection failed: ${error.message}`, 'error');
    }
  }

  /**
   * Clear saved token
   */
  async function clearToken() {
    await chrome.storage.local.remove('githubToken');
    tokenInput.value = '';
    tokenInput.placeholder = 'ghp_xxxxxxxxxxxx';
    showStatus('Token cleared', 'success');
  }

  /**
   * Load saved display mode setting
   */
  async function loadDisplayMode() {
    const { displayMode } = await chrome.storage.local.get('displayMode');
    displayModeSelect.value = displayMode || 'tab';
  }

  /**
   * Save display mode setting
   */
  async function saveDisplayMode() {
    await chrome.storage.local.set({ displayMode: displayModeSelect.value });
  }

  /**
   * Check for pending preview and show banner if exists
   */
  async function checkPendingPreview() {
    const { pendingPreview, pendingPreviewParams } = await chrome.storage.session.get([
      'pendingPreview',
      'pendingPreviewParams'
    ]);

    if (pendingPreview && pendingPreviewParams) {
      pendingPreviewPath.textContent = pendingPreview.path;
      pendingPreviewBanner.style.display = 'block';
    } else {
      pendingPreviewBanner.style.display = 'none';
    }
  }

  /**
   * Open side panel with pending preview
   */
  async function openSidePanel() {
    const { pendingPreview, pendingPreviewParams } = await chrome.storage.session.get([
      'pendingPreview',
      'pendingPreviewParams'
    ]);

    if (!pendingPreview || !pendingPreviewParams) {
      return;
    }

    try {
      // Configure and open side panel
      await chrome.sidePanel.setOptions({
        tabId: pendingPreview.tabId,
        path: 'src/preview/preview.html?' + pendingPreviewParams,
        enabled: true
      });

      await chrome.sidePanel.open({ tabId: pendingPreview.tabId });

      // Clear pending preview
      chrome.runtime.sendMessage({ action: 'clearPendingPreview' });

      // Close popup
      window.close();
    } catch (error) {
      console.error('[GitHub PR Preview] Failed to open side panel:', error);
      showStatus('Failed to open side panel: ' + error.message, 'error');
    }
  }

  // Event listeners
  saveBtn.addEventListener('click', saveToken);
  testBtn.addEventListener('click', testToken);
  clearBtn.addEventListener('click', clearToken);

  // Allow Enter key to save
  tokenInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveToken();
    }
  });

  // Save display mode on change
  displayModeSelect.addEventListener('change', saveDisplayMode);

  // Open side panel button
  openSidePanelBtn.addEventListener('click', openSidePanel);

  /**
   * Sync color scheme with service worker for icon update
   */
  function syncColorScheme() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    chrome.runtime.sendMessage({ action: 'updateColorScheme', isDark });
  }

  // Initialize
  loadToken();
  loadDisplayMode();
  checkPendingPreview();
  syncColorScheme();
})();
