import localFont from "next/font/local";

// #378: JetBrains Mono for the chat's Terminal theme, served from files in this repo (like #364's fonts)
// instead of being fetched from Google Fonts at build time. The files are Google's variable ones (weights
// 100-800, fonts.gstatic.com v24) with Google's family name and unicode-ranges. Nothing is preloaded: the
// browser only downloads a file when a page draws text in this family, which is only in the Terminal theme,
// so the other themes cost nothing. The theme's font stack names "JetBrainsMono Nerd Font" first, so a
// computer that has the Nerd Font installed uses it and downloads nothing. Licence: jetbrains-mono/OFL.txt.

export const jetbrainsMono = localFont({
  src: [{ path: "./jetbrains-mono/JetBrainsMono-var-latin.woff2", weight: "100 800", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "JetBrains Mono" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-chat-terminal",
});

export const jetbrainsMonoLatinExt = localFont({
  src: [{ path: "./jetbrains-mono/JetBrainsMono-var-latin-ext.woff2", weight: "100 800", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "JetBrains Mono" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
