import { Router } from 'express';
import { requireOwnership } from '../utils/ownership.js';
import { fetchChessComGames } from '../services/chesscom.js';
import { fetchLichessGames } from '../services/lichess.js';
import { supabase } from '../config/supabase.js';

const router = Router();

// In-memory game store when Supabase is not configured
const gameStore = new Map();

/**
 * POST /api/games/fetch
 * Fetch games from Chess.com or Lichess and store them
 */
router.post('/fetch', requireOwnership(req => req.body), async (req, res) => {
  try {
    const { platform, username, user_id, max_games = 50 } = req.body;

    if (!platform || !username) {
      return res.status(400).json({ error: 'Platform and username are required' });
    }

    // Fetch games from the platform
    let games;
    if (platform === 'chesscom') {
      games = await fetchChessComGames(username, max_games);
    } else if (platform === 'lichess') {
      games = await fetchLichessGames(username, max_games);
    } else {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    // Store in Supabase if available
    if (supabase && user_id) {
      const gamesToInsert = games.map(g => ({
        ...g,
        user_id,
      }));

      // Use upsert to avoid duplicates based on platform_game_id
      for (const game of gamesToInsert) {
        const { error } = await supabase
          .from('games')
          .upsert(game, {
            onConflict: 'user_id,platform_game_id',
            ignoreDuplicates: true,
          });
        if (error) console.error('Game insert error:', error.message);
      }

      // Update last_synced_at
      await supabase
        .from('chess_accounts')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('user_id', user_id)
        .eq('platform', platform);
    } else {
      // In-memory fallback
      const key = `${platform}:${username}`;
      const existing = gameStore.get(key) || [];
      const existingIds = new Set(existing.map(g => g.platform_game_id));
      const newGames = games.filter(g => !existingIds.has(g.platform_game_id));
      gameStore.set(key, [...existing, ...newGames]);
    }

    res.json({
      fetched: games.length,
      games: games, // Include PGN so frontend can analyze and replay immediately
    });
  } catch (error) {
    console.error('Game fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/games/list
 * Get stored games for a user
 */
router.get('/list', requireOwnership(req => req.query), async (req, res) => {
  try {
    const { platform, username, user_id } = req.query;

    if (supabase && user_id) {
      let query = supabase
        .from('games')
        .select('*')
        .eq('user_id', user_id)
        .order('date_played', { ascending: false });

      if (platform) query = query.eq('platform', platform);

      const { data, error } = await query;
      if (error) throw error;

      return res.json({ games: data || [] });
    }

    // In-memory fallback
    const key = `${platform}:${username}`;
    const games = gameStore.get(key) || [];
    res.json({ games });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/games/:id
 * Get a single game with full PGN
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (supabase) {
      const { data, error } = await supabase
        .from('games')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return res.json({ game: data });
    }

    // In-memory fallback - search through all games
    for (const games of gameStore.values()) {
      const game = games.find(g => g.platform_game_id === id);
      if (game) return res.json({ game });
    }

    res.status(404).json({ error: 'Game not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
