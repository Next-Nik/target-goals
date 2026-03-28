// ============================================================
// LIFE OS — AUTH GUARD v2
// auth-guard.js
//
// Include this script in any tool that requires sign-in.
// Place BEFORE ui.js and app.js in your HTML.
//
// v2 fix: 3-second timeout — if Supabase doesn't respond,
// fail open so the tool loads rather than showing a blank page.
// ============================================================

(async function() {
  const SUPABASE_URL      = window.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;
  const LOGIN_URL         = "https://nextus.world/login";
  const AUTH_TIMEOUT_MS   = 3000;

  // Can't check auth without credentials — fail open for local dev
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

  // Race the session check against a timeout
  // If Supabase is slow, fail open rather than blocking the tool
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

    if (result.timedOut) {
      console.warn("[AuthGuard] Session check timed out — failing open.");
      return;
    }

    if (result.error) {
      console.warn("[AuthGuard] Session check error:", result.error.message || result.error);
      return; // Fail open — don't block the tool on a network error
    }

    const session = result.session;

    if (!session || !session.user) {
      // No session — redirect to login with return URL
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `${LOGIN_URL}?redirect=${returnUrl}`;
      return;
    }

    // Session exists — expose user globally for app.js to use
    window.LIFEOS_USER    = session.user;
    window.LIFEOS_USER_ID = session.user.id;
    console.log("[AuthGuard] Session active:", session.user.id);

  } catch (e) {
    console.warn("[AuthGuard] Unexpected error:", e);
    // Fail open
  }
})();
