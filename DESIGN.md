# MakeMetro design

This is the working design for the first versions. When something here changes, update this file in the same commit.

## Goals

A realistic metro builder for real cities, with numbers that hold up and a map that stays easy to read. Two problems from other games in the genre shape the priorities:

- **Cities.** The game has to work for any city on the planet, not a curated list. Everything comes from open data: OpenStreetMap, the GHSL population grid and open elevation tiles.
- **Performance.** A city the size of Moscow should pan at 60 fps on a five-year-old laptop with integrated graphics and load in under 15 seconds. The simulation runs in a worker and never stalls the camera.

The game should feel real but readable: real data underneath, presented so you don't need a transport degree to play.

Moscow (the city plus the first ring of suburbs, about 15M people) is the reference city we build and test against.

## Modes

- Sandbox comes first. Scenarios with goals come later.
- Every game starts from an empty city. There is no existing metro and no reference layer of the real one.
- Sandbox toggles: unlimited money, instant construction.
- Success is not one score. We show ridership, cost recovery and travel time saved side by side.

## Map and data

- **Units** are metric or imperial, set in options. The scale is always real.
- **Basemap:** vector tiles in a single PMTiles file per city, bundled so the game works offline. The style is muted and minimal, with light and dark themes. Buildings are extruded at their OSM heights in quiet colours.
- **Homes:** the GHSL population grid, spread over residential floor area.
- **Jobs and other destinations:** estimated from OSM land use, building floor area and POIs. That covers jobs, schools and universities, shops and errands, and leisure.
- **Terrain:** real elevation and real rivers. Tunnels have to go deeper under water, and surface track needs a bridge to cross it.
- **Ground conditions:** none. Cost depends on depth and construction type only.
- **Getting cities:** a few pre-built city packs, plus an in-game generator. You draw a box, the game downloads the data once, and that city plays offline from then on.
- **No growth:** the city stays as it is. Demolition is the only thing that changes it.

## Building

The core loop is: place stations, connect them with track, then place a depot and connect it to the line.

- **Stations** go anywhere. You pick the type when placing one (deep, shallow, elevated or surface) along with its depth or height. A turn handle points the platform, or Q and E turn it. Planned stations can be dragged to move them.
- **Connecting:** the Connect tool chains stations: click A, then B, then C, and Esc ends the chain. The construction type chosen in the tool stays selected between connections. A station that hasn't been turned by hand lines itself up with its connections.
- **Track shape:** track leaves each platform straight and eases into smooth curves in between, like real lines. Drag planned track anywhere to bend it; right-click a bend point to remove it. Platforms are always straight.
- **Free track:** a secondary tool for track that ends anywhere, such as sidings and tail tracks. Clicking existing track makes a junction.
- **Limits:** each train type has a minimum curve radius, and tighter curves lower the line speed. No track may curve tighter than 100 m. The maximum gradient is about 4%.
- **Construction types:** bored tunnel, cut-and-cover, elevated and at-grade. Each has its own cost per km, and depth adds to the cost.
- **Track count:** double by default. Single track is cheaper but limits capacity. Quad track allows express services.
- **Cut-and-cover** follows streets. Crossing a block means demolishing it.
- **Demolition** is required whenever track or a trench hits a building, or a tunnel passes through a foundation. Foundation depth is estimated from building height and shown on hover. Demolishing costs compensation and removes the building's residents and jobs from the map.
- **Bored tunnels** need a tunnel boring machine. You own a few, and each digs at a set pace, so you have to choose what gets built first.
- **Construction time:** everything takes game time unless the sandbox instant-build toggle is on. The pace is far quicker than real life so a line opens within weeks: a boring machine digs 125 m a day, and a deep station takes 30 days.
- **Planning mode:** blueprints can be drawn without paying. Undo and redo work everywhere.
- **Stations:**
  - You set the platform length and pick an island or side layout. The layout affects width, cost and walking time.
  - Deeper stations take longer to reach from the street. Track between stations at different levels ramps between them.
  - Entrances are placed automatically, and you can drag them. They set where walking starts.
  - Names come from the nearest street or landmark, and you can edit them.
  - Stations within a set distance of each other link automatically as transfers. Walking time depends on the distance.
- **Depots** are yards placed like stations, with a turn handle; their track leaves from the front end. Every route needs a built depot connected to its track.
- **Junctions** are kept simple: trains can't reverse at a junction or an intermediate station.

## Trains and service

