// ============================================================
// LIFE OS — SHARED SUPABASE CLIENT v3
// supabaseClient.js
//
// Uses new Supabase publishable key format (sb_publishable_...)
// URL: https://tphbpwzozkskytoichho.supabase.co
// ============================================================

import { createClient } from '@supabase/supabase-js';

// ─── Safe env detection ───────────────────────────────────────────────────────
const viteEnv = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env
  : {};

const supabaseUrl =
  viteEnv.VITE_SUPABASE_URL ||
  (typeof window !== 'undefined' ? window.SUPABASE_URL : '') ||
  '';

const supabaseKey =
  viteEnv.VITE_SUPABASE_ANON_KEY ||
  (typeof window !== 'undefined' ? window.SUPABASE_ANON_KEY : '') ||
  '';

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function getCurrentUser() {
  if (!supabase) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user || null;
  } catch {
    return null;
  }
}

export async function signInAnonymously() {
  if (!supabase) return { user: null, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    return { user: data?.user || null, error };
  } catch (err) {
    return { user: null, error: err.message };
  }
}

// IMPORTANT: use updateUser to upgrade anonymous → identified.
// This preserves the anonymous user's existing data.
// Do NOT use signInWithOtp here.
export async function upgradeToEmail(email) {
  if (!supabase) return { error: 'Supabase not configured' };
  try {
    const { error } = await supabase.auth.updateUser({ email });
    return { error };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Access check ─────────────────────────────────────────────────────────────
export async function getAccess(product) {
  if (!supabase) return 'none';
  try {
    const user = await getCurrentUser();
    if (!user) return 'none';

    const { data, error } = await supabase
      .from('access')
      .select('tier, expires_at')
      .eq('user_id', user.id)
      .eq('product', product)
      .single();

    if (error || !data) return 'none';
    if (data.expires_at && new Date(data.expires_at) < new Date()) return 'none';

    return data.tier || 'full';
  } catch {
    return 'none';
  }
}

// ─── Pulse trial grant ────────────────────────────────────────────────────────
export async function grantPulseTrial(userId) {
  if (!supabase || !userId) return { error: 'Missing supabase or userId' };
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { error } = await supabase
      .from('access')
      .upsert({
        user_id:    userId,
        product:    'pulse',
        tier:       'full',
        source:     'trial',
        expires_at: expiresAt
      }, { onConflict: 'user_id,product' });
    return { error };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Foundation signed URL ────────────────────────────────────────────────────
export async function getFoundationAudioUrl(storagePath, expiresInSeconds = 3600) {
  if (!supabase) return { url: null, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase.storage
      .from('nextus-audio')
      .createSignedUrl(storagePath, expiresInSeconds);
    return { url: data?.signedUrl || null, error };
  } catch (err) {
    return { url: null, error: err.message };
  }
}

export default supabase;
