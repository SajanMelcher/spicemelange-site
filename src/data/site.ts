export const SITE = {
  name: 'The Spice Melange',
  tagline: 'A patient bitcoin desk on the Golden Path',
  url: 'https://thespicemelange.org',
  email: 'reserve@thespicemelange.org',
  x: 'https://x.com/Sajan_Melcher',
  xHandle: '@Sajan_Melcher',
  github: 'https://github.com/SajanMelcher',
  joinSubject: 'Join the Golden Path',
  // Compliance switch: the private Reserve pilot is family-only. Set to false to remove
  // its single "contact for details" line from the public site entirely.
  showReserveMention: true,
};

export const mailto = (subject: string, body = '') =>
  `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;

export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/join/', label: 'Join' },
  { href: '/plumbline/', label: 'Plumbline' },
  { href: '/dashboard/', label: 'Live DeepBook' },
  { href: '/desk/', label: 'The Desk' },
];

export const DISCLAIMER =
  'Education and information only. Nothing on this site is financial, investment, legal or tax advice, an offer, or a solicitation to buy or sell any asset. Bitcoin and digital assets are volatile and you can lose money. No returns are promised or implied.';
