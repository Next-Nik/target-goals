// ============================================================
// LIFE OS — AUTH GUARD v2 (TESTING MODE)
// Fails open — tools load without requiring sign-in.
// Replace with full version when nextus.world/login is live.
// ============================================================

(async function() {
  const SUPABASE_URL      = window.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;
  const AUTH_TIMEOUT_MS   = 3000;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_")) {
    console.warn("[AuthGuard] Supabase not configured — skipping auth check.");
    return;
  }

  let sb;
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn("[AuthGuard] Could not initialise Supabase:", e);
    return;
  }

  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve({ timedOut: true }), AUTH_TIMEOUT_MS)
  );

  const sessionPromise = sb.auth.getSession().then(({ data, error }) => ({
    session: data?.session,
    error,
    timedOut: false
  })).catch((e) => ({
    session: null,
    error: e,
    timedOut: false
  }));

  try {
    const result = await Promise.race([sessionPromise, timeoutPromise]);

    if (result.timedOut || result.error) {
      console.warn("[AuthGuard] Session check failed — failing open for testing.");
      return;
    }

    if (result.session?.user) {
      window.LIFEOS_USER    = result.session.user;
      window.LIFEOS_USER_ID = result.session.user.id;
      console.log("[AuthGuard] Session active:", result.session.user.id);
    } else {
      // TESTING MODE — fail open instead of redirecting
      console.warn("[AuthGuard] No session — failing open (testing mode). Swap auth-guard.js when login page is live.");
    }

  } catch (e) {
    console.warn("[AuthGuard] Unexpected error:", e);
  }
})();
