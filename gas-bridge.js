/* =========================================================
   MPDP MATERIAL INDENT - GOOGLE APPS SCRIPT RPC BRIDGE
   Provides the same google.script.run chaining API used by
   the original HTML, without changing its application logic.
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
      el.style.cssText = "position:fixed;z-index:999999;left:12px;right:12px;bottom:12px;background:#7f1d1d;color:#fff;padding:12px 16px;border-radius:6px;font:13px Arial;box-shadow:0 3px 15px #0004";
      document.body.appendChild(el);
    }
    el.textContent = message;
  }

  function initFrame() {
    if (!gasUrl || gasUrl.indexOf("PASTE_YOUR_") === 0) {
      showBridgeError("Setup required: add your deployed Google Apps Script Web App URL in js/config.js.");
      return;
    }
    try {
      new URL(gasUrl);
    } catch (e) {
      showBridgeError("The Google Apps Script Web App URL in js/config.js is invalid.");
      return;
    }

    frame = document.createElement("iframe");
    frame.id = "mpdpGasBridgeFrame";
    frame.title = "MPDP backend connection";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:absolute;width:1px;height:1px;left:-10000px;top:-10000px;border:0;visibility:hidden";
    frame.src = gasUrl;
    frame.onerror = function () {
      showBridgeError("Could not load the Google Apps Script bridge. Check deployment access and URL.");
    };
    document.body.appendChild(frame);
  }

  function flushQueue() {
    if (!ready || !frame || !frame.contentWindow) return;
    while (queued.length) sendRequest(queued.shift());
  }

  function sendRequest(request) {
    if (!frame || !frame.contentWindow) {
      queued.push(request);
      return;
    }
    var id = "mpdp_" + (++requestId) + "_" + Date.now();
    var timer = setTimeout(function () {
      if (!pending[id]) return;
      var item = pending[id];
      delete pending[id];
      if (item.failure) item.failure({ message: "Backend request timed out. Please check your connection and try again." });
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
      flushQueue();
      return;
    }

    if (msg.type !== "RESULT" || !pending[msg.id]) return;
    var item = pending[msg.id];
    clearTimeout(item.timer);
    delete pending[msg.id];
    if (msg.ok) {
      if (item.success) item.success(msg.result);
    } else {
      if (item.failure) item.failure({ message: msg.error || "Unknown backend error" });
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
          sendRequest({ method: property, args: Array.prototype.slice.call(arguments), success: success, failure: failure });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, "run", {
    configurable: false,
    enumerable: true,
    get: function () { return runner(null, null); }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFrame, { once: true });
  } else {
    initFrame();
  }
})();
