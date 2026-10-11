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

import { CERTS_LIVE_AT_BUILD } from '../../store-core/launch.js';

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
  ...(CERTS_LIVE_AT_BUILD ? [{ href: 'https://thespicemelange.org/certificates/', label: 'Certificates' }] : []), // launch flag (SJ2)
  // Absolute on purpose: the Walrus mirror (spicemelange.wal.app) excludes /store, so the link must go to Cloudflare.
  { href: 'https://thespicemelange.org/store/', label: 'Store' },
];

// Footer. LIVE wording (unchanged production text) until the certificates launch; option A ships WITH the certificate pages
// (Tleilaxu's draft: "these swaps should ship together with gate 2"), so it is selected by the same launch flag (SJ2).
export const DISCLAIMER_LIVE =
  'Education and information only. Nothing on this site is financial, investment, legal or tax advice, an offer, or a solicitation to buy or sell any asset. Bitcoin and digital assets are volatile and you can lose money. No returns are promised or implied.';
// Option A (Tleilaxu FOOTER-WORDING-DRAFT.md §1, Sajan approved 8:37 PM PT 10/10), verbatim. It contains no leverage or
// borrowing sentence (the 8:36 borrowing line is ON HOLD, Tleilaxu 8:47 PM PT). Base.astro appends the draft's last sentence
// ("Market data on this site comes from public third-party sources and may be delayed or wrong.").
export const DISCLAIMER_OPTION_A =
  'Education and information only. Our agent templates are educational software: they are not financial, investment, legal or tax advice, and they promise no returns. Bitcoin and digital assets are volatile and you can lose money. Spice Certificates are a separate, holders-only offering with a stated 8% yearly target paid in bitcoin sats. That target is not guaranteed, a certificate is not a bank deposit and is not insured, and you can lose some or all of what you pay; see the Spice Certificate terms. Nothing else on this site is an offer or a solicitation to buy or sell any asset.';
export const DISCLAIMER = CERTS_LIVE_AT_BUILD ? DISCLAIMER_OPTION_A : DISCLAIMER_LIVE;
