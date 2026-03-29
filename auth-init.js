// ============================================================
// LIFE OS — AUTH INIT v1
// Shared cross-domain session handler for all Life OS tools.
//
// Usage: include AFTER Supabase CDN, BEFORE any tool JS.
// Sets window.LIFEOS_USER and window.LIFEOS_SESSION if signed in.
//
// Two paths:
//   1. URL token (?token=ACCESS&refresh=REFRESH) — set by nextus.world links
//   2. getSession() fallback — works when on same domain or cookie exists
//
// Always fails open — never blocks the tool.
// ============================================================

(async function() {
  const SB_URL = window.SUPABASE_URL || 'https://tphbpwzozkskytoichho.supabase.co';
  const SB_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_M00GF1FWV5tgKHqmyRCZag_kJjgBJn-';

  let sb;
  try {
    sb = window.supabase.createClient(SB_URL, SB_KEY, {
      auth: {
        // Use localStorage so the session persists across page loads on this domain
        storage: window.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,  // picks up #access_token from OAuth redirects
      }
    });
  } catch(e) {
    console.warn('[AuthInit] Could not create Supabase client:', e);
    return;
  }

  const AUTH_TIMEOUT_MS = 3000;

  async function resolveSession() {
    // ── Path 1: URL token params (cross-domain handoff from nextus.world) ──
    const params = new URLSearchParams(window.location.search);
    const accessToken  = params.get('sb_access');
    const refreshToken = params.get('sb_refresh');

    if (accessToken && refreshToken) {
      try {
        const { data, error } = await sb.auth.setSession({
          access_token:  accessToken,
          refresh_token: refreshToken,
        });
        if (!error && data?.session?.user) {
          // Clean URL — remove token params without page reload
          const clean = new URL(window.location.href);
          clean.searchParams.delete('sb_access');
          clean.searchParams.delete('sb_refresh');
          window.history.replaceState({}, '', clean.toString());
          return data.session;
        }
      } catch(e) {
        console.warn('[AuthInit] setSession failed:', e);
      }
    }

    // ── Path 2: getSession() — works on same domain or if cookie exists ──
    const timeout = new Promise(resolve =>
      setTimeout(() => resolve({ timedOut: true }), AUTH_TIMEOUT_MS)
    );
    const sessionCheck = sb.auth.getSession().then(({ data, error }) => ({
      session: data?.session, error, timedOut: false
    })).catch(e => ({ session: null, error: e, timedOut: false }));

    const result = await Promise.race([sessionCheck, timeout]);

    if (result.timedOut || result.error) {
      console.warn('[AuthInit] Session check failed — failing open.');
      return null;
    }

    return result.session || null;
  }

  const session = await resolveSession();

  if (session?.user) {
    window.LIFEOS_USER    = session.user;
    window.LIFEOS_USER_ID = session.user.id;
    window.LIFEOS_SESSION = session;
    console.log('[AuthInit] Session active:', session.user.id);
  } else {
    console.log('[AuthInit] No session — tool loads in unauthenticated state.');
  }

  // Expose the client for tools to use
  window._sb = sb;

  // Dispatch event so tools can react when this resolves
  window.dispatchEvent(new CustomEvent('lifeos:auth', {
    detail: { user: session?.user || null, session: session || null }
  }));
})();
