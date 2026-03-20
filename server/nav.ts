import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { join } from "path";

export interface NavItem {
  title: string;
  path: string | null; // null for group headers
  route: string | null;
  children: NavItem[];
}

/** Convert a docs-relative markdown path to a URL route */
export function mdPathToRoute(mdPath: string): string {
  // index.md -> /
  if (mdPath === "index.md") return "/";
  // poc/index.md -> /poc/
  if (mdPath.endsWith("/index.md")) {
    return "/" + mdPath.replace(/\/index\.md$/, "/");
  }
  // reading-order.md -> /reading-order
  // reference-architecture/01-foo.md -> /reference-architecture/01-foo
  return "/" + mdPath.replace(/\.md$/, "");
}

/** Parse site.yml nav into a flat route map and a tree for the sidebar */
export function parseNav(rootDir: string): {
  tree: NavItem[];
  routeMap: Map<string, { title: string; mdPath: string }>;
} {
  // nosemgrep: path-join-resolve-traversal -- rootDir is from import.meta.dir, not user input
  const yml = readFileSync(join(rootDir, "site.yml"), "utf-8");
  const config = parseYaml(yml);
  const routeMap = new Map<string, { title: string; mdPath: string }>();

  function walk(entries: any[]): NavItem[] {
    return entries.map((entry) => {
      if (typeof entry === "string") {
        // bare path like "poc/index.md"
        const route = mdPathToRoute(entry);
        const title = entry.replace(/\.md$/, "").split("/").pop()!;
        routeMap.set(route, { title, mdPath: entry });
        return { title, path: entry, route, children: [] };
      }
      // object with single key
      const [title, value] = Object.entries(entry)[0] as [string, any];
      if (typeof value === "string") {
        const route = mdPathToRoute(value);
        routeMap.set(route, { title, mdPath: value });
        return { title, path: value, route, children: [] };
      }
      // nested array
      return { title, path: null, route: null, children: walk(value as any[]) };
    });
  }

  const tree = walk(config.nav);
  return { tree, routeMap };
}

/** Flatten the nav tree to get all leaf routes in order */
export function flattenNav(tree: NavItem[]): NavItem[] {
  const result: NavItem[] = [];
  for (const item of tree) {
    if (item.route !== null) result.push(item);
    if (item.children.length > 0) result.push(...flattenNav(item.children));
  }
  return result;
}
