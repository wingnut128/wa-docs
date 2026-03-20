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
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css">
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <a href="/" class="site-title">${escapeHtml(opts.siteTitle)}</a>
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
  <script>mermaid.initialize({ startOnLoad: true, theme: 'neutral' });</script>
  <script src="/copy-code.js"></script>
</body>
</html>`;
}
