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

// Currencies
export async function getCurrencies(): Promise<{ currencies: Array<{ code: string; description: string }> }> {
	return request('/currencies');
}

// Chart of Accounts
export async function getAccounts(): Promise<{ accounts: Array<{ code: string; name: string; type: string }> }> {
	return request('/accounts');
}

// Tracking categories
export async function getTracking(): Promise<{
	tracking: Array<{ trackingCategoryID: string; name: string; options: Array<{ trackingOptionID: string; name: string }> }>;
}> {
	return request('/tracking');
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
