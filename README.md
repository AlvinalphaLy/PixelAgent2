# Pixel Agents Office

A pixel-art office built with Phaser 3, with characters that walk around the map.

## Run

Requires Node.js (no dependencies to install).

```
npm run dev
```

Then open http://localhost:8080. Set `PORT` to use a different port.

| URL | Map |
|---|---|
| `/` | `office_v3`: LimeZu's Office Design 1 joined to the left of Office Design 2 through a doorway |
| `/?map=office_v2` | Office Design 2 alone |
| `/?map=office_play` | A sparser layout built for walking around |

## Rebuilding the maps

The maps are generated from the pack's design files (needs the art below plus Tiled for the check):

```
node tools/build_map.js office_v3   # or office_v2
node tools/verify_map.js office_v3  # pixel-for-pixel check against the source designs
```

`build_map.js` reads raw tileset pixels from `.cache/rgba`, created with `tools/dump_rgba.ps1` (see `docs/HOW_THIS_MAP_WAS_BUILT.md`). How the two designs are joined is explained at the top of `tools/compose_designs.js`.

## Art assets (not included)

The tiles and character sprites are from paid packs whose license doesn't allow redistribution, so they're not in this repo. To run the game:

1. Buy [Modern Office by LimeZu](https://limezu.itch.io/modernoffice).
2. Put the tileset folders in `public/assets/tilesets/` and the character PNGs in `public/assets/characters/`.
3. Put the tileset PNGs used by the Tiled maps in `maps/tilesets/`, next to the `.tsx` files.

## Credits

Office tiles and characters: [Modern Office by LimeZu](https://limezu.itch.io/modernoffice).
