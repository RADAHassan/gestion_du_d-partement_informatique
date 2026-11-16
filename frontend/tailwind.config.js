/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef4ff', 100: '#d9e5ff', 500: '#2f5fd0', 600: '#244ab0', 700: '#1c3a8c', 900: '#0f2159' },
      },
    },
  },
  plugins: [],
};
