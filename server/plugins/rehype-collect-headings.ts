import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Element, ElementContent } from "hast";

export interface Heading {
  id: string;
  text: string;
  depth: number;
}

const DEPTHS: Record<string, number> = { h2: 2, h3: 3, h4: 4 };

/** Plain text of a node, skipping the autolink "#" anchor appended to headings. */
function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  const className = node.properties?.className as string[] | undefined;
  if (className?.includes("heading-anchor")) return "";
  return node.children.map(textOf).join("");
}

/**
 * Rehype plugin that records h2–h4 headings (for the TOC) in `file.data.headings`.
 * Must run after rehype-slug so ids are present.
 */
export const rehypeCollectHeadings: Plugin<[], Root> = () => {
  return (tree: Root, file) => {
    const headings: Heading[] = [];
    visit(tree, "element", (node: Element) => {
      const depth = DEPTHS[node.tagName];
      const id = node.properties?.id;
      if (!depth || typeof id !== "string") return;
      headings.push({ id, text: node.children.map(textOf).join("").trim(), depth });
    });
    file.data.headings = headings;
  };
};
