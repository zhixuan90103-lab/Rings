/**
 * Who owns the piece, and when a second finger takes the camera.
 * Settlement happens only when the owning finger lifts.
 * A second finger freezes the piece and does not settle.
 */

export type Hand = {
  /** Pointer ids currently down, first finger first. */
  ids: number[];
  /** The finger that pressed the piece. Null when no piece gesture is open. */
  owner: number | null;
  camera: boolean;
};

export type HandEffect = 'begin-piece' | 'begin-camera' | 'stop-camera' | 'settle' | 'revert' | 'none';

export function emptyHand(): Hand {
  return { ids: [], owner: null, camera: false };
}

function withId(hand: Hand, id: number): Hand {
  if (hand.ids.includes(id)) return hand;
  return { ...hand, ids: [...hand.ids, id] };
}

function withoutId(hand: Hand, id: number): Hand {
  return { ...hand, ids: hand.ids.filter((item) => item !== id) };
}

export function handDown(hand: Hand, id: number, inside: boolean): { hand: Hand; effect: HandEffect } {
  if (hand.ids.includes(id)) return { hand, effect: 'none' };
  if (hand.ids.length === 0 && !inside) return { hand, effect: 'none' };
  const next = withId(hand, id);
  if (next.ids.length > 2) return { hand: { ...next, camera: false }, effect: hand.camera ? 'stop-camera' : 'none' };
  if (next.ids.length === 2) return { hand: { ...next, camera: true }, effect: 'begin-camera' };
  return { hand: { ...next, owner: id, camera: false }, effect: 'begin-piece' };
}

/**
 * `cancel` is a system cancel of this pointer.
 * The owner settles on a real lift. A cancel while another finger is down waits.
 * A cancel of the only finger restores the piece.
 */
export function handUp(hand: Hand, id: number, cancel: boolean): { hand: Hand; effect: HandEffect } {
  if (!hand.ids.includes(id) && hand.owner !== id) return { hand, effect: 'none' };
  const next = withoutId(hand, id);
  if (id !== hand.owner) {
    const camera = next.ids.length === 2;
    return { hand: { ...next, camera }, effect: hand.camera && !camera ? 'stop-camera' : 'none' };
  }
  if (cancel && next.ids.length > 0) return { hand: next, effect: 'none' };
  const settled: Hand = { ...next, owner: null, camera: next.ids.length === 2 };
  return { hand: settled, effect: cancel ? 'revert' : 'settle' };
}

/** A second touch arrived through the touch stream. The owner stays. */
export function handCamera(hand: Hand): { hand: Hand; effect: HandEffect } {
  if (hand.camera || hand.ids.length === 0) return { hand, effect: 'none' };
  return { hand: { ...hand, camera: true }, effect: 'begin-camera' };
}
