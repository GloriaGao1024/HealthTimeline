(function () {
  let client = null;
  let envPromise = null;

  window.getSupabaseClient = async function getSupabaseClient() {
    if (client) return client;

    const env = await getEnv();
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabasePublishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

    if (!supabaseUrl || !supabasePublishableKey) {
      throw new Error("Supabase 未配置，请检查 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    }

    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase SDK 未加载");
    }

    client = window.supabase.createClient(supabaseUrl, supabasePublishableKey);
    return client;
  };

  function getEnv() {
    if (!envPromise) {
      envPromise = loadEnv();
    }
    return envPromise;
  }

  async function loadEnv() {
    const injectedEnv = window.__ENV__ || {};

    try {
      const response = await fetch(".env.local", { cache: "no-store" });
      if (!response.ok) return injectedEnv;

      return {
        ...parseEnv(await response.text()),
        ...injectedEnv
      };
    } catch {
      return injectedEnv;
    }
  }

  function parseEnv(text) {
    return text.split(/\r?\n/).reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return env;

      const separator = trimmed.indexOf("=");
      if (separator === -1) return env;

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = value;
      return env;
    }, {});
  }
})();
