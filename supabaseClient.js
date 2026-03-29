const _url = window.SUPABASE_URL  || '';
const _key = window.SUPABASE_ANON_KEY || '';
window._supabase = (_url && _key)
  ? window.supabase.createClient(_url, _key, {
      auth: { storage: window.localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    })
  : null;
