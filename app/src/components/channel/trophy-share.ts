"use client";

import { APP_NAME } from "@/lib/brand";
import { compactViews, exactViews, trophyThemeColor, type Trophy } from "@/lib/channel/trophy-format";
import { rgbTriplet, trophyDataUrl } from "./trophy-art";

// 1080x1080 share card for an earned trophy (the original offers the same download).

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64"><rect width="32" height="32" rx="9" fill="#4F9DD1"/><path d="M19.5 7.5v10.25a4.75 4.75 0 0 1-9.5 0V15" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M10 15l-2.5 2.6" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="19.5" cy="6.6" r="1.9" fill="#B7FDA0"/></svg>`;

function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:") && !src.startsWith("/")) img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = w;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

export const trophyHeadline = (t: Trophy) =>
  t.type === "VIEW_MILESTONE"
    ? `Congratulations on crossing ${compactViews(t.milestone)} views!`
    : t.viewsAtAward
      ? `Congratulations on crossing ${exactViews(t.viewsAtAward)} views!`
      : "Congratulations on your new trophy!";

export async function renderTrophyCard(trophy: Trophy, channelName: string): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create share card");
  await document.fonts?.ready;

  const color = trophyThemeColor(trophy.milestone);
  ctx.fillStyle = "#fffefd";
  ctx.fillRect(0, 0, 1080, 1080);
  const glow = ctx.createLinearGradient(0, 0, 0, 520);
  glow.addColorStop(0, `rgba(${rgbTriplet(color)}, 0.16)`);
  glow.addColorStop(0.48, "rgba(255,255,255,0.78)");
  glow.addColorStop(1, "#fffefd");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 520);

  const [art, thumb, logo] = await Promise.all([
    loadImage(trophyDataUrl(trophy.milestone, color)),
    loadImage(trophy.videoThumbnail),
    loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`),
  ]);
  if (art) {
    ctx.save();
    ctx.shadowColor = "rgba(13,13,13,0.16)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 14;
    const h = 548;
    const w = (h * 200) / 232;
    ctx.drawImage(art, 540 - w / 2, 48, w, h);
    ctx.restore();
  }

  ctx.fillStyle = "#0D0D0D";
  ctx.font = "800 44px Satoshi, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(wrap(ctx, trophyHeadline(trophy), 968, 1)[0], 540, 637);

  roundRect(ctx, 56, 734, 968, 216, 28);
  ctx.fillStyle = "#F3F4F6";
  ctx.fill();
  if (thumb) {
    ctx.save();
    roundRect(ctx, 80, 758, 300, 169, 20);
    ctx.clip();
    const scale = Math.max(300 / thumb.width, 169 / thumb.height);
    const tw = thumb.width * scale;
    const th = thumb.height * scale;
    ctx.drawImage(thumb, 80 + (300 - tw) / 2, 758 + (169 - th) / 2, tw, th);
    ctx.restore();
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#0D0D0D";
  ctx.font = "700 32px Satoshi, Arial, sans-serif";
  const titleLines = wrap(ctx, trophy.videoTitle || "Untitled video", 568, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, 410, 768 + i * 38));
  ctx.fillStyle = "#6B7280";
  ctx.font = "400 24px Satoshi, Arial, sans-serif";
  const views = trophy.viewsAtAward ?? trophy.currentViews;
  const meta = `${channelName} • ${views != null ? `${exactViews(views)} views` : "New channel record"}`;
  wrap(ctx, meta, 568, 2).forEach((line, i) => ctx.fillText(line, 410, 768 + titleLines.length * 38 + 12 + i * 30));

  ctx.font = "700 22px Satoshi, Arial, sans-serif";
  if (logo) ctx.drawImage(logo, 1080 - 56 - ctx.measureText(APP_NAME).width - 8 - 32, 1010, 32, 32);
  ctx.fillStyle = "#0D0D0D";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(APP_NAME, 1080 - 56, 1026);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export share card"))), "image/jpeg", 0.92),
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function downloadTrophyCard(trophy: Trophy, channelName: string) {
  downloadBlob(await canvasToBlob(await renderTrophyCard(trophy, channelName)), "hooklab-trophy.jpg");
}
