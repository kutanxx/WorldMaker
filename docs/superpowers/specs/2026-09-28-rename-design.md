# Renaming (이름 바꾸기) — design

2026-09-28. The reader's pick from a list of research-backed candidates (the most repeated complaint about
map generators: "no way to rename"), then — from a demo they could click (`.claude/probes/out/rename-demo.html`)
— edited on the map itself, and kept in the link.

## What the reader does

- "✎ 이름 바꾸기" / "✎ Rename" on the map, under the map-only chip (on the world and on a plate). While it is
  on, every name on the map can be clicked — a town, a realm, a region or sea, a river, a province, a
  people, the world's title; on a plate its title and the towns its roads are written to — and an input
  opens where the name stands. Enter keeps it, Escape leaves it, an empty box (or the generated name) gives
  the name back; clicking anywhere else keeps what was typed, and clicking another name moves the box there
  in one click. While it is off, clicking works as it always has (a town opens its plate).
- A name is shown as it was typed, in both languages. Measured: the transliteration Korean pages use runs
  over a closed token alphabet, and typed Latin comes out broken ("Winterfell" → "w인테르펠르").
- A realm keeps its form word (아르델 → "아르델 왕국"), a people its 인: the reader names the realm, the
  record says what kind of state it was. The box holds the bare word.
- The names follow the world everywhere it is drawn or written: the map in every view and year, its keys,
  the town list, the plate (title, gates, road ends, Nearby, realm), the chronicle caption (particles
  chosen for the new word), the tab's title, the gazetteer, the JSON, the SVG/PNG.

## Where the control stands

Planned for the toolbar, measured there first: at 1440x900 the English bar needed 1093px of 1035 with it
(1003 without) and went to two rows — the bar a previous pass spent real work getting onto one. On the map
it costs the bar nothing, it is there in the map-only view (where the toolbar is not), and it stands by the
thing it works on. Measured under it: no town over 12 worlds; the names of seas step out from under it as
from under the other chip (`underControls`); on 34 plates the two chips stood on a road's destination 4
times (3 of them the old chip's), and those now walk clear along their roads (`placeRoadEnds`'s `clear`),
none taken off. A phone does not get it: a 336px map, and typing is a desk's work — the names a link
carries are shown there all the same.

## Where they are kept

In the address, beside the world: `#<world>&city=N&names=<base64url of UTF-8 JSON>`. The link is the save —
shared or bookmarked, it opens the renamed world; a new world starts with its own names. Keys are short:
`w` the world, `t<id>` a town, `r<id>` a realm, `c<i>` a people, `g<i>` a region, `v<i>` a river, `p<id>` a
province. World 1 renamed through (173 names, three Korean syllables each) is about 2.6 KB. A name is at
most 40 characters. The world part of the address is read with the names taken off — before this, anything
after the world's base64 but `&city=` made the page open world 1.

## How

- Data, not display: `applyNames` writes the reader's names INTO the world and the history (towns, realms of
  year zero and of the record, peoples; the free ports and the founding events named after a town, by its
  cell), keeping the generated names to restore. Every existing drawing path then shows them.
- A reader's name carries an invisible mark (U+2060, a zero-width word joiner): `toHangul`/`properNoun` pass
  a marked word through as written, and the English label helpers take the mark off. Regions, rivers,
  provinces and the world are composites with parts; their label takes a `custom` text instead.
- Files leave with no marks: the gazetteer, the chronicle's lines and the JSON are stripped of it. A
  downloaded map leaves without the `data-name` keys.
- Labels say what they name (`data-name`), which is all the colour map gains: its pinned bytes are hashed
  with those attributes taken out and still match. The world map's text lets clicks through to the towns
  under it; while renaming, a name takes its click.
- Re-rendered after a change, the map keeps the zoom it was at (`attachZoomPan`'s `restore`). The box
  follows its name while the map is dragged or zoomed under it.
- Korean is typed through an input method: an Enter that finishes the last syllable keeps the name once
  the syllable is written (`compositionend`), not before.

## Determinism

The generated names are unchanged; nothing but display text moves. World goldens, history anchors and the
plate byte-lock do not move. A plate is laid out under its town's born name — its title's tablet is measured
from the name and the countryside keeps clear of it, so laid out under the reader's name a town's hamlets
moved — and only its title is the reader's.
