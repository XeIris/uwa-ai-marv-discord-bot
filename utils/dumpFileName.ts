/** Insert a filesystem-safe ISO timestamp before the file extension. */
export function timestampedFileName(baseName: string, date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dotIndex = baseName.lastIndexOf('.');
  if (dotIndex === -1) return `${baseName}_${stamp}`;
  return `${baseName.slice(0, dotIndex)}_${stamp}${baseName.slice(dotIndex)}`;
}
