"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/format";
import type { VideoRef } from "@/lib/chat/types";
import { ChannelRefLink, VideoRefTooltip } from "./VideoRefTooltip";

// A small, safe Markdown renderer for chat replies (headings, lists, quotes, code, tables,
// rules, bold/italic/code/links). Links to vref:<videoId> and cref:<channelId> become hover cards.

type RefMaps = { videos?: Record<string, VideoRef> };

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; start: number; items: { text: string; children: Block[] }[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "hr" }
  | { type: "table"; header: string[]; rows: string[][] };

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !LIST_ITEM.test(lines[i]) &&
      !/^\s{0,3}#{1,6}\s/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*>/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    blocks.push({ type: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = LIST_ITEM.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const block: Extract<Block, { type: "list" }> = { type: "list", ordered, start: ordered ? parseInt(first[2], 10) || 1 : 1, items: [] };
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the list unless the next line continues it.
      const next = lines[i + 1];
      const m = next ? LIST_ITEM.exec(next) : null;
      if (m && m[1].length >= indent) {
        i++;
        continue;
      }
      break;
    }
    const m = LIST_ITEM.exec(line);
    if (m && m[1].length === indent) {
      block.items.push({ text: m[3], children: [] });
      i++;
    } else if (m && m[1].length > indent) {
      const nested = parseList(lines, i);
      block.items[block.items.length - 1]?.children.push(nested.block);
      i = nested.next;
    } else if (!m && /^\s+\S/.test(line) && block.items.length) {
      block.items[block.items.length - 1].text += ` ${line.trim()}`;
      i++;
    } else {
      break;
    }
  }
  return { block, next: i };
}

const INLINE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+?\*\*|__[^_]+?__)|(\*[^*\s][^*]*?\*|(?<![\w])_[^_\s][^_]*?_(?![\w]))/;

function inline(text: string, refs: RefMaps, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    const key = `${keyBase}-${k++}`;
    if (m[1]) {
      out.push(
        <code key={key} className="rounded bg-gray-100 px-1 text-[0.9em] dark:bg-white/10">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      out.push(<Fragment key={key}>{renderLink(link[1], link[2], refs, key)}</Fragment>);
    } else if (m[3]) {
      out.push(
        <strong key={key} className="font-semibold text-dark dark:text-white">
          {inline(token.slice(2, -2), refs, key)}
        </strong>,
      );
    } else {
      out.push(<em key={key}>{inline(token.slice(1, -1), refs, key)}</em>);
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

function renderLink(label: string, href: string, refs: RefMaps, key: string): ReactNode {
  const children = inline(label, refs, key);
  if (href.startsWith("vref:")) {
    const video = refs.videos?.[href.slice(5)];
    return video ? <VideoRefTooltip video={video}>{children}</VideoRefTooltip> : <span className="font-medium">{children}</span>;
  }
  if (href.startsWith("cref:")) return <ChannelRefLink channelId={href.slice(5)}>{children}</ChannelRefLink>;
  if (/^(https?:|mailto:)/i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-accent-blue-text underline">
        {children}
      </a>
    );
  }
  return <>{children}</>;
}

function renderBlock(block: Block, refs: RefMaps, key: string): ReactNode {
  switch (block.type) {
    case "heading": {
      const cls = block.level <= 2 ? "mt-5 mb-1.5 text-base font-semibold first:mt-0" : "mt-4 mb-1 text-sm font-semibold first:mt-0";
      return (
        <p key={key} role="heading" aria-level={block.level} className={cn(cls, "text-dark dark:text-white")}>
          {inline(block.text, refs, key)}
        </p>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="my-2 break-words leading-relaxed">
          {inline(block.text, refs, key)}
        </p>
      );
    case "quote":
      return (
        <blockquote key={key} className="my-2 border-l-2 border-stroke pl-3 text-dark-5 dark:border-white/20">
          {inline(block.text, refs, key)}
        </blockquote>
      );
    case "code":
      return (
        <pre key={key} className="my-2 overflow-x-auto rounded-lg bg-gray-100 p-3 text-[13px] leading-snug dark:bg-white/10">
          <code>{block.text}</code>
        </pre>
      );
    case "hr":
      return <hr key={key} className="my-3 border-t border-stroke dark:border-white/10" />;
    case "table":
      return (
        <div key={key} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.header.map((h, i) => (
                  <th key={i} className="border-b border-stroke px-2 py-1.5 text-left font-semibold dark:border-white/15">
                    {inline(h, refs, `${key}-h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i} className="border-b border-stroke px-2 py-1.5 align-top dark:border-white/10">
                      {inline(c, refs, `${key}-${r}-${i}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined} className={cn("my-2 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((item, i) => (
            <li key={i} className="my-0.5 break-words">
              {inline(item.text, refs, `${key}-${i}`)}
              {item.children.map((child, j) => renderBlock(child, refs, `${key}-${i}-${j}`))}
            </li>
          ))}
        </Tag>
      );
    }
  }
}

export function Markdown({ text, videos, className }: { text: string; videos?: Record<string, VideoRef>; className?: string }) {
  const blocks = parseBlocks(text);
  return <div className={cn("chat-markdown text-base text-dark dark:text-white", className)}>{blocks.map((b, i) => renderBlock(b, { videos }, `b${i}`))}</div>;
}
