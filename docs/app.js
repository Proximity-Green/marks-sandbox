const API_URL = 'https://xero-invoice-worker.mark-442.workers.dev';

// --- Page Switching ---

document.querySelectorAll('.page-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelector('.page-tab.active').classList.remove('active');
    tab.classList.add('active');
    const page = tab.dataset.page;
    document.getElementById('page-create').classList.toggle('hidden', page !== 'create');
    document.getElementById('page-list').classList.toggle('hidden', page !== 'list');
    if (page === 'list') loadDocList('invoice');
  });
});

// --- Document Type ---

let docType = 'invoice';

const DOC_CONFIG = {
  invoice: { dateLabel: 'Invoice Date', dueLabel: 'Due Date', submitLabel: 'Submit Draft Invoice to Xero', refPrefix: 'INV' },
  quote:   { dateLabel: 'Quote Date',   dueLabel: 'Expiry Date', submitLabel: 'Submit Quote to Xero', refPrefix: 'QU' },
  po:      { dateLabel: 'Order Date',   dueLabel: 'Delivery Date', submitLabel: 'Submit Purchase Order to Xero', refPrefix: 'PO' },
};

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelector('.tab.active').classList.remove('active');
    tab.classList.add('active');
    docType = tab.dataset.type;
    const cfg = DOC_CONFIG[docType];
    document.getElementById('date-label').textContent = cfg.dateLabel;
    document.getElementById('due-label').textContent = cfg.dueLabel;
    document.getElementById('submit-btn').textContent = cfg.submitLabel;
    document.getElementById('authorise-row').style.display = docType === 'invoice' ? '' : 'none';
    document.getElementById('authorise').checked = false;
  });
});

document.getElementById('authorise').addEventListener('change', (e) => {
  const btn = document.getElementById('submit-btn');
  btn.textContent = e.target.checked ? 'Submit & Authorise Invoice' : DOC_CONFIG[docType].submitLabel;
});

// --- Document List ---

let listType = 'invoice';

document.querySelectorAll('.list-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelector('.list-tab.active').classList.remove('active');
    tab.classList.add('active');
    loadDocList(tab.dataset.list);
  });
});

