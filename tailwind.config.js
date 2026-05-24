/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        hkit: {
          blue: "#1d4ed8",
          blueDark: "#1e3a8a",
          slate: "#0f172a",
          soft: "#eff6ff"
        }
      }
    },
  },
  plugins: [],
};
