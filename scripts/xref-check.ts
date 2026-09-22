/**
 * xref-check — verify "§N.M" section cross-references across docs/.
 *
 * Phase 1 (code, no API key needed): find every § reference, list candidate
 * target documents (links and doc slugs on the same line, doc-number table
 * cells, the citing document itself), and keep the candidates that actually
 * have that numbered section. No candidate left → the reference is dangling.
 *
 * Phase 2 (TypeSafe, runs when TYPESAFE_API_KEY is set):
 *   - When several candidates survive, a Choice picks which document is meant.
 *   - For every resolved reference, a Choice judges whether the cited section
 *     supports, contradicts, or does not address what the citing passage says.
 *
 * Usage: bun run scripts/xref-check.ts [--structural] [--strict] [--json]
 *   --structural  skip phase 2 even if an API key is present
 *   --strict      also fail on high-confidence contradicts/unrelated verdicts
 *   --json        print results as JSON instead of a report
 *
 * Exit code: 1 if any reference is dangling (or, with --strict, a
 * high-confidence semantic failure); otherwise 0.
 */
import { readFileSync } from "fs";
import { join, posix } from "path";
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { parseNav } from "../server/nav";

const ROOT = join(import.meta.dir, "..");
const AUTO_ACCEPT = 0.8; // below this, a verdict is flagged for human review
const MAX_SECTION_CHARS = 12_000;
const QUESTIONS_PER_REQUEST = 25;
const CONCURRENCY = 4;

const args = new Set(process.argv.slice(2));
const STRUCTURAL = args.has("--structural") || !process.env.TYPESAFE_API_KEY;
const STRICT = args.has("--strict");
const JSON_OUT = args.has("--json");

// ---------------------------------------------------------------------------
// Documents and their numbered sections
// ---------------------------------------------------------------------------

interface Section {
  num: string;
  title: string;
  start: number; // 0-based line index of the heading
  end: number; // exclusive: next heading of the same or higher level
}

interface Doc {
  mdPath: string; // docs-relative
  title: string;
  lines: string[];
  sections: Map<string, Section>;
  headingAt: (line: number) => string; // nearest preceding heading text
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/;

function loadDoc(mdPath: string, title: string): Doc {
  const lines = readFileSync(join(ROOT, "docs", mdPath), "utf-8").split("\n");
  const headings: { depth: number; text: string; line: number }[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) inFence = !inFence;
    const m = !inFence && line.match(HEADING);
    if (m) headings.push({ depth: m[1].length, text: m[2], line: i });
  });

  const sections = new Map<string, Section>();
  headings.forEach((h, idx) => {
    const n = h.text.match(NUMBERED);
    if (!n) return;
    const next = headings.slice(idx + 1).find((o) => o.depth <= h.depth);
    sections.set(n[1], { num: n[1], title: n[2], start: h.line, end: next?.line ?? lines.length });
  });

  const headingAt = (line: number) =>
    headings.filter((h) => h.line < line).pop()?.text ?? title;
  return { mdPath, title, lines, sections, headingAt };
}

/** Text of §from (or §from–§to), clipped for the request. */
function sectionText(doc: Doc, from: string, to?: string): string {
  const a = doc.sections.get(from)!;
  const b = to ? doc.sections.get(to)! : a;
  const text = doc.lines.slice(a.start, Math.max(a.end, b.end)).join("\n");
  return text.length > MAX_SECTION_CHARS ? text.slice(0, MAX_SECTION_CHARS) + "\n[…truncated]" : text;
}

// ---------------------------------------------------------------------------
// Phase 1: extract references and resolve candidates
// ---------------------------------------------------------------------------

interface Ref {
  id: string;
  doc: Doc; // citing document
  line: number; // 0-based
  label: string; // "§5.3" or "§4.1–4.3"
  from: string;
  to?: string;
  passage: string;
  candidates: Doc[]; // targets that have the cited section(s)
  target?: Doc;
  resolvedBy?: "code" | "model";
  resolveConfidence?: number;
  relation?: "supports" | "contradicts" | "unrelated";
  confidence?: number;
}

const REF = /§(\d+(?:\.\d+)*)(?:\s*[–-]\s*§?(\d+(?:\.\d+)*))?/g;
const LINK = /\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g;
const SLUG = /\b(\d\d-[a-z0-9]+(?:-[a-z0-9]+)*)(?:\.md)?\b/g; // bare slugs and `x.md` names

