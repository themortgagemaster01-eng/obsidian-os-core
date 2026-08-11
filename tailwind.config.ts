import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        background: "#0A0A0B",
        panel: "#121214",
        "panel-hover": "#17171A",
        border: {
          DEFAULT: "rgba(255,255,255,0.08)",
          subtle: "rgba(255,255,255,0.05)",
        },
        navy: {
          DEFAULT: "#0B1220",
          accent: "#1E3A5F",
        },
        foreground: "#FAFAFA",
        muted: {
          DEFAULT: "#1A1A1D",
          foreground: "rgba(250,250,250,0.6)",
        },
        primary: {
          DEFAULT: "#FAFAFA",
          foreground: "#0A0A0B",
        },
        secondary: {
          DEFAULT: "#1A1A1D",
          foreground: "#FAFAFA",
        },
        accent: {
          DEFAULT: "#1E3A5F",
          foreground: "#FAFAFA",
        },
        destructive: {
          DEFAULT: "#7F1D1D",
          foreground: "#FAFAFA",
        },
        input: "rgba(255,255,255,0.08)",
        ring: "rgba(255,255,255,0.2)",
        card: {
          DEFAULT: "#121214",
          foreground: "#FAFAFA",
        },
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      backdropBlur: {
        xs: "2px",
      },
      transitionDuration: {
        DEFAULT: "250ms",
      },
      transitionTimingFunction: {
        DEFAULT: "ease",
      },
      boxShadow: {
        panel: "0 8px 30px rgba(0,0,0,0.35)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