- **Train types:** three or four generic types that differ in capacity, top speed, acceleration, curve limits and cost. You choose how many cars a train has, up to the shortest platform on its route.
- **Physics:** trains accelerate, brake, and slow for curves and gradients.
- **Dwell time** depends on how many people board and alight.
- **Depots** store trains overnight and dispatch them. Depot size limits fleet size.
- **Services are separate from track.** A route is a service that runs over track, so express, skip-stop and branching services all work.
- **Schedules:** a network-wide set of named periods with editable times, for example Early 05:30, Morning peak 07:00, Midday 10:00, Evening peak 16:00, Evening 19:30 and Late 22:00. Each route sets its headway for each period, with separate values for weekdays and weekends.
- **Operating hours** are set separately for weekdays and weekends. The defaults are 05:30 to 01:00 on weekdays and 06:00 to 02:00 at weekends; a closing time after midnight runs into the next morning. Running 24/7 costs more.
- **Signalling:** one level, which caps the number of trains per hour on a track.
- **Breakdowns:** none.
- **Crowding:** full trains leave people on the platform.

## People

- **Simulation method:** demand is computed as flows between zones. People walking to and from station entrances are shown on the map when you zoom in.
- **Time:** a 24-hour day cycle. Weekdays, Saturdays and Sundays each have their own patterns, and the month matters too.
- **Districts:** every part of the city is classed as sleeper district, business district, industrial zone, city centre or parks and forest, from who lives and works there. A Districts overlay shows them.
- **Trip purposes:**
  - **Office and service work:** people from all residential areas, including the centre, commute to offices, often a long way. Hardly anyone commutes from an industrial zone to an office.
  - **Factory work:** factories fill from sleeper districts, mostly nearby, in shifts: an early start around 6 to 7, an afternoon shift change and a few night workers.
  - **School and university**, and **shopping and errands**, mostly on weekdays and Saturdays.
  - **Outings:** on Sundays, and partly Saturdays, people head out to the parks and forests towards the edge of the city by day. Summer sends far more people out than winter.
  - **Nights out:** Saturday and Sunday evenings bring people into the centre for clubs, bars and theatres, and they head home after midnight. Winter keeps a few more people in town.
- **Round trips:** a trip only happens by metro if the way back does too. If the metro is closed when people would come home, they don't go out by metro at all, so late weekend trains pay off.
- **Out-of-map commuters:** people who live outside the map are ignored.
- **Who rides:** someone can take the metro if there is a station within walking range at both ends. The walking range can be set per city, and willingness to walk tapers off with distance. Whether they do depends on mode choice, below.
- **Transfers** cost walking and waiting time.
- **Satisfaction** is a percentage. Crowding, long waits and slow trips lower it, and fewer of the possible riders use the route. At least about 30% keep riding however bad the service gets.
- **Mode choice:** each trip picks between the metro, walking the whole way and "other ways", which stand in for cars, buses and trams without modelling them. The metro's side counts walking to and from the stations, waiting, riding, transfers and the fare, which is worth about three minutes per dollar. Doubling the fare loses about a fifth of riders, more on short trips.
- **Pull of the metro:** places that are easy to reach by metro draw more trips, at the expense of places that are not, so a good network grows its own ridership. The number of trips people make stays the same.

## Money

- **Currency and costs:** one game currency and one global cost table, kept in data files so mods can change them.
- **What pays:** fares on a busy line cover its running costs and make a profit. Building and new trains need the city budget and loans.
- **City budget:** paid each 1 January. It starts from the city's usual budget and adds up to half again for a profitable year with satisfied riders; it does not compound from year to year.
- **Loans** are available, with interest charged as you go.
- **Fares:**
  - A network fare, flat by default, with distance and zone fares as options. Zones are rings around the city centre.
  - Lines on the network fare share one ticket, so transfers between them are free. A line can charge its own fare instead, and everyone who boards it pays that fare.
  - Changing a fare shows a forecast of riders and fare income first, and applies when you confirm.
  - Riders mind dear fares a little: a big rise lowers the satisfaction that sets next year's budget, and a cut helps a little.
- **Running costs:** train hours, car hours, track maintenance and station maintenance, charged by the hour.
- **Economy panel:** a side panel that stays open while you play. It shows money, fares and costs for today, yesterday and the last 30 days, the fare settings, charts of money, profit and riders, the budget and loans. The bottom bar shows today's operating profit and fare income per hour.
- **Running out of money** ends the game when money is enabled.

## Time and saves

- **Calendar:** real dates, with weekdays and weekends.
- **Speeds:** pause plus three speeds: a minute, ten minutes and a whole day per second.
- **Saves** are compressed JSON. The game autosaves every game week and on exit, and keeps a few rotating autosaves.

## Look and feel

- **Overall:** balanced and minimal, so the map stays the focus. Data overlays work like those in city builders.
- **Map:**
  - The city reads through value, light and ground detail, not colour. The player's lines stay the only saturated thing on the map.
  - Buildings sit a shade darker than the ground and lighten slightly with height. One sun from the south-south-west lights the buildings, trees and trains, and casts ground shadows that fade from the wall outward, with a soft contact band at each building's base.
  - Landuse covers civic grounds, hospitals, cemeteries, pitches, squares and the rest, not only parks. Roads follow a real hierarchy and widen with the zoom, and footpaths are separate from streets.
  - Hill shading picks out the river valleys and fades at street zooms, where the terrain data is too coarse to help. The horizon is hazy when tilted, and trees grow in parks, woods and on lawns.
