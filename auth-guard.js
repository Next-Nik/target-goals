// ============================================================
// LIFE OS — AUTH GUARD v3 (PRODUCTION)
// Redirects to login if no session. Returns user to their
// exact location after sign-in via ?redirect= param.
//
// Usage: include AFTER Supabase CDN, BEFORE any tool JS.
// ============================================================

(async function() {
  const SUPABASE_URL      = window.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;
  const LOGIN_URL         = 'https://nextus.world/login.html';
  const AUTH_TIMEOUT_MS   = 3000;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('YOUR_')) {
    console.warn('[AuthGuard] Supabase not configured — skipping auth check.');
    return;
  }

  let sb;
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: window.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      }
    });
  } catch (e) {
    console.warn('[AuthGuard] Could not initialise Supabase:', e);
    return;
  }

  const timeoutPromise = new Promise(resolve =>
    setTimeout(() => resolve({ timedOut: true }), AUTH_TIMEOUT_MS)
  );

  const sessionPromise = sb.auth.getSession().then(({ data, error }) => ({
    session: data?.session, error, timedOut: false
  })).catch(e => ({ session: null, error: e, timedOut: false }));

  try {
    const result = await Promise.race([sessionPromise, timeoutPromise]);

    if (result.timedOut || result.error) {
      // Network issue — fail open rather than block the tool
      console.warn('[AuthGuard] Session check failed — failing open.');
      return;
    }

    if (result.session?.user) {
      window.LIFEOS_USER    = result.session.user;
      window.LIFEOS_USER_ID = result.session.user.id;
      console.log('[AuthGuard] Session active:', result.session.user.id);
    } else {
      // No session — redirect to login with return URL
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `${LOGIN_URL}?redirect=${returnUrl}`;
    }

  } catch (e) {
    console.warn('[AuthGuard] Unexpected error:', e);
  }
})();
