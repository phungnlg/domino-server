export interface DominoTile {
  left: number;
  right: number;
}

/**
 * Generate all 28 double-six domino tiles.
 * Each tile is unique: [0|0], [0|1], ..., [0|6], [1|1], [1|2], ..., [6|6]
 */
export function generateTileSet(): DominoTile[] {
  const tiles: DominoTile[] = [];
  for (let left = 0; left <= 6; left++) {
    for (let right = left; right <= 6; right++) {
      tiles.push({ left, right });
    }
  }
  return tiles;
}

/**
 * Fisher-Yates shuffle algorithm. Shuffles array in place and returns it.
 */
export function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate tiles, shuffle, and deal to players.
 * For 4 players, each gets 7 tiles (28 total, no remainder).
 */
export function shuffleAndDeal(playerCount: number = 4): {
  hands: DominoTile[][];
  remaining: DominoTile[];
} {
  const tiles = generateTileSet();
  const shuffled = shuffleArray(tiles);
  const tilesPerPlayer = Math.floor(shuffled.length / playerCount);

  const hands: DominoTile[][] = [];
  for (let i = 0; i < playerCount; i++) {
    const start = i * tilesPerPlayer;
    hands.push(shuffled.slice(start, start + tilesPerPlayer));
  }

  const dealt = playerCount * tilesPerPlayer;
  const remaining = shuffled.slice(dealt);

  return { hands, remaining };
}
