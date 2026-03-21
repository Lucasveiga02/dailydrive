#!/usr/bin/env node
// =============================================================================
// Daily Drive — Main Script
// =============================================================================
// Builds your custom Daily Drive playlist by mixing podcasts and music.
//
// Usage:  npm start              (update the playlist)
//         npm test               (dry run — shows what would happen)
//         node index.js --dry-run
// =============================================================================

const fs = require("fs");
const yaml = require("js-yaml");
const SpotifyWebApi = require("spotify-web-api-node");

const TOKEN_FILE = ".spotify-token.json";
const CONFIG_FILE = "config.yaml";
const DRY_RUN = process.argv.includes("--dry-run");

// =============================================================================
// Helper Functions
// =============================================================================

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error("❌ config.yaml not found! Run: cp config.example.yaml config.yaml");
    process.exit(1);
  }
  return yaml.load(fs.readFileSync(CONFIG_FILE, "utf8"));
}

function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    console.error("❌ Not authenticated! Run: npm run setup");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
}

function saveToken(tokenData) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function refreshTokenIfNeeded(spotifyApi, token) {
  // Refresh if token expires in less than 5 minutes
  if (Date.now() > token.expires_at - 5 * 60 * 1000) {
    console.log("🔄 Refreshing access token...");
    const data = await spotifyApi.refreshAccessToken();
    token.access_token = data.body.access_token;
    token.expires_at = Date.now() + data.body.expires_in * 1000;
    if (data.body.refresh_token) {
      token.refresh_token = data.body.refresh_token;
    }
    saveToken(token);
    spotifyApi.setAccessToken(token.access_token);
    console.log("✅ Token refreshed");
  }
}

// =============================================================================
// Core Logic
// =============================================================================

async function fetchPodcastEpisodes(spotifyApi, podcasts) {
  const episodes = [];

  for (const podcast of podcasts) {
    const count = podcast.episodes || 1;
    console.log(`🎙️  Fetching ${count} episode(s) from: ${podcast.name}`);

    try {
      const data = await spotifyApi.getShowEpisodes(podcast.id, {
        limit: count,
        market: "US",
      });

      for (const episode of data.body.items) {
        episodes.push({
          uri: episode.uri,
          name: episode.name,
          show: podcast.name,
          type: "episode",
        });
        console.log(`    📌 ${episode.name}`);
      }
    } catch (err) {
      console.error(`    ⚠️  Failed to fetch ${podcast.name}: ${err.message}`);
    }
  }

  return episodes;
}

async function fetchMusicTracks(spotifyApi, musicConfig) {
  let allTracks = [];

  // Fetch from playlists
  if (musicConfig.playlists) {
    for (const playlist of musicConfig.playlists) {
      if (!playlist.id || playlist.id === "your-playlist-id") continue;

      console.log(`🎵 Fetching songs from playlist: ${playlist.name}`);

      try {
        // Fetch up to 100 tracks (paginate if needed for larger playlists)
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const data = await spotifyApi.getPlaylistTracks(playlist.id, {
            limit: 100,
            offset,
            fields:
              "items(track(uri,name,artists)),total",
          });

          for (const item of data.body.items) {
            if (item.track && item.track.uri) {
              allTracks.push({
                uri: item.track.uri,
                name: item.track.name,
                artist: item.track.artists?.map((a) => a.name).join(", ") || "Unknown",
                type: "track",
              });
            }
          }

          offset += 100;
          hasMore = offset < data.body.total;
        }

        console.log(
          `    Found ${allTracks.length} tracks so far`
        );
      } catch (err) {
        console.error(
          `    ⚠️  Failed to fetch playlist ${playlist.name}: ${err.message}`
        );
      }
    }
  }

  // Shuffle and trim to desired count
  const totalSongs = musicConfig.total_songs || 15;
  if (musicConfig.shuffle !== false) {
    allTracks = shuffle(allTracks);
  }
  allTracks = allTracks.slice(0, totalSongs);

  console.log(`🎵 Selected ${allTracks.length} songs`);
  return allTracks;
}

