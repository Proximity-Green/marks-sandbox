const API_URL = 'https://xero-invoice-worker.mark-442.workers.dev';

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
}

document.getElementById('connect-btn').addEventListener('click', () => {
  window.location.href = `${API_URL}/auth/connect`;
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
    <td class="line-amount">$0.00</td>
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

function updateTotals() {
  let subtotal = 0;
  document.querySelectorAll('#line-items tbody tr').forEach(tr => {
    const qty = parseFloat(tr.querySelector('.line-qty').value) || 0;
    const price = parseFloat(tr.querySelector('.line-price').value) || 0;
    const amount = qty * price;
    tr.querySelector('.line-amount').textContent = `$${amount.toFixed(2)}`;
    subtotal += amount;
  });
  document.getElementById('subtotal').textContent = `$${subtotal.toFixed(2)}`;
  document.getElementById('total').textContent = `$${subtotal.toFixed(2)}`;
}

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
  return d.toISOString().split('T')[0];
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

  const lineItems = [];
  document.querySelectorAll('#line-items tbody tr').forEach(tr => {
    lineItems.push({
      description: tr.querySelector('.line-desc').value,
      quantity: parseFloat(tr.querySelector('.line-qty').value) || 0,
      unitAmount: parseFloat(tr.querySelector('.line-price').value) || 0,
    });
  });

  const invoice = {
    contact: {
      name: document.getElementById('contact-name').value,
      email: document.getElementById('contact-email').value,
    },
    date: document.getElementById('invoice-date').value,
    dueDate: document.getElementById('due-date').value,
    reference: document.getElementById('reference').value,
    lineItems,
  };

  try {
    const res = await fetch(`${API_URL}/invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify(invoice),
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = `Invoice ${data.invoiceNumber || ''} created successfully!`;
      msg.className = 'success';
    } else {
      msg.textContent = `Error: ${data.error || 'Failed to create invoice'}`;
      msg.className = 'error';
    }
  } catch (err) {
    msg.textContent = `Error: ${err.message}`;
    msg.className = 'error';
  }

  msg.classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = 'Submit to Xero';
});

init();
