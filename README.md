# Firtnite

A Fortnite-style battle royale that runs in the browser. Ride the battle bus, skydive onto a low-poly island, loot chests, harvest materials, build walls and ramps, and outlast a lobby of bots while the storm closes in.

Built with [three.js](https://threejs.org/) (vendored in `vendor/`). There's no build step and no dependencies to install.

## Play

ES modules don't load from `file://`, so serve the folder over HTTP:

```bash
npm start
```

Then open <http://localhost:8080>. Any static server works too, for example `python3 -m http.server 8080`.

## Controls

| Keyboard / mouse | Action |
| --- | --- |
| WASD | Move |
| Shift | Sprint |
| Space | Jump · drop from the bus · open the glider |
| Mouse | Look · left click fires · right click aims |
| 1 – 6, mouse wheel | Pickaxe and inventory slots |
| R | Reload |
| E | Open chest / pick up loot |
| Q | Toggle build mode |
| Z / X / C / V | Wall / floor / ramp / roof |
| Left click (hold) | Place pieces in build mode |
| Right click or G | Switch wood / stone / metal |
| F | Pickaxe |
| M | Map |
| Esc | Pause |

On phones and tablets, the left thumb moves, dragging on the right side looks around, and on-screen buttons handle everything else. Play in landscape.

## What's in a match

- **Battle bus**: flies across the island. Jump whenever you like and steer your skydive and glider.
- **Loot**: chests and floor loot in five rarities (Common → Legendary): assault rifle, SMG, pump shotgun, pistol, bolt sniper and rocket launcher, plus bandages, med kits, small shields and shield potions.
- **Harvesting and building**: pickaxe trees, rocks, containers and houses for wood, stone and metal. Build walls, floors, ramps and roofs on a grid. Pieces take time to reach full health, and anything left unsupported collapses.
- **Storm**: six shrinking circles, with damage that grows each phase.
- **Bots**: they loot, rotate with the storm, strafe, panic-build when shot, and break through walls that block them. The difficulty setting controls their aim and damage.
- **HUD**: health and shield, materials, hotbar, minimap and full map, kill feed, damage numbers, hit markers, damage-direction indicators and a spectate mode after you're eliminated.

## Project layout

```
index.html          page, HUD and menus
css/style.css       all UI styling
js/config.js        tuning: weapons, loot tables, storm phases, physics
js/main.js          boot, menu, pause and end screens, main loop
js/game.js          match orchestration, damage and eliminations
js/terrain.js       island heightmap, mesh and minimap image
js/world.js         towns, houses, trees, rocks, sky and water
js/structures.js    build pieces, placement grid and structural collapse
js/collision.js     spatial hash, character movement and ray casts
js/character.js     shared player/bot body, inventory and animation
js/player.js        player input, camera and building controls
js/bot.js           bot AI
js/combat.js        guns, pickaxe, rockets and healing
js/items.js         chests, pickups and loot rolls
js/storm.js         storm circle logic and wall shader
js/bus.js           battle bus
js/hud.js           HUD, minimap and big map
js/effects.js       tracers, particles and explosions
js/audio.js         synthesized sound effects (no audio files)
js/input.js         keyboard, mouse, pointer lock and touch controls
tools/serve.mjs     zero-dependency static server used by `npm start`
```

Most balance changes live in `js/config.js`.

For debugging, the browser console exposes `firtnite.game`, the running match.
