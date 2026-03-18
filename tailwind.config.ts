import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        dw: {
          bg: "#1a120b",
          wood: "#3d2b1f",
          "wood-light": "#5a3d2b",
          "wood-dark": "#2a1a10",
          aluminum: "#b0b0b0",
          "aluminum-light": "#d0d0d0",
          "aluminum-dark": "#808080",
          chrome: "#e0e0e0",
          amber: "#e89030",
          "amber-dim": "#a06020",
          "amber-glow": "#ffaa44",
          surface: "#1a1a1a",
          accent: "#e89030",
          "accent-dim": "#a06020",
          text: "#e8e0d0",
          muted: "#8a8580",
          danger: "#c0392b",
          panel: "#2a2a2e",
        },
      },
      fontFamily: {
        mono: ["var(--font-ibm-plex-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
