# EasyVideo

> Streaming live broadcast and video app. P2P / BT / SERVER transports, fully self-contained, single-file EXE.

[简体中文](README.md) · [English](README.en.md)

---

## What it is

EasyVideo puts "start a live stream" and "publish a video" into one local app: double-click the EXE, open `http://localhost:13750/` in a browser, and everything stays in the `data/` directory.

The HTTP kernel, WebSocket framing, router, segment distribution and transcode bridge are written from scratch with no third-party runtime. ffmpeg, aria2, 7-Zip, Node and zstd ship as "components" under `program/`, so the app needs no network at runtime.

## Features

### Live

- Three transports over one shared segment store:
  - `SERVER`: the host serves every segment over HTTP. Lowest CPU, needs a fat uplink.
  - `P2P`: one-to-many. The host pushes every segment to every viewer.
  - `BT`: whoever holds a segment serves it. The host only seeds; more viewers means faster.
- **Separate broadcaster and viewer UIs**: the host sees start/stop, standby settings, publish state, viewer count and swarm coverage; viewers get the player and chat.
- **Configurable off-air state**: black screen, or loop a standby video.
- Segment push: the host POSTs encoded segments, viewers GET them on demand. 8 MiB per segment, the newest 900 kept per stream.
- Private rooms (friends-only / self-only), viewer limits, replay recording, floating danmaku window.

### Video

- Multi-part collections, drafts, and three sources: local upload, cloud link, local path.
- Uploads stream straight to disk, so **they are not capped by the 2 GiB in-memory buffer**, with a progress bar in the UI.
- Quality ladder 360P / 480P / 720P / 1080P / 2K / 4K; encoder choice of H.264 / H.265 / H.266 / AV1 / AMF / NVENC / software.
- Player: highlight bar, picture-in-picture, theater mode, speed, subtitles, volume 0-200%, keyboard shortcuts.

### Recommendations and social

- Two small 64M-parameter rankers (one for live, one for video) that learn online from searches. Neither is visible in the UI.
- Tag-weight recommendation: weights accumulate per visited tag, decay, then a roulette-wheel draw. Cards load live.
- Likes, favourites, shares, comments; comments can be liked and deleted.

### UI

- Left icon rail plus topbar with eight entries: Live, Video, History, Watch Later, Favourites, Friends, Profile, Settings.
- **Themes**: five built in (OBS dark, cinema, Bilibili pink, paper light, high contrast) with four colour pickers.
- **Theme packages**: a `.zst` tar with `package.json`, `settings.json`, `background/` and `maincolor/`.

### Engineering

- Plugin host: `.zst` / `.evp` packages with a built-in ZSTD parser; plugins add routes, panels and event hooks.
- Self-contained components: ffmpeg, aria2, 7-Zip, Node and zstd live in `program/`; no PATH dependency.
- Single-file EXE (Node SEA, 89 MiB). Double-click and go.
- Installer: pick a language, unpack to cache, install; later runs offer reinstall / repair / uninstall.

## Getting started

### From the installer

1. Download `EasyVideo-v1.0.0pre1-Setup.exe` from Releases.
2. Run it and pick a language (Simplified Chinese, Traditional Chinese, English, Japanese, Korean, German, French, Russian, Spanish, Portuguese).
3. The installer unpacks into `%TEMP%/EasyVideo/cache/payload` and installs from that cache.
4. Choose what you want: Start Menu shortcuts, a desktop shortcut, register `ev` on PATH, launch when done.
5. Double-click the icon; your browser opens `http://localhost:13750/`.

Running the same installer again first asks whether you want to **reinstall**, **repair** or **uninstall**. Every file SHA-256 is written to `HKCU/Software/EasyVideo/Files` at install time, and repair restores against it.

### From source

Node.js 22 or newer is required (developed on 24.19.0).

    npm install     # build-time deps: esbuild / sharp / postject / rcedit
    npm start       # dev server on http://127.0.0.1:13750/

### Building your own installer

    node tools/fetch-components.mjs   # fetch ffmpeg / aria2 / 7-Zip / Node / zstd into program/
    node build.mjs                    # produce dist/EasyVideo.exe
    node tools/package.mjs            # produce app/EasyVideo.exe and installer/*-Setup.exe

## Command line

| Flag | Effect |
| --- | --- |
| `-b` | Start in the background, do not open a browser |
| `-br` | Start in the background and open the UI a moment later (1500 ms by default, tune with `--open-delay=ms`) |
| `-nob` | Start without opening a browser |

The `ev://` protocol is registered automatically at startup:

| Link | Opens |
| --- | --- |
| `ev://live/<nickname>/<PID>` | A live room |
| `ev://video/<nickname>/<PID>` | A video |
| `ev://live/search/<base64>` | A search |

