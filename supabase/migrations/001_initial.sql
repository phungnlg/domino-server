-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Room status enum
CREATE TYPE room_status AS ENUM ('waiting', 'playing', 'finished');

-- Game phase enum
CREATE TYPE game_phase AS ENUM ('waiting', 'dealing', 'playing', 'round_end', 'game_over');

-- Move type enum
CREATE TYPE move_type AS ENUM ('place', 'pass');

-- Rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  status room_status DEFAULT 'waiting',
  max_score INT DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Players table
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  team INT NOT NULL CHECK (team IN (1, 2)),
  seat INT NOT NULL CHECK (seat >= 0 AND seat < 4),
  hand JSONB DEFAULT '[]',
  is_bot BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, seat)
);

-- Game states table
CREATE TABLE game_states (
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE UNIQUE,
  board JSONB DEFAULT '[]',
  current_player_id UUID REFERENCES players(id),
  open_left INT DEFAULT -1,
  open_right INT DEFAULT -1,
  round INT DEFAULT 1,
  scores JSONB DEFAULT '{"team1": 0, "team2": 0}',
  phase game_phase DEFAULT 'waiting',
  consecutive_passes INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Moves table
CREATE TABLE moves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id),
  tile JSONB,
  board_end TEXT,
  move_type move_type NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime on game_states and moves
ALTER PUBLICATION supabase_realtime ADD TABLE game_states;
ALTER PUBLICATION supabase_realtime ADD TABLE moves;

-- Indexes
CREATE INDEX idx_players_room ON players(room_id);
CREATE INDEX idx_game_states_room ON game_states(room_id);
CREATE INDEX idx_moves_room ON moves(room_id);
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_status ON rooms(status);
