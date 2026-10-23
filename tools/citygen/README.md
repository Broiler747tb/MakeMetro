# citygen

Builds a city pack for MakeMetro from open data: a vector basemap, a 250 m grid of residents, jobs and other trip attractors, every building with its floor area, and a list of names for stations.

## Running it

```
npm run city -- moscow
```

This reads `cities/moscow.json` and writes `public/cities/moscow/`. Downloads are cached under `.cache/citygen/`, so a second run works offline and takes about half a minute for Moscow. Pass `--refresh-basemap` to re-extract the basemap from the newest Protomaps build.

The basemap extract needs the `go-pmtiles` command:

```
go install github.com/protomaps/go-pmtiles@latest
```

It is looked up on `PATH` and in `$GOPATH/bin` (or `~/go/bin`). Set `PMTILES_BIN` to use a binary somewhere else.

Each run also writes preview images of the grid to `.cache/citygen/<id>/` (`residents-jobs.png`, `industry-nature-nightlife.png` and `layers.png`, north up).

## City config

`cities/<id>.json`:

| Field | Default | Meaning |
| --- | --- | --- |
| `id` | | Must match the file name. Lowercase letters, digits and dashes. |
| `name` | | Display name. |
| `bbox` | | `[west, south, east, north]` in degrees. |
| `centre` | bbox centre | City centre as `[lon, lat]`. Nature attraction grows with distance from it. |
| `jobsPerResident` | 0.55 | Total jobs as a share of residents. |
| `studentsPerResident` | 0.18 | School and university places as a share of residents. |
| `cellSize` | 250 | Grid cell size in metres. |
| `maxzoom` | 15 | Highest basemap zoom. Buildings are read at this zoom. |
| `streetNameSpacing` | 150 | Distance between street name points, metres. |
| `basemapBuild` | | Protomaps build date (`YYYYMMDD`) to pin. Without it the newest cached extract is used, or the newest build if nothing is cached. |

Any bbox works. Keep it to a city and its suburbs: the whole pack is loaded at once.

## Output

All coordinates are local metres: x east, y north, on an equirectangular projection around the bbox centre. `city.json` holds the projection constants:

```
x = (lon - lon0) * mPerDegLon
y = (lat - lat0) * mPerDegLat
```

`mPerDegLat` and `mPerDegLon` are the usual series for the length of a degree at `lat0`. All binaries are little-endian.

- **`city.json`**: the manifest, with the bbox, projection, city centre (`centre`, in local metres), grid layout, totals and the attribution to show on the map. `totals` has `residents`, `jobs`, `education`, `buildings`, `jobsIndustry`, `nature` and `nightlife`.
- **`basemap.pmtiles`**: Protomaps basemap (v4 schema) for the bbox, zoom 0 to 15.
- **`grid.bin`**: one float32 plane per layer, in the order listed in `city.json`. Planes are row-major. Row 0 is the south edge and column 0 the west edge, starting at (`x0`, `y0`). The layers are `residents`, `jobs`, `education`, `retail`, `leisure`, `elevation`, `water`, `built`, `jobsIndustry`, `nature` and `nightlife`. New layers are added at the end.
  - `residents`, `jobs` and `education` are counts.
  - `jobsIndustry` is the part of `jobs` in industry, logistics and utilities, so it is never more than `jobs` in a cell. `jobs - jobsIndustry` is office and service work.
  - `retail`, `leisure`, `nature` and `nightlife` are unitless and scaled to sum to the resident total.
  - `elevation` is metres above sea level at the cell centre.
  - `water` and `built` are the share of the cell covered.
- **`buildings.bin`**: the file is laid out in this order:
  - A header of four uint32: magic `0x44424D4D` ("MMBD"), version 1, count, vertexCount.
  - float32 `props[count * 6]`: cx, cy, height (m), floor area (m²), residents, jobs.
  - uint8 `kind[count]`, padded to 4 bytes. The codes are 0 residential, 1 office/commercial, 2 industrial, 3 education, 4 retail, 5 other.
  - uint32 `ringStart[count + 1]`, indexes into the vertex list.
  - float32 `verts[vertexCount * 2]`: the outer ring of each building, counter-clockwise, not closed.
