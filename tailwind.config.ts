import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper:       "#F4F5F2",
        "paper-2":   "#EBEDE7",
        navy:        "#0B2239",
        "navy-2":    "#10304F",
        black:       "#0A0A0A",
        "text-dark": "#14181D",
        "text-mid":  "#5B6470",
        "text-muted":"#8A929D",
        accent:      "#F5A623",
        "accent-hover":"#E09612",
        amber:       "#F5A623",
        border:      "rgba(20,24,29,0.12)",
        "border-dark":"rgba(255,255,255,0.10)",
      },
      fontFamily: {
        sans:    ["Inter", "sans-serif"],
        display: ["Space Grotesk", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
