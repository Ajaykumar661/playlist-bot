import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isChannelAllowed, parseChannelIds, wrongChannelMessage } from "../src/utils/allowlist.ts";

const A = "112233445566778899";
const B = "998877665544332211";

describe("channel allowlist", () => {
  it("parses a comma-separated list, ignoring spaces, blanks and duplicates", () => {
    assert.deepEqual(parseChannelIds(` ${A}, ${B},,${A} `), [A, B]);
    assert.deepEqual(parseChannelIds(""), []);
    assert.deepEqual(parseChannelIds(undefined), []);
  });

  it("rejects things that aren't channel IDs", () => {
    assert.throws(() => parseChannelIds(`${A}, #music`), /Not valid: #music/);
  });

  it("allows every channel when the list is empty", () => {
    assert.equal(isChannelAllowed([], A), true);
  });

  it("allows only listed channels otherwise", () => {
    assert.equal(isChannelAllowed([A], A), true);
    assert.equal(isChannelAllowed([A], B), false);
    assert.equal(isChannelAllowed([A], null), false);
  });

  it("points people to the first allowed channel", () => {
    assert.equal(wrongChannelMessage([A, B]), `Use me in <#${A}> 🎵`);
  });
});
