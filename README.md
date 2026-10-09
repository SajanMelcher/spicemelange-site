# thespicemelange.org

Static site for The Spice Melange desk. Astro 5 + Tailwind CSS 4, no client framework.
**Not deployed.** See `/home/box/agent-data/shared/portfolio-desk/website/PLAN.md` for hosting, DNS and email plans.

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # -> dist/
npm run preview    # serve dist/ on 127.0.0.1:4321
npm run snapshot   # refresh public/data/deepbook-snapshot.json (dashboard fallback)
npm run shots      # full-page screenshots (desktop 1440, mobile 390) -> screenshots/
node scripts/a11y.mjs  # axe-core WCAG A/AA check against the preview
```

- `src/data/site.ts`: contact details, nav, disclaimer, and the `showReserveMention` compliance switch.
- `src/lib/deepbook-core.js`: DeepBook indexer fetch + mid/spread/depth math, shared by the browser and the snapshot script.
- `src/pages/join.astro`: the form posts nowhere; see `TODO(resend-endpoint)`.
- All artwork is original SVG in `src/components/`.
