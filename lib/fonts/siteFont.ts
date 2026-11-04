import localFont from "next/font/local";
import "./fallbacks.css";

// #364: IBM Plex Mono for the whole site (app/layout.tsx), served from files in this repo instead of being
// fetched from Google Fonts at build time. The files are the exact ones next/font/google used to download
// (fonts.gstatic.com, Plex Mono v20), and each @font-face keeps Google's family name, weights and
// unicode-range, so pages render the same. Only the latin file is preloaded, as before; the other
// alphabets load only when a page uses one of their characters. Licence: ibm-plex-mono/OFL.txt.

export const ibmPlexMono = localFont({
  src: [
    { path: "./ibm-plex-mono/IBMPlexMono-300-latin.woff2", weight: "300", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-600-latin.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "IBM Plex Mono" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  display: "swap",
  adjustFontFallback: false,
  fallback: ["'IBM Plex Mono Fallback'"],
  variable: "--font-ibm-plex-mono",
});

// The other alphabets Google served for the same family. Not preloaded, no fallback face of their own:
// they only add @font-face rules to the "IBM Plex Mono" family above.
export const ibmPlexMonoLatinExt = localFont({
  src: [
    { path: "./ibm-plex-mono/IBMPlexMono-300-latin-ext.woff2", weight: "300", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-400-latin-ext.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-500-latin-ext.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-600-latin-ext.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "IBM Plex Mono" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const ibmPlexMonoVietnamese = localFont({
  src: [
    { path: "./ibm-plex-mono/IBMPlexMono-300-vietnamese.woff2", weight: "300", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-400-vietnamese.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-500-vietnamese.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-600-vietnamese.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "IBM Plex Mono" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const ibmPlexMonoCyrillic = localFont({
  src: [
    { path: "./ibm-plex-mono/IBMPlexMono-300-cyrillic.woff2", weight: "300", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-400-cyrillic.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-500-cyrillic.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-600-cyrillic.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "IBM Plex Mono" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const ibmPlexMonoCyrillicExt = localFont({
  src: [
    { path: "./ibm-plex-mono/IBMPlexMono-300-cyrillic-ext.woff2", weight: "300", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-400-cyrillic-ext.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-500-cyrillic-ext.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-600-cyrillic-ext.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "IBM Plex Mono" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
