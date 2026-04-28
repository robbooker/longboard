import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["\"Courier New\"", "Courier", "ui-monospace", "monospace"],
        sans: ["\"Helvetica Neue\"", "Helvetica", "Arial", "sans-serif"],
        serif: ["Georgia", "\"Times New Roman\"", "serif"],
      },
      colors: {
        // The "terminal" class namespace is a legacy alias — tokens resolve
        // to unified theme vars so every page follows light/dark. Kept in
        // place during Phase 3B so existing Tailwind class usage across the
        // research pages keeps compiling. Scheduled to be replaced with a
        // non-"terminal"-named namespace (or collapsed entirely) once the
        // research pages' class names get renamed in a follow-up pass.
        terminal: {
          bg: "var(--bg)",
          surface: "var(--surface)",
          border: "var(--border)",
          muted: "var(--border)",
          text: "var(--text-primary)",
          dim: "var(--text-secondary)",
          accent: "var(--accent)",
          warn: "var(--warning)",
          danger: "var(--danger)",
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        scan: "scan 2s linear infinite",
      },
      keyframes: {
        blink: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
