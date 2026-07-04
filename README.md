# WorldMaker

A procedural fantasy world generator for novelists and TRPG game masters — cartography, coherent city drill-downs, and 500 years of simulated history rendered as readable lore.

절차적 판타지 세계 생성기 — 소설가와 TRPG GM을 위한 지도 제작 도구입니다.

## Features

- **World map** — Voronoi-based continents with climate-driven biomes, named rivers, mountain relief, and antique-atlas styling (terrain / political / culture views)
- **History simulation** — a Turchin-style solidarity model runs 500 years forward: conquests, civil wars, free cities, golden ages — scrubbable on a timeline and written out as a chronicle
- **City drill-down** — click any city marker for a deterministic medieval city map: walls, wards, harbors, mountains, extramural suburbs, abbeys
- **Culture layer** — phonetic naming profiles so each region's cities *sound* related
- **Exports** — PNG / SVG maps, JSON world data, and a Markdown gazetteer (world almanac)
- **Shareable seeds** — every world is reproducible from its URL

## Development

```bash
npm install
npm run dev      # dev server
npm test         # vitest
npm run build    # typecheck + production build
```

Built with TypeScript, Vite, d3-delaunay, and simplex-noise. The generation engine (`src/engine/`) is pure and DOM-free; rendering lives in `src/ui/`.

## Deployment

Pushes to `main` deploy automatically to GitHub Pages via `.github/workflows/deploy.yml`.
