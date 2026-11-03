# @fsc/marketing

Static marketing page for Fifth Stone Connect (Inquiry-to-Action). Brief:
[`docs/marketing/SITE_BRIEF.md`](../../docs/marketing/SITE_BRIEF.md). Local review only; nothing
is deployed and no DNS is configured.

```bash
npm run preview -w @fsc/marketing   # http://localhost:4321/
```

- `public/index.html`: page content. Contains `TODO(owner)` for the real contact link.
- `public/tokens.css`: brand colors, fonts, radii. Change brand values here only.
- `public/styles.css`: layout and components.
- `public/assets/`: Fifth Stone Dev logo PNGs supplied by the owner.

Before launch: owner approval, remove `noindex`, replace the placeholder contact link, and decide
whether to self-host the fonts.
