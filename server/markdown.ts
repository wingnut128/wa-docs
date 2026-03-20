import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkEmoji from "remark-emoji";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { remarkAdmonition } from "./plugins/remark-admonition";
import { rehypeRewriteLinks } from "./plugins/rehype-rewrite-links";
import { rehypeMermaid } from "./plugins/rehype-mermaid";

export interface Heading {
  id: string;
  text: string;
  depth: number;
}

/** Build the unified processor pipeline */
function createProcessor(routeMap: Map<string, { title: string; mdPath: string }>) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkEmoji)
    .use(remarkAdmonition)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: "append",
      properties: { className: ["heading-anchor"], ariaLabel: "Link to this section" },
      content: {
        type: "element",
        tagName: "span",
        properties: { className: ["anchor-icon"] },
        children: [{ type: "text", value: "#" }],
      },
    })
    .use(rehypeRewriteLinks, { routeMap })
    .use(rehypeMermaid)
    .use(rehypeHighlight, { detect: true, ignoreMissing: true })
    .use(rehypeStringify, { allowDangerousHtml: true });
}

/** Extract headings from markdown source (for TOC) */
export function extractHeadings(html: string): Heading[] {
  const headings: Heading[] = [];
  const re = /<h([2-4])\s+id="([^"]+)"[^>]*>(.*?)<\/h\1>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const depth = parseInt(match[1]);
    // Strip HTML tags from heading text
    const text = match[3].replace(/<[^>]+>/g, "").trim();
    headings.push({ id: match[2], text, depth });
  }
  return headings;
}

/** Render a markdown string to HTML */
export async function renderMarkdown(
  source: string,
  routeMap: Map<string, { title: string; mdPath: string }>
): Promise<{ html: string; headings: Heading[] }> {
  const processor = createProcessor(routeMap);
  const result = await processor.process(source);
  const html = String(result);
  const headings = extractHeadings(html);
  return { html, headings };
}
