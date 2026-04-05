const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const SCOPES = 'openid profile email accounting.invoices accounting.contacts accounting.settings';

const SUPABASE_URL = 'https://lcigjfeyldhfoihsyvwn.supabase.co';

// Supabase REST API helper — uses service role key for full access
async function supabaseRequest(env, path, { method = 'GET', body, headers = {}, query = '' } = {}) {
  if (!env.SUPABASE_SERVICE_KEY) return null; // gracefully skip if not configured
  const url = `${SUPABASE_URL}/rest/v1/${path}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Supabase ${method} ${path} failed:`, err);
    return null;
  }
  if (method === 'GET' || (method === 'POST' && !(headers['Prefer'] || '').includes('return=minimal'))) {
    return safeJson(res);
  }
  return true;
}

// Upsert xero_connections row
async function upsertConnection(env, tenantId, tenantName, shortCode) {
  return supabaseRequest(env, 'xero_connections', {
    method: 'POST',
    body: { tenant_id: tenantId, tenant_name: tenantName, short_code: shortCode },
    headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
  });
}

// Upsert contact and return the Supabase contact id
async function upsertContact(env, tenantId, xeroContactId, name, email) {
  const result = await supabaseRequest(env, 'contacts', {
    method: 'POST',
    body: {
      tenant_id: tenantId,
      xero_contact_id: xeroContactId || null,
      name,
      email: email || null,
    },
    headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
    query: 'on_conflict=xero_contact_id',
  });
  return result?.[0]?.id || null;
}

// Insert document and return the row
async function insertDocument(env, doc) {
  const result = await supabaseRequest(env, 'documents', {
    method: 'POST',
    body: doc,
  });
  return result?.[0] || null;
}

// Insert line items
async function insertLineItems(env, items) {
  return supabaseRequest(env, 'line_items', {
    method: 'POST',
    body: items,
  });
}

function corsHeaders(env, request) {
  const origin = request?.headers?.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data, status, env, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env, request) },
  });
}

function getSessionId(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

function generateSessionId() {
  return crypto.randomUUID().replace(/-/g, '');
}

async function safeJson(res) {
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { Message: text }; }
}

async function xeroFetch(url, options, tokenData) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Xero-Tenant-Id': tokenData.tenant_id,
      ...(options?.headers || {}),
    },
  });
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || '60';
    return { _rateLimited: true, _retryAfter: parseInt(retryAfter), _status: 429 };
  }
  const data = await safeJson(res);
  data._status = res.status;
  data._ok = res.ok;
  // Capture rate limit headers
  data._rateLimit = {
    remaining: res.headers.get('X-MinLimit-Remaining'),
    appRemaining: res.headers.get('X-AppMinLimit-Remaining'),
  };
  return data;
}

