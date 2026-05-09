/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', 'Noto Sans KR', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#0a0a0c',
          900: '#101015',
          800: '#16161d',
          700: '#1f1f29',
          600: '#2a2a37',
          500: '#3a3a4a',
          400: '#5a5a72',
        },
        accent: {
          DEFAULT: '#ffd60a',
          soft: '#ffe66b',
        },
      },
    },
  },
  plugins: [],
};
