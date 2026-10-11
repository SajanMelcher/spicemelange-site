export const SITE = {
  name: 'The Spice Melange',
  tagline: 'A patient bitcoin desk on the Golden Path',
  url: 'https://thespicemelange.org',
  email: 'hello@thespicemelange.org',
  x: 'https://x.com/Sajan_Melcher',
  xHandle: '@Sajan_Melcher',
  github: 'https://github.com/SajanMelcher',
  joinSubject: 'Join the Golden Path',
  // Compliance switch: the private Reserve pilot is family-only. Set to false to remove
  // its single "contact for details" line from the public site entirely.
  showReserveMention: false,
};

export const mailto = (subject: string, body = '') =>
  `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;

// The free course (Sajan 4:02 PM PT 10/10): linked from nav, footer and home; the share link carries utm_source=share.
export const LEARN_URL = 'https://thespicemelange.org/learn/';
export const LEARN_SHARE_URL = `${LEARN_URL}?utm_source=share`;

export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/learn/', label: 'Free course' },
  { href: '/join/', label: 'Join' },
  { href: '/plumbline/', label: 'Market data' },
  { href: '/dashboard/', label: 'Live DeepBook' },
  { href: '/desk/', label: 'The Desk' },
  { href: '/join-the-desk/', label: 'Join the Desk' },
  // Spice Certificates: wallet sign-in + holders-only buying page (testnet preview). Ixians 10/10 8:11 PM PT ask.
  // Absolute like Store: the Walrus mirror excludes /certificates (sign-in needs the Cloudflare Functions API).
  { href: 'https://thespicemelange.org/certificates/', label: 'Certificates' },
  // Absolute on purpose: the Walrus mirror (spicemelange.wal.app) excludes /store, so the link must go to Cloudflare.
  { href: 'https://thespicemelange.org/store/', label: 'Store' },
];

export const DISCLAIMER =
  'Education and information only. Nothing on this site is financial, investment, legal or tax advice, an offer, or a solicitation to buy or sell any asset. Bitcoin and digital assets are volatile and you can lose money. No returns are promised or implied.';
