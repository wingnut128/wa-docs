import { readFileSync, realpathSync } from "fs";
import { join, resolve } from "path";
import type { Hono } from "hono";
import { parseNav, flattenNav, type NavItem } from "./nav";
import { renderMarkdown, type Heading } from "./markdown";
import { renderPage } from "./templates/layout";
import { parse as parseYaml } from "yaml";

interface CachedPage {
  html: string;
  headings: Heading[];
  title: string;
}

export async function registerRoutes(app: Hono, rootDir: string) {
  const { tree, routeMap } = parseNav(rootDir);

  // nosemgrep: path-join-resolve-traversal -- rootDir is from import.meta.dir, not user input
  const yml = readFileSync(join(rootDir, "site.yml"), "utf-8");
  const config = parseYaml(yml);
  const siteTitle = config.site_name || "Documentation";
  const copyright = config.copyright || "";

  // Pre-render all docs into memory
  const cache = new Map<string, CachedPage>();
  // nosemgrep: path-join-resolve-traversal -- rootDir is from import.meta.dir, not user input
  const docsRoot = realpathSync(join(rootDir, "docs"));
  console.log(`Rendering ${routeMap.size} documents...`);

  for (const [route, info] of routeMap) {
    // nosemgrep: path-join-resolve-traversal -- guarded by startsWith check below
    const filePath = resolve(rootDir, "docs", info.mdPath);
    // Path traversal guard: ensure resolved path stays under docs/
    if (!filePath.startsWith(docsRoot + "/") && filePath !== docsRoot) {
      console.error(`Skipping ${info.mdPath}: resolves outside docs/ directory`);
      continue;
    }
    try {
      const source = readFileSync(filePath, "utf-8");
      const { html, headings } = await renderMarkdown(source, routeMap);
      cache.set(route, { html, headings, title: info.title });
    } catch (err) {
      console.error("Failed to render %s: %o", info.mdPath, err);
    }
  }

  console.log(`Cached ${cache.size} pages.`);

  // Register a route for each page
  for (const [route, page] of cache) {
    app.get(route, (c) => {
      const fullHtml = renderPage({
        title: page.title,
        siteTitle,
        content: page.html,
        headings: page.headings,
        navTree: tree,
        currentRoute: route,
        copyright,
      });
      return c.html(fullHtml);
    });
  }

  // Health check
  app.get("/healthz", (c) => c.text("ok"));
}
