/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#7165E3", active: "#7C6EFF", dim: "#665AD9", soft: "#EEECFC" },
        ink: { DEFAULT: "#1C1939", soft: "#2C2948", muted: "#6B6A80" },
        surface: { DEFAULT: "#F9F9FB", input: "#F7F7F7" },
        success: { DEFAULT: "#22A06B", soft: "#DCF5E8" },
        warn: { DEFAULT: "#FFBF1E", soft: "#FFF4D6" },
        danger: { DEFAULT: "#E5484D", soft: "#FDE8E8" },
      },
      fontFamily: { sans: ['"DM Sans"', '"IBM Plex Sans Thai"', "system-ui", "sans-serif"] },
      maxWidth: { app: "28rem" },
    },
  },
  plugins: [],
};
