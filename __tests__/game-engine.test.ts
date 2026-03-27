import { generateTileSet, shuffleAndDeal, DominoTile } from '../lib/tile-set';
import {
  findStartingPlayer,
  getValidMoves,
  validateAndPlace,
  isBlocked,
  calculateRoundScore,
  getNextPlayerSeat,
  tileMatchesEnd,
  tilesEqual,
  BoardTile,
} from '../lib/game-engine';

describe('tile-set', () => {
  describe('generateTileSet', () => {
    it('should produce exactly 28 tiles', () => {
      const tiles = generateTileSet();
      expect(tiles).toHaveLength(28);
    });

    it('should include all valid double-six combinations', () => {
      const tiles = generateTileSet();
      // Check some specific tiles exist
      expect(tiles).toContainEqual({ left: 0, right: 0 });
      expect(tiles).toContainEqual({ left: 6, right: 6 });
      expect(tiles).toContainEqual({ left: 3, right: 5 });
      expect(tiles).toContainEqual({ left: 0, right: 6 });
    });

    it('should contain 7 doubles', () => {
      const tiles = generateTileSet();
      const doubles = tiles.filter(t => t.left === t.right);
      expect(doubles).toHaveLength(7);
    });

    it('should have no duplicate tiles', () => {
      const tiles = generateTileSet();
      const seen = new Set<string>();
      for (const tile of tiles) {
        const key = `${Math.min(tile.left, tile.right)}-${Math.max(tile.left, tile.right)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });

  describe('shuffleAndDeal', () => {
    it('should deal 7 tiles to each of 4 players', () => {
      const { hands } = shuffleAndDeal(4);
      expect(hands).toHaveLength(4);
      for (const hand of hands) {
        expect(hand).toHaveLength(7);
      }
    });

    it('should have no remaining tiles for 4 players', () => {
      const { remaining } = shuffleAndDeal(4);
      expect(remaining).toHaveLength(0);
    });

    it('should deal all 28 unique tiles', () => {
      const { hands } = shuffleAndDeal(4);
      const allTiles = hands.flat();
      expect(allTiles).toHaveLength(28);

      const seen = new Set<string>();
      for (const tile of allTiles) {
        const key = `${Math.min(tile.left, tile.right)}-${Math.max(tile.left, tile.right)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });
});

describe('game-engine', () => {
  describe('tileMatchesEnd', () => {
    it('should match left side', () => {
      expect(tileMatchesEnd({ left: 3, right: 5 }, 3)).toBe(true);
    });

    it('should match right side', () => {
      expect(tileMatchesEnd({ left: 3, right: 5 }, 5)).toBe(true);
    });

    it('should not match when neither side equals value', () => {
      expect(tileMatchesEnd({ left: 3, right: 5 }, 4)).toBe(false);
    });
  });

  describe('tilesEqual', () => {
    it('should detect equal tiles in same order', () => {
      expect(tilesEqual({ left: 3, right: 5 }, { left: 3, right: 5 })).toBe(true);
    });

    it('should detect equal tiles in reverse order', () => {
      expect(tilesEqual({ left: 3, right: 5 }, { left: 5, right: 3 })).toBe(true);
    });

    it('should detect unequal tiles', () => {
      expect(tilesEqual({ left: 3, right: 5 }, { left: 3, right: 4 })).toBe(false);
    });
  });

  describe('findStartingPlayer', () => {
    it('should find the player with the highest double', () => {
      const players = [
        { id: 'p1', hand: [{ left: 3, right: 3 }, { left: 2, right: 5 }] },
        { id: 'p2', hand: [{ left: 6, right: 6 }, { left: 1, right: 4 }] },
        { id: 'p3', hand: [{ left: 5, right: 5 }, { left: 0, right: 3 }] },
        { id: 'p4', hand: [{ left: 4, right: 4 }, { left: 2, right: 6 }] },
      ];

      const result = findStartingPlayer(players);
      expect(result).not.toBeNull();
      expect(result!.playerId).toBe('p2');
      expect(result!.tile).toEqual({ left: 6, right: 6 });
    });

    it('should find lower double when highest is absent', () => {
      const players = [
        { id: 'p1', hand: [{ left: 1, right: 1 }, { left: 2, right: 5 }] },
        { id: 'p2', hand: [{ left: 0, right: 6 }, { left: 1, right: 4 }] },
        { id: 'p3', hand: [{ left: 4, right: 4 }, { left: 0, right: 3 }] },
        { id: 'p4', hand: [{ left: 2, right: 2 }, { left: 2, right: 6 }] },
      ];

      const result = findStartingPlayer(players);
      expect(result).not.toBeNull();
      expect(result!.playerId).toBe('p3');
      expect(result!.tile).toEqual({ left: 4, right: 4 });
    });

    it('should return null if no doubles exist', () => {
      const players = [
        { id: 'p1', hand: [{ left: 1, right: 2 }] },
        { id: 'p2', hand: [{ left: 3, right: 4 }] },
      ];

      const result = findStartingPlayer(players);
      expect(result).toBeNull();
    });
  });

  describe('getValidMoves', () => {
    it('should allow any tile on empty board', () => {
      const hand: DominoTile[] = [
        { left: 3, right: 5 },
        { left: 1, right: 2 },
      ];
      const moves = getValidMoves(hand, -1, -1);
      expect(moves).toHaveLength(2);
      expect(moves.every(m => m.end === 'left')).toBe(true);
    });

    it('should return correct moves for matching open ends', () => {
      const hand: DominoTile[] = [
        { left: 3, right: 5 },
        { left: 1, right: 2 },
        { left: 5, right: 6 },
      ];
      // Board has open left=3, open right=5
      const moves = getValidMoves(hand, 3, 5);

      // [3|5] matches left (3) and right (5)
      // [1|2] matches nothing
      // [5|6] matches right (5)
      const tileKeys = moves.map(m => `${m.tile.left}-${m.tile.right}:${m.end}`);
      expect(tileKeys).toContain('3-5:left');
      expect(tileKeys).toContain('3-5:right');
      expect(tileKeys).toContain('5-6:right');
      expect(moves.find(m => m.tile.left === 1 && m.tile.right === 2)).toBeUndefined();
    });

    it('should return empty array when no moves available', () => {
      const hand: DominoTile[] = [
        { left: 1, right: 2 },
        { left: 0, right: 0 },
      ];
      const moves = getValidMoves(hand, 5, 6);
      expect(moves).toHaveLength(0);
    });
  });

  describe('validateAndPlace', () => {
    it('should place first tile on empty board', () => {
      const tile: DominoTile = { left: 6, right: 6 };
      const result = validateAndPlace(tile, 'left', [], -1, -1);

      expect(result).not.toBeNull();
      expect(result!.board).toHaveLength(1);
      expect(result!.board[0].end).toBe('first');
      expect(result!.openLeft).toBe(6);
      expect(result!.openRight).toBe(6);
    });

    it('should place matching tile on left end', () => {
      const board: BoardTile[] = [
        { tile: { left: 6, right: 6 }, end: 'first', flipped: false },
      ];
      const tile: DominoTile = { left: 3, right: 6 };
      const result = validateAndPlace(tile, 'left', board, 6, 6);

      expect(result).not.toBeNull();
      expect(result!.board).toHaveLength(2);
      expect(result!.openLeft).toBe(3);
      expect(result!.openRight).toBe(6);
    });

    it('should place matching tile on right end', () => {
      const board: BoardTile[] = [
        { tile: { left: 6, right: 6 }, end: 'first', flipped: false },
      ];
      const tile: DominoTile = { left: 6, right: 2 };
      const result = validateAndPlace(tile, 'right', board, 6, 6);

      expect(result).not.toBeNull();
      expect(result!.board).toHaveLength(2);
      expect(result!.openLeft).toBe(6);
      expect(result!.openRight).toBe(2);
    });

    it('should reject tile that does not match', () => {
      const board: BoardTile[] = [
        { tile: { left: 6, right: 6 }, end: 'first', flipped: false },
      ];
      const tile: DominoTile = { left: 3, right: 4 };
      const result = validateAndPlace(tile, 'left', board, 6, 6);

      expect(result).toBeNull();
    });

    it('should flip tile when needed for left placement', () => {
      const board: BoardTile[] = [
        { tile: { left: 3, right: 5 }, end: 'first', flipped: false },
      ];
      // open left is 3, tile left is 3 - needs flip so right faces outward
      const tile: DominoTile = { left: 3, right: 1 };
      const result = validateAndPlace(tile, 'left', board, 3, 5);

      expect(result).not.toBeNull();
      expect(result!.openLeft).toBe(1); // right side becomes new open left
      expect(result!.board[0].flipped).toBe(true);
    });

    it('should flip tile when needed for right placement', () => {
      const board: BoardTile[] = [
        { tile: { left: 3, right: 5 }, end: 'first', flipped: false },
      ];
      // open right is 5, tile right is 5 - needs flip so left faces outward
      const tile: DominoTile = { left: 2, right: 5 };
      const result = validateAndPlace(tile, 'right', board, 3, 5);

      expect(result).not.toBeNull();
      expect(result!.openRight).toBe(2); // After flip: right(5) faces board, left(2) is new open
      // Wait - let's re-check the logic:
      // tile.right === openRight (5===5), so flipped=true, newOpenRight = tile.left = 2
      expect(result!.board[result!.board.length - 1].flipped).toBe(true);
    });
  });

  describe('isBlocked', () => {
    it('should detect blocked game', () => {
      const players = [
        { hand: [{ left: 1, right: 2 }] },
        { hand: [{ left: 3, right: 4 }] },
        { hand: [{ left: 1, right: 3 }] },
        { hand: [{ left: 2, right: 4 }] },
      ];
      // Open ends are 5 and 6 - no one has a 5 or 6
      expect(isBlocked(players, 5, 6)).toBe(true);
    });

    it('should detect non-blocked game', () => {
      const players = [
        { hand: [{ left: 5, right: 2 }] },
        { hand: [{ left: 3, right: 4 }] },
        { hand: [{ left: 1, right: 3 }] },
        { hand: [{ left: 2, right: 4 }] },
      ];
      expect(isBlocked(players, 5, 6)).toBe(false);
    });
  });

  describe('calculateRoundScore', () => {
    it('should award points to team with lower pips', () => {
      const players = [
        { team: 1, hand: [{ left: 1, right: 1 }] }, // 2 pips
        { team: 2, hand: [{ left: 5, right: 6 }] }, // 11 pips
        { team: 1, hand: [{ left: 0, right: 1 }] }, // 1 pip
        { team: 2, hand: [{ left: 3, right: 4 }] }, // 7 pips
      ];

      const result = calculateRoundScore(players);
      // Team 1: 2 + 1 = 3 pips
      // Team 2: 11 + 7 = 18 pips
      // Team 1 wins, gets team 2's 18 pips
      expect(result.winningTeam).toBe(1);
      expect(result.team1Points).toBe(18);
      expect(result.team2Points).toBe(0);
    });

    it('should award team 2 when they have lower pips', () => {
      const players = [
        { team: 1, hand: [{ left: 6, right: 6 }] }, // 12 pips
        { team: 2, hand: [{ left: 0, right: 1 }] }, // 1 pip
        { team: 1, hand: [{ left: 5, right: 5 }] }, // 10 pips
        { team: 2, hand: [{ left: 0, right: 0 }] }, // 0 pips
      ];

      const result = calculateRoundScore(players);
      expect(result.winningTeam).toBe(2);
      expect(result.team1Points).toBe(0);
      expect(result.team2Points).toBe(22); // Team 1's total pips
    });

    it('should return no points on tie', () => {
      const players = [
        { team: 1, hand: [{ left: 3, right: 3 }] }, // 6 pips
        { team: 2, hand: [{ left: 2, right: 4 }] }, // 6 pips
        { team: 1, hand: [] },
        { team: 2, hand: [] },
      ];

      const result = calculateRoundScore(players);
      expect(result.winningTeam).toBe(0);
      expect(result.team1Points).toBe(0);
      expect(result.team2Points).toBe(0);
    });

    it('should handle empty hands (player domino-ed)', () => {
      const players = [
        { team: 1, hand: [] }, // Winner emptied hand
        { team: 2, hand: [{ left: 5, right: 6 }] }, // 11 pips
        { team: 1, hand: [{ left: 1, right: 2 }] }, // 3 pips (teammate)
        { team: 2, hand: [{ left: 3, right: 3 }] }, // 6 pips
      ];

      const result = calculateRoundScore(players);
      // Team 1: 0 + 3 = 3
      // Team 2: 11 + 6 = 17
      // Team 1 wins, gets 17
      expect(result.winningTeam).toBe(1);
      expect(result.team1Points).toBe(17);
    });
  });

  describe('getNextPlayerSeat', () => {
    it('should cycle through seats 0-3', () => {
      expect(getNextPlayerSeat(0)).toBe(1);
      expect(getNextPlayerSeat(1)).toBe(2);
      expect(getNextPlayerSeat(2)).toBe(3);
      expect(getNextPlayerSeat(3)).toBe(0);
    });
  });
});
