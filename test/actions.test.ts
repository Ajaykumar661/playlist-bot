import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTime } from "../src/music/actions.ts";

describe("parseTime (/seek)", () => {
  it("reads clock formats", () => {
    assert.equal(parseTime("1:30"), 90_000);
    assert.equal(parseTime("01:02:03"), 3_723_000);
    assert.equal(parseTime("0:05"), 5_000);
  });

  it("reads plain seconds and unit formats", () => {
    assert.equal(parseTime("90"), 90_000);
    assert.equal(parseTime("90s"), 90_000);
    assert.equal(parseTime("1m30s"), 90_000);
    assert.equal(parseTime("2m"), 120_000);
    assert.equal(parseTime("1h2m3s"), 3_723_000);
  });

  it("rejects nonsense", () => {
    assert.equal(parseTime("abc"), null);
    assert.equal(parseTime(""), null);
    assert.equal(parseTime("1:2:3:4"), null);
  });
});
