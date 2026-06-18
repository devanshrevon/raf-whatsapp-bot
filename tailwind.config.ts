import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#15191E",
        paper: "#FAFAF8",
        line: "#E4E2DD",
        accent: "#1F5E4C",
        accentSoft: "#E7F0EC",
        warn: "#B8542E",
        warnSoft: "#FBE9E1",
        danger: "#9C2B2B",
        dangerSoft: "#F7E2E2"
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"]
      }
    }
  },
  plugins: []
};

export default config;
