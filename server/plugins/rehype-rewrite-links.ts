import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Element } from "hast";
import { mdPathToRoute } from "../nav";

interface Options {
  routeMap: Map<string, { title: string; mdPath: string }>;
}

/**
 * Rehype plugin that rewrites relative .md links to server routes.
 *
 * Handles:
 *   href="04-agent-connectivity-requirements.md"             -> /reference-architecture/04-agent-connectivity-requirements
 *   href="../reference-architecture/01-trust-domain-and-attestation-policy.md#section" -> /reference-architecture/01-trust-domain-and-attestation-policy#section
 *   href="01-poc-architecture.md"                            -> /poc/01-poc-architecture
 */
export const rehypeRewriteLinks: Plugin<[Options], Root> = (options) => {
  // Build a lookup from filename to route
  const fileToRoute = new Map<string, string>();
  for (const [route, info] of options.routeMap) {
    const filename = info.mdPath.split("/").pop()!;
    fileToRoute.set(filename, route);
    // Also index by full relative path
    fileToRoute.set(info.mdPath, route);
  }

  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href as string | undefined;
      if (!href) return;

      // Skip external links and anchors
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
        return;
      }

      // Split fragment
      const [pathPart, fragment] = href.split("#");
      if (!pathPart.endsWith(".md")) return;

      // Normalize the path - strip leading ../ segments
      const normalizedPath = pathPart.replace(/^(\.\.\/)+/, "");
      const filename = normalizedPath.split("/").pop()!;

      // Try to find the route
      let route = fileToRoute.get(normalizedPath) || fileToRoute.get(filename);

      if (route) {
        node.properties!.href = fragment ? `${route}#${fragment}` : route;
      }
    });
  };
};
