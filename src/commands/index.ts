import type { Command } from "../utils/types.js";
import { play } from "./play.js";
import { playnext } from "./playnext.js";
import { songrequest } from "./songrequest.js";
import { search } from "./search.js";
import { skip } from "./skip.js";
import { previous } from "./previous.js";
import { pause } from "./pause.js";
import { resume } from "./resume.js";
import { stop } from "./stop.js";
import { leave } from "./leave.js";
import { seek } from "./seek.js";
import { forward } from "./forward.js";
import { rewind } from "./rewind.js";
import { replay } from "./replay.js";
import { queue } from "./queue.js";
import { nowplaying } from "./nowplaying.js";
import { jump } from "./jump.js";
import { playqueue } from "./playqueue.js";
import { history } from "./history.js";
import { quality } from "./quality.js";
import { move } from "./move.js";
import { remove } from "./remove.js";
import { shuffle } from "./shuffle.js";
import { loop } from "./loop.js";
import { clear } from "./clear.js";
import { volume } from "./volume.js";
import { filter } from "./filter.js";
import { autoplay } from "./autoplay.js";
import { stay247 } from "./stay247.js";
import { wrong } from "./wrong.js";
import { lyrics } from "./lyrics.js";
import { grab } from "./grab.js";
import { help } from "./help.js";

export const commands: Command[] = [
  play,
  playnext,
  songrequest,
  search,
  skip,
  previous,
  pause,
  resume,
  stop,
  leave,
  seek,
  forward,
  rewind,
  replay,
  queue,
  nowplaying,
  playqueue,
  jump,
  history,
  move,
  remove,
  shuffle,
  loop,
  clear,
  volume,
  quality,
  filter,
  autoplay,
  stay247,
  wrong,
  lyrics,
  grab,
  help,
];
