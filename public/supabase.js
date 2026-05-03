(function () {
  const config = window.FUZE_SUPABASE || {};
  const baseUrl = (config.url || "").replace(/\/$/, "");
  const anonKey = config.anonKey || "";

  function enabled() {
    return Boolean(baseUrl && anonKey);
  }

  async function request(path, options = {}) {
    if (!enabled()) {
      throw new Error("Supabase is not configured");
    }

    const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const message = await response.text();
      window.fuzeSupabaseLastError = message || `Supabase request failed: ${response.status}`;
      throw new Error(message || `Supabase request failed: ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  function list(table, order = "created_at.desc") {
    return request(`${table}?select=*&order=${order}`);
  }

  function insert(table, payload) {
    return request(table, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  function updateLeader(payload) {
    return request(`project_leaders?project=eq.${encodeURIComponent(payload.project)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  window.fuzeSupabase = {
    enabled,
    list,
    insert,
    updateLeader,
  };
})();
