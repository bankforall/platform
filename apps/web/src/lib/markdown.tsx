import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

/**
 * Tiny Markdown renderer for the legal documents (docs/legal/*.md), bundled at build time.
 * Supports headings, paragraphs, one level of nested lists, blockquotes, rules, **bold**,
 * `code`, [links](/path) and [[placeholders]]. Output is React elements only (no raw HTML), so
 * nothing in the source can inject markup.
 */

interface ListItem {
  text: string;
  children: List | null;
}
interface List {
  type: "list";
  ordered: boolean;
  items: ListItem[];
}
export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "hr" }
  | List;

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: List | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: "quote", blocks: parseMarkdown(quote.join("\n")) });
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^>\s?/.test(line)) {
      flushPara();
      flushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushPara();
      const nested = item[1]!.length >= 2;
      const ordered = /\d/.test(item[2]!);
      const current = list as List | null;
      const parent = current?.items[current.items.length - 1];
      if (nested && parent) {
        parent.children ??= { type: "list", ordered, items: [] };
        parent.children.items.push({ text: item[3]!, children: null });
      } else {
        if (!current || current.ordered !== ordered) {
          flushList();
          list = { type: "list", ordered, items: [] };
        }
        list!.items.push({ text: item[3]!, children: null });
      }
      continue;
    }
    const current = list as List | null;
    if (current && /^\s+/.test(raw)) {
      // continuation of the last list item
      const last = current.items[current.items.length - 1]!;
      const target = last.children ? last.children.items[last.children.items.length - 1]! : last;
      target.text += " " + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushQuote();
  flushPara();
  flushList();
  return blocks;
}

const INLINE = /\*\*(.+?)\*\*|\[\[(.+?)\]\]|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, bold, placeholder, label, href, code] = m;
    if (bold !== undefined) {
      out.push(<strong key={key++}>{renderInline(bold)}</strong>);
    } else if (placeholder !== undefined) {
      out.push(
        <mark key={key++} className="rounded bg-warn-soft px-1 text-amber-800" title="ต้องกรอกก่อนใช้งานจริง">
          {placeholder}
        </mark>,
      );
    } else if (label !== undefined && href !== undefined) {
      if (href.startsWith("/") && !href.startsWith("//")) {
        out.push(
          <Link key={key++} to={href} className="text-primary underline">
            {label}
          </Link>,
        );
      } else if (/^https:\/\//.test(href)) {
        out.push(
          <a key={key++} href={href} target="_blank" rel="noreferrer" className="text-primary underline">
            {label}
          </a>,
        );
      } else {
        out.push(label);
      }
    } else if (code !== undefined) {
      out.push(
        <code key={key++} className="rounded bg-surface px-1 text-[0.9em]">
          {code}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ListView({ list }: { list: List }) {
  const items = list.items.map((it, i) => (
    <li key={i}>
      {renderInline(it.text)}
      {it.children && <ListView list={it.children} />}
    </li>
  ));
  return list.ordered ? (
    <ol className="mt-2 list-decimal space-y-1.5 pl-6">{items}</ol>
  ) : (
    <ul className="mt-2 list-disc space-y-1.5 pl-6">{items}</ul>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      const content = renderInline(block.text);
      if (block.level <= 1) return <h2 className="mt-6 text-xl font-semibold text-ink">{content}</h2>;
      if (block.level === 2) return <h2 className="mt-6 text-lg font-semibold text-ink">{content}</h2>;
      return <h3 className="mt-4 font-semibold text-ink">{content}</h3>;
    }
    case "paragraph":
      return <p className="mt-3">{renderInline(block.text)}</p>;
    case "quote":
      return (
        <blockquote className="mt-3 rounded-xl border-l-4 border-warn bg-warn-soft px-4 py-2 text-ink">
          {block.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </blockquote>
      );
    case "hr":
      return <hr className="my-6 border-gray-200" />;
    case "list":
      return <ListView list={block} />;
  }
}

/** Renders Markdown; `{{NAME}}` is replaced from `vars`. `skipTitle` drops the leading level-1 heading. */
export function Markdown({ source, vars = {}, skipTitle }: { source: string; vars?: Record<string, string>; skipTitle?: boolean }) {
  const text = source.replace(/\{\{(\w+)\}\}/g, (all, name: string) => vars[name] ?? all);
  let blocks = parseMarkdown(text);
  if (skipTitle && blocks[0]?.type === "heading" && blocks[0].level === 1) blocks = blocks.slice(1);
  return (
    <div className="text-sm leading-relaxed text-ink-muted">
      {blocks.map((b, i) => (
        <Fragment key={i}>
          <BlockView block={b} />
        </Fragment>
      ))}
    </div>
  );
}
