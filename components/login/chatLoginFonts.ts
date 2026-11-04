import localFont from "next/font/local";
import "../../lib/fonts/fallbacks.css";

// #364: served from files in lib/fonts instead of being fetched from Google Fonts at build time. Same files,
// family names, weights and unicode-ranges next/font/google used; only latin is preloaded.
// Licences: lib/fonts/barlow-condensed/OFL.txt, lib/fonts/dm-sans/OFL.txt.

const heading = localFont({
  src: [
    { path: "../../lib/fonts/barlow-condensed/BarlowCondensed-700-latin.woff2", weight: "700", style: "normal" },
    { path: "../../lib/fonts/barlow-condensed/BarlowCondensed-800-latin.woff2", weight: "800", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "Barlow Condensed" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  display: "swap",
  adjustFontFallback: false,
  fallback: ["'Barlow Condensed Fallback'"],
  variable: "--chat-login-heading",
});

const headingLatinExt = localFont({
  src: [
    { path: "../../lib/fonts/barlow-condensed/BarlowCondensed-700-latin-ext.woff2", weight: "700", style: "normal" },
    { path: "../../lib/fonts/barlow-condensed/BarlowCondensed-800-latin-ext.woff2", weight: "800", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "Barlow Condensed" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const headingVietnamese = localFont({
  src: [
    { path: "../../lib/fonts/barlow-condensed/BarlowCondensed-700-vietnamese.woff2", weight: "700", style: "normal" },
    { path: "../../lib/fonts/barlow-condensed/BarlowCondensed-800-vietnamese.woff2", weight: "800", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "Barlow Condensed" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const body = localFont({
  src: [{ path: "../../lib/fonts/dm-sans/DMSans-var-latin.woff2", weight: "100 1000", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "DM Sans" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  display: "swap",
  adjustFontFallback: false,
  fallback: ["'DM Sans Fallback'"],
  variable: "--chat-login-body",
});

const bodyLatinExt = localFont({
  src: [{ path: "../../lib/fonts/dm-sans/DMSans-var-latin-ext.woff2", weight: "100 1000", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "DM Sans" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const chatLoginFonts = `${heading.variable} ${body.variable}`;
