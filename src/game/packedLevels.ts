import type { Board } from './board';

/** JSON files under public/levels, included in the phone build. */
export const packedLevels = import.meta.glob('../../public/levels/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Board>;
