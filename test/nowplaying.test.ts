import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { timingLine } from "../src/utils/format.ts";
import { artworkFor } from "../src/music/nowPlaying.ts";

describe("now-playing card", () => {
  it("shows the length and a live countdown to the end of the song", () => {
    // 1:00 into a 3:20 song at t = 1,000,000 s, so it ends at 1,000,140 s.
    assert.equal(timingLine(60_000, 200_000, false, false, 1_000_000_000), "`3:20` · ends <t:1000140:R>");
  });

  it("shows where it paused instead of a countdown", () => {
    assert.equal(timingLine(83_000, 232_000, true, false), "⏸ Paused at `1:23` of `3:52`");
  });

  it("marks streams as live", () => {
    assert.equal(timingLine(5_000, 0, false, true), "🔴 **LIVE**");
  });

  it("asks Apple for 600×600 cover art instead of 3000×3000", () => {
    assert.equal(
      artworkFor("https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/a3/x.jpg/3000x3000bb.jpg"),
      "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/a3/x.jpg/600x600bb.jpg",
    );
    const yt = "https://yt3.googleusercontent.com/abc=w1000-h1000";
    assert.equal(artworkFor(yt), yt);
    assert.equal(artworkFor(null), null);
  });
});
