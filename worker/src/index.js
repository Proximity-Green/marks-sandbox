const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const SCOPES = 'openid profile email accounting.invoices accounting.contacts accounting.settings';

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
      return jsonResponse({ authenticated: true, shortCode: tokenData.short_code || '', orgName: tokenData.org_name || '' }, 200, env, request);
    }

    // --- Get Currencies ---
    if (url.pathname === '/currencies' && request.method === 'GET') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const currRes = await fetch(`${XERO_API_URL}/Currencies`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Xero-Tenant-Id': tokenData.tenant_id,
        },
      });

      const result = await currRes.json();
      if (!currRes.ok) {
        return jsonResponse({ error: result.Message || 'Failed to fetch currencies' }, currRes.status, env, request);
      }

      return jsonResponse({ currencies: result.Currencies || [] }, 200, env, request);
    }

    // --- Get Chart of Accounts ---
    if (url.pathname === '/accounts' && request.method === 'GET') {
      const tokenData = await getTokenData(request, env);
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env, request);

      const res = await fetch(`${XERO_API_URL}/Accounts?where=Status=="ACTIVE"&order=Code`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Xero-Tenant-Id': tokenData.tenant_id,
        },
      });

      const result = await res.json();
      if (!res.ok) {
        return jsonResponse({ error: result.Message || 'Failed to fetch accounts' }, res.status, env, request);
      }

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

      const res = await fetch(`${XERO_API_URL}/TrackingCategories`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Xero-Tenant-Id': tokenData.tenant_id,
        },
      });

      const result = await res.json();
      if (!res.ok) {
        return jsonResponse({ error: result.Message || 'Failed to fetch tracking' }, res.status, env, request);
      }

      const categories = (result.TrackingCategories || []).map(c => ({
        id: c.TrackingCategoryID,
        name: c.Name,
        options: (c.Options || []).map(o => ({ id: o.TrackingOptionID, name: o.Name })),
      }));

      return jsonResponse({ categories }, 200, env, request);
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

      const listRes = await fetch(`${XERO_API_URL}/${ep}${where}`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Xero-Tenant-Id': tokenData.tenant_id,
        },
      });

      const result = await listRes.json();
      if (!listRes.ok) {
        return jsonResponse({ error: result.Message || 'Failed to list' }, listRes.status, env, request);
      }

      const items = (result[ep] || []).map(item => ({
        id: item.InvoiceID || item.QuoteID || item.PurchaseOrderID,
        number: item.InvoiceNumber || item.QuoteNumber || item.PurchaseOrderNumber || '',
        contact: item.Contact?.Name || '',
        date: item.DateString || item.Date || '',
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

      const result = await apiRes.json();

      if (!apiRes.ok) {
        const items = result.Elements || result[endpoint] || [];
        const validationErrors = items[0]?.ValidationErrors?.map(e => e.Message) || [];
        const errorMsg = validationErrors.length
          ? validationErrors.join('\n')
          : result.Message || JSON.stringify(result);
        return jsonResponse({ error: errorMsg }, apiRes.status, env, request);
      }

      const items = result[endpoint] || [];
      const created = items[0];
      const idField = { Invoices: 'InvoiceID', Quotes: 'QuoteID', PurchaseOrders: 'PurchaseOrderID' }[endpoint];
      return jsonResponse({
        success: true,
        id: created?.[idField] || '',
        number: created?.[numberField] || created?.InvoiceNumber || '',
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

    return jsonResponse({ error: 'Not found' }, 404, env, request);
  },
};
