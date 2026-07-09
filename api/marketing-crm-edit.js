const ALLOWED_FIELDS = [
  'organisation_name',
  'organization_name',
  'company_name',
  'lead_segment',
  'segment',
  'category',
  'contact_name',
  'primary_contact',
  'email',
  'status',
  'priority',
  'lead_status',
  'next_action',
  'recommended_offer',
  'personalization_angle',
  'website',
  'source',
  'research_notes',
  'notes',
];

function cleanText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function pickUpdates(input = {}) {
  const updates = {};
  for (const field of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      if (field === 'email') {
        updates[field] = normalizeEmail(input[field]);
      } else {
        updates[field] = cleanText(input[field]);
      }
    }
  }
  return updates;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const id = cleanText(body.id);
    const updates = pickUpdates(body.updates || body);

    if (!id) {
      res.status(400).json({ ok: false, error: 'Missing lead id' });
      return;
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ ok: false, error: 'No editable fields supplied' });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://duzudeowllmfaugrbave.supabase.co';
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRole) {
      res.status(500).json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' });
      return;
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/marketing_cold_email_leads?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ ok: false, error: errorText || `Supabase update failed with ${response.status}` });
      return;
    }

    const rows = await response.json();
    res.status(200).json({ ok: true, row: rows && rows[0] ? rows[0] : null });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
};
