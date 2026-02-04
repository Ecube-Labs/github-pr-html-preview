/**
 * GitHub PR HTML Preview - Popup Script
 * Handles GitHub token configuration with step-by-step guide
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
  const createTokenLink = document.getElementById('createTokenLink');

  // Step elements
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');

  // State
  let tokenExists = false;
  let tokenTested = false;

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
   * Update step states based on token status
   */
  function updateStepStates() {
    // Reset all steps
    [step1, step2, step3].forEach(step => {
      step.classList.remove('active', 'completed', 'disabled');
    });

    if (!tokenExists) {
      // No token: Step 1-2 active, Step 3 disabled
      // User can enter token in Step 2 immediately after creating it
      step1.classList.add('active');
      step2.classList.add('active');
      step3.classList.add('disabled');
      testBtn.disabled = true;
      clearBtn.style.display = 'none';
    } else if (!tokenTested) {
      // Token saved but not tested: Step 1-2 completed, Step 3 active
      step1.classList.add('completed');
      step2.classList.add('completed');
      step3.classList.add('active');
      testBtn.disabled = false;
      clearBtn.style.display = 'inline-block';
    } else {
      // Token tested: All steps completed
      step1.classList.add('completed');
      step2.classList.add('completed');
      step3.classList.add('completed');
      testBtn.disabled = false;
      clearBtn.style.display = 'inline-block';
    }
  }

  /**
   * Load saved token on popup open
   */
  async function loadToken() {
    const { githubToken, tokenTestedAt } = await chrome.storage.local.get(['githubToken', 'tokenTestedAt']);

    if (githubToken) {
      tokenExists = true;
      tokenInput.value = githubToken;
      tokenInput.placeholder = 'Token saved';

      // Check if token was tested (within last 7 days)
      if (tokenTestedAt) {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        tokenTested = tokenTestedAt > sevenDaysAgo;
      }
    }

    updateStepStates();
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
    tokenExists = true;
    tokenTested = false; // Reset tested state for new token
    await chrome.storage.local.remove('tokenTestedAt');

    showStatus('Token saved! Now test the connection.', 'success');
    updateStepStates();
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
        tokenTested = false;
        updateStepStates();
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

      // Mark as tested
      tokenTested = true;
      await chrome.storage.local.set({ tokenTestedAt: Date.now() });

      showStatus(
        `Connected as ${user.login}. Rate limit: ${remaining}/${limit}`,
        'success'
      );
      updateStepStates();
    } catch (error) {
      showStatus(`Connection failed: ${error.message}`, 'error');
      tokenTested = false;
      updateStepStates();
    }
  }

  /**
   * Clear saved token
   */
  async function clearToken() {
    await chrome.storage.local.remove(['githubToken', 'tokenTestedAt']);
    tokenInput.value = '';
    tokenInput.placeholder = 'ghp_xxxxxxxxxxxx';
    tokenExists = false;
    tokenTested = false;
    showStatus('Token cleared', 'success');
    updateStepStates();
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

  /**
   * Handle Step 1 link click - mark as visited
   */
  function handleCreateTokenClick() {
    // Store that user clicked the create token link
    chrome.storage.local.set({ tokenLinkClicked: true });
  }

  // Event listeners
  saveBtn.addEventListener('click', saveToken);
  testBtn.addEventListener('click', testToken);
  clearBtn.addEventListener('click', clearToken);
  createTokenLink.addEventListener('click', handleCreateTokenClick);

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
