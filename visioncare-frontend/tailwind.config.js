/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0B1B24",
          900: "#0F2733",
          800: "#153444",
          700: "#1C4356",
        },
        signal: {
          teal: "#1C9E9E",
          amber: "#E8A33D",
          coral: "#E1573E",
          mist: "#EAF3F3",
        },
      },
      fontFamily: {
        display: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 39, 51, 0.06), 0 4px 12px rgba(15, 39, 51, 0.06)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", opacity: "1" },
          "50%": { transform: "scale(1.05)", opacity: "0.7" },
          "100%": { transform: "scale(0.95)", opacity: "1" },
        },
        "slide-in": {
          from: { transform: "translateX(16px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.6s ease-in-out infinite",
        "slide-in": "slide-in 0.25s ease-out",
      },
    },
  },
  plugins: [],
};
