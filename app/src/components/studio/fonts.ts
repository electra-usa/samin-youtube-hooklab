import { Bebas_Neue, Inter, Montserrat, Oswald, Poppins } from "next/font/google";

// Thumbnail-text fonts offered in the Studio style toolbar (same list as the original).
// Roboto comes from the root layout; Impact and Arial Black are system fonts.
const montserrat = Montserrat({ subsets: ["latin"], weight: ["700", "800"], display: "swap", preload: false });
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", display: "swap", preload: false });
const oswald = Oswald({ subsets: ["latin"], weight: ["600", "700"], display: "swap", preload: false });
const poppins = Poppins({ subsets: ["latin"], weight: ["700", "800"], display: "swap", preload: false });
const inter = Inter({ subsets: ["latin"], weight: ["700", "800"], display: "swap", preload: false });

const FAMILIES: Record<string, string> = {
  roboto: "var(--font-roboto)",
  montserrat: montserrat.style.fontFamily,
  "bebas-neue": bebas.style.fontFamily,
  oswald: oswald.style.fontFamily,
  poppins: poppins.style.fontFamily,
  inter: inter.style.fontFamily,
  impact: "Impact, 'Haettenschweiler', 'Arial Narrow Bold', sans-serif",
  "arial-black": "'Arial Black', Arial, sans-serif",
};

/** CSS font-family for a Studio font id. */
export function studioFontFamily(font: string | undefined): string {
  return (font && FAMILIES[font.toLowerCase()]) || FAMILIES.roboto;
}

/** Resolved family for canvas text (canvas can't read CSS variables). */
export function canvasFontFamily(font: string | undefined): string {
  const family = studioFontFamily(font);
  if (!family.startsWith("var(")) return family;
  if (typeof document === "undefined") return "Roboto, Arial, sans-serif";
  const resolved = getComputedStyle(document.documentElement).getPropertyValue("--font-roboto-src").trim();
  return resolved ? `${resolved}, Roboto, Arial, sans-serif` : "Roboto, Arial, sans-serif";
}

/** Start downloading every toolbar font so switching fonts (and canvas exports) don't flash. */
export function preloadStudioFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  for (const font of ["montserrat", "bebas-neue", "oswald", "poppins", "inter"]) {
    document.fonts.load(`700 24px ${studioFontFamily(font)}`).catch(() => {});
  }
}
