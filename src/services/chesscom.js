import axios from 'axios';

const CHESSCOM_API = 'https://api.chess.com/pub';
const DEFAULT_HEADERS = {
  'User-Agent': 'ChessMind-App/1.0 (https://github.com/chessmind)',
};

/**
 * Fetch player profile from Chess.com
 */
export async function getChessComProfile(username) {
  try {
    const response = await axios.get(`${CHESSCOM_API}/player/${username}`, {
      headers: { ...DEFAULT_HEADERS, 'Accept': 'application/json' }
    });
    return {
      username: response.data.username,
      name: response.data.name || response.data.username,
      avatar: response.data.avatar || null,
      url: response.data.url,
      joined: response.data.joined,
      country: response.data.country,
      status: response.data.status,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Chess.com player "${username}" not found`);
    }
    console.error('Chess.com profile error:', error.code, error.message, error.response?.status);
    throw new Error('Failed to connect to Chess.com API');
  }
}

/**
 * Fetch player stats (ratings) from Chess.com
 */
export async function getChessComStats(username) {
  try {
    const response = await axios.get(`${CHESSCOM_API}/player/${username}/stats`, {
      headers: { ...DEFAULT_HEADERS, 'Accept': 'application/json' }
    });
    const data = response.data;
    const stats = {};

    const formats = ['chess_rapid', 'chess_blitz', 'chess_bullet', 'chess_daily'];
    for (const format of formats) {
      if (data[format]) {
        const name = format.replace('chess_', '');
        stats[name] = {
          rating: data[format].last?.rating || null,
          best: data[format].best?.rating || null,
          wins: data[format].record?.win || 0,
          losses: data[format].record?.loss || 0,
          draws: data[format].record?.draw || 0,
        };
      }
    }
    return stats;
  } catch (error) {
    throw new Error('Failed to fetch Chess.com stats');
  }
}

/**
 * Fetch game archive list (monthly archive URLs) from Chess.com
 */
export async function getChessComArchives(username) {
  try {
    const response = await axios.get(`${CHESSCOM_API}/player/${username}/games/archives`, {
      headers: { ...DEFAULT_HEADERS, 'Accept': 'application/json' }
    });
    return response.data.archives || [];
  } catch (error) {
    throw new Error('Failed to fetch Chess.com game archives');
  }
}

/**
 * Fetch games from a specific monthly archive
 */
export async function getChessComMonthlyGames(archiveUrl) {
  try {
    const response = await axios.get(archiveUrl, {
      headers: { ...DEFAULT_HEADERS, 'Accept': 'application/json' }
    });
    return response.data.games || [];
  } catch (error) {
    throw new Error('Failed to fetch games from archive');
  }
}

/**
 * Fetch recent games from Chess.com (last N months)
 */
export async function fetchChessComGames(username, maxGames = 50) {
  const archives = await getChessComArchives(username);
  if (!archives.length) return [];

  // Start from most recent archives
  const recentArchives = archives.slice(-3).reverse();
  const allGames = [];

  for (const archiveUrl of recentArchives) {
    if (allGames.length >= maxGames) break;

    const games = await getChessComMonthlyGames(archiveUrl);

    for (const game of games.reverse()) {
      if (allGames.length >= maxGames) break;

      const playerColor = game.white?.username?.toLowerCase() === username.toLowerCase()
        ? 'white' : 'black';

      const opponent = playerColor === 'white'
        ? game.black?.username : game.white?.username;

      let result = 'unknown';
      const playerResult = game[playerColor]?.result;
      if (playerResult === 'win') result = 'win';
      else if (playerResult === 'checkmated' || playerResult === 'resigned' || playerResult === 'timeout' || playerResult === 'abandoned') result = 'loss';
      else if (playerResult === 'stalemate' || playerResult === 'agreed' || playerResult === 'repetition' || playerResult === 'insufficient' || playerResult === 'timevsinsufficient' || playerResult === '50move') result = 'draw';

      allGames.push({
        platform: 'chesscom',
        platform_game_id: game.url || `chesscom_${game.end_time}`,
        pgn: game.pgn || '',
        white_player: game.white?.username || 'Unknown',
        black_player: game.black?.username || 'Unknown',
        player_color: playerColor,
        opponent: opponent || 'Unknown',
        result: result,
        date_played: game.end_time ? new Date(game.end_time * 1000).toISOString() : new Date().toISOString(),
        time_control: game.time_control || 'unknown',
        rated: game.rated || false,
        opening_name: extractOpening(game.pgn),
        analysis_status: 'pending',
        white_rating: game.white?.rating || null,
        black_rating: game.black?.rating || null,
      });
    }
  }

  return allGames;
}

/**
 * Extract opening name from PGN headers
 */
function extractOpening(pgn) {
  if (!pgn) return 'Unknown Opening';
  const match = pgn.match(/\[ECOUrl ".*?\/([^"]+)"\]/);
  if (match) {
    return match[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  const ecoMatch = pgn.match(/\[Opening "([^"]+)"\]/);
  if (ecoMatch) return ecoMatch[1];
  return 'Unknown Opening';
}
