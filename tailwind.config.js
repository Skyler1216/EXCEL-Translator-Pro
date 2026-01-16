/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}" // In case files are in root
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}