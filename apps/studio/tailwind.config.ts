import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        led: {
          bg: '#0a0a0f',
          panel: '#111118',
          border: '#1e1e2e',
          accent: '#7c3aed',
          muted: '#4a4a6a',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
