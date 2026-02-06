(function() {
  'use strict';

  let runtimeFrame = document.getElementById('runtimeFrame');
  let pendingScrollHash = null;
  let navigationRelayCounter = 0;

  function postToHost(message) {
    window.parent.postMessage(message, '*');
  }

  function postToRuntime(message) {
    if (!runtimeFrame.contentWindow) return;
    runtimeFrame.contentWindow.postMessage(message, '*');
  }

  function handleRuntimeLoad() {
    postToHost({ type: 'renderer-render-complete' });
    if (pendingScrollHash) {
      postToRuntime({
        type: '__ghPreviewScrollToHash',
        hash: pendingScrollHash
      });
      pendingScrollHash = null;
    }
  }

  function replaceRuntimeFrame(htmlContent) {
    const nextFrame = runtimeFrame.cloneNode(false);
    nextFrame.removeAttribute('src');
    nextFrame.removeAttribute('srcdoc');
    nextFrame.addEventListener('load', handleRuntimeLoad);
    nextFrame.srcdoc = htmlContent || '';
    runtimeFrame.replaceWith(nextFrame);
    runtimeFrame = nextFrame;
  }

  function handleHostMessage(event) {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'host-render') {
      pendingScrollHash = data.scrollToHash || null;
      postToHost({ type: 'renderer-render-start' });
      // Recreate runtime iframe each render so inner browsing history is reset.
      // This prevents iframe history entries from polluting top-level back navigation.
      replaceRuntimeFrame(data.htmlContent);
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
      navigationRelayCounter += 1;
      postToHost({
        type: 'renderer-navigate',
        href: data.href,
        relayId: navigationRelayCounter,
        relayTime: Date.now()
      });
    }
  }

  runtimeFrame.addEventListener('load', handleRuntimeLoad);

  window.addEventListener('message', handleHostMessage);
  window.addEventListener('message', handleRuntimeMessage);

  postToHost({ type: 'renderer-ready' });
})();
