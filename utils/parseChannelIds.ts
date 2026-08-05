/**
 * Parses a comma-separated string of channel IDs into a clean array.
 */
export function parseChannelIds(raw: string | null | undefined): string[] {
  return (raw || '').split(',').map((id) => id.trim()).filter(Boolean);
}
