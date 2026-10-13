import { Router } from 'express';
import { getChessComProfile, getChessComStats, fetchChessComGames } from '../services/chesscom.js';
import { getLichessProfile, getLichessStats, fetchLichessGames } from '../services/lichess.js';
import { supabase } from '../config/supabase.js';

import axios from 'axios';
import { issueOwnershipToken } from '../utils/ownership.js';

const router = Router();

/**
 * POST /api/profile/verify
 * Proves the caller owns a Chess.com / Lichess account: the one-time code must appear in the
 * Chess.com profile "Location" field (or the Lichess bio). Nobody else can edit that profile.
 */
router.post('/verify', async (req, res) => {
  try {
    const { platform, username, code } = req.body;
    if (!platform || !username || !code || String(code).length < 8) {
      return res.status(400).json({ error: 'Platform, username and verification code are required' });
    }
    const name = encodeURIComponent(String(username).trim());
    const headers = { 'User-Agent': 'ChessMind-App/1.0 (https://github.com/chessmind)', Accept: 'application/json' };
    let field = '';
    if (platform === 'chesscom') {
      const r = await axios.get(`https://api.chess.com/pub/player/${name}`, { headers });
      field = r.data.location || '';
    } else if (platform === 'lichess') {
      const r = await axios.get(`https://lichess.org/api/user/${name}`, { headers });
      field = r.data.profile?.bio || '';
    } else {
      return res.status(400).json({ error: 'Invalid platform' });
    }
    if (!field.includes(code)) {
      return res.status(403).json({
        error: platform === 'chesscom'
          ? 'Code not found in your Chess.com profile Location yet. Save it there and try again (it can take a minute).'
          : 'Code not found in your Lichess bio yet. Save it there and try again.',
      });
    }
    res.json({ verified: true, token: issueOwnershipToken(platform, String(username).trim()) });
  } catch (error) {
    if (error.response?.status === 404) return res.status(404).json({ error: 'Account not found' });
    console.error('Verify error:', error.code, error.message);
    res.status(500).json({ error: 'Could not reach the chess platform to verify. Try again.' });
  }
});

/**
 * POST /api/profile/verify-lichess
 * Lichess OAuth: the browser sends the access token it got by logging in on lichess.org; we ask Lichess
 * who that token belongs to and issue an ownership token for exactly that username.
 */
router.post('/verify-lichess', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'access_token is required' });
    const r = await axios.get('https://lichess.org/api/account', { headers: { Authorization: `Bearer ${access_token}` } });
    res.json({ verified: true, username: r.data.username, token: issueOwnershipToken('lichess', r.data.username) });
  } catch (error) {
    res.status(401).json({ error: 'Lichess sign-in could not be verified.' });
  }
});

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
