(function() {
  'use strict';

  const runtimeFrame = document.getElementById('runtimeFrame');
  let pendingScrollHash = null;

  function postToHost(message) {
    window.parent.postMessage(message, '*');
  }

  function postToRuntime(message) {
    if (!runtimeFrame.contentWindow) return;
    runtimeFrame.contentWindow.postMessage(message, '*');
  }

  function handleHostMessage(event) {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'host-render') {
      pendingScrollHash = data.scrollToHash || null;
      postToHost({ type: 'renderer-render-start' });
      runtimeFrame.srcdoc = data.htmlContent || '';
      return;
    }

    if (data.type === 'host-fetch-response') {
      postToRuntime({
        type: '__ghPreviewProxyResponse',
        id: data.id,
        success: data.success,
        content: data.content,
        mimeType: data.mimeType,
        error: data.error
      });
      return;
    }

    if (data.type === 'host-scroll-to-hash' && data.hash) {
      postToRuntime({
        type: '__ghPreviewScrollToHash',
        hash: data.hash
      });
    }
  }

  function handleRuntimeMessage(event) {
    if (event.source !== runtimeFrame.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === '__ghPreviewProxy') {
      postToHost({
        type: 'renderer-fetch-external',
        id: data.id,
        url: data.url,
        responseType: data.responseType || 'text'
      });
      return;
    }

    if (data.type === '__ghPreviewNavigation') {
      postToHost({
        type: 'renderer-navigate',
        href: data.href
      });
    }
  }

  runtimeFrame.addEventListener('load', () => {
    postToHost({ type: 'renderer-render-complete' });
    if (pendingScrollHash) {
      postToRuntime({
        type: '__ghPreviewScrollToHash',
        hash: pendingScrollHash
      });
      pendingScrollHash = null;
    }
  });

  window.addEventListener('message', handleHostMessage);
  window.addEventListener('message', handleRuntimeMessage);

  postToHost({ type: 'renderer-ready' });
})();