- **`names.json`**: `[{ n, en?, x, y, k, r }]`.
  - `k` is `street`, `place` or `poi`.
  - `r` is prominence from 1 (a lane, a chapel) to 10 (a city or an airport).
  - `en` is the English name when OSM has one.

## How the layers are made

**Buildings.** Buildings come from the z15 tiles. Tiles clip features at their edges, but every feature keeps its OSM id. The pieces of a building are clipped exactly to their tile, then joined back along the tile edges into one outline. Floor area works as follows:

- Height is the `height` from the tiles. Where OSM only has `building:levels`, Protomaps has already turned it into levels × 3 + 2 m. Buildings without either get 9 m.
- The footprint (net of courtyards) is multiplied by one storey per full 3 m.
- `building:part` features inside a building replace this estimate for the ground they cover.
- Non-residential buildings over 10,000 m² are counted as at most four storeys, since they are mostly halls, malls and plants.

**Building use.** The tiles carry no building type, so each building takes its use from the landuse under it. A POI inside the footprint overrides that, for example a school, a mall or a hospital.

**Residents.** Population comes from GHSL, spread over the housing floor area of the buildings in each 3 arc-second pixel. A pixel with no housing hands its people to housing within 100 m. GHSL also places people on industrial and open land with no housing nearby. Those people stay in the grid cell where GHSL put them and are not attached to any building, so building residents add up to a little less than the grid total. The run summary prints the difference.

**Jobs.** Jobs spread over floor area weighted by use, from about 1 per 25 m² in offices down to 1 per 1000 m² in housing, plus a fixed number per POI. The total is scaled to `jobsPerResident`.

**Industrial jobs.** These are the floor jobs of industrial buildings (on industrial, railway and airfield land), plus the jobs of industrial POIs: named industrial sites, rail yards, warehouses, sorting offices, breweries, quarries and landfills. Many old factory buildings now hold shops, car dealers and offices. An industrial building with a shop, cafe or office POI inside is taken to be one of them, and its floor jobs don't count as industrial. For Moscow this leaves about 22% of jobs industrial.

**Other attractors.** Education places come from education buildings, school grounds and POIs. Retail comes from shop and service POIs and retail floor area. Leisure comes from culture, sport and food POIs, plus the area of parks, woods and pitches. All the weights are in `weights.ts`.

**Nature.** This is the draw of green land for day outings: parks, woods, nature reserves, meadows, beaches and allotments (dacha plots).
- Each hectare is weighted by kind, with parks and beaches highest and scrub lowest.
- Green land is joined into patches on 50 m blocks, so a road through a forest doesn't split it. Each hectare counts 1 + ln(patch area in ha), so a forest park draws more per hectare than a square. Patches under 2 ha are left out.
- Green land next to a river or lake counts 1.5 times.
- The result is multiplied by 0.5 + d / 15 km, up to 2.5, where d is the distance from `centre`.

**Nightlife.** Bars and nightclubs count most. Pubs, theatres, cinemas and arts centres count less, restaurants less again, and cafes and fast food least. Leisure and civic buildings add a little by floor area.

**Surface.**
- Elevation is bilinear from Terrarium tiles at z12.
- Water and landuse are rasterised at 10 m.
- Built cover is exact footprint area per cell.

**Names.**
- Streets are sampled every 150 m along named roads.
- Places are towns, districts and neighbourhoods.
- POIs are landmarks the basemap shows by zoom 15 or 16.
- Rail and metro stations are left out, so a new game doesn't hint at the real network. Landmarks that share a station's name are also dropped within 300 m of that station.

## Data sources and licences

| Data | Source | Licence |
| --- | --- | --- |
| Basemap, buildings, landuse, POIs, names | [Protomaps](https://protomaps.com) daily builds of [OpenStreetMap](https://www.openstreetmap.org) (`build.protomaps.com`) | © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/) |
| Population | GHSL GHS-POP R2023A, epoch 2025, WGS84 3 arc-second tiles, from the JRC open data FTP | © European Union, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Elevation | [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) (Terrarium encoding) | Various open sources, see the [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |

The pack's `city.json` carries the attribution strings the game shows on the map. Packs are built, not committed: `public/cities/` is gitignored.
