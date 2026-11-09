import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyRerank,
  cleanSourceTitle,
  normalize,
  rankCandidates,
  rerankPool,
  scoreCandidate,
  splitArtists,
  type Candidate,
  type SourceTrack,
} from "../src/music/matcher.ts";
import { parseMatchingConfig } from "../src/music/matchingConfig.ts";

// Tests run against the real config file so they also catch tuning changes that break these cases.
const cfg = parseMatchingConfig(JSON.parse(readFileSync(new URL("../config/matching.json", import.meta.url), "utf8")));

const sec = (m: number, s: number) => (m * 60 + s) * 1000;
const c = (id: string, title: string, author: string, durationMs: number): Candidate => ({ id, title, author, durationMs });
const best = (source: SourceTrack, candidates: Candidate[]) => rankCandidates(source, candidates, cfg)[0]!.candidate.id;
const order = (source: SourceTrack, candidates: Candidate[]) => rankCandidates(source, candidates, cfg).map((r) => r.candidate.id);

describe("normalisation", () => {
  it("keeps Tamil vowel signs (combining marks)", () => {
    assert.equal(normalize("வா வாத்தி!"), "வா வாத்தி");
  });

  it("keeps the film name from (From \"…\") and drops feat. credits", () => {
    assert.equal(cleanSourceTitle('Kaavaalaa (From "Jailer")'), "kaavaalaa jailer");
    assert.equal(cleanSourceTitle("Señorita (feat. Camila Cabello)"), "señorita");
    assert.equal(cleanSourceTitle("Here Comes the Sun (2019 Remaster)"), "here comes the sun");
  });

  it("splits multi-artist credits", () => {
    assert.deepEqual(splitArtists("Anirudh Ravichander, Shilpa Rao & Jonita Gandhi"), [
      "anirudh ravichander",
      "shilpa rao",
      "jonita gandhi",
    ]);
  });
});

describe("live versions", () => {
  const studio: SourceTrack = { title: "Yellow", artist: "Coldplay", album: "Parachutes", durationMs: sec(4, 29) };
  const candidates = [
    c("live", "Coldplay - Yellow (Live at Glastonbury 2016)", "Coldplay", sec(5, 10)),
    c("mv", "Coldplay - Yellow (Official Video)", "Coldplay", sec(4, 32)),
    c("topic", "Yellow", "Coldplay - Topic", sec(4, 29)),
  ];

  it("prefers the Topic upload, and ranks the live recording last", () => {
    assert.deepEqual(order(studio, candidates), ["topic", "mv", "live"]);
  });

  it("penalises 'live' and the 41 s duration gap", () => {
    const b = scoreCandidate(studio, candidates[0]!, cfg);
    assert.ok(b.penalties.live, "expected a live penalty");
    assert.equal(b.duration, -cfg.duration.penalty);
  });

  it("does not penalise live when the Apple track itself is live", () => {
    const liveSource: SourceTrack = { title: "Yellow (Live at Glastonbury 2016)", artist: "Coldplay", durationMs: sec(5, 10) };
    assert.equal(best(liveSource, candidates), "live");
    assert.equal(scoreCandidate(liveSource, candidates[0]!, cfg).penalties.live, undefined);
  });

  it("allows live when only the album says live", () => {
    const fromLiveAlbum: SourceTrack = { title: "Yellow", artist: "Coldplay", album: "Live in Buenos Aires", durationMs: sec(5, 10) };
    assert.equal(best(fromLiveAlbum, candidates), "live");
  });
});

