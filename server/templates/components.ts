import type { NavItem } from "../nav";
import type { Heading } from "../markdown";
import { escapeHtml } from "../utils/html";

/** Render the sidebar nav tree */
export function renderNav(tree: NavItem[], currentRoute: string): string {
  function renderItems(items: NavItem[], depth: number = 0): string {
    return items
      .map((item) => {
        if (item.children.length > 0) {
          const isActive = hasActiveChild(item, currentRoute);
          return `
            <li class="nav-group${isActive ? " active" : ""}">
              <span class="nav-group-title">${escapeHtml(item.title)}</span>
              <ul>${renderItems(item.children, depth + 1)}</ul>
            </li>`;
        }
        const active = item.route === currentRoute ? ' class="active"' : "";
        return `<li${active}><a href="${escapeHtml(item.route!)}">${escapeHtml(item.title)}</a></li>`;
      })
      .join("\n");
  }

  return `<nav class="sidebar-nav"><ul>${renderItems(tree)}</ul></nav>`;
}

function hasActiveChild(item: NavItem, currentRoute: string): boolean {
  if (item.route === currentRoute) return true;
  return item.children.some((c) => hasActiveChild(c, currentRoute));
}

/** Render the right-side table of contents */
export function renderToc(headings: Heading[]): string {
  if (headings.length === 0) return "";
  const items = headings
    .map((h) => `<li class="toc-h${h.depth}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`)
    .join("\n");
  return `<nav class="toc"><h3>On this page</h3><ul>${items}</ul></nav>`;
}

/** Render the footer with copyright/disclaimer */
export function renderFooter(copyright: string): string {
  return `<footer class="site-footer"><p>${escapeHtml(copyright)}</p></footer>`;
}
