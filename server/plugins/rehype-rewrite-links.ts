import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Element } from "hast";
import { posix } from "path";

interface Options {
  routeMap: Map<string, { title: string; mdPath: string }>;
}

/**
 * Rehype plugin that rewrites relative .md links to server routes.
 *
 * Links are resolved relative to the linking document's own path (the vfile
 * path, docs-relative), so same-named files in different directories —
 * index.md and poc/index.md — map to their own routes.
 *
 * Handles (from reference-architecture/06-firewall-rules.md):
 *   href="04-agent-connectivity-requirements.md"         -> /reference-architecture/04-agent-connectivity-requirements
 *   href="../poc/01-poc-architecture.md#section"         -> /poc/01-poc-architecture#section
 *   href="../index.md"                                   -> /
 */
export const rehypeRewriteLinks: Plugin<[Options], Root> = (options) => {
  const pathToRoute = new Map<string, string>();
  for (const [route, info] of options.routeMap) {
    pathToRoute.set(info.mdPath, route);
  }

  return (tree: Root, file) => {
    const baseDir = file.path ? posix.dirname(file.path) : ".";

    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href as string | undefined;
      if (!href) return;

      // Skip external links and anchors
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) {
        return;
      }

      // Split fragment
      const [pathPart, fragment] = href.split("#");
      if (!pathPart.endsWith(".md")) return;

      const resolved = posix.normalize(posix.join(baseDir, pathPart));
      const route = pathToRoute.get(resolved);

      if (route) {
        node.properties!.href = fragment ? `${route}#${fragment}` : route;
      }
    });
  };
};