describe("covers, remixes and edits", () => {
  const perfect: SourceTrack = { title: "Perfect", artist: "Ed Sheeran", album: "÷", durationMs: sec(4, 23) };

  it("rejects a cover even when it has the better duration", () => {
    const candidates = [
      c("cover", "Perfect - Ed Sheeran (Cover by Alexander Stewart)", "Alexander Stewart", sec(4, 23)),
      c("official", "Ed Sheeran - Perfect (Official Music Video)", "Ed Sheeran", sec(4, 39)),
    ];
    assert.equal(best(perfect, candidates), "official");
  });

  it("rejects sped up / slowed / nightcore uploads", () => {
    const pasoori: SourceTrack = { title: "Pasoori", artist: "Ali Sethi & Shae Gill", durationMs: sec(3, 44) };
    const candidates = [
      c("sped", "Pasoori (Sped Up)", "Ali Sethi - Topic", sec(3, 1)),
      c("slowed", "Pasoori [Slowed + Reverb] | Ali Sethi x Shae Gill", "Lofi Vibes", sec(4, 30)),
      c("nightcore", "Nightcore - Pasoori", "Nightcore Planet", sec(3, 0)),
      c("orig", "Coke Studio | Season 14 | Pasoori | Ali Sethi x Shae Gill", "Coke Studio", sec(3, 45)),
    ];
    assert.equal(best(pasoori, candidates), "orig");
  });

  it("accepts a remix when the Apple title is the remix", () => {
    const remix: SourceTrack = { title: "Levitating (The Blessed Madonna Remix)", artist: "Dua Lipa", durationMs: sec(4, 35) };
    const candidates = [
      c("orig", "Dua Lipa - Levitating (Official Music Video)", "Dua Lipa", sec(3, 23)),
      c("remix", "Levitating (The Blessed Madonna Remix)", "Dua Lipa - Topic", sec(4, 35)),
    ];
    assert.equal(best(remix, candidates), "remix");
    assert.equal(scoreCandidate(remix, candidates[1]!, cfg).penalties.remix, undefined);
  });

  it("rejects 8-bit and lo-fi remakes that copy the exact title and credits", () => {
    // Real ytmsearch results for "Shilpa Rao Kaavaalaa" once the correct video was blacklisted.
    const kaavaalaa: SourceTrack = {
      title: 'Kaavaalaa (From "Jailer")',
      artist: "Shilpa Rao, Anirudh Ravichander & Arunraja Kamaraj",
      durationMs: sec(3, 30),
    };
    for (const remake of [
      c("8bit", 'Kaavaalaa (From "Jailer") (8-Bit Anirudh Ravichander, Shilpa Rao & Arunraja Kamaraj Emulation)', "8-Bit Arcade", sec(3, 35)),
      c("lofi", "Kaavaalaa (LoFi Version)", "Anirudh Ravichander", sec(3, 48)),
    ]) {
      const b = scoreCandidate(kaavaalaa, remake, cfg);
      assert.ok(b.total < cfg.search.minAcceptScore, `${remake.id} scored ${b.total}`);
    }
  });

  it("penalises a one-hour loop through the duration gap", () => {
    const b = scoreCandidate(perfect, c("loop", "Ed Sheeran - Perfect (1 Hour Loop)", "Loops", sec(60, 0)), cfg);
    assert.equal(b.duration, -cfg.duration.penalty);
    assert.ok(b.total < cfg.search.minAcceptScore, `loop scored ${b.total}`);
  });
});

