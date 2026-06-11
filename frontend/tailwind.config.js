/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface:      '#F0F3F8',
        panel:        '#FFFFFF',
        nav:          '#F8F9FC',
        border:       '#D4D9E0',
        accent:       '#2563EB',
        'accent-sky': '#0EA5E9',
        ink:          '#1B2333',
        muted:        '#5B6472',
      },
      boxShadow: {
        card:         '0 1px 3px rgba(27,35,51,0.06), 0 4px 12px rgba(27,35,51,0.04)',
        'card-hover': '0 4px 16px rgba(27,35,51,0.10), 0 1px 3px rgba(27,35,51,0.06)',
        panel:        '0 0 0 1px rgba(212,217,224,0.8), 0 8px 32px rgba(27,35,51,0.08)',
        btn:          '0 1px 2px rgba(37,99,235,0.20)',
        'btn-hover':  '0 4px 12px rgba(37,99,235,0.25)',
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

