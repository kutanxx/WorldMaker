# Sea routes (뱃길) — design

2026-09-28. Chosen by the reader from a research-backed proposal (FMG has had sea routes since 2017,
Perilous Shores draws them, ORBIS models Roman sea legs), then the rule and the ink picked from a
preview drawn from real data (`.claude/probes/out/sea-routes-preview.html`, worlds 1 and 11).

## What the reader sees

- Dashed lines over the sea between ports, in the sea names' navy (`#3f5d78`, about 5:1 on the ocean
  fill) — the reader's pick over the roads' red. A hover names the route and its length:
  "카아그–마에르 뱃길 · 320km" / "Sea route, Kaag – Maer, 320 km".
- They follow the chronicle together with the roads, by the roads' own rule: a road or a sea route
  shows in a year while it lies on the cheapest way (land and sea together) between two towns standing
  then. Nothing is taken away as the years run, and when every town stands every way shows.
- The terrain key and the province key gain a "뱃길" row beside "길".
- A port's "Nearby" lists the towns its ships sail to beside the towns its roads lead to ("엘라엔 ·
  뱃길 320km"); an island town no road leaves points at its ports across the water instead of at the
  three nearest towns as the crow flies.
- The SVG/PNG export carries its year's sea routes; the JSON carries `seaRoutes`.

## Which ports are joined — rule (나), "only where the sea is the better way"

1. Ports are the coastal towns.
2. Each port's way over the water to every other is measured on the mesh (Dijkstra over ocean cells;
   a port's cell is where a voyage starts or ends, never a way through).
3. Two ports are neighbours by sea when no third port is nearer to both of them (the relative
   neighbourhood graph — the roads' own rule).
4. Of those, a route is kept where no road joins them, or the way by road is more than 1.5 times the
   voyage.
5. A kept route that no cheapest way between two towns uses, even with every town standing, is
   dropped (1 of 41 over twelve worlds): it would never show.

Measured over worlds 1–12 (139 ports): rule (가), every sea neighbour, gave 128 routes — dashed loops
round whole islands, and under the joint timeline rule 4 of world 11's 26 roads never showed; rule (나)
gives 40 (world 1: 5, world 11: 9), and every road still shows by the end. Joining only landmasses gave 5.

## The course

The shortest way through ocean cell centres runs half a cell off the shore and read as a dotted second
coastline. The course is that path pulled straight: from each point, the farthest later point the
straight leg to which stays over water (tested every 2 units against the nearest cell), so a ship
sails straight legs between headlands. It is drawn as those legs. Its length is the voyage's length.

## The timeline

`waysInUse(roads, seaRoutes, stands)` runs `roadsInUse` over roads and sea routes together (a sea
route costs its length, a road its effort). Measured: sea routes shown at year 0 / 100 / 200 / 300 / 500
over twelve worlds 29 / 35 / 35 / 38 / 40, none taken away. World 1 opens on 17 roads (was 15: two
roads beyond a crossing now lie on the way between two capitals) and 1 sea route.

## Determinism

Terrain, the mesh and the roads only; no rng. The world goldens hash polityOf and the town cells, so
nothing moves; no town plate reads the sea routes, so the plate byte-lock does not move either.
