import type { PlayHandles } from './play';
import { fetchLevelCount, loadLevel } from './levelio';

/** Play-only level changes. The editor page has its own tools. */
export function mountPlaySession(
  play: PlayHandles,
  hud: { setLevel: (level: number) => void; resetMoves: () => void },
): { advance: () => void; replay: () => void } {
  let level = 1;
  let count = 1;

  async function open(index: number): Promise<void> {
    count = await fetchLevelCount();
    level = Math.min(Math.max(1, index), count);
    const board = await loadLevel(index);
    hud.setLevel(level);
    hud.resetMoves();
    play.setEditing(false);
    play.replace(board);
    play.frame();
  }

  void open(1);

  return {
    advance: () => {
      void open(level >= count ? 1 : level + 1);
    },
    replay: () => {
      void open(level);
    },
  };
}
