// LIFE OS — SUPABASE CLIENT (browser/vanilla JS)
// For tools loaded as plain <script> tags (not bundled with Vite)
// Requires Supabase CDN already loaded:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// Requires window.SUPABASE_URL and window.SUPABASE_ANON_KEY set before this file

const _url = window.SUPABASE_URL  || '';
const _key = window.SUPABASE_ANON_KEY || '';

window._supabase = (_url && _key)
  ? window.supabase.createClient(_url, _key)
  : null;
