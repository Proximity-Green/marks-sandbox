const API_BASE = 'https://xero-invoice-worker.mark-442.workers.dev';

function getToken(): string | null {
	if (typeof window === 'undefined') return null;
	return localStorage.getItem('xero_session_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const token = getToken();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(options.headers as Record<string, string>)
	};
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers
	});

	if (!res.ok) {
		const body = await res.text();
		let message = `API error ${res.status}`;
		try {
			const json = JSON.parse(body);
			// Xero validation errors
			if (json.error?.elements) {
				const msgs = json.error.elements
					.flatMap((el: Record<string, unknown>) => (el.validationErrors as Array<{ message: string }>) || [])
					.map((ve: { message: string }) => ve.message);
				if (msgs.length) { message = msgs.join('. '); throw new Error(message); }
			}
			// Worker-level error
			if (json.error && typeof json.error === 'string') message = json.error;
			else if (json.Detail) message = json.Detail;
			else if (json.Message) message = json.Message;
			else if (json.message) message = json.message;
		} catch (e) {
			if (e instanceof Error && !e.message.startsWith('API error')) throw e;
		}
		throw new Error(message);
	}

	const contentType = res.headers.get('content-type') || '';
	if (contentType.includes('application/json')) {
		return res.json();
	}
	return res as unknown as T;
}

// Auth
export function getAuthConnectUrl(): string {
	return `${API_BASE}/auth/connect`;
}

export async function getAuthStatus(): Promise<{
	authenticated: boolean;
	orgName?: string;
	orgId?: string;
	shortCode?: string;
}> {
	return request('/auth/status');
}

// --- Supabase direct reads (no auth needed) ---
const SUPABASE_URL = 'https://lcigjfeyldhfoihsyvwn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjaWdqZmV5bGRoZm9paHN5dnduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTI2NDgsImV4cCI6MjA5MDc4ODY0OH0.ef9_p8BmNyFf5h1dOa2_HZMzuKMC6br0yYK8HG9z7Rk';

async function supabaseGet<T>(path: string): Promise<T | null> {
	try {
		const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
			headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
		});
		if (!res.ok) return null;
		return res.json();
	} catch { return null; }
}

// --- Local cache with TTL ---
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
	data: T;
	ts: number;
}

function getCached<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const entry: CacheEntry<T> = JSON.parse(raw);
		if (Date.now() - entry.ts < CACHE_TTL) return entry.data;
	} catch { /* ignore */ }
	return null;
}

function setCache<T>(key: string, data: T): void {
	try {
		const entry: CacheEntry<T> = { data, ts: Date.now() };
		localStorage.setItem(key, JSON.stringify(entry));
	} catch { /* ignore quota errors */ }
}

// Currencies (still from Xero — not stored in Supabase)
export async function getCurrencies(): Promise<{ currencies: Array<{ code: string; description: string }> }> {
	const cached = getCached<{ currencies: Array<{ code: string; description: string }> }>('xero_currencies');
	if (cached) return cached;
	const data = await request<{ currencies: Array<{ code: string; description: string }> }>('/currencies');
	setCache('xero_currencies', data);
	return data;
}

// Chart of Accounts — Supabase first, Xero fallback
export async function getAccounts(): Promise<{ accounts: Array<{ code: string; name: string; type: string }> }> {
	const cached = getCached<{ accounts: Array<{ code: string; name: string; type: string }> }>('xero_accounts');
	if (cached) return cached;

	// Try Supabase
	const rows = await supabaseGet<Array<{ code: string; name: string; type: string }>>('accounts?select=code,name,type&order=code');
	if (rows && rows.length > 0) {
		const data = { accounts: rows };
		setCache('xero_accounts', data);
		return data;
	}

	// Fallback to Xero API
	const data = await request<{ accounts: Array<{ code: string; name: string; type: string }> }>('/accounts');
	setCache('xero_accounts', data);
	return data;
}

// Tracking categories — Supabase first, Xero fallback
export async function getTracking(): Promise<{
	categories: Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }>;
}> {
	const cached = getCached<{ categories: Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }> }>('xero_tracking');
	if (cached) return cached;

	// Try Supabase — fetch categories with nested options
	const cats = await supabaseGet<Array<{
		id: string; external_id: string; name: string;
		tracking_options: Array<{ external_id: string; name: string }>;
	}>>('tracking_categories?select=id,external_id,name,tracking_options(external_id,name)');

	if (cats && cats.length > 0) {
		const data = {
			categories: cats.map(c => ({
				id: c.external_id,
				name: c.name,
				options: (c.tracking_options || []).map(o => ({ id: o.external_id, name: o.name })),
			}))
		};
		setCache('xero_tracking', data);
		return data;
	}

	// Fallback to Xero API
	const data = await request<{ categories: Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }> }>('/tracking');
	setCache('xero_tracking', data);
	return data;
}

// Items catalog from Supabase
export interface CatalogItem {
	item_code: string;
	name: string;
	gl_code: string;
	gl_name: string;
	price: number;
	tracking_codes: string[];
	location_name: string;
	product_type: string;
}

export async function getItems(): Promise<CatalogItem[]> {
	const cached = getCached<CatalogItem[]>('catalog_items');
	if (cached) return cached;

	const rows = await supabaseGet<CatalogItem[]>('items?select=item_code,name,gl_code,gl_name,price,tracking_codes,location_name,product_type&order=name');
	if (rows && rows.length > 0) {
		setCache('catalog_items', rows);
		return rows;
	}
	return [];
}

// Sync accounts & tracking from Xero to Supabase
export async function syncRefData(): Promise<{ synced: boolean; accounts: number; categories: number; options: number; synced_at: string }> {
	return request('/admin/sync', { method: 'POST' });
}

// List documents
export async function listDocuments(type: 'invoices' | 'quotes' | 'purchaseorders'): Promise<{ items: Array<Record<string, unknown>> }> {
	const typeMap: Record<string, string> = { invoices: 'invoice', quotes: 'quote', purchaseorders: 'po' };
	return request(`/list?type=${typeMap[type] || type}`);
}

// Create document
export async function createDocument(data: Record<string, unknown>): Promise<Record<string, unknown>> {
	return request('/create', {
		method: 'POST',
		body: JSON.stringify(data)
	});
}

// Download PDF
export async function downloadPdf(type: string, id: string): Promise<Blob> {
	const token = getToken();
	const res = await fetch(`${API_BASE}/pdf?type=${type}&id=${id}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : {}
	});
	if (!res.ok) throw new Error(`PDF download failed: ${res.status}`);
	return res.blob();
}

// Send email via Xero
export async function sendEmail(type: string, id: string): Promise<Record<string, unknown>> {
	return request('/email', {
		method: 'POST',
		body: JSON.stringify({ type, id })
	});
}

// Send custom email with PDF
export async function sendCustomEmail(data: {
	type: string;
	id: string;
	to: string;
	subject: string;
	body: string;
}): Promise<Record<string, unknown>> {
	return request('/email-custom', {
		method: 'POST',
		body: JSON.stringify(data)
	});
}

export async function inviteUser(email: string, invited_by: string): Promise<{ success: boolean; email: string }> {
	return request('/invite', {
		method: 'POST',
		body: JSON.stringify({ email, invited_by })
	});
}
