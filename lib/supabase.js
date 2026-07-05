(function () {
  const SUPABASE_URL = "https://keiovavmwbepmsqsagmd.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_h5glhRQNgTuBOgc-OBoYWQ_wY1rsycu";

  let client = null;

  window.getSupabaseClient = async function getSupabaseClient() {
    if (client) return client;

    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase SDK 未加载");
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    return client;
  };
})();
