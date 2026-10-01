/** Cyfers plugin bridge — injected into sandboxed srcdoc iframes. */
export const CYFERS_SDK_SOURCE = `
(function () {
  var pluginId = document.currentScript && document.currentScript.getAttribute("data-plugin-id");
  if (!pluginId) throw new Error("Cyfers SDK: plugin id ontbreekt.");

  var pending = Object.create(null);
  var seq = 0;
  var storageCache = Object.create(null);

  function call(type, payload) {
    return new Promise(function (resolve, reject) {
      var id = String(++seq);
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ source: "cyfers-plugin", pluginId: pluginId, id: id, type: type, payload: payload }, "*");
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "cyfers-host" || data.pluginId !== pluginId) return;
    var entry = pending[data.id];
    if (!entry) return;
    delete pending[data.id];
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  window.cyfers = {
    getContext: function () {
      return call("getContext", null);
    },
    fetch: function (path, init) {
      init = init || {};
      return call("fetch", {
        path: path,
        method: init.method || "GET",
        headers: init.headers || {},
        body: init.body
      }).then(function (result) {
        if (!result || result.ok === false) {
          throw new Error("API-verzoek mislukt");
        }
        return result.data;
      });
    },
    storage: {
      get: function (key) {
        return call("storageGet", { key: String(key) }).then(function (value) {
          storageCache[key] = value;
          return value;
        });
      },
      set: function (key, value) {
        storageCache[key] = value;
        return call("storageSet", { key: String(key), value: value });
      },
      remove: function (key) {
        delete storageCache[key];
        return call("storageRemove", { key: String(key) });
      }
    }
  };
})();
`.trim();

export function rewritePluginHtml(html: string, pluginId: string, entryRelative: string): string {
  const entryDir = entryRelative.includes("/")
    ? entryRelative.slice(0, entryRelative.lastIndexOf("/") + 1)
    : "ui/";
  const base = `/api/plugins/${encodeURIComponent(pluginId)}/${entryDir}`;

  let out = html;
  out = out.replace(/\b(src|href)=["'](?!https?:|data:|blob:|#|\/\/)([^"']+)["']/gi, (_m, attr, url) => {
    const cleaned = url.replace(/^\.\//, "");
    return `${attr}="${base}${cleaned}"`;
  });

  const sdkTag = `<script data-plugin-id="${pluginId}">${CYFERS_SDK_SOURCE}</script>`;
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${sdkTag}</head>`);
  } else if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, `<body$1>${sdkTag}`);
  } else {
    out = `<!DOCTYPE html><html><head>${sdkTag}</head><body>${out}</body></html>`;
  }
  return out;
}
