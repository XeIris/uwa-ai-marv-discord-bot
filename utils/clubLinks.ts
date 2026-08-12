/**
 * Structured club links for the `/links` command.
 *
 * The model-facing copy of these lives in prose in `data/skills/club-links.md`
 * (served by `recall_club_links`), which is the wrong shape for an embed. Rather
 * than parse that markdown, the structured form is declared here — and
 * `tests/utils/clubLinks.test.ts` asserts the two agree in both directions, so
 * adding a link to one file and forgetting the other fails the test suite
 * instead of quietly shipping a half-updated bot.
 */

export interface ClubLink {
  label: string;
  url: string;
  blurb: string;
}

/** Run by the club. */
export const OFFICIAL_LINKS: ClubLink[] = [
  {
    label: 'Join via the UWA Student Guild',
    url: 'https://www.uwastudentguild.com/clubs/uwa-artificial-intelligence-club',
    blurb: 'Official club page and membership sign-up',
  },
  {
    label: 'Discord invite',
    url: 'https://discord.gg/8sQXmT9qRg',
    blurb: 'Permanent link — safe to reshare anywhere',
  },
  {
    label: 'Instagram',
    url: 'https://www.instagram.com/uwaaiclub/',
    blurb: 'Event promos and day-to-day updates',
  },
  {
    label: 'LinkedIn',
    url: 'https://au.linkedin.com/company/uwa-ai-club',
    blurb: 'Announcements, sponsors, industry posts',
  },
];

/** UWA's own pages — not run by the club. */
export const UWA_LINKS: ClubLink[] = [
  {
    label: 'AI study at UWA',
    url: 'https://www.uwa.edu.au/study/courses/artificial-intelligence',
    blurb: 'Degrees, majors and units in AI',
  },
  {
    label: 'Library AI subject guide',
    url: 'https://guides.library.uwa.edu.au/artificial_intelligence/',
    blurb: 'Databases, reading, and guidance on AI use in coursework',
  },
];

export function formatLinkList(links: ClubLink[]): string {
  return links.map((link) => `**[${link.label}](${link.url})**\n${link.blurb}`).join('\n\n');
}
