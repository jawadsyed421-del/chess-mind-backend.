import axios from 'axios';

const LICHESS_API = 'https://lichess.org/api';

/**
 * Fetch player profile from Lichess
 */
export async function getLichessProfile(username) {
  try {
    const response = await axios.get(`${LICHESS_API}/user/${username}`, {
      headers: { 'Accept': 'application/json' }
    });
    const data = response.data;
    return {
      username: data.username,
      name: data.profile?.realName || data.username,
      avatar: null, // Lichess doesn't expose avatars via API
      url: `https://lichess.org/@/${data.username}`,
      joined: data.createdAt,
      country: data.profile?.country || null,
      status: data.disabled ? 'closed' : 'active',
    };
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Lichess player "${username}" not found`);
    }
    throw new Error('Failed to connect to Lichess API');
  }
}

/**
 * Fetch player stats from Lichess
 */
export async function getLichessStats(username) {
  try {
    const response = await axios.get(`${LICHESS_API}/user/${username}`, {
      headers: { 'Accept': 'application/json' }
    });
    const perfs = response.data.perfs || {};
    const stats = {};

    const formats = {
      rapid: 'rapid',
      blitz: 'blitz',
      bullet: 'bullet',
      classical: 'classical',
      correspondence: 'daily'
    };

    for (const [lichessKey, mappedName] of Object.entries(formats)) {
      if (perfs[lichessKey]) {
        stats[mappedName] = {
          rating: perfs[lichessKey].rating || null,
          best: null,
          wins: perfs[lichessKey].games || 0,
          losses: 0,
          draws: 0,
        };
      }
    }
    return stats;
  } catch (error) {
    throw new Error('Failed to fetch Lichess stats');
  }
}

/**
 * Fetch recent games from Lichess (NDJSON format)
 */
export async function fetchLichessGames(username, maxGames = 50) {
  try {
    const response = await axios.get(
      `${LICHESS_API}/games/user/${username}`,
      {
        params: {
          max: maxGames,
          pgnInJson: true,
          clocks: false,
          evals: false,
          opening: true,
        },
        headers: {
          'Accept': 'application/x-ndjson'
        },
        responseType: 'text'
      }
    );

    const games = response.data
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean);

    return games.map(game => {
      const playerColor = game.players?.white?.user?.name?.toLowerCase() === username.toLowerCase()
        ? 'white' : 'black';

      const opponent = playerColor === 'white'
        ? game.players?.black?.user?.name
        : game.players?.white?.user?.name;

      let result = 'unknown';
      if (game.winner === playerColor) result = 'win';
      else if (game.winner && game.winner !== playerColor) result = 'loss';
      else if (game.status === 'draw' || game.status === 'stalemate') result = 'draw';

      return {
        platform: 'lichess',
        platform_game_id: game.id || `lichess_${Date.now()}`,
        pgn: game.pgn || '',
        white_player: game.players?.white?.user?.name || 'Anonymous',
        black_player: game.players?.black?.user?.name || 'Anonymous',
        player_color: playerColor,
        opponent: opponent || 'Anonymous',
        result: result,
        date_played: game.createdAt ? new Date(game.createdAt).toISOString() : new Date().toISOString(),
        time_control: game.clock ? `${game.clock.initial / 60}+${game.clock.increment}` : game.speed || 'unknown',
        rated: game.rated || false,
        opening_name: game.opening?.name || 'Unknown Opening',
        analysis_status: 'pending',
        white_rating: game.players?.white?.rating || null,
        black_rating: game.players?.black?.rating || null,
      };
    });
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Lichess player "${username}" not found`);
    }
    throw new Error('Failed to fetch Lichess games');
  }
}
