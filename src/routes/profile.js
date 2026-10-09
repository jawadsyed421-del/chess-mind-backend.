import { Router } from 'express';
import { getChessComProfile, getChessComStats, fetchChessComGames } from '../services/chesscom.js';
import { getLichessProfile, getLichessStats, fetchLichessGames } from '../services/lichess.js';
import { supabase } from '../config/supabase.js';

const router = Router();

/**
 * POST /api/profile/connect
 * Connect a Chess.com or Lichess profile
 */
router.post('/connect', async (req, res) => {
  try {
    const { platform, username, user_id } = req.body;

    if (!platform || !username) {
      return res.status(400).json({ error: 'Platform and username are required' });
    }

    if (!['chesscom', 'lichess'].includes(platform)) {
      return res.status(400).json({ error: 'Platform must be "chesscom" or "lichess"' });
    }

    // Fetch profile from the platform
    let profile, stats;
    if (platform === 'chesscom') {
      profile = await getChessComProfile(username);
      stats = await getChessComStats(username);
    } else {
      profile = await getLichessProfile(username);
      stats = await getLichessStats(username);
    }

    // Store in Supabase if available
    if (supabase && user_id) {
      const { error } = await supabase
        .from('chess_accounts')
        .upsert({
          user_id,
          platform,
          username: profile.username,
          avatar: profile.avatar,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'user_id,platform' });

      if (error) console.error('Supabase error:', error);
    }

    res.json({
      profile,
      stats,
      connected: true,
    });
  } catch (error) {
    res.status(error.message.includes('not found') ? 404 : 500).json({
      error: error.message
    });
  }
});

/**
 * GET /api/profile/:platform/:username
 * Get profile info
 */
router.get('/:platform/:username', async (req, res) => {
  try {
    const { platform, username } = req.params;

    let profile, stats;
    if (platform === 'chesscom') {
      profile = await getChessComProfile(username);
      stats = await getChessComStats(username);
    } else if (platform === 'lichess') {
      profile = await getLichessProfile(username);
      stats = await getLichessStats(username);
    } else {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    res.json({ profile, stats });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

export default router;
