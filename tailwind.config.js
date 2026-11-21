const slate = (n) => `rgb(var(--slate-${n}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      // Etwas größere Schrift für bessere Lesbarkeit (xs 12→14 px, sm 14→15,5 px, base 16→17 px)
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.3rem' }],
        sm: ['0.96875rem', { lineHeight: '1.4rem' }],
        base: ['1.0625rem', { lineHeight: '1.55rem' }],
      },
      colors: {
        brand: { 50: '#ecfdf5', 100: '#d1fae5', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46' },
        // Slate-Skala läuft über CSS-Variablen -> Hell/Dunkel ohne Änderung der Seiten
        slate: { 50: slate(50), 100: slate(100), 200: slate(200), 300: slate(300), 400: slate(400), 500: slate(500), 600: slate(600), 700: slate(700), 800: slate(800), 900: slate(900), 950: slate(950) },
      },
    },
  },
};
