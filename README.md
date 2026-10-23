# MakeMetro

A metro building game played on real cities. Draw tunnels, viaducts and stations through a real street grid, run trains on them, and watch millions of people decide whether your network is worth taking.

Cities are built from open data (OpenStreetMap and the GHSL population grid), so in principle any city works. Moscow is the first one we test against.

The game is early and changes a lot. See [DESIGN.md](DESIGN.md) for what we're building and why.

## Running it

You need Node 20 or newer.

```
npm install
npm run city -- moscow     # downloads and builds the Moscow city pack, once
npm run dev
```

Then open http://localhost:5180. `npm test` runs the tests.

Building a city pack downloads map tiles, population and elevation data for the area (a few hundred MB for Moscow) and takes a few minutes. See [tools/citygen](tools/citygen) for details.

## Controls

| Key | |
| --- | --- |
| V | Select. Drag planned stations and depots to move them, or planned track to bend it |
| S | Stations: click to place, then drag the round handle to point the platform |
| C | Connect: click stations in order to lay track between them, Esc to stop |
| T | Free track: click points, double-click or Enter to end it anywhere |
| D | Depot: click to place the yard, then connect it to the line |
| R | Routes: click stations in order |
| X | Remove |
| Q and E | Turn the selected station or depot |
| [ and ] | Deeper or higher |
| B | Build everything you've planned |
| U | X-ray, to see tunnels at their real depth |
| Space, 1, 2, 3 | Pause and game speed |
| Ctrl+Z, Ctrl+Y | Undo and redo |

All keys can be changed in Settings.

## Layout

- `src/game`: network model, construction, money, trains
- `src/sim`: demand and passenger assignment, runs in a worker
- `src/map`, `src/render`: map style, map layers, three.js trains and structures
- `src/ui`: everything on screen that isn't the map
- `tools/citygen`: builds city packs from open data

## License

The code is GPL-3.0, see [LICENSE](LICENSE). Map data © OpenStreetMap contributors, available under the ODbL. Population data: GHSL, European Commission Joint Research Centre (CC BY 4.0). Elevation: Terrain Tiles on AWS (Mapzen and their sources). Fonts: IBM Plex (OFL) and Noto Sans (OFL).
