// Logo der MBG Lemgo (Mennonitische Brüdergemeinde): Haus-Umriss mit Kreuz.
// Als SVG nachgezeichnet, damit es in jeder Größe scharf bleibt.
export const LOGO_BLUE = '#86acd2';
export const LOGO_CROSS = '#5f93cc';

const PATHS = `
  <path d="M38 58H8V27h14V17L48 4l26 13v10h14v31H58" fill="none" stroke="${LOGO_BLUE}" stroke-width="4" stroke-linejoin="miter"/>
  <path d="M43 18h9v11h11v8H52v25h-9V37H32v-8h11z" fill="${LOGO_CROSS}"/>`;

// Bildmarke allein (für Menü, Icons)
export const logoMark = (cls = 'h-8 w-auto') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64" class="${cls}" role="img" aria-label="MBG Lemgo">${PATHS}</svg>`;

// Bildmarke + Schriftzug (für Anmeldeseite). textClass färbt den Schriftzug.
export const logoFull = ({ cls = 'h-24 w-auto', dark = false } = {}) => {
  const main = dark ? '#ffffff' : '#565656'; const sub = dark ? '#94a3b8' : '#8a8a8a';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150" class="${cls}" role="img" aria-label="MBG Lemgo – Mennonitische Brüdergemeinde">
    <g transform="translate(102 2) scale(1)">${PATHS}</g>
    <text x="150" y="112" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="46" fill="${main}" textLength="262" lengthAdjust="spacingAndGlyphs"><tspan font-weight="700">MBG</tspan><tspan font-weight="300">LEMGO</tspan></text>
    <text x="150" y="138" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="12.5" fill="${sub}" textLength="262" lengthAdjust="spacingAndGlyphs">MENNONITISCHE BRÜDERGEMEINDE</text>
  </svg>`;
};
