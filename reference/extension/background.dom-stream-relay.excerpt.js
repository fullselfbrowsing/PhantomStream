    // ==========================================
    // DOM Stream forwarding (content -> dashboard via WebSocket)
    // ==========================================

    case 'domStreamSnapshot':
      if (typeof fsbWebSocket !== 'undefined' && fsbWebSocket && fsbWebSocket.connected) {
        fsbWebSocket.send('ext:dom-snapshot', request.snapshot || {});
      }
      sendResponse({ success: true });
      break;

    case 'domStreamMutations':
      // Phase 211-02 STREAM-02: cache the last-known staleFlushCount from
      // the content script so ws/ws-client.js _emitStreamState can include
      // it in the ext:stream-state payload. Additive only -- the
      // ext:dom-mutations payload shape MUST NOT change (D-14).
      if (typeof request.staleFlushCount === 'number') {
        _lastDomStreamStaleFlushCount = request.staleFlushCount;
      }
      // Phase 211-02 STREAM-01: ensure the dom-stream watchdog alarm is armed
      // whenever streaming activity is observed. chrome.alarms.create is
      // idempotent (recreating the same name replaces the schedule), so it is
      // safe to call on every dispatch. Pattern mirrors ws/mcp-bridge-client.js:218.
      try {
        var alarmsApi = (typeof chrome !== 'undefined') ? chrome.alarms : null;
        if (alarmsApi && typeof alarmsApi.create === 'function') {
          var armResult = alarmsApi.create('fsb-domstream-watchdog', { periodInMinutes: 1 });
          if (armResult && typeof armResult.catch === 'function') {
            armResult.catch(function() { /* best-effort; in-memory watchdog still runs in content script */ });
          }
        }
      } catch (e) { /* best-effort */ }
      if (typeof fsbWebSocket !== 'undefined' && fsbWebSocket && fsbWebSocket.connected) {
        fsbWebSocket.send('ext:dom-mutations', {
          mutations: request.mutations || [],
          streamSessionId: request.streamSessionId || '',
          snapshotId: request.snapshotId || 0
        });
      }
      sendResponse({ success: true });
      break;

    case 'domStreamScroll':
      if (typeof fsbWebSocket !== 'undefined' && fsbWebSocket && fsbWebSocket.connected) {
        fsbWebSocket.send('ext:dom-scroll', {
          scrollX: request.scrollX || 0,
          scrollY: request.scrollY || 0,
          streamSessionId: request.streamSessionId || '',
          snapshotId: request.snapshotId || 0
        });
      }
      sendResponse({ success: true });
      break;

    case 'domStreamOverlay':
      if (typeof fsbWebSocket !== 'undefined' && fsbWebSocket && fsbWebSocket.connected) {
        fsbWebSocket.send('ext:dom-overlay', {
          glow: request.glow || null,
          progress: request.progress || null,
          streamSessionId: request.streamSessionId || '',
          snapshotId: request.snapshotId || 0
        });
      }
      sendResponse({ success: true });
      break;

    case 'domStreamDialog':
      if (typeof fsbWebSocket !== 'undefined' && fsbWebSocket && fsbWebSocket.connected) {
        fsbWebSocket.send('ext:dom-dialog', {
          dialog: request.dialog || {}
        });
      }
      sendResponse({ success: true });
      break;

    case 'domStreamReady':
      if (typeof fsbWebSocket !== 'undefined' && fsbWebSocket && fsbWebSocket.connected) {
        fsbWebSocket.send('ext:dom-ready', { tabId: sender.tab ? sender.tab.id : null });
      }
      // Phase 276 STREAM-DEFENSIVE-04 (hypothesis #4 pending-intent re-arm):
      // when the content-script's dom-stream module finishes loading and pings
      // ready, re-arm any dash:dom-stream-start payload that was parked in
      // ws-client.js _pendingStreamStart because pingDomStream had not yet
      // responded within the 5s probe budget. The function is a no-op if no
      // intent is parked. Defensive only -- the readiness ping should normally
      // succeed on the first poll, but this covers the edge case where a slow
      // CWS-flagged page extends past 5s before the dom-stream module loads.
      try {
        if (typeof _onDomStreamReady === 'function') {
          _onDomStreamReady(sender.tab ? sender.tab.id : null);
        }
      } catch (e) {
        console.warn('[FSB DOM] _onDomStreamReady re-arm failed (non-blocking):', e && e.message);
      }
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }
});