- **Overlays:** population and jobs, passenger flows, crowding, and a travel-time map from any point.
- **Charts:** riders per hour, load and revenue for each line and station over the day.
- **Alerts:** a quiet log. Only things that need action pop up.
- **Camera:**
  - The view is fully 3D and the camera tilts.
  - An x-ray toggle fades the ground and buildings so tunnels and stations show at their real depth.
  - Trains are simple car models in their line colour.
- **Line colours:** you pick them when you create a line.
- **Line names:** each line has a number and a name. New lines are named in the Moscow way after a place they serve, such as Сокольническая or Кольцевая, and the name follows the stops until you type your own. Other naming styles can come with other cities.

## Controls and accessibility

- Mouse and keyboard, with shortcuts for everything. Gamepad support too.
- Colour-blind line palettes, UI scaling, rebindable keys and a reduced-motion setting.
- A short guided first line serves as the tutorial, added once the core is solid.
- The game is in English. All text lives in string files so translations can be dropped in.
- Sound: UI sounds and ambience come later.

## Tech

- **Language and rendering:** TypeScript. MapLibre draws the map, and three.js draws track, tunnels and trains in the same WebGL context.
- **Simulation:** runs in a Web Worker and talks to the UI through messages.
- **Builds:** Tauri for the desktop build. The same code runs in a browser.
- **City packs:** a folder with a basemap PMTiles file, a JSON manifest and binary data grids (see `tools/citygen`).
- **Mods** can add city packs, train types and costs, scripts and UI themes. Script mods are not sandboxed, so install only mods you trust.

## Distribution

- GitHub releases, itch.io and a web version.
- Co-op multiplayer is a later idea, not planned for v1.
- **License:** GPL-3.0 for the code. Map data is © OpenStreetMap contributors (ODbL). Population data comes from GHSL (European Commission, JRC, CC BY 4.0). Elevation comes from the Terrain Tiles on AWS (Mapzen and their sources). The game shows the required attribution on the map.

## Status

Milestone 1 is playable in a browser on Moscow. Done so far:

- **Map and data:** the whole city is saved to the computer in the background on the first visit, then loads from disk; hill shading, building shadows and trees; light and dark themes, a tilting 3D camera with extruded buildings, x-ray view of tunnels, and population, jobs, districts, flows, crowding and travel-time overlays.
- **Building:**
  - Stations placed on their own and turned with a handle; chained connections with straight platforms and smooth curves; bending by dragging; free track and junctions; depot yards linked by track.
  - The four construction types, depth and height, and single, double or quad track.
  - Gradient, curve, water, overlap and same-level crossing checks.
  - Demolition by corridor, platform footprint, depot yard and foundation depth.
  - Boring machines, construction time and planning mode with undo.
- **Stations and routes:** platform length and layout, auto names for stations and lines, line numbers, draggable entrances, train types and car counts, and per-period weekday and weekend headways.
- **Operations:** track capacity limits, including single track; trains running on physics-based timings with load-dependent dwell, stopping centred on their platforms.
- **People:** districts; office and factory commutes with shifts; school, shopping, outings and nights out by day of week and month; returns after midnight; routing with transfers; mode choice against walking and other ways; the pull of the metro; crowding and people left behind; satisfaction with its 30% floor.
- **Money:** the economy panel; network fares (flat, distance and zones) with per-line fares and a forecast; city budget, loans, running costs and game over.
- **Saves:** compressed JSON in the browser, rotating autosaves, and file export and import.
- **Controls:** keyboard shortcuts you can rebind, basic gamepad, UI scaling, reduced motion and colour-blind line colours.

Not done yet:

- Following an individual passenger through their whole trip
- How platform layout affects transfer walking; express overtaking on quad track
- The in-game city generator (city packs come from `npm run city` for now)
- Loading mods and themes from files; a scripting API
- String files for translation (UI text is still inline)
- The Tauri desktop build
- Tutorial, sound

Balance notes: a lone line only serves trips with both ends in walking range of its stations. Real Moscow lines are also fed by buses and trams from further out, so trip rates are doubled to make up for it. With that, a lone central line carries about 100 to 150 thousand people a weekday and a nine-line network nearly 5 million, and at a $2 fare a busy central line takes in nearly four times its running costs and upkeep. Crossing lines feed each other and earn much more. Ridership grows much faster than linearly as the network grows. Outings to nature are tapered beyond about 20 km from the centre, because the forests at the edge of the map otherwise outweigh the city's own parks. We should tune all of this once there are a few lines to compare.
