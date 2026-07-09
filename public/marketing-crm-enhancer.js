(function () {
  const PANEL_ID = 'crmLiveLeadsPanel';
  const DIALOG_ID = 'crmLeadEditDialog';
  const TABLE = 'marketing_cold_email_leads';
  const API_PATH = '/api/marketing-crm-edit';
  const MAX_ROWS = 250;

  const state = {
    rows: [],
    loading: false,
    error: '',
    activeRow: null,
  };

  function getConfig() {
    return window.FUZE_SUPABASE || {};
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(value) {
    return value == null || value === '' ? '—' : String(value);
  }

  function emailValue(row) {
    return text(row.email || row.contact_email || row.public_email || row.website_email);
  }

  function isDraftable(row) {
    return Boolean(emailValue(row) && emailValue(row) !== '—');
  }

  function getBaseUrl() {
    const config = getConfig();
    return (config.url || '').replace(/\/$/, '');
  }

  function getAnonKey() {
    const config = getConfig();
    return config.anonKey || '';
  }

  async function fetchRows() {
    const baseUrl = getBaseUrl();
    const anonKey = getAnonKey();
    if (!baseUrl || !anonKey) {
      throw new Error('Supabase config is missing');
    }

    const url = new URL(`${baseUrl}/rest/v1/${TABLE}`);
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'updated_at.desc');
    url.searchParams.set('limit', String(MAX_ROWS));

    const response = await fetch(url.toString(), {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }

  function ensureStyles() {
    if (document.getElementById('crmEnhancerStyles')) return;
    const style = document.createElement('style');
    style.id = 'crmEnhancerStyles';
    style.textContent = `
      #${PANEL_ID} { margin-top: 16px; }
      #${PANEL_ID} .crm-summary { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 16px; }
      #${PANEL_ID} .crm-summary .summary-chip { border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 8px 12px; font-size: 12px; }
      #${PANEL_ID} table { width: 100%; border-collapse: collapse; }
      #${PANEL_ID} th, #${PANEL_ID} td { padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; }
      #${PANEL_ID} th { text-align: left; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #9da3af; }
      #${PANEL_ID} td { font-size: 14px; }
      #${PANEL_ID} .crm-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      #${PANEL_ID} .crm-email { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-word; }
      #${PANEL_ID} .crm-status { display: inline-block; border-radius: 999px; padding: 4px 8px; border: 1px solid rgba(255,255,255,.16); font-size: 12px; }
      #${DIALOG_ID} { border: 1px solid rgba(255,255,255,.18); border-radius: 16px; max-width: 760px; width: calc(100vw - 32px); padding: 0; background: #111; color: #fff; }
      #${DIALOG_ID}::backdrop { background: rgba(0,0,0,.66); }
      #${DIALOG_ID} form { padding: 18px; display: grid; gap: 12px; }
      #${DIALOG_ID} .dialog-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      #${DIALOG_ID} label { display: grid; gap: 6px; font-size: 13px; }
      #${DIALOG_ID} input, #${DIALOG_ID} select, #${DIALOG_ID} textarea { width: 100%; box-sizing: border-box; }
      #${DIALOG_ID} .dialog-wide { grid-column: 1 / -1; }
      #${DIALOG_ID} .dialog-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      @media (max-width: 720px) { #${DIALOG_ID} .dialog-grid { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  function findInsertTarget() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, div, span'));
    const marker = headings.find((node) => node.textContent && node.textContent.includes('Leads - CRM'));
    if (marker) {
      return marker.closest('section, .panel, article, div') || document.querySelector('main') || document.body;
    }
    return document.querySelector('main') || document.body;
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'panel content-panel';
    panel.innerHTML = `
      <div class="panel-head">
        <h2>Live CRM leads</h2>
        <div class="crm-actions">
          <button id="crmRefreshButton" class="secondary" type="button">Refresh latest rows</button>
        </div>
      </div>
      <div id="crmEnhancerStatus" class="sync-status">Loading latest rows from Supabase...</div>
      <div id="crmEnhancerSummary" class="crm-summary"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Organisation</th>
              <th>Email</th>
              <th>Segment</th>
              <th>Next action</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="crmEnhancerRows"></tbody>
        </table>
      </div>
    `;

    const target = findInsertTarget();
    target.prepend(panel);

    panel.querySelector('#crmRefreshButton').addEventListener('click', () => {
      loadRows();
    });

    return panel;
  }

  function renderSummary() {
    const total = state.rows.length;
    const withEmail = state.rows.filter(isDraftable).length;
    const withoutEmail = total - withEmail;
    const draftable = withEmail;
    const summary = document.getElementById('crmEnhancerSummary');
    if (!summary) return;
    summary.innerHTML = [
      ['Rows loaded', total],
      ['With email', withEmail],
      ['Without email', withoutEmail],
      ['Draftable', draftable],
    ]
      .map(([label, value]) => `<div class="summary-chip"><strong>${escapeHtml(value)}</strong> ${escapeHtml(label)}</div>`)
      .join('');
  }

  function renderRows() {
    const tbody = document.getElementById('crmEnhancerRows');
    const status = document.getElementById('crmEnhancerStatus');
    if (!tbody || !status) return;

    if (state.loading) {
      status.textContent = 'Loading latest rows from Supabase...';
    } else if (state.error) {
      status.textContent = `Could not load live rows: ${state.error}`;
    } else {
      status.textContent = `Showing ${state.rows.length} latest rows directly from Supabase.`;
    }

    tbody.innerHTML = state.rows
      .map((row) => {
        const email = emailValue(row);
        const statusLabel = text(row.status || row.priority || row.lead_status);
        const nextAction = text(row.next_action || row.recommended_offer || row.personalization_angle);
        const org = text(row.organisation_name || row.organization_name || row.company_name || row.name);
        const segment = text(row.lead_segment || row.segment || row.category);
        return `
          <tr>
            <td>${escapeHtml(org)}</td>
            <td class="crm-email">${escapeHtml(email)}</td>
            <td>${escapeHtml(segment)}</td>
            <td>${escapeHtml(nextAction)}</td>
            <td><span class="crm-status">${escapeHtml(statusLabel)}</span></td>
            <td>
              <div class="crm-actions">
                <button class="secondary" type="button" data-crm-edit="${escapeHtml(row.id)}">Edit</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function ensureDialog() {
    let dialog = document.getElementById(DIALOG_ID);
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.innerHTML = `
      <form method="dialog" id="crmEditForm">
        <h3 style="margin:0">Edit lead</h3>
        <div class="dialog-grid">
          <label>
            Organisation
            <input name="organisation_name" />
          </label>
          <label>
            Email
            <input name="email" type="email" />
          </label>
          <label>
            Lead segment
            <input name="lead_segment" />
          </label>
          <label>
            Contact name
            <input name="contact_name" />
          </label>
          <label>
            Status
            <input name="status" />
          </label>
          <label>
            Next action
            <input name="next_action" />
          </label>
          <label class="dialog-wide">
            Website
            <input name="website" />
          </label>
          <label class="dialog-wide">
            Research notes
            <textarea name="research_notes" rows="4"></textarea>
          </label>
        </div>
        <div class="dialog-actions">
          <button type="button" class="secondary" data-crm-edit-cancel>Cancel</button>
          <button type="submit" class="primary">Save changes</button>
        </div>
      </form>
    `;

    dialog.querySelector('[data-crm-edit-cancel]').addEventListener('click', () => {
      dialog.close();
    });

    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const row = state.activeRow;
      if (!row) return;

      const form = event.currentTarget;
      const payload = {
        id: row.id,
        updates: {
          organisation_name: form.organisation_name.value.trim(),
          email: form.email.value.trim(),
          lead_segment: form.lead_segment.value.trim(),
          contact_name: form.contact_name.value.trim(),
          status: form.status.value.trim(),
          next_action: form.next_action.value.trim(),
          website: form.website.value.trim(),
          research_notes: form.research_notes.value.trim(),
        },
      };

      try {
        const response = await fetch(API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const result = await response.json();
        const updated = result.row || payload.updates;
        state.rows = state.rows.map((item) => (String(item.id) === String(row.id) ? { ...item, ...updated } : item));
        state.activeRow = null;
        dialog.close();
        renderSummary();
        renderRows();
      } catch (error) {
        alert(`Could not save edit: ${error.message || error}`);
      }
    });

    document.body.appendChild(dialog);
    return dialog;
  }

  function openEdit(row) {
    const dialog = ensureDialog();
    const form = dialog.querySelector('form');
    state.activeRow = row;

    form.organisation_name.value = row.organisation_name || row.organization_name || row.company_name || row.name || '';
    form.email.value = emailValue(row) === '—' ? '' : emailValue(row);
    form.lead_segment.value = row.lead_segment || row.segment || row.category || '';
    form.contact_name.value = row.contact_name || row.primary_contact || '';
    form.status.value = row.status || row.priority || row.lead_status || '';
    form.next_action.value = row.next_action || row.recommended_offer || row.personalization_angle || '';
    form.website.value = row.website || row.source || '';
    form.research_notes.value = row.research_notes || row.notes || '';

    dialog.showModal();
  }

  function bindRowActions() {
    document.querySelectorAll(`[data-crm-edit]`).forEach((button) => {
      button.addEventListener('click', () => {
        const row = state.rows.find((item) => String(item.id) === String(button.getAttribute('data-crm-edit')));
        if (row) openEdit(row);
      });
    });
  }

  async function loadRows() {
    ensureStyles();
    ensurePanel();
    state.loading = true;
    state.error = '';
    renderRows();
    renderSummary();

    try {
      state.rows = await fetchRows();
    } catch (error) {
      state.error = error.message || String(error);
      state.rows = [];
    } finally {
      state.loading = false;
      renderSummary();
      renderRows();
      bindRowActions();
    }
  }

  function shouldRun() {
    return !location.hash || location.hash === '#marketing' || location.hash.includes('marketing');
  }

  function boot() {
    if (!shouldRun()) return;
    ensurePanel();
    loadRows();
  }

  const schedule = () => window.requestAnimationFrame(boot);
  window.addEventListener('DOMContentLoaded', schedule, { once: true });
  window.addEventListener('hashchange', schedule);
})();