function mixContent(episodes, tracks, pattern) {
  const mixed = [];
  let episodeIndex = 0;
  let trackIndex = 0;
  let patternIndex = 0;

  const mixPattern = pattern || "PMMM";

  // Keep going until we've placed all content
  while (episodeIndex < episodes.length || trackIndex < tracks.length) {
    const slot = mixPattern[patternIndex % mixPattern.length];

    if (slot === "P" || slot === "p") {
      if (episodeIndex < episodes.length) {
        mixed.push(episodes[episodeIndex++]);
      }
    } else {
      // M = music
      if (trackIndex < tracks.length) {
        mixed.push(tracks[trackIndex++]);
      }
    }

    patternIndex++;

    // Safety valve: if one type is exhausted, dump the rest of the other
    if (episodeIndex >= episodes.length && trackIndex < tracks.length) {
      while (trackIndex < tracks.length) {
        mixed.push(tracks[trackIndex++]);
      }
      break;
    }
    if (trackIndex >= tracks.length && episodeIndex < episodes.length) {
      while (episodeIndex < episodes.length) {
        mixed.push(episodes[episodeIndex++]);
      }
      break;
    }
  }

  return mixed;
}

async function updatePlaylist(spotifyApi, playlistId, items) {
  const uris = items.map((item) => item.uri);

  if (DRY_RUN) {
    console.log("\n🧪 DRY RUN — would update playlist with:\n");
    items.forEach((item, i) => {
      const icon = item.type === "episode" ? "🎙️ " : "🎵";
      const detail =
        item.type === "episode"
          ? `[${item.show}] ${item.name}`
          : `${item.name} — ${item.artist}`;
      console.log(`  ${String(i + 1).padStart(2)}. ${icon} ${detail}`);
    });
    console.log(`\n✅ Dry run complete. ${items.length} items would be added.\n`);
    return;
  }

  // Spotify API allows max 100 items per call
  // First, replace with the first batch
  const firstBatch = uris.slice(0, 100);
  await spotifyApi.replaceTracksInPlaylist(playlistId, firstBatch);

  // Add remaining batches if any
  for (let i = 100; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    await spotifyApi.addTracksToPlaylist(playlistId, batch);
  }

  console.log(`\n✅ Playlist updated with ${items.length} items!`);
  console.log(`   🎙️  ${items.filter((i) => i.type === "episode").length} podcast episodes`);
  console.log(`   🎵 ${items.filter((i) => i.type === "track").length} songs\n`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("\n🚗 Daily Drive — Building your playlist...\n");

  const config = loadConfig();
  const token = loadToken();

  const spotifyApi = new SpotifyWebApi({
    clientId: config.spotify.client_id,
    clientSecret: config.spotify.client_secret,
    redirectUri: config.spotify.redirect_uri,
  });

  spotifyApi.setAccessToken(token.access_token);
  spotifyApi.setRefreshToken(token.refresh_token);

  // Refresh token if needed
  await refreshTokenIfNeeded(spotifyApi, token);

  // Validate playlist ID
  if (!config.playlist_id || config.playlist_id === "your-playlist-id-here") {
    console.error("❌ Please set your playlist_id in config.yaml");
    process.exit(1);
  }

  // Fetch content
  const episodes = await fetchPodcastEpisodes(spotifyApi, config.podcasts || []);
  const tracks = await fetchMusicTracks(spotifyApi, config.music || {});

  if (episodes.length === 0 && tracks.length === 0) {
    console.error("❌ No content found! Check your config.yaml settings.");
    process.exit(1);
  }

  // Mix content according to pattern
  console.log(`\n🔀 Mixing with pattern: ${config.mix_pattern || "PMMM"}`);
  const mixed = mixContent(episodes, tracks, config.mix_pattern);

  // Update the playlist
  await updatePlaylist(spotifyApi, config.playlist_id, mixed);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  if (err.statusCode === 401) {
    console.error("   Your token may have expired. Run: npm run setup\n");
  }
  process.exit(1);
});
