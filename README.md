# Music Discord Bot

A self-hosted Discord music bot that plays **Apple Music, Spotify and YouTube** playlists, albums and songs in voice channels.

Apple Music audio is DRM-protected, so the bot never streams from Apple. It works like this:

1. [Lavalink](https://github.com/lavalink-devs/Lavalink) **v4** with the [LavaSrc](https://github.com/topi314/LavaSrc) plugin reads the Apple Music or Spotify link and gets each track's metadata (title, artist, duration, ISRC). YouTube links play directly.
2. Just before a track plays (the next one is matched in advance), the bot's own matcher picks a YouTube copy. See [Track matching](#track-matching).
3. If nothing scores well enough, LavaSrc's built-in chain gets a try:
   `Deezer ISRC → YouTube Music ISRC → YouTube ISRC → YouTube Music search → YouTube search`
4. The official [youtube-plugin](https://github.com/lavalink-devs/youtube-source) does the YouTube playback. Lavalink's built-in YouTube source is disabled.

| Component | Version |
|---|---|
| Lavalink | 4.2.2 |
| LavaSrc plugin | 4.8.3 |
| youtube-plugin | snapshot `2be8e54` (2026-09-17). 1.18.2 can't play most videos since YouTube's August 2026 changes. |
| yt-cipher | `ghcr.io/kikkia/yt-cipher`, pinned by digest |
| discord.js | 14.28.1 |
| lavalink-client | 2.11.0 |
| Node.js | ≥ 22 (Docker image uses 24.22.2, Debian slim) |
| fuzzball / better-sqlite3 / @huggingface/transformers | 2.2.6 / 13.0.3 / 4.3.2 |

**Why lavalink-client rather than Shoukaku?** lavalink-client comes with a queue, loop modes, shuffle, typed LavaSrc plugin data and node reconnect handling. Shoukaku is a thin wrapper, so you would have to write and maintain the queue yourself.

---

## Commands

**Now-playing buttons.** Every track posts a "Now playing" message with labelled controls, updated in place (labels show the current state, e.g. "Resume" while paused, "Loop: queue"). Only people in the bot's voice channel can use them, except 📜.

| Button | What it does |
|---|---|
| ⏮️ | Previous song |
| ⏯️ | Pause / resume |
| ⏭️ | Skip |
| ⏹️ | Stop and leave |
| 📜 | Show or hide the queue inside the Now playing message, with ◀️ ▶️ pages and a song menu |
| 🔀 | Shuffle |
| 🔁 | Loop: off → queue → track |
| 🔉 / 🔊 | Volume −10 / +10 |
| ♾️ | Autoplay |

| Command | What it does |
|---|---|
| `/play <query>` | Apple Music, Spotify or YouTube / YouTube Music link (playlist, album, track), or a song name. While you type a name, matching songs appear as suggestions: pick one to add exactly that song. If something is already playing, a single song asks **▶️ Play now / ⏭️ Play next / ➕ Add to queue**. Playlists queue every track. |
| `/playnext <query>` | Same as `/play` (with suggestions), but adds to the front of the queue without asking |
| `/songrequest <song>` | Request a song: it goes to the **end** of the queue and nothing else changes (no skipping or reordering). Works without being in the voice channel. Up to 3 requests per person can wait at once. |
| `/search <query> [source]` | Pick from the top 10 results (YouTube Music, YouTube, Apple Music or Spotify), then choose play now / next / add to queue |
| `/pause` `/resume` `/skip` | Playback control |
| `/previous` | Go back to the previous song. Press again to keep going back; ⏭️ goes forward again. (`/replay` restarts the current song.) |
| `/stop` | Clear the queue and leave |
| `/seek <time>` | Jump to a time: `1:30`, `90`, `1m30s` |
| `/forward [s]` `/rewind [s]` | Skip ahead or back (default 10 s) |
| `/replay` | Restart the current track |
| `/queue [page]` | The queue, 10 songs per page. Use ◀️ ▶️ (or ⏮️ ⏭️ for the first/last page) to see the rest, and the menu to pick a song (asks ▶️ Play now or ⏭️ Play next). The 📜 button shows the same list inside the Now playing message. |
| `/playqueue <song>` | Play a queued song right now. Type part of the title and pick it from the list. The songs before it stay in the queue. |
| `/history [song]` | The last 50 songs played, with a menu to play one again (now, next, or at the end of the queue) |
| `/nowplaying` | Current track with a progress bar and the control buttons |
| `/jump <position>` | Skip to a queued song and **remove** the songs before it (pick from the list like `/playqueue`) |
| `/move <from> <to>` | Reorder the queue |
| `/remove <position>` | Remove a track from the queue |
| `/shuffle` | Shuffle upcoming tracks |
| `/loop <mode>` | Loop mode: off, track or queue |
| `/clear` | Clear upcoming tracks (the current one keeps playing) |
| `/volume [0-150]` | Show or set the volume (above 100 can distort) |
| `/quality` | Check volume, filter and source of the current song |
| `/filter <preset>` | Bass boost, nightcore, vaporwave, 8D, karaoke, soft, tremolo, vibrato, EQ presets, speed. `/filter off` clears it. |
| `/autoplay` | When the queue runs out, keep playing similar songs (from YouTube's mix for the last track) |
| `/247` | Stay in the voice channel even when idle or alone |
| `/wrong` | Wrong song? Skips it, never uses that YouTube video for this song again, and plays the next-best match |
| `/lyrics [song]` | Lyrics for the current song (or any song), from [LRCLIB](https://lrclib.net) |
| `/grab` | DM yourself the current song's links |
| `/leave` | Leave the voice channel |
| `/help` | List all commands |

**Behaviour:**
- **Voice channel:** you must be in a voice channel. If the bot is already playing in a different channel in the same server, it politely refuses.
- **Auto-leave:** the bot leaves after **3 minutes** with an empty queue, or 3 minutes after everyone leaves its channel (unless `/247` is on).
- **Unmatched songs:** songs that can't be matched are skipped. When the queue ends, the bot posts a summary such as *"3 tracks couldn't be found"*.
- **Lavalink drops:** the bot reconnects automatically. A short drop keeps the session alive. If Lavalink restarts, the current track resumes from where it was.
- **Private links:** `music.apple.com/library/...` links are personal-library links nobody else can read, so the bot explains how to share the playlist publicly.

---

## Setup

### 1. Requirements
- **Docker** (Docker Desktop on Windows/macOS) with Compose v2
- **Node.js 22+**, only if you want to run the bot outside Docker
- A Discord server where you can add bots

### 2. Create the Discord application
1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **General Information** → copy the **Application ID**. This is `CLIENT_ID`.
3. **Bot** → **Reset Token** → copy it. This is `DISCORD_TOKEN`. Never share or commit it.
   No privileged intents are needed (the bot only uses `Guilds` and `GuildVoiceStates`).
4. **OAuth2 → URL Generator**: tick scopes `bot` and `applications.commands`. Under Bot Permissions tick
   `View Channels`, `Send Messages`, `Embed Links`, `Connect`, `Speak`. Open the generated URL and invite the bot.
5. In Discord: **User Settings → Advanced → Developer Mode** on. Then right-click your server → **Copy Server ID**. This is `GUILD_ID`.

### 3. Configure `.env`
```bash
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
```

| Variable | How to get it |
|---|---|
| `DISCORD_TOKEN` | Developer Portal → Bot → Reset Token |
| `CLIENT_ID` | Developer Portal → General Information → Application ID |
| `GUILD_ID` | Right-click your server → Copy Server ID (Developer Mode on) |
| `LAVALINK_HOST` | `localhost` when running the bot with npm. Docker Compose overrides it to `lavalink` for the bot container. |
| `LAVALINK_PORT` | `2333` unless that port is taken |
| `LAVALINK_PASSWORD` | Any long random string. Lavalink and the bot both read it from `.env`. Generate one with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `APPLE_MUSIC_MEDIA_API_TOKEN` | **Optional.** Leave empty and LavaSrc scrapes a token from music.apple.com automatically. To set one manually, see [Token issues](#apple-music-token-issues). |
| `APPLE_MUSIC_COUNTRY_CODE` | Apple Music storefront, e.g. `in`, `us`, `gb`. Default `in`. Playlists must be available in this storefront. |
| `DEEZER_ENABLED` / `DEEZER_MASTER_DECRYPTION_KEY` / `DEEZER_ARL` | Optional. See [Deezer](#deezer-the-first-resolver). Keep `DEEZER_ENABLED=false` if unsure. |
| `YOUTUBE_OAUTH_*` | Optional. Only needed if YouTube blocks your server ([see below](#youtube-blocking--sign-in-to-confirm-youre-not-a-bot)). |
| `LOG_LEVEL` | `info` (default), `debug` for more detail |
| `DEFAULT_VOLUME` | Starting volume, 0–150 (default 100) |

`lavalink/application.yml` holds no secrets. It reads every value above from the environment using `${VAR:default}`.

---

## Running

### Option A: everything in Docker (recommended)
```bash
docker compose up -d                                   # builds the bot image, starts yt-cipher + Lavalink + bot
docker compose run --rm --no-deps bot node dist/deploy-commands.js   # register slash commands (once, and after changing commands)
docker compose logs -f                                 # watch logs (Ctrl+C to stop watching)
```
The bot waits for Lavalink's health check before starting. The first Lavalink start downloads the plugins, which takes about 30–60 s. The first bot start downloads the embedding model (~120 MB) into the `bot-data` volume. Matching works meanwhile, just without the rerank.

Update after pulling changes: `docker compose up -d --build`
Stop: `docker compose down`

### Option B: bot on your machine, Lavalink in Docker
```bash
docker compose up -d lavalink   # only Lavalink, published on 127.0.0.1:2333
npm install
npm run deploy-commands         # register slash commands to GUILD_ID
npm run dev                     # tsx watch, restarts on file changes
# or, compiled:
npm run build && npm start
```
Keep `LAVALINK_HOST=localhost` in `.env` for this mode.

### npm scripts
| Script | What it does |
|---|---|
| `npm run dev` | Run from source with auto-reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled bot |
| `npm run deploy-commands` | Register slash commands to your guild (instant) |
| `npm run lint` | ESLint (type-aware) |
| `npm test` | Unit tests for the match scorer and queue/history actions (`node:test`) |
| `npm run typecheck` | Type-check `src/` and `test/` without building |

---

## Track matching

Each Apple Music track (title, artist, album, duration, ISRC) goes through these steps until one succeeds:

1. **Cache:** a previous match for this ISRC or Apple track ID, stored in SQLite (`data/matches.db`).
2. **ISRC:** `dzisrc:<ISRC>` (only when `DEEZER_ENABLED=true`), then `ytmsearch:"<ISRC>"`. YouTube sometimes returns an unrelated video for an unindexed ISRC, so a YouTube ISRC hit must also reach `isrc.minScore` with the scorer below.
3. **Scored search:** `ytmsearch:<main artist> <title>`. The top 8 results are scored by [src/music/matcher.ts](src/music/matcher.ts), and anything below `search.minAcceptScore` is rejected. If nothing passes, it repeats with `ytsearch:`.
   - **Title:** fuzzball `token_set_ratio`. For `Song (From "Film")` titles most of the weight goes to the song name, so another song from the same film doesn't match on the film name.
   - **Artist:** compared with the channel name, or found in the video title (label channels such as T-Series or Sony Music South). There's a bonus for `- Topic` channels.
   - **Duration:** a boost within ±5 s, a penalty beyond 20 s.
   - **Variant penalties:** live, cover, remix, sped up, slowed, nightcore, 8D, karaoke, lyrics, reaction, 8-bit/lo-fi remakes, status edits, jukeboxes and more. A penalty is skipped when the Apple title or album contains the same word, so a live album can still match live videos.
   - **Small bonus** for "Official Audio".
4. **Embedding rerank:** if the top two scores are within `rerank.margin`, every candidate in that margin is reranked by `score + weight × cosine(embedding("<artist> - <title>"), embedding(video title))`. It uses `Xenova/paraphrase-multilingual-MiniLM-L12-v2` on CPU, loaded once at startup. The first run downloads about 120 MB into `data/models`, and rerank is skipped until the model is ready.
5. **Fallback:** the plain Apple track is played and LavaSrc's own provider chain resolves it.

The "Now playing" message shows which YouTube video was picked, how it was found and its score.

**Tuning.** Every weight, threshold and penalty word is in [config/matching.json](config/matching.json). To tune:
- Run with `LOG_LEVEL=debug` to log a score breakdown for every candidate, for example:
  `68.0 = title 33 (0.66) + artist 25 (1) + topic 0 + dur 10 (Δ0.1s) + official 0 :: [Vz8hUW0L3QI] "Kaavaali (From "Jailer")" by Anirudh Ravichander`
- Matches are cached for `cache.maxAgeDays`, so after changing weights delete `data/matches.db` (Docker: `docker compose down -v` also removes the downloaded model), or set `cache.enabled` to `false` while experimenting.
- Run `npm test` after editing. The tests read the same config file, so they catch changes that break the tricky cases.
- In Docker, `config/` is mounted read-only, so edit it on the host and run `docker compose restart bot`.

**`/wrong`** blacklists the current video for that song (stored by ISRC and Apple ID), drops the cached match, re-runs matching without it, and plays the result. Other queued copies of the same song are re-matched too.

---

## Project layout
```
lavalink/application.yml   Lavalink + LavaSrc + youtube-plugin config (env-driven)
config/matching.json       matcher weights, thresholds, penalty words, cache + model settings
test/matcher.test.ts       scorer unit tests (live versions, covers, remakes, Tamil film songs)
data/                      created at runtime: matches.db (SQLite) + models/ (embedding model)
src/
  index.ts                 entry: Discord client, Lavalink manager, event wiring
  config.ts                .env loading + validation
  deploy-commands.ts       guild slash-command registration
  commands/                one file per slash command, registry in index.ts
  events/                  ready, interactionCreate, voiceStateUpdate
  music/
    lavalink.ts            LavalinkManager, node reconnect/resume/restore
    playerEvents.ts        now-playing messages, failure tracking + summary
    idleManager.ts         3-minute auto-leave timers
    resolve.ts             classify input (library link / Apple URL / other URL / search)
    actions.ts             player actions shared by slash commands and buttons
    nowPlaying.ts          now-playing message + control buttons (one live message per server)
    controls.ts            button click handler
    autoplay.ts            /autoplay: queue similar songs when the queue runs out
    trackResolver.ts       Apple → YouTube matching pipeline (cache, ISRC, search, rerank, /wrong)
    matcher.ts             pure scoring functions (unit-tested)
    matchingConfig.ts      loads + validates config/matching.json
    embeddings.ts          sentence-embedding model for the rerank
    matchCache.ts          SQLite match cache + per-song blacklist
    notify.ts              safe "send to the player's text channel" helper
  utils/                   logger, embeds, formatting, voice-channel checks, types
```

---

## Troubleshooting

### Lavalink won't start / the bot logs "Reconnecting to Lavalink…"
- Check `docker compose logs lavalink`. The first start downloads the plugins, so give it a minute.
- **"Unauthorized" / 401:** `LAVALINK_PASSWORD` must be the same for both (it is if both read `.env`). Restart both after changing it.
- **Running the bot locally:** use `LAVALINK_HOST=localhost`, and check the port isn't taken by something else.
- **Linux host, "permission denied" writing plugins/logs:** Lavalink runs as UID 322. Run `sudo chown -R 322:322 lavalink/plugins lavalink/logs`.

### YouTube blocking ("Sign in to confirm you're not a bot", "This video is unavailable", every track fails)
YouTube rate-limits and blocks datacenter/VPS IPs. Symptoms: many songs in a row get skipped. The bot stops after 8 consecutive failures and tells you.
1. Check `docker compose logs lavalink` for `dev.lavalink.youtube` errors.
2. **OAuth (most effective).** Use a *burner* Google account, never your main one:
   - Set `YOUTUBE_OAUTH_ENABLED=true` and `YOUTUBE_OAUTH_SKIP_INIT=false`, then `docker compose up -d lavalink`.
   - The Lavalink log prints a google.com/device URL and a code. Sign in with the burner account.
   - The log then prints a **refresh token**. Put it in `YOUTUBE_OAUTH_REFRESH_TOKEN`, set `YOUTUBE_OAUTH_SKIP_INIT=true`, and restart Lavalink.
   - The `TV` client, which is the one OAuth signs in, is already in the `clients` list in `lavalink/application.yml`.
3. **Remote cipher server.** It's already set up: the `yt-cipher` service in `docker-compose.yml` (password: `YT_CIPHER_PASSWORD`) and the `remoteCipher` block in `application.yml`. If `docker compose logs yt-cipher` shows errors, pull a newer image and update the pinned digest.
4. **"The page needs to be reloaded" on TVHTML5:** youtube-plugin 1.18.2 is affected ([#226](https://github.com/lavalink-devs/youtube-source/issues/226), [#240](https://github.com/lavalink-devs/youtube-source/issues/240)). The config pins a snapshot with the fix. When a release newer than 1.18.2 ships, switch `application.yml` back to it with `snapshot: false`.
5. **Test playback without Discord:** `curl -H "Authorization: <LAVALINK_PASSWORD>" -o test.mp4 http://127.0.0.1:2333/youtube/stream/kJQP7kiw5Fk`. A multi-MB file means YouTube playback works. Test more than one video: some play under every setup.
6. Running from a home connection instead of a VPS also usually avoids blocks.

### Wrong song plays (cover, remix, live version, sped-up edit)
- Use **`/wrong`**. That video is never used for that song again, and the next-best match plays.
- The "Now playing" footer shows the YouTube video, how it was found and its score. Run with `LOG_LEVEL=debug` to see why each candidate scored what it did, then adjust [config/matching.json](config/matching.json) (see [Track matching](#track-matching)).
- **Dubbed versions:** Indian film songs often have dubbed versions with the same tune and length (e.g. Tamil *Kaavaalaa* and Telugu *Kaavaali*). If the right upload is missing or blacklisted, the dub can be the next-best match. Raising `search.minAcceptScore` (e.g. to 70) makes the bot hand those tracks to LavaSrc instead.
- Enabling Deezer (below) makes ISRC matches more accurate.
- Very new or regional releases may have no ISRC match, so they rely on the scored search.

### "That's a link to a playlist in your personal library" / playlist not public
Links like `music.apple.com/library/playlist/p.xxxx` exist only in your account. To fix:
- **iPhone/iPad:** open the playlist → **⋯** → **Share Playlist** → **Copy Link**.
- **Mac/PC:** right-click the playlist → **Share Playlist** → **Copy Link**. If needed, first turn on *Show on My Profile and in Search* in the playlist's details.
- A working link looks like `https://music.apple.com/in/playlist/<name>/pl.u-XXXXXXXX`.
- **"Couldn't load anything from that Apple Music link":** the playlist may be private, deleted, or unavailable in your `APPLE_MUSIC_COUNTRY_CODE` storefront. Try the storefront in the link (e.g. `/us/`).

### Apple Music token issues
- With `APPLE_MUSIC_MEDIA_API_TOKEN` empty, LavaSrc fetches a token from music.apple.com on startup and when it expires.
- If loading fails with 401/403 or "token" errors:
  1. Restart Lavalink (`docker compose restart lavalink`) to force a fresh token.
  2. Or set one manually: open <https://music.apple.com> in a desktop browser → DevTools → **Sources/Debugger** → search all `index-*.js` files for the regex `"(?<token>(ey[\w-]+)\.([\w-]+)\.([\w-]+))"` → copy the long `ey…` string into `APPLE_MUSIC_MEDIA_API_TOKEN` → restart Lavalink.
  3. Clear it again later if it expires. Scraped tokens are valid for a few months.

### Discord token issues
- **"An invalid token was provided" / `TokenInvalid`:** reset the token in the Developer Portal and paste it without quotes or spaces.
- **Slash commands don't appear:** run the deploy-commands step again. Check `CLIENT_ID` is the *application* ID and `GUILD_ID` is your *server* ID, and that the bot was invited with the `applications.commands` scope.
- **"Missing Access" while deploying:** the bot isn't in the server `GUILD_ID` points to.

### Spotify
**What works with app credentials:** single-track links (`open.spotify.com/track/…`) and `/search source:Spotify`. Both include ISRCs, so they go through the same matcher as Apple Music and `/wrong` works for them.

**What doesn't:** playlist and album links. Spotify's Web API now refuses to list a playlist's songs without a signed-in user (401 "Valid user authentication required"), and refuses the batch track lookup LavaSrc uses for albums (403). That's Spotify's policy for developer-mode apps, not a setup problem. The bot explains it when someone tries. Use the Apple Music or YouTube link for the same playlist instead.

Setup for tracks and search:
1. Go to <https://developer.spotify.com/dashboard> → **Create app**. Any name, redirect URI `http://127.0.0.1`, and tick **Web API**.
2. Copy the **Client ID** and **Client secret** into `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in `.env`.
3. Run `docker compose up -d --force-recreate lavalink`. Lavalink only reads `.env` when the container is created.

**Optional fix for playlists and albums:** LavaSrc can read them through Spotify's internal web-player API (`preferPartnerApi`). That needs a web-player token, which LavaSrc's own scraper can't get right now ("Failed to retrieve secret"). LavaSrc's author publishes [spotify-tokener](https://github.com/topi314/spotify-tokener), which gets it with headless Chrome. It's not set up here because it's another third-party container. To add it, add a `spotify-tokener` service to `docker-compose.yml` (pin the image digest), then under `plugins.lavasrc.spotify` in `application.yml` set `preferPartnerApi: true` and `customTokenEndpoint: "http://spotify-tokener:8080/api/token"`.

### SoundCloud
Lavaplayer's built-in SoundCloud source currently fails ("Did not detect any supported formats"), so SoundCloud links aren't supported.

### Deezer (the first resolver)
Deezer playback needs a *master decryption key*, which is not distributed publicly. Without it LavaSrc refuses to start, so Deezer is **off by default** (`DEEZER_ENABLED=false`). Resolving then simply starts at YouTube Music ISRC. If you have a key, set `DEEZER_ENABLED=true`, `DEEZER_MASTER_DECRYPTION_KEY` and `DEEZER_ARL` (the `arl` cookie from a logged-in deezer.com session).

### Sound quality is low / noisy / muffled
Usually this is the YouTube **format**, not the bot:
1. **Which YouTube client plays.** Since YouTube's SABR change, most clients only get a link to itag 18, the old 360p video file, whose audio sounds noisy and muffled. `lavalink/application.yml` lists `IOS` first because it still gets itag 140 (audio-only AAC, ~130 kbps). If quality drops again, check which format is used: add `LOGGING_LEVEL_DEV_LAVALINK_YOUTUBE_TRACK: DEBUG` to the lavalink service's `environment`, restart it, and look for `itag=` in the "Starting track with URL from client …" line (`docker compose logs lavalink`). 251/140 are good; 18 is bad. Then check for a newer youtube-plugin build.
2. **Volume above 100%** can distort loud songs. Run `/quality` to check volume and filters.
3. **A bad upload.** If one song sounds bad and others are fine, `/wrong` picks a different YouTube video.

The voice channel's bitrate setting doesn't affect the bot: Discord forwards the bot's audio as it is.

### The bot joins but there's no sound
- Make sure it has **Speak** permission and isn't server-muted.
- Check `docker compose logs lavalink` for track exceptions.
- On first play after start, give Lavalink a few seconds to warm up.

---

## Notes
- This bot is for personal/self-hosted use. Respect the terms of service of the platforms it uses.
- Lavalink is published on `127.0.0.1` only. Don't expose port 2333 to the internet.
