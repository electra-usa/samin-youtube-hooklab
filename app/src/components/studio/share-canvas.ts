"use client";

import { APP_NAME } from "@/lib/brand";
import { textAnchor } from "./model";
import { canvasFontFamily } from "./fonts";
import type { ComboWithStyle } from "./StudioViews";

// 1080x1350 image of up to 8 combos laid out as YouTube cards, for feedback from a team.
// Layout per combo count follows the original's share export.

const W = 1080;
const H = 1350;
const PAD = 24;
const AREA_W = W - PAD * 2;
const AREA_H = H - PAD * 2 - 48;
const META_H = 96;
const BG = "#e5e7eb";

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="40" height="40"><rect width="32" height="32" rx="9" fill="#4F9DD1"/><path d="M19.5 7.5v10.25a4.75 4.75 0 0 1-9.5 0V15" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M10 15l-2.5 2.6" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="19.5" cy="6.6" r="1.9" fill="#B7FDA0"/></svg>`;

function cardSize(n: number): { kind: string; w: number; h: number } {
  const fit = (rowH: number, maxW: number, scale = 1) => {
    const w = Math.floor(scale * Math.min(maxW, Math.floor((16 * (Math.floor(rowH) - META_H)) / 9)));
    return { w, h: Math.floor((9 * w) / 16) + META_H };
  };
  if (n === 1) return { kind: "1", w: AREA_W, h: Math.round((AREA_W * 9) / 16) + META_H };
  if (n === 2) return { kind: "stack", ...fit(639, AREA_W, 0.96) };
  if (n === 3) return { kind: "stack", ...fit(418, AREA_W, 0.92) };
  if (n === 4) return { kind: "2x2", ...fit(639, 504) };
  if (n === 5) return { kind: "5", ...fit(418, 504) };
  if (n === 6) return { kind: "2x3", ...fit(418, 504, 0.96) };
  return { kind: "2x4", ...fit(293.5, 504, 0.96) };
}

function positions(n: number, size: { kind: string; w: number; h: number }): { x: number; y: number }[] {
  const { kind, w, h } = size;
  const out: { x: number; y: number }[] = [];
  if (kind === "1") return [{ x: PAD + (AREA_W - w) / 2, y: PAD + (AREA_H - h) / 2 }];
  if (kind === "stack") {
    const top = PAD + (AREA_H - (n * h + (n - 1) * 24)) / 2 + (n === 2 ? 16 : 10);
    for (let i = 0; i < n; i++) out.push({ x: PAD + (AREA_W - w) / 2, y: top + i * (h + 24) });
    return out;
  }
  const gap = kind === "2x2" ? 32 : 24;
  const rows = kind === "2x2" ? 2 : kind === "2x4" ? 4 : 3;
  const rowW = 2 * w + gap;
  const left = PAD + (AREA_W - rowW) / 2;
  const top = PAD + (AREA_H - (rows * h + (rows - 1) * gap)) / 2;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 2);
    const lastAlone = i === n - 1 && n % 2 === 1;
    out.push({ x: lastAlone ? left + (rowW - w) / 2 : left + (i % 2) * (w + gap), y: top + row * (h + gap) });
  }
  return out;
}

function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    if (/^https?:/.test(src)) img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
}

function titleLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(next).width <= maxW) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  let second = lines[1];
  while (second.length && ctx.measureText(`${second}…`).width > maxW) second = second.slice(0, -1).trimEnd();
  return [lines[0], `${second}…`];
}

export async function renderShareImage(combos: ComboWithStyle[], channelName: string, channelAvatar: string | null): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to initialize canvas context");
  const list = combos.slice(0, 8);
  // Make sure chosen thumbnail fonts are loaded before drawing text.
  await Promise.all(list.map((c) => document.fonts?.load(`700 32px ${canvasFontFamily(c.style.font)}`).catch(() => null)));
  await document.fonts?.ready;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const size = cardSize(list.length);
  const spots = positions(list.length, size);
  const urls = [...new Set(list.map((c) => c.imageUrl).filter(Boolean))];
  const images = new Map(await Promise.all(urls.map(async (u) => [u, await loadImage(u)] as const)));
  const avatar = await loadImage(channelAvatar);
  const logo = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`);

  list.forEach((combo, i) => {
    const { x, y } = spots[i];
    const { w, h } = size;
    const thumbH = h - META_H;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, w, h);
    const img = combo.imageUrl ? images.get(combo.imageUrl) : null;
    if (img) cover(ctx, img, x, y, w, thumbH);
    else {
      const g = ctx.createLinearGradient(x, y, x + w, y + thumbH);
      g.addColorStop(0, "rgba(148,163,184,0.8)");
      g.addColorStop(1, "rgba(22,68,102,0.8)");
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(x, y, w, thumbH);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, thumbH);
    }

    if (combo.thumbnailText.trim()) {
      const pos = textAnchor(combo.style);
      const fontPx = Math.max(12, ((combo.style.fontSize || 24) / 320) * w);
      const lines = combo.thumbnailText.split("\n");
      const lineH = fontPx * 1.05;
      ctx.font = `700 ${fontPx.toFixed(1)}px ${canvasFontFamily(combo.style.font)}`;
      ctx.fillStyle = combo.style.fontColor || "#FFFFFF";
      ctx.textAlign = combo.style.textAlign || "center";
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = 6;
      const cx = x + (w * pos.x) / 100;
      const cy = y + (thumbH * pos.y) / 100;
      lines.forEach((line, li) => ctx.fillText(line, cx, cy - (lineH * lines.length) / 2 + li * lineH, w * 0.85));
      ctx.shadowBlur = 0;
    }

    const bx = x + w - 6 - 42;
    const by = y + thumbH - 6 - 20;
    ctx.beginPath();
    ctx.roundRect(bx, by, 42, 20, 4);
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fill();
    ctx.font = "500 12px Roboto, Arial, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("12:34", bx + 21, by + 4);

    const avX = x + 12;
    const textX = avX + 36 + 12;
    const textW = x + w - 12 - textX;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX + 18, y + thumbH + 16 + 18, 18, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (avatar) cover(ctx, avatar, avX, y + thumbH + 16, 36, 36);
    else {
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(avX, y + thumbH + 16, 36, 36);
    }
    ctx.restore();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "500 16px Roboto, Arial, sans-serif";
    ctx.fillStyle = "#0d0d0d";
    const tl = titleLines(ctx, combo.title.trim() ? combo.title : "Untitled", textW);
    tl.forEach((line, li) => ctx.fillText(line, textX, y + thumbH + 14 + li * 17, textW));
    const metaY = y + thumbH + 14 + 17 * Math.max(1, tl.length) + 6;
    ctx.font = "400 14px Roboto, Arial, sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(channelName, textX, metaY, textW);
    ctx.fillText("100K views • 1 day ago", textX, metaY + 21, textW);
    ctx.restore();
  });

  ctx.font = "500 14px Roboto, Arial, sans-serif";
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const label = `made with ${APP_NAME}`;
  const lx = W - PAD - (28 + ctx.measureText(label).width);
  if (logo) ctx.drawImage(logo, lx, H - 45, 20, 20);
  ctx.fillText(label, lx + 28, H - 43);
  return canvas;
}
