import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-catamaran)", "Catamaran", "system-ui", "ui-sans-serif", "sans-serif"],
        heading: ["var(--font-montserrat)", "Montserrat", "system-ui", "ui-sans-serif", "sans-serif"],
      },
      colors: {
        // Escalate Brand Colors (matching Reservation app)
        primary: {
          50: "#e8f0f9",
          100: "#d1e1f3",
          200: "#a3c3e7",
          300: "#75a5db",
          400: "#4787cf",
          500: "#1969c3",
          600: "#1456a0",
          700: "#0f437d",
          800: "#0a305a",
          900: "#083774",
          950: "#041b37",
        },
        luxury: {
          50: "#f6f4f0",
          100: "#edeae3",
          200: "#dbd5c7",
          300: "#c9c0ab",
          400: "#b7ab8f",
          500: "#a59673",
          600: "#8a7d5e",
          700: "#6e6349",
          800: "#534a35",
          900: "#373120",
          950: "#1c180c",
        },
        dark: {
          50: "#f0f4f8",
          100: "#d9e2ec",
          200: "#bcccdc",
          300: "#9fb3c8",
          400: "#829ab1",
          500: "#627d98",
          600: "#486581",
          700: "#334e68",
          800: "#243b53",
          900: "#1a2332",
          950: "#102a43",
        },
        accent: {
          gold: "#b59a5a",
          "gold-light": "#d4b87b",
          "gold-dark": "#9a8149",
          grey: "#9a9a98",
        },
      },
      borderRadius: {
        luxury: "12px",
      },
      boxShadow: {
        luxury: "0 4px 20px rgba(0, 0, 0, 0.15)",
        "luxury-lg": "0 10px 40px rgba(0, 0, 0, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
