function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function supabaseConfig() {
  return {
    url: requireEnv("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

async function upsertRows(table, rows, onConflict) {
  if (!rows.length) return [];
  const { url, serviceRoleKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw new Error(`Supabase upsert failed: ${await response.text()}`);
  }

  return response.json();
}

async function insertRows(table, rows) {
  if (!rows.length) return [];
  const { url, serviceRoleKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw new Error(`Supabase insert failed: ${await response.text()}`);
  }

  return response.json();
}

async function selectRows(table, params = []) {
  const { url, serviceRoleKey } = supabaseConfig();
  const search = new URLSearchParams();
  const entries = Array.isArray(params) ? params : Object.entries(params);

  for (const [key, value] of entries) {
    if (value !== undefined && value !== null && value !== "") {
      search.append(key, String(value));
    }
  }

  const query = search.toString();
  const response = await fetch(`${url}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase select failed: ${await response.text()}`);
  }

  return response.json();
}

module.exports = {
  insertRows,
  selectRows,
  upsertRows,
};
