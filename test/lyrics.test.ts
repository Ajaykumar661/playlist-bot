import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanLyricsTitle, currentLineIndex, parseLrc } from "../src/music/lyrics.ts";
import { renderLines } from "../src/music/liveLyrics.ts";

const LRC = `[ar:Anirudh]
[00:06.88] ஹான்...
[00:07.85] ஹான் ஹான் ஹான் ஹான்
[00:16.45]
[01:02.5][02:10.00] Chorus line`;

describe("synced lyrics", () => {
  it("parses LRC time tags, including several tags on one line", () => {
    const lines = parseLrc(LRC);
    assert.deepEqual(
      lines.map((l) => l.timeMs),
      [6_880, 7_850, 16_450, 62_500, 130_000],
    );
    assert.equal(lines[0]!.text, "ஹான்...");
    assert.equal(lines[2]!.text, "");
    assert.equal(lines[4]!.text, "Chorus line");
  });

  it("finds the line being sung", () => {
    const lines = parseLrc(LRC);
    assert.equal(currentLineIndex(lines, 0), -1);
    assert.equal(currentLineIndex(lines, 6_880), 0);
    assert.equal(currentLineIndex(lines, 10_000), 1);
    assert.equal(currentLineIndex(lines, 999_999), 4);
  });

  it("shows the current line big, the previous ones small, and a few next lines", () => {
    const lines = parseLrc(LRC);
    const text = renderLines(lines, 1);
    assert.equal(text, "-# ஹான்...\n### ஹான் ஹான் ஹான் ஹான்\n♪\nChorus line\nChorus line");
    assert.match(renderLines(lines, -1), /^### 🎵 …/);
  });

  it("cleans film/feat tags from titles before looking them up", () => {
    assert.equal(cleanLyricsTitle('Aeroplane (From "Scene")'), "Aeroplane");
    assert.equal(cleanLyricsTitle("Song [feat. Someone]"), "Song");
  });
});
