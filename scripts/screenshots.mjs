// Full-page screenshots of every page at desktop and mobile widths, against localhost only.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE)) throw new Error('screenshots run against localhost only');
const pages = [['home', '/'], ['join', '/join/'], ['plumbline', '/plumbline/'], ['dashboard', '/dashboard/'], ['desk', '/desk/'], ['404', '/nope/']];
const sizes = [['desktop', { width: 1440, height: 900 }, 1], ['mobile', { width: 390, height: 844 }, 2]];
await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const [sname, viewport, dpr] of sizes) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [name, path] of pages) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    if (name === 'dashboard') await page.waitForSelector('[data-mode]:not(:text("Connecting"))', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(600);
    const file = `screenshots/${name}-${sname}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file, name === 'dashboard' ? `mode=${await page.textContent('[data-mode]')} | ${await page.textContent('[data-updated]')}` : '');
  }
  if (errors.length) console.log('page errors:', errors);
  await ctx.close();
}
await browser.close();
