const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const SCOPES = 'openid profile email accounting.invoices accounting.contacts accounting.settings';

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.FRONTEND_URL,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
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

      // Get tenant ID
      const connRes = await fetch(XERO_CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const connections = await connRes.json();
      const tenantId = connections[0]?.tenantId;

      await env.TOKENS.put(`tokens:${sessionId}`, JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
        tenant_id: tenantId,
      }), { expirationTtl: 86400 });

      // Redirect back to frontend with session token in URL fragment
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
      if (!sessionId) return jsonResponse({ authenticated: false }, 200, env);

      const tokenData = await env.TOKENS.get(`tokens:${sessionId}`);
      return jsonResponse({ authenticated: !!tokenData }, 200, env);
    }

    // --- Get Currencies ---
    if (url.pathname === '/currencies' && request.method === 'GET') {
      const sessionId = getSessionId(request);
      if (!sessionId) return jsonResponse({ error: 'Not authenticated' }, 401, env);

      let tokenData = JSON.parse(await env.TOKENS.get(`tokens:${sessionId}`) || 'null');
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env);

      const currRes = await fetch(`${XERO_API_URL}/Currencies`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Xero-Tenant-Id': tokenData.tenant_id,
        },
      });

      const result = await currRes.json();
      if (!currRes.ok) {
        return jsonResponse({ error: result.Message || 'Failed to fetch currencies' }, currRes.status, env);
      }

      return jsonResponse({ currencies: result.Currencies || [] }, 200, env);
    }

    // --- Create Invoice ---
    if (url.pathname === '/invoice' && request.method === 'POST') {
      const sessionId = getSessionId(request);
      if (!sessionId) return jsonResponse({ error: 'Not authenticated' }, 401, env);

      let tokenData = JSON.parse(await env.TOKENS.get(`tokens:${sessionId}`) || 'null');
      if (!tokenData) return jsonResponse({ error: 'Not authenticated' }, 401, env);

      // Refresh token if expired
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

        if (!refreshRes.ok) {
          return jsonResponse({ error: 'Session expired, please reconnect' }, 401, env);
        }

        const newTokens = await refreshRes.json();
        tokenData.access_token = newTokens.access_token;
        tokenData.refresh_token = newTokens.refresh_token;
        tokenData.expires_at = Date.now() + newTokens.expires_in * 1000;
        await env.TOKENS.put(`tokens:${sessionId}`, JSON.stringify(tokenData), { expirationTtl: 86400 });
      }

      const body = await request.json();

      const xeroInvoice = {
        Type: 'ACCREC',
        Contact: { Name: body.contact.name, EmailAddress: body.contact.email || undefined },
        Date: body.date,
        DueDate: body.dueDate,
        Reference: body.reference || undefined,
        CurrencyCode: body.currencyCode || undefined,
        LineItems: body.lineItems.map(item => ({
          Description: item.description,
          Quantity: item.quantity,
          UnitAmount: item.unitAmount,
          AccountCode: '200',
        })),
        Status: 'DRAFT',
      };

      const invoiceRes = await fetch(`${XERO_API_URL}/Invoices`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          'Xero-Tenant-Id': tokenData.tenant_id,
        },
        body: JSON.stringify({ Invoices: [xeroInvoice] }),
      });

      const result = await invoiceRes.json();

      if (!invoiceRes.ok) {
        return jsonResponse({ error: result.Message || 'Xero API error' }, invoiceRes.status, env);
      }

      const created = result.Invoices?.[0];
      return jsonResponse({
        success: true,
        invoiceId: created?.InvoiceID,
        invoiceNumber: created?.InvoiceNumber,
      }, 200, env);
    }

    return jsonResponse({ error: 'Not found' }, 404, env);
  },
};
