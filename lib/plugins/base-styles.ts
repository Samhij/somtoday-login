/** Shared look for every plugin iframe — injected by rewritePluginHtml. */
export const CYFERS_PLUGIN_FONT_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Syne:wght@700&display=swap" rel="stylesheet" />
`.trim();

export const CYFERS_PLUGIN_BASE_CSS = `
:root {
  color-scheme: light;
  --bg: transparent;
  --bg-elevated: #f7f8fa;
  --ink: #10141c;
  --muted: #5a6578;
  --line: #c5ccd8;
  --accent: #c43c11;
  --accent-soft: rgba(196, 60, 17, 0.12);
  --accent-ink: #fff8f5;
  --danger: #9b1c1c;
  --danger-bg: #fde8e8;
  --focus: rgba(196, 60, 17, 0.4);
  --font-body: "IBM Plex Sans", "Segoe UI", sans-serif;
  --font-display: Syne, Georgia, serif;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --bg-elevated: #161b24;
  --ink: #eef1f6;
  --muted: #9aa5b8;
  --line: #2a3344;
  --accent: #ff6a35;
  --accent-soft: rgba(255, 106, 53, 0.16);
  --accent-ink: #140800;
  --danger: #ff8f8f;
  --danger-bg: #3a1515;
  --focus: rgba(255, 106, 53, 0.45);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  height: 100%;
}

body {
  margin: 0;
  min-height: 100%;
  padding: 1.25rem 1.5rem;
  color: var(--ink);
  background: var(--bg);
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.45;
}

body.cyfers-widget {
  padding: 0.25rem 0.15rem 0.5rem;
}

h1, h2, h3 {
  margin: 0 0 0.5rem;
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--ink);
}

h1 { font-size: clamp(1.45rem, 3.5vw, 1.9rem); }
h2 { font-size: 1.25rem; }
h3 { font-size: 1.05rem; }

p {
  margin: 0 0 0.75rem;
}

a {
  color: var(--accent);
}

code, kbd {
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 0.9em;
}

button, input, select, textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

.muted,
.empty {
  color: var(--muted);
  font-size: 0.92rem;
}

.error {
  color: var(--danger);
  background: var(--danger-bg);
  padding: 0.65rem 0.85rem;
  border-radius: 2px;
  font-size: 0.92rem;
}

.lede {
  color: var(--muted);
  max-width: 36rem;
}
`.trim();
