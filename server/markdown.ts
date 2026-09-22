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
import { rehypeCollectHeadings, type Heading } from "./plugins/rehype-collect-headings";

export type { Heading };

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
    .use(rehypeCollectHeadings)
    .use(rehypeRewriteLinks, { routeMap })
    .use(rehypeMermaid)
    .use(rehypeHighlight, { detect: true, ignoreMissing: true })
    .use(rehypeStringify, { allowDangerousHtml: true });
}

/** Render a markdown string to HTML. `mdPath` is docs-relative and anchors relative links. */
export async function renderMarkdown(
  source: string,
  routeMap: Map<string, { title: string; mdPath: string }>,
  mdPath?: string
): Promise<{ html: string; headings: Heading[] }> {
  const processor = createProcessor(routeMap);
  const result = await processor.process({ value: source, path: mdPath });
  const html = String(result);
  const headings = (result.data.headings as Heading[] | undefined) ?? [];
  return { html, headings };
}
