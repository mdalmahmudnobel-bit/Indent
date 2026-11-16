/* =========================================================
   MPDP MATERIAL INDENT - GOOGLE APPS SCRIPT RPC BRIDGE
   Option 2: Execute as User accessing the web app.
   Preserves the existing google.script.run-style API.
   ========================================================= */
(function () {
  "use strict";

  var config = window.MPDP_CONFIG || {};
  var gasUrl = String(config.GAS_WEB_APP_URL || "").trim();
  var timeoutMs = Number(config.BRIDGE_TIMEOUT_MS || 120000);
  var frame = null;
  var ready = false;
  var requestId = 0;
  var pending = Object.create(null);
  var queued = [];
  var handshakeTimer = null;

  // Keep this list synchronized with Bridge.html.
  var allowedMethods = new Set([
    "getMaterialSuggestionsWeb",
    "getEquipmentMaterialHistoryWeb",
    "getSession",
    "login",
    "logout",
    "setNextIndentNumber",
    "submitIndentWeb",
    "getWebEmailData",
    "searchIndentWeb",
    "reloadIndentWeb",
    "saveInventoryNamesWeb",
    "saveEngineerNamesWeb",
    "saveSignatureWeb",
    "createIndentEmailDraftWeb",
    "downloadIndentPdfWeb",
    "printIndentWeb",
    "sendIndentEmailWeb",
    "sendIndentToSingleEmailWeb",
    "adminGetUsers",
    "adminAddUser",
    "adminResetPassword",
    "adminDeleteUser",
    "changeMyPassword"
  ]);

  function showBridgeError(message) {
    var el = document.getElementById("gasBridgeError");
    if (!el) {
      el = document.createElement("div");
      el.id = "gasBridgeError";
      el.style.cssText =
        "position:fixed;z-index:999999;left:12px;right:12px;bottom:12px;" +
        "background:#7f1d1d;color:#fff;padding:12px 16px;border-radius:7px;" +
        "font:13px/1.45 Arial,sans-serif;box-shadow:0 3px 15px #0004;";
      document.body.appendChild(el);
    }
    el.textContent = message + " ";

    var auth = document.createElement("button");
    auth.type = "button";
    auth.textContent = "Google Authorization খুলুন";
    auth.style.cssText = "margin:8px 8px 0 0;padding:8px 12px;border:0;border-radius:5px;cursor:pointer;font-weight:bold";
    auth.onclick = function () {
      // User must authorize in a top-level tab; third-party iframe auth can be blocked.
      var authUrl = gasUrl + (gasUrl.indexOf("?") >= 0 ? "&" : "?") + "auth=1";
      window.open(authUrl, "_blank");
    };
    el.appendChild(auth);

    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Reconnect";
    retry.style.cssText = "margin:8px 0 0;padding:8px 12px;border:0;border-radius:5px;background:#facc15;color:#111;cursor:pointer;font-weight:bold";
    retry.onclick = function () {
      removeFrame();
      initFrame();
    };
    el.appendChild(retry);
  }

  function clearBridgeError() {
    var el = document.getElementById("gasBridgeError");
    if (el) el.remove();
  }

  function removeFrame() {
    ready = false;
    if (handshakeTimer) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = null;
  }

  function initFrame() {
    if (!gasUrl || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(gasUrl)) {
      showBridgeError("Invalid Apps Script Web App URL. Check config.js.");
      return;
    }

    removeFrame();
    frame = document.createElement("iframe");
    frame.id = "mpdpGasBridgeFrame";
    frame.title = "MPDP Google Apps Script Backend";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      "position:absolute;width:1px;height:1px;left:-10000px;top:-10000px;" +
      "border:0;visibility:hidden";

    frame.onload = function () {
      if (!frame || !frame.contentWindow) return;
      // Explicit handshake lets Bridge reply to the exact GitHub Pages origin.
      frame.contentWindow.postMessage({
        channel: "MPDP_GAS_BRIDGE",
        type: "HELLO"
      }, "*");
    };

    frame.onerror = function () {
      showBridgeError("Could not load Apps Script. Check the deployment URL and Google account authorization.");
    };

    frame.src = gasUrl;
    document.body.appendChild(frame);

    handshakeTimer = setTimeout(function () {
      if (!ready) {
        showBridgeError(
          "Google Authentication required or the backend bridge did not become ready. " +
          "Open Google Authorization in a new tab, complete consent, return here, then press Reconnect."
        );
      }
    }, 18000);
  }

  function flushQueue() {
    if (!ready || !frame || !frame.contentWindow) return;
    while (queued.length) sendRequest(queued.shift());
  }

  function sendRequest(request) {
    if (!ready || !frame || !frame.contentWindow) {
      queued.push(request);
      return;
    }

    var id = "mpdp_" + (++requestId) + "_" + Date.now();
    var timer = setTimeout(function () {
      if (!pending[id]) return;
      var item = pending[id];
      delete pending[id];
      if (item.failure) {
        item.failure({ message: "Backend request timed out. Please reconnect and try again." });
      }
    }, timeoutMs);

    pending[id] = { success: request.success, failure: request.failure, timer: timer };
    try {
      frame.contentWindow.postMessage({
        channel: "MPDP_GAS_BRIDGE",
        type: "CALL",
        id: id,
        method: request.method,
        args: request.args
      }, "*");
    } catch (err) {
      clearTimeout(timer);
      delete pending[id];
      if (request.failure) request.failure({ message: err.message || String(err) });
    }
  }

  window.addEventListener("message", function (event) {
    if (!frame || event.source !== frame.contentWindow) return;
    var msg = event.data || {};
    if (msg.channel !== "MPDP_GAS_BRIDGE") return;

    if (msg.type === "READY") {
      ready = true;
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }
      clearBridgeError();
      flushQueue();
      return;
    }

    if (msg.type !== "RESULT" || !pending[msg.id]) return;
    var item = pending[msg.id];
    clearTimeout(item.timer);
    delete pending[msg.id];
    if (msg.ok) {
      if (item.success) item.success(msg.result);
    } else if (item.failure) {
      item.failure({ message: msg.error || "Unknown backend error" });
    }
  });

  function runner(success, failure) {
    var api = {
      withSuccessHandler: function (fn) { return runner(fn, failure); },
      withFailureHandler: function (fn) { return runner(success, fn); }
    };

    return new Proxy(api, {
      get: function (target, property) {
        if (property in target) return target[property];
        if (typeof property !== "string") return undefined;
        return function () {
          if (!allowedMethods.has(property)) {
            if (failure) failure({ message: "Backend method is not allowed: " + property });
            return;
          }
          sendRequest({
            method: property,
            args: Array.prototype.slice.call(arguments),
            success: success,
            failure: failure
          });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, "run", {
    configurable: true,
    enumerable: true,
    get: function () { return runner(null, null); }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFrame, { once: true });
  } else {
    initFrame();
  }
})();