async function getTokenData(request, env) {
  const sessionId = getSessionId(request);
  if (!sessionId) return null;
  const raw = await env.TOKENS.get(`tokens:${sessionId}`);
  if (!raw) return null;
  const tokenData = JSON.parse(raw);
  tokenData._sessionId = sessionId;

  // Refresh if expired
  if (Date.now() > tokenData.expires_at - 60000) {
    const refreshRes = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenData.refresh_token,
      }),
    });
    if (!refreshRes.ok) return null;
    const newTokens = await refreshRes.json();
    tokenData.access_token = newTokens.access_token;
    tokenData.refresh_token = newTokens.refresh_token;
    tokenData.expires_at = Date.now() + newTokens.expires_in * 1000;
    await env.TOKENS.put(`tokens:${sessionId}`, JSON.stringify(tokenData), { expirationTtl: 86400 });
  }

  return tokenData;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    try {
    // Main handler - wrapped in try/catch for unhandled errors

    // --- OAuth: Start connection ---
    if (url.pathname === '/auth/connect') {
      const sessionId = generateSessionId();
      const state = crypto.randomUUID();
      await env.TOKENS.put(`state:${state}`, sessionId, { expirationTtl: 600 });

      const redirectUri = `${url.origin}/auth/callback`;
      const authUrl = `${XERO_AUTH_URL}?${new URLSearchParams({
        response_type: 'code',
        client_id: env.XERO_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
      })}`;

      return new Response(null, {
        status: 302,
        headers: { Location: authUrl },
      });
    }

    // --- OAuth: Callback ---
    if (url.pathname === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        return new Response('Missing code or state', { status: 400 });
      }

      const sessionId = await env.TOKENS.get(`state:${state}`);
      if (!sessionId) {
        return new Response('Invalid state', { status: 400 });
      }
      await env.TOKENS.delete(`state:${state}`);

      const redirectUri = `${url.origin}/auth/callback`;
      const tokenRes = await fetch(XERO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return new Response(`Token exchange failed: ${err}`, { status: 500 });
      }

      const tokens = await tokenRes.json();

      const connRes = await fetch(XERO_CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const connections = await connRes.json();
      // Use the most recently connected tenant
      const sorted = connections.sort((a, b) => new Date(b.createdDateUtc) - new Date(a.createdDateUtc));
      const tenantId = sorted[0]?.tenantId;

      // Get org short code (best effort)
      let shortCode = '';
      let orgName = '';
      try {
        const orgRes = await fetch(`${XERO_API_URL}/Organisation`, {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Xero-Tenant-Id': tenantId,
          },
        });
        if (orgRes.ok) {
          const orgData = await orgRes.json();
          shortCode = orgData.Organisations?.[0]?.ShortCode || '';
          orgName = orgData.Organisations?.[0]?.Name || '';
        }
      } catch (e) { /* ignore */ }

      await env.TOKENS.put(`tokens:${sessionId}`, JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
        tenant_id: tenantId,
        short_code: shortCode,
        org_name: orgName,
      }), { expirationTtl: 86400 });

      // Save connection to Supabase (best effort)
      await upsertConnection(env, tenantId, orgName, shortCode);

      return new Response(null, {
        status: 302,
        headers: {
          Location: `${env.FRONTEND_URL}?session=${sessionId}`,
        },
      });
    }

    // --- Auth status check ---
    if (url.pathname === '/auth/status') {
      const sessionId = getSessionId(request);
      if (!sessionId) return jsonResponse({ authenticated: false }, 200, env, request);
      const raw = await env.TOKENS.get(`tokens:${sessionId}`);
      if (!raw) return jsonResponse({ authenticated: false }, 200, env, request);
      const tokenData = JSON.parse(raw);

      // Fetch org info if missing
      if (!tokenData.org_name && tokenData.access_token && tokenData.tenant_id) {
        try {
          const orgRes = await fetch(`${XERO_API_URL}/Organisation`, {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              'Xero-Tenant-Id': tokenData.tenant_id,
            },
          });
          if (orgRes.ok) {
            const orgData = await safeJson(orgRes);
            tokenData.org_name = orgData.Organisations?.[0]?.Name || '';
            tokenData.short_code = orgData.Organisations?.[0]?.ShortCode || tokenData.short_code || '';
            await env.TOKENS.put(`tokens:${sessionId}`, JSON.stringify(tokenData), { expirationTtl: 86400 });
          }
        } catch (e) { /* ignore */ }
      }

      return jsonResponse({ authenticated: true, shortCode: tokenData.short_code || '', orgName: tokenData.org_name || '' }, 200, env, request);
    }

    // --- Get Currencies ---
    if (url.pathname === '/currencies' && request.method === 'GET') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const result = await xeroFetch(`${XERO_API_URL}/Currencies`, {}, tokenData);
      if (result._rateLimited) return jsonResponse({ error: `Rate limited. Try again in ${result._retryAfter}s.` }, 429, env, request);
      if (!result._ok) return jsonResponse({ error: result.Message || 'Failed to fetch currencies' }, result._status, env, request);

      return jsonResponse({ currencies: result.Currencies || [] }, 200, env, request);
    }

    // --- Get Chart of Accounts ---
    if (url.pathname === '/accounts' && request.method === 'GET') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const result = await xeroFetch(`${XERO_API_URL}/Accounts?where=Status=="ACTIVE"&order=Code`, {}, tokenData);
      if (result._rateLimited) return jsonResponse({ error: `Rate limited. Try again in ${result._retryAfter}s.` }, 429, env, request);
      if (!result._ok) return jsonResponse({ error: result.Message || 'Failed to fetch accounts' }, result._status, env, request);

      const accounts = (result.Accounts || []).map(a => ({
        code: a.Code,
        name: a.Name,
        type: a.Type,
      }));

      return jsonResponse({ accounts }, 200, env, request);
    }

    // --- Get Tracking Categories ---
    if (url.pathname === '/tracking' && request.method === 'GET') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const result = await xeroFetch(`${XERO_API_URL}/TrackingCategories`, {}, tokenData);
      if (result._rateLimited) return jsonResponse({ error: `Rate limited. Try again in ${result._retryAfter}s.` }, 429, env, request);
      if (!result._ok) return jsonResponse({ error: result.Message || 'Failed to fetch tracking' }, result._status, env, request);

      const categories = (result.TrackingCategories || []).map(c => ({
        id: c.TrackingCategoryID,
        name: c.Name,
        options: (c.Options || []).map(o => ({ id: o.TrackingOptionID, name: o.Name })),
      }));

      return jsonResponse({ categories }, 200, env, request);
    }

    // --- Sync accounts & tracking to Supabase ---
    if (url.pathname === '/admin/sync' && request.method === 'POST') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const results = { accounts: 0, categories: 0, options: 0 };
      const tenantId = tokenData.tenant_id;

      // Sync accounts
      const acctResult = await xeroFetch(`${XERO_API_URL}/Accounts?where=Status%3D%3D%22ACTIVE%22&order=Code`, {}, tokenData);
      if (acctResult._ok && acctResult.Accounts) {
        const rows = acctResult.Accounts
          .filter(a => a.Code && a.Name)
          .map(a => ({
            tenant_id: tenantId,
            source: 'xero',
            code: String(a.Code),
            name: String(a.Name),
            type: a.Type ? String(a.Type) : null,
            external_id: a.AccountID ? String(a.AccountID) : null,
            synced_at: new Date().toISOString(),
          }));
        if (rows.length > 0) {
          const sbUrl = `${SUPABASE_URL}/rest/v1/accounts?on_conflict=tenant_id,source,code`;
          const sbRes = await fetch(sbUrl, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal,resolution=merge-duplicates',
            },
            body: JSON.stringify(rows),
          });
          if (sbRes.ok) results.accounts = rows.length;
        }
      }

      // Sync tracking categories + options
      const trackResult = await xeroFetch(`${XERO_API_URL}/TrackingCategories`, {}, tokenData);
      if (trackResult._ok && trackResult.TrackingCategories) {
        for (const cat of trackResult.TrackingCategories) {
          // Upsert category
          const catRes = await supabaseRequest(env, 'tracking_categories', {
            method: 'POST',
            body: {
              tenant_id: tenantId,
              source: 'xero',
              external_id: cat.TrackingCategoryID,
              name: cat.Name,
              synced_at: new Date().toISOString(),
            },
            headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
            query: 'on_conflict=tenant_id,source,external_id',
          });
          results.categories++;

          if (catRes?.[0]?.id && cat.Options?.length > 0) {
            const optRows = cat.Options.map(o => ({
              category_id: catRes[0].id,
              external_id: o.TrackingOptionID,
              name: o.Name,
              synced_at: new Date().toISOString(),
            }));
            await supabaseRequest(env, 'tracking_options', {
              method: 'POST',
              body: optRows,
              headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
              query: 'on_conflict=category_id,external_id',
            });
            results.options += optRows.length;
          }
        }
      }

      return jsonResponse({ synced: true, ...results, synced_at: new Date().toISOString() }, 200, env, request);
    }

    // --- List Documents ---
    if (url.pathname === '/list' && request.method === 'GET') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const type = url.searchParams.get('type');
      const endpoints = { invoice: 'Invoices', quote: 'Quotes', po: 'PurchaseOrders' };
      const ep = endpoints[type];
      if (!ep) return jsonResponse({ error: 'Invalid type' }, 400, env, request);

      // Only get draft invoices, all quotes and POs
      let where = '';
      if (type === 'invoice') where = '?where=Status=="DRAFT"&order=Date DESC';
      else if (type === 'quote') where = '?order=Date DESC';
      else where = '?order=Date DESC';

      const result = await xeroFetch(`${XERO_API_URL}/${ep}${where}`, {}, tokenData);
      if (result._rateLimited) {
        return jsonResponse({ error: `Rate limited by Xero. Try again in ${result._retryAfter}s.` }, 429, env, request);
      }
      if (!result._ok) {
        return jsonResponse({ error: result.Message || 'Failed to list' }, result._status, env, request);
      }

      const items = (result[ep] || []).map(item => ({
        id: item.InvoiceID || item.QuoteID || item.PurchaseOrderID,
        number: item.InvoiceNumber || item.QuoteNumber || item.PurchaseOrderNumber || '',
        contact: item.Contact?.Name || '',
        date: item.DateString || item.Date || '',
        updatedDateUTC: item.UpdatedDateUTC || '',
        total: item.Total || 0,
        currency: item.CurrencyCode || '',
        status: item.Status || '',
      }));

      return jsonResponse({ items }, 200, env, request);
    }

    // --- Create Document (Invoice / Quote / PO) ---
    if (url.pathname === '/create' && request.method === 'POST') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const body = await request.json();
      const { docType } = body;

      // For POs, we need a ContactID — look up or create the contact
      let contactRef = { Name: body.contact.name, EmailAddress: body.contact.email || undefined };
      if (docType === 'po') {
        // Search for existing contact
        const searchRes = await fetch(
          `${XERO_API_URL}/Contacts?where=Name=="${encodeURIComponent(body.contact.name)}"`,
          {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              'Xero-Tenant-Id': tokenData.tenant_id,
            },
          }
        );
        const searchData = await searchRes.json();
        let contactId = searchData.Contacts?.[0]?.ContactID;

        if (!contactId) {
          // Create the contact
          const createRes = await fetch(`${XERO_API_URL}/Contacts`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json',
              'Xero-Tenant-Id': tokenData.tenant_id,
            },
            body: JSON.stringify({ Contacts: [{ Name: body.contact.name, EmailAddress: body.contact.email || undefined }] }),
          });
          const createData = await createRes.json();
          contactId = createData.Contacts?.[0]?.ContactID;
        }

        if (!contactId) {
          return jsonResponse({ error: 'Could not find or create contact' }, 400, env, request);
        }
        contactRef = { ContactID: contactId };
      }

      const lineItems = body.lineItems.map(item => {
        const li = {
          Description: item.description,
          Quantity: item.quantity,
          UnitAmount: item.unitAmount,
        };
        if (item.accountCode) li.AccountCode = item.accountCode;
        if (item.tracking && item.tracking.length > 0) {
          li.Tracking = item.tracking.map(t => ({
            TrackingCategoryID: t.categoryId,
            TrackingOptionID: t.optionId,
          }));
        }
        return li;
      });

      let endpoint, payload, numberField;

      if (docType === 'invoice') {
        const status = body.authorise ? 'AUTHORISED' : 'DRAFT';
        endpoint = 'Invoices';
        numberField = 'InvoiceNumber';
        payload = { Invoices: [{
          Type: 'ACCREC',
          Contact: contactRef,
          Date: body.date,
          DueDate: body.dueDate,
          Reference: body.reference || undefined,
          CurrencyCode: body.currencyCode || undefined,
          LineItems: lineItems,
          Status: status,
        }]};
      } else if (docType === 'quote') {
        endpoint = 'Quotes';
        numberField = 'QuoteNumber';
        payload = { Quotes: [{
          Contact: contactRef,
          Date: body.date,
          ExpiryDate: body.dueDate,
          Reference: body.reference || undefined,
          CurrencyCode: body.currencyCode || undefined,
          LineItems: lineItems,
          Status: 'DRAFT',
        }]};
      } else if (docType === 'po') {
        endpoint = 'PurchaseOrders';
        numberField = 'PurchaseOrderNumber';
        payload = { PurchaseOrders: [{
          Contact: contactRef,
          Date: body.date,
          DeliveryDate: body.dueDate,
          Reference: body.reference || undefined,
          CurrencyCode: body.currencyCode || undefined,
          LineItems: lineItems,
          Status: 'DRAFT',
        }]};
      } else {
        return jsonResponse({ error: 'Invalid document type' }, 400, env, request);
      }

      const apiRes = await fetch(`${XERO_API_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          'Xero-Tenant-Id': tokenData.tenant_id,
        },
        body: JSON.stringify(payload),
      });

      if (apiRes.status === 429) {
        const retryAfter = apiRes.headers.get('Retry-After') || '60';
        return jsonResponse({ error: `Rate limited by Xero. Try again in ${retryAfter}s.` }, 429, env, request);
      }

      const result = await safeJson(apiRes);

      if (!apiRes.ok) {
        const items = result.Elements || result[endpoint] || [];
        const validationErrors = items[0]?.ValidationErrors?.map(e => e.Message) || [];
        const errorMsg = validationErrors.length
          ? validationErrors.join('\n')
          : result.Message || 'Xero API error. Please try again.';
        return jsonResponse({ error: errorMsg }, apiRes.status, env, request);
      }

      const items = result[endpoint] || [];
      const created = items[0];
      const idField = { Invoices: 'InvoiceID', Quotes: 'QuoteID', PurchaseOrders: 'PurchaseOrderID' }[endpoint];
      const xeroId = created?.[idField] || '';
      const docNumber = created?.[numberField] || created?.InvoiceNumber || '';

      // --- Save to Supabase (best effort — don't fail the response if this errors) ---
      try {
        // Ensure connection exists
        await upsertConnection(env, tokenData.tenant_id, tokenData.org_name, tokenData.short_code);

        // Get or extract Xero contact ID from the created document
        const xeroContactId = created?.Contact?.ContactID || contactRef?.ContactID || null;

        // Upsert contact
        const contactDbId = await upsertContact(
          env,
          tokenData.tenant_id,
          xeroContactId,
          body.contact.name,
          body.contact.email
        );

        // Calculate totals from line items
        const subtotal = body.lineItems.reduce((sum, li) => sum + (li.quantity * li.unitAmount), 0);
        const total = created?.Total || subtotal;

        // Insert document
        const savedDoc = await insertDocument(env, {
          xero_id: xeroId,
          tenant_id: tokenData.tenant_id,
          doc_type: docType,
          doc_number: docNumber,
          contact_id: contactDbId,
          contact_name: body.contact.name,
          contact_email: body.contact.email || null,
          date: body.date,
          due_date: body.dueDate || null,
          reference: body.reference || null,
          currency_code: body.currencyCode || 'ZAR',
          subtotal: created?.SubTotal || subtotal,
          total,
          status: 'DRAFT',
          xero_status: created?.Status || 'DRAFT',
        });

        // Insert line items
        if (savedDoc?.id) {
          const lineItemRows = body.lineItems.map((li, idx) => ({
            document_id: savedDoc.id,
            sort_order: idx,
            description: li.description,
            account_code: li.accountCode || null,
            tracking_category_id: li.tracking?.[0]?.categoryId || null,
            tracking_option_id: li.tracking?.[0]?.optionId || null,
            quantity: li.quantity,
            unit_amount: li.unitAmount,
            line_amount: li.quantity * li.unitAmount,
          }));
          await insertLineItems(env, lineItemRows);
        }
      } catch (e) {
        console.error('Supabase save failed (non-blocking):', e.message);
      }

      return jsonResponse({
        success: true,
        id: xeroId,
        number: docNumber,
        docType: body.docType,
      }, 200, env, request);
    }

    // --- Download PDF ---
    if (url.pathname === '/pdf' && request.method === 'GET') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const docId = url.searchParams.get('id');
      const type = url.searchParams.get('type');
      if (!docId || !type) return jsonResponse({ error: 'Missing id or type' }, 400, env, request);

      const endpoints = { invoice: 'Invoices', quote: 'Quotes', po: 'PurchaseOrders' };
      const ep = endpoints[type];
      if (!ep) return jsonResponse({ error: 'Invalid type' }, 400, env, request);

      const pdfRes = await fetch(`${XERO_API_URL}/${ep}/${docId}`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Xero-Tenant-Id': tokenData.tenant_id,
          Accept: 'application/pdf',
        },
      });

      if (!pdfRes.ok) {
        return jsonResponse({ error: 'Failed to download PDF' }, pdfRes.status, env, request);
      }

      return new Response(pdfRes.body, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${type}-${docId}.pdf"`,
          ...corsHeaders(env, request),
        },
      });
    }

    // --- Email via Xero ---
    if (url.pathname === '/email' && request.method === 'POST') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const body = await request.json();
      const { id, type } = body;
      if (!id || !type) return jsonResponse({ error: 'Missing id or type' }, 400, env, request);

      const endpoints = { invoice: 'Invoices', quote: 'Quotes', po: 'PurchaseOrders' };
      const ep = endpoints[type];
      if (!ep) return jsonResponse({ error: 'Invalid type' }, 400, env, request);

      const emailRes = await fetch(`${XERO_API_URL}/${ep}/${id}/Email`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          'Xero-Tenant-Id': tokenData.tenant_id,
        },
        body: JSON.stringify({}),
      });

      if (!emailRes.ok) {
        let errMsg = 'Failed to email';
        try {
          const errData = await emailRes.json();
          errMsg = errData.Message || JSON.stringify(errData);
        } catch (e) {
          errMsg = await emailRes.text();
        }
        return jsonResponse({ error: errMsg }, emailRes.status, env, request);
      }

      return jsonResponse({ success: true }, 200, env, request);
    }

    // --- Email via Mailgun (with PDF attachment) ---
    if (url.pathname === '/email-custom' && request.method === 'POST') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const body = await request.json();
      const { id, type, to, subject, message } = body;
      if (!id || !type || !to) return jsonResponse({ error: 'Missing id, type, or to' }, 400, env, request);

      const endpoints = { invoice: 'Invoices', quote: 'Quotes', po: 'PurchaseOrders' };
      const ep = endpoints[type];
      if (!ep) return jsonResponse({ error: 'Invalid type' }, 400, env, request);

      // Fetch PDF from Xero
      const pdfRes = await fetch(`${XERO_API_URL}/${ep}/${id}`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Xero-Tenant-Id': tokenData.tenant_id,
          Accept: 'application/pdf',
        },
      });

      if (!pdfRes.ok) {
        return jsonResponse({ error: 'Failed to fetch PDF from Xero' }, pdfRes.status, env, request);
      }

      const pdfBuffer = await pdfRes.arrayBuffer();
      const docLabels = { invoice: 'Invoice', quote: 'Quote', po: 'Purchase Order' };
      const label = docLabels[type] || 'Document';
      const filename = `${label.replace(' ', '-')}-${id}.pdf`;

      // Send via Mailgun with multipart form
      const formData = new FormData();
      formData.append('from', `Xero Documents <postmaster@${env.MAILGUN_DOMAIN}>`);
      formData.append('to', to);
      formData.append('subject', subject || `${label} attached`);
      formData.append('text', message || `Please find the attached ${label}.`);
      formData.append('attachment', new Blob([pdfBuffer], { type: 'application/pdf' }), filename);

      const mgRes = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}`,
        },
        body: formData,
      });

      if (!mgRes.ok) {
        const mgErr = await mgRes.text();
        return jsonResponse({ error: `Mailgun error: ${mgErr}` }, mgRes.status, env, request);
      }

      return jsonResponse({ success: true }, 200, env, request);
    }

    // Invite user — add to allowed_users and send email
    if (url.pathname === '/invite' && request.method === 'POST') {
      const body = await request.json();
      const { email, invited_by } = body;
      if (!email) return jsonResponse({ error: 'Email is required' }, 400, env, request);

      const normalised = email.trim().toLowerCase();

      // Check already exists
      const existing = await supabaseRequest(env, 'allowed_users', {
        method: 'GET',
        query: `email=eq.${encodeURIComponent(normalised)}&select=email`,
      });
      if (existing && existing.length > 0) {
        return jsonResponse({ error: 'User already has access' }, 409, env, request);
      }

      // Add to allowed_users
      await supabaseRequest(env, 'allowed_users', {
        method: 'POST',
        body: { email: normalised, name: normalised.split('@')[0] },
      });

      // Send invite email via Mailgun
      if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN) {
        const formData = new FormData();
        formData.append('from', 'Proximity Green <mark@proximity.green>');
        formData.append('to', normalised);
        formData.append('subject', 'You\'ve been invited to Proximity Green');
        formData.append('html', `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="width: 48px; height: 48px; border-radius: 50%; background: #3d6147; display: inline-flex; align-items: center; justify-content: center;">
                <div style="width: 18px; height: 18px; border-radius: 50%; background: #7aa882;"></div>
              </div>
            </div>
            <h2 style="color: #18180f; margin: 0 0 12px; font-size: 20px;">You're invited</h2>
            <p style="color: #706b60; line-height: 1.6; margin: 0 0 24px;">
              ${invited_by || 'Someone'} has invited you to the <strong>Proximity Green</strong> platform.
              Sign in with your Google account to get started.
            </p>
            <a href="https://xero-app.pages.dev/login" style="display: inline-block; background: #3d6147; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
              Sign in
            </a>
            <p style="color: #b0a99f; font-size: 13px; margin-top: 32px;">
              This invite is for ${normalised}. You'll need to sign in with the Google account associated with this email.
            </p>
          </div>
        `);

        await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
          method: 'POST',
          headers: { Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}` },
          body: formData,
        });
      }

      return jsonResponse({ success: true, email: normalised }, 200, env, request);
    }

    return jsonResponse({ error: 'Not found' }, 404, env, request);

    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: err.message || 'Internal server error' }, 500, env, request);
    }
  },
};
