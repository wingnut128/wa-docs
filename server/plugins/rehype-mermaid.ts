import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Element, Text } from "hast";

/**
 * Rehype plugin that converts fenced mermaid code blocks into
 * <pre class="mermaid"> blocks for client-side Mermaid.js rendering.
 *
 * Transforms: <pre><code class="language-mermaid">...</code></pre>
 * Into:       <pre class="mermaid">raw text</pre>
 *
 * Uses a raw HTML node so rehype-stringify does not escape characters
 * like & and <br> that Mermaid syntax requires.
 */
export const rehypeMermaid: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;

      const code = node.children[0] as Element | undefined;
      if (!code || code.tagName !== "code") return;

      const className = code.properties?.className as string[] | undefined;
      if (!className?.some((c) => c === "language-mermaid" || c === "hljs language-mermaid")) {
        return;
      }

      // Extract raw text from the code element's children
      const rawText = code.children
        .filter((c): c is Text => c.type === "text")
        .map((c) => c.value)
        .join("");

      // Replace with a raw HTML node so stringify preserves &, <br>, etc.
      (parent.children as any[])[index] = {
        type: "raw",
        value: `<pre class="mermaid">${rawText}</pre>`,
      };
    });
  };
};