async function loadDocList(type) {
  listType = type;
  const session = localStorage.getItem('xero_session');
  if (!session) return;

  const loading = document.getElementById('list-loading');
  const table = document.getElementById('doc-list');
  loading.textContent = 'Loading...';
  loading.classList.remove('hidden');
  table.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/list?type=${type}`, {
      headers: { Authorization: `Bearer ${session}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      loading.textContent = 'No documents found';
      return;
    }

    const xeroBase = 'https://go.xero.com';
    const xeroUrls = {
      invoice: id => `${xeroBase}/AccountsReceivable/View.aspx?InvoiceID=${id}`,
      quote: id => `${xeroBase}/Quotes/View/${id}`,
      po: id => `${xeroBase}/PurchaseOrders/View/${id}`,
    };

    data.items.forEach(item => {
      const tr = document.createElement('tr');
      const dateStr = item.date ? formatListDate(item.date) : '';
      tr.innerHTML = `
        <td>${item.number}</td>
        <td>${item.contact}</td>
        <td>${dateStr}</td>
        <td>${item.currency} ${Number(item.total).toFixed(2)}</td>
        <td><span class="status-badge status-${item.status}">${item.status}</span></td>
        <td class="actions">
          <button class="btn-sm btn-open" onclick="window.open('${xeroUrls[type](item.id)}','_blank')">Open</button>
          <button class="btn-sm btn-dl" onclick="downloadPDF('${item.id}','${type}')">PDF</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    loading.classList.add('hidden');
    table.classList.remove('hidden');
  } catch (err) {
    loading.textContent = 'Error: ' + err.message;
  }
}

function formatListDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// --- Auth ---

function checkAuth() {
  const params = new URLSearchParams(window.location.search);
  const session = params.get('session');
  if (session) {
    localStorage.setItem('xero_session', session);
    window.history.replaceState({}, '', window.location.pathname);
    setConnected(true);
    return;
  }

  const stored = localStorage.getItem('xero_session');
  if (!stored) {
    setConnected(false);
    return;
  }

  fetch(`${API_URL}/auth/status`, {
    headers: { Authorization: `Bearer ${stored}` },
  })
    .then(r => r.json())
    .then(data => {
      if (!data.authenticated) localStorage.removeItem('xero_session');
      setConnected(data.authenticated);
    })
    .catch(() => setConnected(false));
}

function setConnected(connected) {
  document.getElementById('connect-btn').classList.toggle('hidden', connected);
  document.getElementById('connected-msg').classList.toggle('hidden', !connected);
  document.getElementById('submit-btn').disabled = !connected;
  if (connected) loadCurrencies();
}

function loadCurrencies() {
  const session = localStorage.getItem('xero_session');
  if (!session) return;
  fetch(`${API_URL}/currencies`, {
    headers: { Authorization: `Bearer ${session}` },
  })
    .then(r => r.json())
    .then(data => {
      const sel = document.getElementById('currency');
      sel.innerHTML = '';
      (data.currencies || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.Code;
        opt.textContent = `${c.Code} - ${c.Description}`;
        if (c.Code === 'ZAR') opt.selected = true;
        sel.appendChild(opt);
      });
      if (!sel.value) sel.value = 'ZAR';
    })
    .catch(() => {});
}

document.getElementById('connect-btn').addEventListener('click', () => {
  window.location.href = `${API_URL}/auth/connect`;
});

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('xero_session');
  setConnected(false);
});

// --- Line Items ---

let lineId = 0;

function addLine(desc = '', qty = 1, price = 0) {
  const id = ++lineId;
  const tbody = document.querySelector('#line-items tbody');
  const tr = document.createElement('tr');
  tr.dataset.id = id;
  tr.innerHTML = `
    <td><input type="text" class="line-desc" value="${desc}" placeholder="Description"></td>
    <td><input type="number" class="line-qty" value="${qty}" min="0" step="1"></td>
    <td><input type="number" class="line-price" value="${price}" min="0" step="0.01"></td>
    <td class="line-amount">ZAR 0.00</td>
    <td><button type="button" class="btn-remove">&times;</button></td>
  `;
  tbody.appendChild(tr);
  updateTotals();
  return tr;
}

document.getElementById('add-line').addEventListener('click', () => addLine());

document.getElementById('line-items').addEventListener('input', updateTotals);

document.getElementById('line-items').addEventListener('click', (e) => {
  if (e.target.classList.contains('btn-remove')) {
    const tbody = document.querySelector('#line-items tbody');
    if (tbody.children.length > 1) {
      e.target.closest('tr').remove();
      updateTotals();
    }
  }
});

function getCurrencySymbol() {
  const sel = document.getElementById('currency');
  return sel.value || 'ZAR';
}

function fmtAmount(val) {
  return `${getCurrencySymbol()} ${val.toFixed(2)}`;
}

function updateTotals() {
  let subtotal = 0;
  document.querySelectorAll('#line-items tbody tr').forEach(tr => {
    const qty = parseFloat(tr.querySelector('.line-qty').value) || 0;
    const price = parseFloat(tr.querySelector('.line-price').value) || 0;
    const amount = qty * price;
    tr.querySelector('.line-amount').textContent = fmtAmount(amount);
    subtotal += amount;
  });
  document.getElementById('subtotal').textContent = fmtAmount(subtotal);
  document.getElementById('total').textContent = fmtAmount(subtotal);
}

document.getElementById('currency').addEventListener('change', updateTotals);

// --- Random Test Data ---

const RANDOM_NAMES = ['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Ltd', 'Stark Industries', 'Wayne Enterprises', 'Oscorp', 'Cyberdyne Systems'];
const RANDOM_ITEMS = ['Web Development', 'Consulting', 'Design Services', 'Server Hosting', 'SEO Audit', 'Logo Design', 'App Development', 'Data Migration', 'Training Workshop', 'Support Package'];

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

document.getElementById('random-btn').addEventListener('click', () => {
  const name = randomPick(RANDOM_NAMES);
  const cfg = DOC_CONFIG[docType];
  document.getElementById('contact-name').value = name;
  document.getElementById('contact-email').value = name.toLowerCase().replace(/\s+/g, '.') + '@example.com';
  document.getElementById('reference').value = cfg.refPrefix + '-' + randomInt(1000, 9999);

  document.querySelector('#line-items tbody').innerHTML = '';
  const numLines = randomInt(1, 4);
  const usedItems = new Set();
  for (let i = 0; i < numLines; i++) {
    let item;
    do { item = randomPick(RANDOM_ITEMS); } while (usedItems.has(item));
    usedItems.add(item);
    addLine(item, randomInt(1, 10), randomInt(50, 500));
  }
  updateTotals();
});

// --- Set defaults ---

function init() {
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 30);
  document.getElementById('invoice-date').value = toDateStr(today);
  document.getElementById('due-date').value = toDateStr(due);
  addLine();
  checkAuth();
}

function toDateStr(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toISODate(str) {
  const [dd, mm, yyyy] = str.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

// --- Submit ---

document.getElementById('invoice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = localStorage.getItem('xero_session');
  if (!session) return;

  const btn = document.getElementById('submit-btn');
  const msg = document.getElementById('status-msg');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  msg.classList.add('hidden');
  document.getElementById('download-btn').classList.add('hidden');

  const lineItems = [];
  document.querySelectorAll('#line-items tbody tr').forEach(tr => {
    lineItems.push({
      description: tr.querySelector('.line-desc').value,
      quantity: parseFloat(tr.querySelector('.line-qty').value) || 0,
      unitAmount: parseFloat(tr.querySelector('.line-price').value) || 0,
    });
  });

  const payload = {
    docType,
    contact: {
      name: document.getElementById('contact-name').value,
      email: document.getElementById('contact-email').value,
    },
    date: toISODate(document.getElementById('invoice-date').value),
    dueDate: toISODate(document.getElementById('due-date').value),
    reference: document.getElementById('reference').value,
    currencyCode: document.getElementById('currency').value,
    authorise: docType === 'invoice' && document.getElementById('authorise').checked,
    lineItems,
  };

  const docLabels = { invoice: 'Invoice', quote: 'Quote', po: 'Purchase Order' };

  try {
    const res = await fetch(`${API_URL}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (res.ok) {
      msg.textContent = `${docLabels[docType]} ${data.number || ''} created successfully!`;
      msg.className = 'success';
      const dlBtn = document.getElementById('download-btn');
      dlBtn.classList.remove('hidden');
      dlBtn.onclick = () => downloadPDF(data.id, data.docType);
    } else {
      document.getElementById('download-btn').classList.add('hidden');
      msg.textContent = `Error (${res.status}): ${data.error || JSON.stringify(data)}`;
      msg.className = 'error';
    }
  } catch (err) {
    msg.textContent = `Error: ${err.message}`;
    msg.className = 'error';
  }

  msg.classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = DOC_CONFIG[docType].submitLabel;
});

// --- Download PDF ---

async function downloadPDF(id, type) {
  const session = localStorage.getItem('xero_session');
  if (!session) return;
  try {
    const res = await fetch(`${API_URL}/pdf?id=${id}&type=${type}`, {
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!res.ok) throw new Error('Failed to download');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-${id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Failed to download PDF: ' + err.message);
  }
}

init();
