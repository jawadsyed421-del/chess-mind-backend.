import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const isValidUrl = (url) => {
  try {
    return Boolean(url && (url.startsWith('http://') || url.startsWith('https://')));
  } catch {
    return false;
  }
};

const isSupabaseConfigured = isValidUrl(supabaseUrl) && Boolean(supabaseServiceKey && supabaseServiceKey !== 'your_supabase_service_role_key_here');

if (!isSupabaseConfigured) {
  console.log('ℹ️  Supabase URL/Key not configured or placeholder detected. Running in in-memory session mode.');
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

export const supabaseAnon = isSupabaseConfigured && isValidUrl(supabaseUrl) && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
