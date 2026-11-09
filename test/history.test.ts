import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Player } from "lavalink-client";
import { dedupeHistory, playFromHistory, playFromQueue, previousTrack, skipTrack } from "../src/music/actions.ts";

type FakeTrack = { info: { title: string; identifier: string } };
const t = (name: string): FakeTrack => ({ info: { title: name, identifier: name } });

/** Just enough of a lavalink-client Player for the queue/history actions. */
function fakePlayer(current: string | null, upcoming: string[], played: string[] = []) {
  const queue = {
    current: current ? t(current) : null,
    tracks: upcoming.map(t),
    previous: played.map(t),
    options: { maxPreviousTracks: 50 },
    utils: { save: () => Promise.resolve() },
    add(track: FakeTrack, index?: number) {
      if (index === undefined) queue.tracks.push(track);
      else queue.tracks.splice(index, 0, track);
      return Promise.resolve(queue.tracks.length);
    },
    splice(index: number, amount: number) {
      return Promise.resolve(queue.tracks.splice(index, amount));
    },
  };
  const player = {
    queue,
    // Like the library: a replaced track is not added to the history; a skipped one is.
    play({ clientTrack }: { clientTrack: FakeTrack }) {
      queue.current = clientTrack;
      return Promise.resolve();
    },
    skip() {
      if (queue.current) queue.previous.unshift(queue.current);
      queue.current = queue.tracks.shift() ?? null;
      return Promise.resolve();
    },
  };
  const names = (list: FakeTrack[]) => list.map((x) => x.info.title);
  return {
    player: player as unknown as Player,
    state: () => ({ current: queue.current?.info.title ?? null, tracks: names(queue.tracks), previous: names(queue.previous) }),
  };
}

describe("playFromQueue (/playqueue, /queue menu)", () => {
  it("plays the picked song now and keeps the songs before it", async () => {
    const { player, state } = fakePlayer("A", ["B", "C", "D", "E"]);
    const result = await playFromQueue(player, 2);
    assert.ok(result.ok);
    assert.deepEqual(state(), { current: "D", tracks: ["B", "C", "E"], previous: ["A"] });
  });

  it("rejects a position past the end", async () => {
    const { player, state } = fakePlayer("A", ["B"]);
    assert.equal((await playFromQueue(player, 5)).ok, false);
    assert.equal(state().current, "A");
  });
});

describe("previous / history", () => {
  it("⏮️ walks back through every played song, ⏭️ walks forward again", async () => {
    const { player, state } = fakePlayer("C", ["D"], ["B", "A"]);
    await previousTrack(player);
    assert.deepEqual(state(), { current: "B", tracks: ["C", "D"], previous: ["A"] });
    await previousTrack(player);
    assert.deepEqual(state(), { current: "A", tracks: ["B", "C", "D"], previous: [] });
    assert.equal((await previousTrack(player)).ok, false);

    await skipTrack(player);
    assert.deepEqual(state(), { current: "B", tracks: ["C", "D"], previous: ["A"] });
  });

  it("goes back even in the middle of a song (no restart instead)", async () => {
    const { player, state } = fakePlayer("B", [], ["A"]);
    Object.assign(player, { position: 120_000 });
    await previousTrack(player);
    assert.equal(state().current, "A");
  });

  it("replays any song from /history", async () => {
    const { player, state } = fakePlayer("D", ["E"], ["C", "B", "A"]);
    await playFromHistory(player, 2);
    assert.deepEqual(state(), { current: "A", tracks: ["D", "E"], previous: ["C", "B"] });
  });

  it("a song picked from the queue can be returned to with ⏮️", async () => {
    const { player, state } = fakePlayer("A", ["B", "C", "D"]);
    await playFromQueue(player, 2);
    await previousTrack(player);
    assert.deepEqual(state(), { current: "A", tracks: ["D", "B", "C"], previous: [] });
  });

  it("keeps one copy of a song that was looped", () => {
    const { player, state } = fakePlayer("A", [], ["A", "A", "B"]);
    dedupeHistory(player);
    assert.deepEqual(state().previous, ["A", "B"]);
  });
});
