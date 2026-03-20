import type { NavItem } from "../nav";
import type { Heading } from "../markdown";
import { renderNav, renderToc, renderFooter } from "./components";
import { escapeHtml } from "../utils/html";

interface LayoutOptions {
  title: string;
  siteTitle: string;
  content: string;
  headings: Heading[];
  navTree: NavItem[];
  currentRoute: string;
  copyright: string;
}

export function renderPage(opts: LayoutOptions): string {
  const nav = renderNav(opts.navTree, opts.currentRoute);
  const toc = renderToc(opts.headings);
  const footer = renderFooter(opts.copyright);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)} — ${escapeHtml(opts.siteTitle)}</title>
  <script>
    (function() {
      var t = localStorage.getItem('theme');
      if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
    })();
  </script>
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css" media="none" id="hljs-dark">
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem">
          <a href="/" class="site-title">${escapeHtml(opts.siteTitle)}</a>
          <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme"></button>
        </div>
      </div>
      ${nav}
    </aside>
    <main class="content">
      <article class="doc">
        ${opts.content}
      </article>
      ${footer}
    </main>
    <aside class="toc-sidebar">
      ${toc}
    </aside>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: true, theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'neutral' });</script>
  <script src="/copy-code.js"></script>
  <script>
    (function() {
      var btn = document.getElementById('theme-toggle');
      var dark = document.getElementById('hljs-dark');
      var light = document.querySelector('link[href*="github.min.css"]');
      function apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        btn.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
        dark.media = theme === 'dark' ? 'all' : 'none';
        light.media = theme === 'dark' ? 'none' : 'all';
        if (typeof mermaid !== 'undefined') {
          mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'neutral' });
          mermaid.run();
        }
      }
      var current = document.documentElement.getAttribute('data-theme') || 'light';
      apply(current);
      btn.addEventListener('click', function() {
        current = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', current);
        apply(current);
      });
    })();
  </script>
</body>
</html>`;
}
