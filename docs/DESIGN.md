# Monochrome UI

The three supplied references are black-and-white manga illustrations, not app screenshots. They provide a reference for tonal contrast and fine linework; exact UI layout/radii cannot be measured from them. Bento layout follows the written brief.

Tokens implemented with Tailwind CSS in `app/globals.css`:

- Canvas: #000000; card: zinc-950 / #0a0a0a; controls: zinc-900.
- Borders: 1px zinc-800 (#27272a); selected: zinc-700.
- Text: zinc-100, secondary zinc-400, metadata zinc-500.
- Cards: rounded-2xl (16px), controls 8px; grid gap 20px.
- Glow: white at 2–4% opacity; no purple/color accents.
- Layout: fixed sidebar on desktop, sticky icon navigation on mobile; summary cards, chart, deadline list, data table, monthly calendar and document grid.
- Copy: module names, metrics, labels, actions, operational errors and empty states only. No welcome copy, marketing slogans, motivational quotes or decorative footer.

## Coolvetica

User ZIP contains Coolvetica Regular, Italic, Condensed, Crammed and Heavy Compressed OTF files, a quick guide and `Typodermic Desktop EULA 2026.pdf` (v260817). The included guide explicitly excludes website/webfont embedding from that desktop license. Font binaries are therefore not redistributed or committed.

Headings/metrics use `Coolvetica Local` via CSS `local()` when installed on the visitor's computer, then Helvetica Neue/Helvetica/Arial. Body and form text use the neutral system sans-serif stack for readability. No font download or external font service is required. To serve Coolvetica consistently across devices, supply a web-licensed font package and its deployment/redistribution terms first; then replace the local-only source with the licensed asset.