function extractRefs(docs: Map<string, Doc>): Ref[] {
  const bySlug = new Map<string, Doc[]>();
  const byNumber = new Map<string, Doc>();
  for (const d of docs.values()) {
    const slug = posix.basename(d.mdPath, ".md");
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), d]);
    const num = d.mdPath.match(/^reference-architecture\/(\d\d)-/)?.[1];
    if (num) byNumber.set(num, d);
  }

  const refs: Ref[] = [];
  for (const doc of docs.values()) {
    let inFence = false;
    doc.lines.forEach((text, line) => {
      if (FENCE.test(text)) inFence = !inFence;
      if (inFence || !text.includes("§")) return;

      // Documents this line could be pointing at, with the link offsets for adjacency
      const links: { doc: Doc; end: number }[] = [];
      for (const m of text.matchAll(LINK)) {
        const d = docs.get(posix.normalize(posix.join(posix.dirname(doc.mdPath), m[1])));
        if (d) links.push({ doc: d, end: m.index! + m[0].length });
      }
      const pool = new Set<Doc>([doc, ...links.map((l) => l.doc)]);
      for (const m of text.matchAll(SLUG)) bySlug.get(m[1])?.forEach((d) => pool.add(d));
      if (text.trimStart().startsWith("|")) {
        for (const cell of text.split("|").map((c) => c.trim())) {
          const d = /^\d\d$/.test(cell) && byNumber.get(cell);
          if (d) pool.add(d);
        }
      }

      for (const m of text.matchAll(REF)) {
        const [label, from, to] = [m[0], m[1], m[2]];
        const has = (d: Doc) => d.sections.has(from) && (!to || d.sections.has(to));
        const ref: Ref = {
          id: `r${refs.length}`,
          doc,
          line,
          label,
          from,
          to,
          passage: text.trim(),
          candidates: [...pool].filter(has),
        };
        // A link directly before the § ("[Doc](x.md) §5.3", "[Doc](x.md) (§5.3)") names its target
        const adjacent = links.find((l) => /^\s*\(?$/.test(text.slice(l.end, m.index)));
        if (adjacent && has(adjacent.doc)) ref.candidates = [adjacent.doc];
        if (ref.candidates.length === 1) {
          ref.target = ref.candidates[0];
          ref.resolvedBy = "code";
        }
        refs.push(ref);
      }
    });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Phase 2: TypeSafe judgments
// ---------------------------------------------------------------------------

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** Pick the intended target document for references with several candidates. */
async function disambiguate(client: TypeSafeClient, refs: Ref[]) {
  await runLimited(
    chunk(refs, QUESTIONS_PER_REQUEST).map((batch) => async () => {
      const state: Record<string, unknown> = {};
      const questions: Record<string, ReturnType<typeof choice>> = {};
      for (const ref of batch) {
        state[ref.id] = {
          citing_document: ref.doc.title,
          section_heading: ref.doc.headingAt(ref.line),
          passage: ref.passage,
          reference: ref.label,
        };
        const criteria: Record<string, string> = {};
        ref.candidates.forEach((d, i) => {
          const s = d.sections.get(ref.from)!;
          const self = d === ref.doc ? " (the citing document itself)" : "";
          criteria[`c${i}`] = `"${d.title}"${self}, whose §${s.num} is "${s.title}"`;
        });
        criteria.none =
          "None of these: the section the line refers to is in some other document, or the line does not make it clear";
        questions[ref.id] = choice(
          `The line \`${ref.id}.passage\` appears in the document \`${ref.id}.citing_document\` ` +
            `under \`${ref.id}.section_heading\`. Which document's section does the reference ` +
            `\`${ref.id}.reference\` in that line point to?`,
          criteria
        );
      }
      const { answers } = await client.systemOne({ state, questions });
      for (const ref of batch) {
        const a = answers[ref.id] as { choice: string; confidence: number };
        ref.target = a.choice === "none" ? undefined : ref.candidates[Number(a.choice.slice(1))];
        ref.resolvedBy = "model";
        ref.resolveConfidence = a.confidence;
      }
    }),
    CONCURRENCY
  );
}

const RELATION = {
  supports:
    "The section addresses what the passage cites it for, and nothing in it is inconsistent with the passage",
  contradicts:
    "The section addresses the same topic but states something inconsistent with the passage (different value, decision, or behavior)",
  unrelated:
    "The section does not address what the passage cites it for; the reference points at the wrong place",
};

/** Judge each resolved reference against its cited section; one request per cited section. */
async function checkSupport(client: TypeSafeClient, refs: Ref[]) {
  const groups = new Map<string, Ref[]>();
  for (const ref of refs) {
    const key = `${ref.target!.mdPath}|${ref.from}|${ref.to ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), ref]);
  }

  const tasks = [...groups.values()].flatMap((group) =>
    chunk(group, QUESTIONS_PER_REQUEST).map((batch) => async () => {
      const target = batch[0].target!;
      const heading = target.sections.get(batch[0].from)!;
      const state = {
        section: {
          document: target.title,
          number: batch[0].label,
          heading: heading.title,
          text: sectionText(target, batch[0].from, batch[0].to),
        },
      };
      const questions: Record<string, ReturnType<typeof choice>> = {};
      for (const ref of batch) {
        questions[ref.id] = choice(
          {
            question:
              "A passage in `citing_document` cites `section.number` of `section.document` " +
              "(its text is in `section.text`). How does that section relate to what the " +
              "`passage` says or relies on it for?",
            citing_document: ref.doc.title,
            passage: ref.passage,
          },
          RELATION
        );
      }
      const { answers } = await client.systemOne({ state, questions });
      for (const ref of batch) {
        const a = answers[ref.id] as { choice: keyof typeof RELATION; confidence: number };
        ref.relation = a.choice;
        ref.confidence = a.confidence;
      }
    })
  );
  await runLimited(tasks, CONCURRENCY);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

type Level = "error" | "warning" | "notice" | "ok";

function classify(ref: Ref): { level: Level; message: string } {
  if (!ref.target) {
    const listed = ref.candidates.map((d) => d.mdPath).join(", ");
    if (ref.candidates.length === 0) {
      return { level: "error", message: `${ref.label}: no candidate document has this section (dangling)` };
    }
    if (ref.resolvedBy === "model") {
      const conf = ref.resolveConfidence!.toFixed(2);
      return {
        level: "warning",
        message: `${ref.label}: points to none of ${listed} (confidence ${conf}); check the intended document`,
      };
    }
    return { level: "notice", message: `${ref.label}: ambiguous between ${listed}` };
  }
  const where = `${ref.label} → ${ref.target.mdPath}`;
  if (!ref.relation) return { level: "ok", message: where };
  const conf = ref.confidence!;
  const sure = conf >= AUTO_ACCEPT && (ref.resolveConfidence ?? 1) >= AUTO_ACCEPT;
  const tag = `${ref.relation} (confidence ${conf.toFixed(2)}${sure ? "" : ", needs review"})`;
  if (ref.relation === "supports") {
    return { level: sure ? "ok" : "notice", message: `${where}: ${tag}` };
  }
  return { level: sure && STRICT ? "error" : "warning", message: `${where}: ${tag}` };
}

async function main() {
  const { routeMap } = parseNav(ROOT);
  const docs = new Map<string, Doc>();
  for (const info of routeMap.values()) docs.set(info.mdPath, loadDoc(info.mdPath, info.title));

  const refs = extractRefs(docs);

  if (!STRUCTURAL) {
    const client = new TypeSafeClient();
    await disambiguate(client, refs.filter((r) => !r.target && r.candidates.length > 1));
    await checkSupport(client, refs.filter((r) => r.target));
  }

  const results = refs.map((ref) => ({ ref, ...classify(ref) }));

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        results.map(({ ref, level, message }) => ({
          file: `docs/${ref.doc.mdPath}`,
          line: ref.line + 1,
          reference: ref.label,
          target: ref.target?.mdPath ?? null,
          resolvedBy: ref.resolvedBy ?? null,
          resolveConfidence: ref.resolveConfidence ?? null,
          relation: ref.relation ?? null,
          confidence: ref.confidence ?? null,
          level,
          message,
        })),
        null,
        2
      )
    );
  } else {
    const gha = process.env.GITHUB_ACTIONS === "true";
    for (const { ref, level, message } of results) {
      if (level === "ok") continue;
      const file = `docs/${ref.doc.mdPath}`;
      if (gha) console.log(`::${level} file=${file},line=${ref.line + 1}::${message}`);
      else console.log(`${level.toUpperCase().padEnd(7)} ${file}:${ref.line + 1}  ${message}`);
    }
    const count = (l: Level) => results.filter((r) => r.level === l).length;
    const mode = STRUCTURAL ? "structural only (set TYPESAFE_API_KEY for semantic checks)" : "structural + semantic";
    console.log(
      `\n${refs.length} references, ${count("ok")} ok, ${count("notice")} notices, ` +
        `${count("warning")} warnings, ${count("error")} errors — ${mode}`
    );
  }

  if (results.some((r) => r.level === "error")) process.exit(1);
}

await main();
