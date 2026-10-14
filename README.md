# cartridge-games

Hosted builds of Cartridge original games (Godot web exports), served by GitHub Pages.

- `<slug>/` — playable web build (`index.html`)
- `packages/<slug>.zip` — the downloadable package the Cartridge app installs
- `index.json` — catalog of all games (version, sha256, URLs)

Source code lives in a separate private repo. Builds are published with
`tools/publish_game.py`. Games: © Cartridge Studio, all rights reserved.
Engine: Godot (MIT) — see `GODOT_LICENSE.txt` / `GODOT_COPYRIGHT.txt` in each build.
