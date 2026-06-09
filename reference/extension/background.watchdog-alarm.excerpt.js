  // Phase 211-02 STREAM-01: dom-stream watchdog (safety net).
  // Survives SW idle eviction (chrome.alarms.create at periodInMinutes: 1).
  // The content-script self-watchdog is the trip wire; this alarm exists
  // so a wedged content script does not strand the stream silently.
  // Phase 212 owns the agent branch below; this branch slots BEFORE it.
  if (alarm.name === 'fsb-domstream-watchdog') {
    console.log('[FSB DOM] watchdog alarm fired (SW safety net)');
    // Phase 276 STREAM-DEFENSIVE-05 (watchdog auto-resnapshot): if streaming
    // is supposed to be active but the alarm is firing (i.e. the SW just woke
    // and nothing has flushed mutations recently), request a fresh snapshot
    // from the dashboard via the ext:request-snapshot signal. The dashboard
    // routes this through its requestPreviewResync path which re-issues
    // dash:dom-stream-start. Best-effort -- no-op if the WS is offline or
    // _streamingActive is false/undefined.
    try {
      var streamingActive = (typeof _streamingActive !== 'undefined') && !!_streamingActive;
      if (streamingActive
          && typeof fsbWebSocket !== 'undefined'
          && fsbWebSocket
          && fsbWebSocket.connected
          && typeof fsbWebSocket.send === 'function') {
        fsbWebSocket.send('ext:request-snapshot', {
          reason: 'sw-watchdog-tick',
          ts: Date.now()
        });
      }
    } catch (e) {
      console.warn('[FSB DOM] watchdog auto-resnapshot failed (non-blocking):', e && e.message);
    }
    return;
  }
