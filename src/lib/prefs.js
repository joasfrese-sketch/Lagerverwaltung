// @ts-check
// Kleine Gerätevorlieben (zuletzt benutztes Projekt usw.). Alles optional: ohne Speicher läuft die App normal.
/** @param {string} key @param {string} [dflt] */
export const getPref = (key, dflt = '') => { try { return localStorage.getItem('pref_' + key) ?? dflt; } catch { return dflt; } };
/** @param {string} key @param {unknown} value */
export const setPref = (key, value) => { try { localStorage.setItem('pref_' + key, String(value ?? '')); } catch { /* egal */ } };
