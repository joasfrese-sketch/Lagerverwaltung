// @ts-check
/** Alter der letzten Sicherung in Tagen (null = es gibt keine)
 * @param {string|null|undefined} lastIso @param {Date} [now] */
export function backupAgeDays(lastIso, now = new Date()) {
  if (!lastIso) return null;
  return (now.getTime() - new Date(lastIso).getTime()) / 86400000;
}
