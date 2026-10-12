import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Signing secret: env var, else a random one persisted next to the server so tokens survive restarts.
const secretFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.ownership-secret');
function loadSecret() {
  if (process.env.OWNERSHIP_SECRET) return process.env.OWNERSHIP_SECRET;
  try {
    return fs.readFileSync(secretFile, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(secretFile, s, { mode: 0o600 }); } catch { /* in-memory fallback */ }
    return s;
  }
}
const SECRET = loadSecret();
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sign = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

/** Issues a token proving the caller controls `username` on `platform`. */
export function issueOwnershipToken(platform, username) {
  const body = Buffer.from(JSON.stringify({ p: platform, u: String(username).toLowerCase(), exp: Date.now() + TTL_MS })).toString('base64url');
  return `${body}.${sign(body)}`;
}

function valid(token, platform, username) {
  if (!token || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const { p, u, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p === platform && u === String(username).toLowerCase() && exp > Date.now();
  } catch {
    return false;
  }
}

/** Express guard: rejects the request unless X-Ownership-Token proves ownership of the requested account. */
export function requireOwnership(getTarget) {
  return (req, res, next) => {
    const { platform, username } = getTarget(req);
    if (!valid(req.get('X-Ownership-Token'), platform, username)) {
      return res.status(403).json({ error: 'Ownership of this chess account has not been verified. Please verify the account first.' });
    }
    next();
  };
}
