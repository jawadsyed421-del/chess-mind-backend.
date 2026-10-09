-- ==============================================================================
-- ChessMind Database Schema (Supabase / PostgreSQL)
-- Run this in your Supabase Project -> SQL Editor
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Chess Accounts (Connected Chess.com / Lichess accounts)
CREATE TABLE IF NOT EXISTS public.chess_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('chesscom', 'lichess')),
    username TEXT NOT NULL,
    avatar TEXT,
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, platform)
);

-- 3. Games (Imported PGNs and game metadata)
CREATE TABLE IF NOT EXISTS public.games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('chesscom', 'lichess')),
    platform_game_id TEXT NOT NULL,
    pgn TEXT NOT NULL,
    white_player TEXT NOT NULL,
    black_player TEXT NOT NULL,
    player_color TEXT NOT NULL CHECK (player_color IN ('white', 'black')),
    opponent TEXT NOT NULL,
    result TEXT NOT NULL,
    date_played TIMESTAMPTZ NOT NULL,
    time_control TEXT,
    rated BOOLEAN DEFAULT FALSE,
    opening_name TEXT DEFAULT 'Standard Chess',
    analysis_status TEXT DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'analyzing', 'complete')),
    white_rating INTEGER,
    black_rating INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, platform_game_id)
);

-- 4. Move Analysis (Move-by-move Stockfish diagnostics)
CREATE TABLE IF NOT EXISTS public.move_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
    move_number INTEGER NOT NULL,
    player_color TEXT NOT NULL,
    fen_before TEXT NOT NULL,
    fen_after TEXT NOT NULL,
    move_played TEXT NOT NULL,
    best_move TEXT NOT NULL,
    eval_before NUMERIC(6, 2),
    eval_after NUMERIC(6, 2),
    eval_drop NUMERIC(6, 2),
    mistake_type TEXT CHECK (mistake_type IN ('strategic', 'positional', 'tactical')),
    tactical_theme TEXT,
    explanation TEXT,
    better_move_explanation TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Player Weakness Profile
CREATE TABLE IF NOT EXISTS public.player_profile (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    total_games_analyzed INTEGER DEFAULT 0,
    tactical_score JSONB DEFAULT '{"forks": "needs_practice", "pins": "improving", "hanging_pieces": "strong"}'::jsonb,
    positional_score JSONB DEFAULT '{"pawn_structure": "needs_practice", "weak_squares": "improving", "open_files": "strong"}'::jsonb,
    strategic_score JSONB DEFAULT '{"planning": "needs_practice", "piece_coordination": "improving"}'::jsonb,
    current_focus TEXT DEFAULT 'Tactical Fork Recognition & Pawn Structure Decisions',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Puzzles Database (Curated themed puzzles)
CREATE TABLE IF NOT EXISTS public.puzzles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fen TEXT NOT NULL,
    solution_moves TEXT NOT NULL,
    theme TEXT NOT NULL,
    difficulty INTEGER DEFAULT 1200,
    instruction TEXT,
    explanation TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Grandmaster Studies
CREATE TABLE IF NOT EXISTS public.grandmaster_games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    white_player TEXT NOT NULL,
    black_player TEXT NOT NULL,
    year INTEGER,
    theme TEXT NOT NULL,
    why_study TEXT NOT NULL,
    fen_key_position TEXT NOT NULL,
    key_move TEXT NOT NULL,
    gm_move_explanation TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Training History (Records of in-app practice attempts)
CREATE TABLE IF NOT EXISTS public.training_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('puzzle', 'own_mistake', 'gm_study')),
    theme TEXT,
    fen_practiced TEXT NOT NULL,
    user_move TEXT NOT NULL,
    correct_move TEXT NOT NULL,
    was_correct BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.chess_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.move_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_history ENABLE ROW LEVEL SECURITY;

-- Default RLS Policies (Users can only see and manage their own data)
CREATE POLICY "Users can manage their chess accounts"
    ON public.chess_accounts FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their games"
    ON public.games FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can access profile"
    ON public.player_profile FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their training history"
    ON public.training_history FOR ALL
    USING (auth.uid() = user_id);

-- Public read for curated puzzles and GM games
ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grandmaster_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view puzzles"
    ON public.puzzles FOR SELECT USING (true);

CREATE POLICY "Anyone can view gm games"
    ON public.grandmaster_games FOR SELECT USING (true);
