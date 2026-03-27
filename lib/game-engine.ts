import { DominoTile } from './tile-set';

export interface BoardTile {
  tile: DominoTile;
  end: 'left' | 'right' | 'first';
  flipped: boolean;
}

export interface ValidMove {
  tile: DominoTile;
  end: 'left' | 'right';
}

export interface PlacementResult {
  board: BoardTile[];
  openLeft: number;
  openRight: number;
}

export interface PlayerWithHand {
  id: string;
  hand: DominoTile[];
  team?: number;
  seat?: number;
}

export interface RoundScoreResult {
  team1Points: number;
  team2Points: number;
  winningTeam: number;
}

/**
 * Check if a tile matches a given open-end value.
 * A tile matches if either its left or right side equals the value.
 */
export function tileMatchesEnd(tile: DominoTile, value: number): boolean {
  return tile.left === value || tile.right === value;
}

/**
 * Check if two tiles are the same (order-independent).
 */
export function tilesEqual(a: DominoTile, b: DominoTile): boolean {
  return (a.left === b.left && a.right === b.right) ||
         (a.left === b.right && a.right === b.left);
}

/**
 * Find the starting player - the one holding the highest double.
 * In Caribbean dominoes, the player with the highest double goes first.
 * Checks from [6|6] down to [0|0].
 * Returns the player ID and the starting tile, or null if no doubles found.
 */
export function findStartingPlayer(
  players: PlayerWithHand[]
): { playerId: string; tile: DominoTile } | null {
  for (let d = 6; d >= 0; d--) {
    for (const player of players) {
      const double = player.hand.find(t => t.left === d && t.right === d);
      if (double) {
        return { playerId: player.id, tile: double };
      }
    }
  }
  return null;
}

/**
 * Get all valid moves for a player given the current open ends.
 * If openLeft and openRight are both -1, the board is empty and any tile can be played.
 */
export function getValidMoves(
  hand: DominoTile[],
  openLeft: number,
  openRight: number
): ValidMove[] {
  const moves: ValidMove[] = [];

  // Empty board - any tile can be played
  if (openLeft === -1 && openRight === -1) {
    for (const tile of hand) {
      moves.push({ tile, end: 'left' });
    }
    return moves;
  }

  for (const tile of hand) {
    // Check left end
    if (tileMatchesEnd(tile, openLeft)) {
      moves.push({ tile, end: 'left' });
    }
    // Check right end (avoid duplicate if both ends have same value)
    if (openLeft !== openRight && tileMatchesEnd(tile, openRight)) {
      moves.push({ tile, end: 'right' });
    }
    // If both ends are the same value, still allow playing on right
    if (openLeft === openRight && tileMatchesEnd(tile, openRight)) {
      // Already added for left, add for right too so player can choose
      moves.push({ tile, end: 'right' });
    }
  }

  return moves;
}

/**
 * Validate and apply a tile placement on the board.
 * Returns the new board state with updated open ends, or null if invalid.
 */
export function validateAndPlace(
  tile: DominoTile,
  end: 'left' | 'right',
  board: BoardTile[],
  openLeft: number,
  openRight: number
): PlacementResult | null {
  const newBoard = [...board];

  // First tile on board
  if (board.length === 0) {
    newBoard.push({
      tile,
      end: 'first',
      flipped: false,
    });
    return {
      board: newBoard,
      openLeft: tile.left,
      openRight: tile.right,
    };
  }

  if (end === 'left') {
    if (!tileMatchesEnd(tile, openLeft)) {
      return null; // Invalid move
    }

    // Determine orientation: the matching side should face the board (right side of placed tile connects)
    const flipped = tile.left === openLeft;
    // If tile.right matches openLeft, place as-is (right faces board, left becomes new open)
    // If tile.left matches openLeft, flip it (left faces board, right becomes new open)
    const newOpenLeft = flipped ? tile.right : tile.left;

    newBoard.unshift({
      tile,
      end: 'left',
      flipped,
    });

    return {
      board: newBoard,
      openLeft: newOpenLeft,
      openRight,
    };
  }

  if (end === 'right') {
    if (!tileMatchesEnd(tile, openRight)) {
      return null; // Invalid move
    }

    // The matching side should face the board (left side of placed tile connects)
    const flipped = tile.right === openRight;
    // If tile.left matches openRight, place as-is (left faces board, right becomes new open)
    // If tile.right matches openRight, flip it (right faces board, left becomes new open)
    const newOpenRight = flipped ? tile.left : tile.right;

    newBoard.push({
      tile,
      end: 'right',
      flipped,
    });

    return {
      board: newBoard,
      openLeft,
      openRight: newOpenRight,
    };
  }

  return null;
}

/**
 * Check if the game is blocked - no player can make a valid move.
 */
export function isBlocked(
  players: { hand: DominoTile[] }[],
  openLeft: number,
  openRight: number
): boolean {
  for (const player of players) {
    const moves = getValidMoves(player.hand, openLeft, openRight);
    if (moves.length > 0) {
      return false;
    }
  }
  return true;
}

/**
 * Calculate the pip count (sum of all dots) for a hand.
 */
export function calculatePipCount(hand: DominoTile[]): number {
  return hand.reduce((sum, tile) => sum + tile.left + tile.right, 0);
}

/**
 * Calculate round score when the round ends.
 * - If a player empties their hand, the opposing team's combined pip count is awarded to the winning team.
 * - If blocked, the team with the lower total pip count wins.
 *   The losing team's pip count is awarded to the winning team.
 *   On a tie, no points are awarded (winningTeam = 0).
 */
export function calculateRoundScore(
  players: { team: number; hand: DominoTile[] }[]
): RoundScoreResult {
  let team1Pips = 0;
  let team2Pips = 0;

  for (const player of players) {
    const pips = calculatePipCount(player.hand);
    if (player.team === 1) {
      team1Pips += pips;
    } else {
      team2Pips += pips;
    }
  }

  // Determine winning team
  if (team1Pips < team2Pips) {
    return {
      team1Points: team2Pips,
      team2Points: 0,
      winningTeam: 1,
    };
  } else if (team2Pips < team1Pips) {
    return {
      team1Points: 0,
      team2Points: team1Pips,
      winningTeam: 2,
    };
  } else {
    // Tie - no points awarded
    return {
      team1Points: 0,
      team2Points: 0,
      winningTeam: 0,
    };
  }
}

/**
 * Get next player seat in clockwise order: 0 -> 1 -> 2 -> 3 -> 0
 */
export function getNextPlayerSeat(currentSeat: number): number {
  return (currentSeat + 1) % 4;
}
