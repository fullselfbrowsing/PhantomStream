// PhantomStream bookmarklet adapter surface.
//
// Bookmarklets are a convenience adapter: they load a local helper script into
// pages that allow it, and fail visibly when the browser or page policy blocks
// that load. They do not attempt to bypass CSP.

import { getBrowserInjectSource } from './browser-inject.js';

export const BOOKMARKLET_ERROR_EVENT = 'phantomstream:bookmarklet-error';

function ensureOptions(options) {
  if (!options || Object(options) !== options) throw new Error('bookmarklet-options-required');
  return options;
}

function normalizeUrl(value, protocols, errorCode) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode);
  var parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    throw new Error(errorCode);
  }
  if (!protocols[parsed.protocol]) throw new Error(errorCode);
  return parsed.toString();
}

function encodeConfigValue(value) {
  return encodeURIComponent(value || '');
}

function jsString(value) {
  return JSON.stringify(String(value));
}

/**
 * Create bookmarklet JavaScript source.
 *
 * @param {{scriptUrl: string, wsUrl: string, roomKey?: string}} options
 * @returns {string}
 */
export function createBookmarkletSource(options) {
  var opts = ensureOptions(options);
  var scriptUrl = normalizeUrl(opts.scriptUrl, { 'http:': true, 'https:': true }, 'bookmarklet-script-url-required');
  var wsUrl = normalizeUrl(opts.wsUrl, { 'ws:': true, 'wss:': true }, 'bookmarklet-ws-url-required');
  var roomKey = typeof opts.roomKey === 'string' ? opts.roomKey : '';
  var encodedScriptUrl = encodeConfigValue(scriptUrl);
  var encodedWsUrl = encodeConfigValue(wsUrl);
  var encodedRoomKey = encodeConfigValue(roomKey);

  return [
    'javascript:(()=>{',
    'try{',
    'const s=decodeURIComponent("', encodedScriptUrl, '");',
    'const w=decodeURIComponent("', encodedWsUrl, '");',
    'const r=decodeURIComponent("', encodedRoomKey, '");',
    'const u=new URL(s);',
    'u.searchParams.set("ws",w);',
    'if(r)u.searchParams.set("room",r);',
    'u.searchParams.set("ts",String(Date.now()));',
    'const e=document.createElement("script");',
    'e.async=true;',
    'e.src=u.toString();',
    'e.onerror=()=>{window.dispatchEvent(new CustomEvent("', BOOKMARKLET_ERROR_EVENT, '",{detail:{reason:"script-load-failed"}}));};',
    '(document.head||document.documentElement).appendChild(e);',
    '}catch(e){window.dispatchEvent(new CustomEvent("', BOOKMARKLET_ERROR_EVENT, '",{detail:{reason:"script-load-failed"}}));}',
    '})()'
  ].join('');
}

/**
 * Create the browser-side loader source fetched by a generated bookmarklet.
 *
 * @param {{browserInjectSource?: string}} [options]
 * @returns {string}
 */
export function createBookmarkletLoaderSource(options) {
  var opts = options || {};
  var browserInjectSource = typeof opts.browserInjectSource === 'string'
    ? opts.browserInjectSource
    : getBrowserInjectSource();

  return [
    '(function(){',
    'var BOOKMARKLET_ERROR_EVENT=', jsString(BOOKMARKLET_ERROR_EVENT), ';',
    'function dispatchPhantomStreamBookmarkletError(reason){try{window.dispatchEvent(new CustomEvent(BOOKMARKLET_ERROR_EVENT,{detail:{reason:reason}}));}catch(e){}}',
    'function createWebSocketTransport(options){var socket=new WebSocket(options.url);return {send:function(type,payload){var frame=JSON.stringify({type:type,payload:payload||{},ts:Date.now()});if(socket.readyState===1){socket.send(frame);return;}socket.addEventListener("open",function sendWhenOpen(){try{socket.send(frame);}catch(e){}},{once:true});},flush:function(){return Promise.resolve();}};}',
    'var params;',
    'try{params=new URL((document.currentScript&&document.currentScript.src)||window.location.href).searchParams;}catch(e){dispatchPhantomStreamBookmarkletError("script-load-failed");return;}',
    'var wsUrl=params.get("ws");',
    'try{if(!wsUrl||!/^wss?:$/.test(new URL(wsUrl).protocol)){dispatchPhantomStreamBookmarkletError("invalid-ws-url");return;}}catch(e){dispatchPhantomStreamBookmarkletError("invalid-ws-url");return;}',
    'var transport=createWebSocketTransport({url:wsUrl});',
    'window.__phantomStreamBridge=function(msg){try{if(!msg||!msg.type)return;transport.send(msg.type,msg.payload||{});}catch(e){dispatchPhantomStreamBookmarkletError("bridge-send-failed");}};',
    'var phantomStreamBrowserInjectSource=', jsString(browserInjectSource), ';',
    'try{var script=document.createElement("script");script.text=phantomStreamBrowserInjectSource;(document.documentElement||document.head||document.body).appendChild(script);if(script.parentNode)script.parentNode.removeChild(script);}catch(e){dispatchPhantomStreamBookmarkletError("script-load-failed");}',
    '}());'
  ].join('');
}