describe("Tamil film songs", () => {
  const kaavaalaa: SourceTrack = {
    title: 'Kaavaalaa (From "Jailer")',
    artist: "Anirudh Ravichander & Shilpa Rao",
    album: 'Kaavaalaa (From "Jailer") - Single',
    durationMs: sec(3, 30),
  };

  it("picks the Topic upload over lyric, 8D and status edits", () => {
    const candidates = [
      c("lyric", "Jailer - Kaavaalaa Lyric | Superstar Rajinikanth | Sun Pictures | Anirudh | Nelson | Tamannaah", "Sun TV", sec(3, 33)),
      c("8d", "Kaavaalaa 8D Audio Song | Jailer | Use Headphones 🎧", "8D Tamil Beats", sec(3, 30)),
      c("status", "Kaavaalaa whatsapp status | Jailer | Tamannaah", "Tamil Status Hub", sec(0, 30)),
      c("topic", 'Kaavaalaa (From "Jailer")', "Anirudh Ravichander - Topic", sec(3, 30)),
    ];
    const ranked = order(kaavaalaa, candidates);
    assert.equal(ranked[0], "topic");
    assert.equal(ranked[1], "lyric");
  });

  it("matches a label-channel upload where the artist is only in the title", () => {
    const b = scoreCandidate(
      kaavaalaa,
      c("label", "Kaavaalaa - Video Song | Jailer | Anirudh Ravichander | Shilpa Rao", "Sun TV", sec(3, 31)),
      cfg,
    );
    assert.ok(b.artistSimilarity >= 0.9, `artist similarity ${b.artistSimilarity}`);
    assert.ok(b.total >= cfg.search.minAcceptScore, `scored ${b.total}`);
  });

  it("does not take another song from the same film", () => {
    const candidates = [
      c("other", "Hukum - Thalaivar Alappara Lyric Video | Jailer | Anirudh Ravichander", "Sun TV", sec(3, 28)),
      c("right", "Jailer | Kaavaalaa Video Song | Anirudh Ravichander | Shilpa Rao", "Sun TV", sec(3, 34)),
    ];
    assert.equal(best(kaavaalaa, candidates), "right");
    const wrong = scoreCandidate(kaavaalaa, candidates[0]!, cfg);
    assert.ok(wrong.total < cfg.search.minAcceptScore, `other song from the film scored ${wrong.total}`);
  });

  it("handles Tamil-script titles and rejects a cover in the same script", () => {
    const vaaVaathi: SourceTrack = {
      title: 'வா வாத்தி (From "Vaathi")',
      artist: "G. V. Prakash Kumar & Shweta Mohan",
      durationMs: sec(4, 10),
    };
    const candidates = [
      c("cover", "வா வாத்தி Cover Song | Female Version", "Priya Sings", sec(4, 2)),
      c("topic", 'வா வாத்தி (From "Vaathi")', "G. V. Prakash Kumar - Topic", sec(4, 10)),
    ];
    assert.equal(best(vaaVaathi, candidates), "topic");
    assert.equal(scoreCandidate(vaaVaathi, candidates[1]!, cfg).titleSimilarity, 1);
  });

  it("picks the right song from a romanised Apple title, over a different song sharing a word", () => {
    // Apple: "Vaa Vaathi" (romanised). Right upload titles it in Tamil script, wrong one is "Vaathi Coming".
    const vaaVaathi: SourceTrack = { title: "Vaa Vaathi", artist: "G. V. Prakash Kumar & Shweta Mohan", durationMs: sec(4, 10) };
    const candidates = [
      c("roman", "Vaathi Coming | Master | Anirudh Ravichander", "Sony Music South", sec(4, 10)),
      c("tamil", "வா வாத்தி | Vaathi | Dhanush | G. V. Prakash Kumar", "Aditya Music Tamil", sec(4, 11)),
    ];
    assert.equal(best(vaaVaathi, candidates), "tamil");
  });
});

describe("embedding rerank", () => {
  const src: SourceTrack = { title: "Song", artist: "Artist", durationMs: sec(3, 0) };
  const ranked = rankCandidates(
    src,
    [c("a", "Artist - Song", "Artist", sec(3, 0)), c("b", "Song (Artist)", "Artist", sec(3, 0)), c("far", "Other", "Nobody", sec(9, 0))],
    cfg,
  );

  it("only pools candidates within the margin of the leader", () => {
    const pool = rerankPool(ranked, cfg.rerank.margin);
    assert.deepEqual(pool.map((p) => p.candidate.id).sort(), ["a", "b"]);
  });

  it("lets cosine similarity reorder the pool but keeps everything else after it", () => {
    const pool = rerankPool(ranked, cfg.rerank.margin);
    const cosines = pool.map((p) => (p.candidate.id === "b" ? 0.95 : 0.2));
    const out = applyRerank(ranked, pool, cosines, cfg.rerank.weight);
    assert.deepEqual(
      out.map((o) => o.candidate.id),
      ["b", "a", "far"],
    );
    assert.ok(out[0]!.embedding);
  });

  it("returns no pool when the leader is clearly ahead", () => {
    const clear = rankCandidates(src, [c("a", "Artist - Song", "Artist", sec(3, 0)), c("far", "Other", "Nobody", sec(9, 0))], cfg);
    assert.deepEqual(rerankPool(clear, cfg.rerank.margin), []);
  });
});