If you ticked the PATH option during install, typing `ev` in a terminal starts the app.

## Layout

    EasyVideo/
      app/EasyVideo.exe            single-file executable
      app/README.txt  app/version.json
      data/                        database, media, recordings, backup, recycle, settings.json
      log/                         rolling logs
      program/                     bundled components
        ffmpeg/  aria2/  7zip/  node/  zstd/
        plugins/                   plugin packages (.evp / .zst)
      sourcecode/                  source snapshot
      installer/                   NSIS script and output
      src/server/  src/web/        source

Volatile cache lives in `%TEMP%/EasyVideo/`, the recycle bin in `%TEMP%/recyle.bin/EasyVideo/` and backups in `%TEMP%/backup/EasyVideo/`.

## Transports

| Mode | How data moves | When to use it |
| --- | --- | --- |
| `SERVER` | The host sends every segment over HTTP to all viewers | Fat uplink, lowest latency |
| `P2P` | The host pushes every segment to every viewer | Few viewers, minimal server |
| `BT` | The host only seeds; viewers holding segments relay them | Many viewers: the more, the faster |

All three share one segment store: the host POSTs `/api/transport/segment/:streamId/:index`, viewers GET the same path, and `/api/transport/segments/:streamId` lists what exists.

## Themes

Settings → Interface theme: switch themes, tune four main colours, install theme packages.

A theme package is a `.zst`-compressed tar:

    /
      package.json       name / version / introduction / releases
      settings.json      background_next_sec, maincolor, ...
      background/        background images, any number, rotated on a timer
      maincolor/         solid colour swatches, 64x64

A colour swatch can also be named `#RRGGBB.png` inside `maincolor/` and it is picked up automatically.

## Plugins

Plugins live in `program/plugins/` in two shapes:

- `<name>.evp`: a single `zstd(JSON)` package, active after a restart;
- `<name>/plugin.json + main.js`: a loose directory.

A plugin reaches the server only through the injected `api` object:

    api.get('/hello', function (ctx, req, res) { res.json({ ok: true }); });
    api.panel({ id: 'hello', title: 'Hello', icon: 'sparkles' });
    api.on('video.publish', function (payload) { /* ... */ });

Source runs inside a `(api, module, exports, console)` scope.

## HTTP surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Uptime, memory, peers, streams |
| `GET /api/components` | Bundled component inventory |
| `GET /api/themes` | Theme list and current theme |
| `GET /api/themes/css` | CSS for the current theme |
| `POST /api/themes/install` | Install a theme package |
| `POST /api/live` | Create a live room |
| `POST /api/live/:id/start` | Host goes live |
| `POST /api/live/:id/standby` | Off-air screen: black or standby video |
| `POST /api/live/:id/end` | End the stream (idempotent) |
| `DELETE /api/live/:id` | Delete a live room |
| `POST /api/live/:id/join` | Viewer joins |
| `POST /api/transport/segment/:streamId/:index` | Host pushes one segment |
| `GET /api/transport/segment/:streamId/:index` | Viewer pulls one segment |
| `GET /api/transport/segments/:streamId` | List available segments |
| `POST /api/upload` | Streaming upload, arbitrarily large files |
| `GET /api/recommend` | Tag-weight recommendations |

## Troubleshooting

| `POST /api/transport/segment/:streamId/:index` | Host pushes one segment |
| `GET /api/transport/segment/:streamId/:index` | Viewer pulls one segment |
| `GET /api/transport/segments/:streamId` | List available segments |
| `POST /api/upload` | Streaming upload, arbitrarily large files |
| `GET /api/recommend` | Tag-weight recommendations |

## Troubleshooting

**Port already in use?** The default is `13750`. Set `EV_PORT` or edit `data/settings.json`.

**Transcoding unavailable?** Check Settings → Bundled components; run `node tools/fetch-components.mjs` to fill in anything missing.

**Tray icon missing?** The tray uses PowerShell WinForms and the generated script carries a UTF-8 BOM. If you hand-edited `%TEMP%/EasyVideo/runtime/tray.ps1` and dropped the BOM, PowerShell 5.1 decodes it as ANSI and reports a wall of syntax errors.

**Only one instance?** Yes, locked via `data/easyvideo.lock`. A lock left behind by a killed process is checked against its PID and taken over if that process is gone.

**Large uploads failing?** They now stream to disk and are no longer limited by the 2 GiB single-Buffer ceiling. If you still see `length is out of range`, you are running an old build.

## License

This project is released under the [MIT License](LICENSE).

Icon glyphs come from [lucide](https://lucide.dev/) (ISC); see `assets/icons/LICENSE`.

Bundled components keep their upstream licences: FFmpeg (LGPL/GPL), aria2 (GPL-2.0), 7-Zip (LGPL), Node.js (MIT), Zstandard (BSD-3).

