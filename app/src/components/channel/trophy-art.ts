// HookLab's own trophy illustration (an SVG string), tinted per milestone. Used as an
// <img> in the Trophy Case and drawn onto the share-card canvas.

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const ch = (c: number, t: number) => Math.round(c + (t - c) * amount);
  return `rgb(${ch(r, target[0])}, ${ch(g, target[1])}, ${ch(b, target[2])})`;
}

const lighten = (hex: string, a: number) => mix(hex, [255, 255, 255], a);
const darken = (hex: string, a: number) => mix(hex, [0, 0, 0], a);

export function rgbTriplet(hex: string): string {
  return hexToRgb(hex).join(", ");
}

export function trophySvg(milestone: number, color: string): string {
  const label = new Intl.NumberFormat("en-US").format(milestone);
  const size = label.length <= 3 ? 30 : label.length <= 5 ? 26 : label.length <= 7 ? 22 : 17;
  const ink = milestone >= 10_000_000 ? "#f5f5f5" : "#141414";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 232" width="200" height="232">
  <defs>
    <linearGradient id="cup" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${darken(color, 0.35)}"/>
      <stop offset="0.28" stop-color="${lighten(color, 0.55)}"/>
      <stop offset="0.5" stop-color="${lighten(color, 0.2)}"/>
      <stop offset="0.78" stop-color="${color}"/>
      <stop offset="1" stop-color="${darken(color, 0.45)}"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${lighten(color, 0.7)}"/>
      <stop offset="1" stop-color="${darken(color, 0.15)}"/>
    </linearGradient>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b3b3b"/>
      <stop offset="1" stop-color="#121212"/>
    </linearGradient>
  </defs>
  <path d="M46 44c-30 0-34 54 12 70" fill="none" stroke="url(#cup)" stroke-width="11" stroke-linecap="round"/>
  <path d="M154 44c30 0 34 54-12 70" fill="none" stroke="url(#cup)" stroke-width="11" stroke-linecap="round"/>
  <path d="M38 24h124v34c0 52-30 84-62 88-32-4-62-36-62-88z" fill="url(#cup)"/>
  <ellipse cx="100" cy="24" rx="62" ry="7" fill="url(#rim)"/>
  <path d="M52 34c2 40 14 70 34 90" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round"/>
  <text x="100" y="${64 + (30 - size) / 3}" text-anchor="middle" font-family="'Arial Black', 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="${size}" fill="${ink}" letter-spacing="-0.5">${label}</text>
  <text x="100" y="84" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="10" fill="${ink}" letter-spacing="2">VIEWS</text>
  <circle cx="100" cy="104" r="10" fill="${ink}"/>
  <path d="M96.5 98.5l9 5.5-9 5.5z" fill="${milestone >= 10_000_000 ? "#141414" : "#ffffff"}"/>
  <path d="M90 145h20l-3 22h-14z" fill="url(#cup)"/>
  <rect x="78" y="164" width="44" height="9" rx="3" fill="url(#rim)"/>
  <path d="M64 176h72l9 48a4 4 0 0 1-4 5H59a4 4 0 0 1-4-5z" fill="url(#base)"/>
  <rect x="80" y="192" width="40" height="18" rx="2" fill="#000000" fill-opacity="0.25"/>
</svg>`;
}

export function trophyDataUrl(milestone: number, color: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trophySvg(milestone, color))}`;
}
