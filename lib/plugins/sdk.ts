import { CYFERS_PLUGIN_BASE_CSS, CYFERS_PLUGIN_FONT_LINKS } from "./base-styles";

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

  function applyTheme(theme) {
    if (theme !== "light" && theme !== "dark") return;
    document.documentElement.setAttribute("data-theme", theme);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "cyfers-host") return;
    if (data.type === "setTheme") {
      applyTheme(data.theme);
      return;
    }
    if (data.pluginId !== pluginId) return;
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
          var detail =
            (result && result.error) ||
            (result && result.status ? "HTTP " + result.status : null) ||
            "API-verzoek mislukt";
          throw new Error(detail);
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

function injectIntoHead(html: string, headContent: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${headContent}</head>`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<head>${headContent}</head><body$1>`);
  }
  return `<!DOCTYPE html><html><head>${headContent}</head><body>${html}</body></html>`;
}

export function rewritePluginHtml(
  html: string,
  pluginId: string,
  entryRelative: string,
  options?: { variant?: "page" | "widget" },
): string {
  const entryDir = entryRelative.includes("/")
    ? entryRelative.slice(0, entryRelative.lastIndexOf("/") + 1)
    : "ui/";
  const base = `/api/plugins/${encodeURIComponent(pluginId)}/${entryDir}`;

  let out = html;
  out = out.replace(/\b(src|href)=["'](?!https?:|data:|blob:|#|\/\/)([^"']+)["']/gi, (_m, attr, url) => {
    const cleaned = url.replace(/^\.\//, "");
    return `${attr}="${base}${cleaned}"`;
  });

  if (options?.variant === "widget") {
    out = out.replace(/<body\b([^>]*)>/i, (_m, attrs: string) => {
      if (/\bclass\s*=/.test(attrs)) {
        return `<body${attrs.replace(/\bclass\s*=\s*(["'])([^"']*)\1/i, (_cm, q, cls) => `class=${q}${cls} cyfers-widget${q}`)}>`;
      }
      return `<body class="cyfers-widget"${attrs}>`;
    });
  }

  const baseStyle = `<style data-cyfers-base>${CYFERS_PLUGIN_BASE_CSS}</style>`;
  const sdkTag = `<script data-plugin-id="${pluginId}">${CYFERS_SDK_SOURCE}</script>`;
  out = injectIntoHead(out, `${CYFERS_PLUGIN_FONT_LINKS}${baseStyle}${sdkTag}`);
  return out;
}

/** Stamp host theme onto plugin HTML before srcdoc assignment. */
export function applyPluginTheme(html: string, theme: "light" | "dark"): string {
  if (/<html\b[^>]*\bdata-theme\s*=/.test(html)) {
    return html.replace(/<html\b([^>]*)\bdata-theme\s*=\s*(["'])[^"']*\2/i, `<html$1data-theme="${theme}"`);
  }
  if (/<html\b/i.test(html)) {
    return html.replace(/<html\b/i, `<html data-theme="${theme}"`);
  }
  return `<html data-theme="${theme}">${html}</html>`;
}
