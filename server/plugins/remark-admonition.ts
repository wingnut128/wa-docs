import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Paragraph, Text, RootContent } from "mdast";

/**
 * Remark plugin to convert admonitions to HTML.
 *
 * Handles:
 *   !!! warning "Title"
 *       indented content
 *
 * Produces a <div class="admonition warning"> block. The body is parsed as
 * markdown, so inline formatting and links inside admonitions render.
 */
export const remarkAdmonition: Plugin<[], Root> = function () {
  const processor = this;
  return (tree: Root) => {
    const nodes = tree.children;
    let i = 0;
    while (i < nodes.length) {
      const node = nodes[i];
      if (node.type !== "paragraph") {
        i++;
        continue;
      }

      const para = node as Paragraph;
      const firstChild = para.children[0];
      if (!firstChild || firstChild.type !== "text") {
        i++;
        continue;
      }

      const text = (firstChild as Text).value;
      const match = text.match(/^!!!\s+(\w+)\s*(?:"([^"]*)")?\s*$/);
      if (!match) {
        i++;
        continue;
      }

      const admonType = match[1]; // e.g. "warning"
      const title = match[2] || admonType.charAt(0).toUpperCase() + admonType.slice(1);

      // Collect indented content blocks that follow
      const bodyParts: string[] = [];
      let j = i + 1;
      while (j < nodes.length) {
        const next = nodes[j];
        // Indented content appears as a code block (indented by 4 spaces)
        // or as paragraphs. In practice admonitions have indented paragraphs.
        if (next.type === "code" && !(next as any).lang) {
          bodyParts.push((next as any).value);
          j++;
        } else if (next.type === "paragraph") {
          // Check if this paragraph starts with whitespace (continuation)
          const fc = (next as Paragraph).children[0];
          if (fc && fc.type === "text" && (fc as Text).value.startsWith("    ")) {
            // Remove leading indent
            const cleaned = (next as Paragraph).children
              .map((c: any) => (c.type === "text" ? c.value.replace(/^ {4}/gm, "") : c.value || ""))
              .join("");
            bodyParts.push(cleaned);
            j++;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      // Replace original nodes with a container that remark-rehype renders as a <div>
      const body = processor.parse(bodyParts.join("\n\n")) as Root;
      const admonition = {
        type: "blockquote" as const,
        data: { hName: "div", hProperties: { className: ["admonition", admonType] } },
        children: [
          {
            type: "paragraph" as const,
            data: { hProperties: { className: ["admonition-title"] } },
            children: [{ type: "text" as const, value: title }],
          },
          ...(body.children as any[]),
        ],
      } as RootContent;

      nodes.splice(i, j - i, admonition);
      i++;
    }
  };
};
