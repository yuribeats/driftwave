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
          bg: "#0d0d0d",
          surface: "#1a1a1a",
          surface2: "#242424",
          border: "#2e2e2e",
          accent: "#c8a96e",
          "accent-dim": "#7a6440",
          text: "#e8e0d0",
          muted: "#7a7570",
          danger: "#c0392b",
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
