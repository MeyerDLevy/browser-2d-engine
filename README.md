# iso engine

In-browser 2D isometric multiplayer. Shared sim on client + server, authoritative WebSocket rooms (2–8 players).

## run

```
npm install
npm run dev
```

Open http://localhost:8080 — pick a name, join or create a room. Share the URL (`?lobby=...`) as a direct link.

## controls

wasd move · e pickup · g drop · space attack · f enter/exit car · scroll zoom

Browser console: `window.G` (`live`, `cam`, `world`, `keys`).

Map size is `MAP_SIZE` in `shared/world.ts`.

## deploy

`npm start` is the production entry (Railway uses it; listens on `PORT`). One Node process serves the page, assets, and WebSockets.

Live: https://browser-2d-engine-production.up.railway.app

## art

Hero sprites: Clint Bellanger / Flare, CC-BY-SA 3.0.
