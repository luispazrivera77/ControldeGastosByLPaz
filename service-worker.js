// app.js
// Control de gastos minimalista con IndexedDB y PWA

const CURRENCY = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

// ---------- IndexedDB ----------
const dbp = (function () {
  let db;
  return {
    open: () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('gastosDB', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('expenses')) {
            const s = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
            s.createIndex('by_date', 'date', { unique: false });
            s.createIndex('by_name', 'name', { unique: false });
          }
          if (!db.objectStoreNames.contains('attachments')) {
            db.createObjectStore('attachments', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' });
          }
        };
        req.onsuccess = () => { db = req.result; resolve(db); };
        req.onerror = () => reject(req.error);
      }),
    tx: (stores, mode = 'readonly') => db.transaction(stores, mode),
    getAll: (store) =>
      new Promise((res, rej) => {
        const req = dbp.tx([store]).objectStore(store).getAll();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      }),
    add: (store, value) =>
      new Promise((res, rej) => {
        const req = dbp.tx([store], 'readwrite').objectStore(store).add(value);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      }),
    put: (store, value) =>
      new Promise((res, rej) => {
        const req = dbp.tx([store], 'readwrite').objectStore(store).put(value);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      }),
    get: (store, key) =>
      new Promise((res, rej) => {
        const req = dbp.tx([store]).objectStore(store).get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      }),
    delete: (store, key) =>
      new Promise((res, rej) => {
        const req = dbp.tx([store], 'readwrite').objectStore(store).delete(key);
        req.onsuccess = () => res(true);
        req.onerror = () => rej(req.error);
      }),
  };
})();

// ---------- Utils ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n) => CURRENCY.format(n ?? 0);
const todayStr = () => new Date().toISOString().slice(0, 10);

function parseAmount(input) {
  const v = Number(input.value);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

function within(dateISO, start, end) {
  const t = new Date(dateISO);
  return t >= start && t <= end;
}

function getPeriodRange(kind) {
  const now = new Date();
  if (kind === 'week') {
    const end = endOfDay(now);
    const start = new Date(end); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
    return { start, end, label: 'Últimos 7 días' };
  }
  if (kind === 'fortnight') {
    const y = now.getFullYear(); const m = now.getMonth();
    const day = now.getDate();
    const first = new Date(y, m, 1, 0,0,0,0);
    const mid = new Date(y, m, 15, 23,59,59,999);
    const last = new Date(y, m + 1, 0, 23,59,59,999);
    return day <= 15 ? { start: first, end: mid, label: 'Quincena actual' } : { start: new Date(y, m, 16,0,0,0,0), end: last, label: 'Quincena actual' };
  }
  if (kind === 'month') {
    const y = now.getFullYear(); const m = now.getMonth();
    return { start: new Date(y, m, 1, 0,0,0,0), end: new Date(y, m + 1, 0, 23,59,59,999), label: 'Mes actual' };
  }
  return { start: new Date(1970,0,1), end: endOfDay(now), label: 'Todo' };
}
function endOfDay(d) { const x = new Date(d); x.setHours(23,59,59,999); return x; }

function groupByDate(expenses) {
  const map = new Map();
  for (const e of expenses) {
    const k = e.date;
    map.set(k, (map.get(k) || 0) + e.amount);
  }
  return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
}

// ---------- State ----------
let state = {
  expenses: [],
  income: 0,
  filtered: [],
  period: 'week',
  editId: null,
};

// ---------- Init ----------
await dbp.open();
await loadAll();
initUI();
registerSW();
autoSetDefaultDate();
refreshInfoPanel();

function autoSetDefaultDate() {
  $('#date').value = todayStr();
}

// ---------- Load and compute ----------
async function loadAll() {
  const [expenses, metaIncome] = await Promise.all([
    dbp.getAll('expenses'),
    dbp.get('meta', 'income'),
  ]);
  state.expenses = expenses.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  state.income = metaIncome?.value || 0;
  computeAndRender();
}

function computeAndRender() {
  const period = state.period;
  const { start, end } = getPeriodRange(period);
  const filtered = state.expenses.filter(e => within(e.date, start, end));
  state.filtered = filtered;

  const totalSpent = state.expenses.reduce((s, e) => s + e.amount, 0);
  const spentPeriod = filtered.reduce((s, e) => s + e.amount, 0);
  const days = Math.max(1, Math.ceil((end - start) / (1000*60*60*24)) + 1);
  const avg = Math.round(spentPeriod / days);

  // Balance
  $('#incomeDisplay').textContent = fmt(state.income);
  $('#spentDisplay').textContent = fmt(totalSpent);
  const available = Math.max(0, state.income - totalSpent);
  $('#availableDisplay').textContent = fmt(available);
  const ratio = state.income > 0 ? Math.min(100, Math.round((totalSpent / state.income) * 100)) : 0;
  $('#progressBar').style.width = ratio + '%';

  // Stats
  $('#periodTotal').textContent = fmt(spentPeriod);
  $('#periodAvg').textContent = fmt(avg);
  $('#periodCount').textContent = String(filtered.length);

  renderList();
  renderMiniChart(filtered, { start, end });
}

function renderMiniChart(expenses, range) {
  const container = $('#chartBars');
  container.innerHTML = '';
  const byDate = groupByDate(expenses);
  const values = byDate.map(([, v]) => v);
  const max = Math.max(1, ...values);
  for (const [, v] of byDate) {
    const h = Math.max(4, Math.round((v / max) * 100));
    const bar = document.createElement('div');
    bar.style.height = h + '%';
    container.appendChild(bar);
  }
}

// ---------- UI binding ----------
function initUI() {
  $('#expenseForm').addEventListener('submit', onAddExpense);
  $('#periodSelect').addEventListener('change', (e) => {
    state.period = e.target.value;
    computeAndRender();
  });
  $('#search').addEventListener('input', onSearch);
  $('#setIncomeBtn').addEventListener('click', openIncomeDialog);
  $('#saveIncomeBtn').addEventListener('click', saveIncome);
  $('#updateExpenseBtn').addEventListener('click', updateExpense);
  $('#refreshDataBtn').addEventListener('click', refreshInfoPanel);
  setupInstall();
}

function onSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  const items = $$('#expenseList .item');
  let visible = 0;
  for (const li of items) {
    const title = li.querySelector('.title').textContent.toLowerCase();
    const show = title.includes(q);
    li.style.display = show ? '' : 'none';
    if (show) visible++;
  }
  $('#emptyState').style.display = visible === 0 ? '' : 'none';
}

async function onAddExpense(e) {
  e.preventDefault();
  const name = $('#name').value.trim();
  const amount = parseAmount($('#amount'));
  const date = $('#date').value || todayStr();
  if (!name || amount <= 0) return;

  // Attachments
  const photoFile = $('#photo').files[0] || null;
  const docFile = $('#document').files[0] || null;

  const attachmentRefs = [];
  if (photoFile) {
    const id = await dbp.add('attachments', { blob: photoFile, name: photoFile.name, type: photoFile.type, created: Date.now() });
    attachmentRefs.push({ storeId: id, kind: 'photo', name: photoFile.name, type: photoFile.type });
  }
  if (docFile) {
    const id = await dbp.add('attachments', { blob: docFile, name: docFile.name, type: docFile.type, created: Date.now() });
    attachmentRefs.push({ storeId: id, kind: 'document', name: docFile.name, type: docFile.type });
  }

  const expense = { name, amount, date, attachments: attachmentRefs, created: Date.now() };
  const id = await dbp.add('expenses', expense);
  expense.id = id;
  state.expenses.unshift(expense);

  $('#expenseForm').reset();
  autoSetDefaultDate();
  computeAndRender();
}

function renderList() {
  const list = $('#expenseList');
  list.innerHTML = '';
  const empty = $('#emptyState');
  empty.style.display = state.expenses.length ? 'none' : '';

  const tpl = $('#itemTemplate');
  for (const e of state.expenses) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = e.id;

    li.querySelector('.title').textContent = `${e.name} — ${fmt(e.amount)}`;
    li.querySelector('.meta').textContent = new Date(e.date).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });

    const link = li.querySelector('.thumb');
    if (e.attachments?.length) {
      link.classList.remove('hidden');
      link.textContent = e.attachments.length === 1 ? 'Comprobante' : `${e.attachments.length} archivos`;
      link.href = '#';
      link.addEventListener('click', async (ev) => {
        ev.preventDefault();
        // Abre el primero si es imagen o descarga el primero
        const ref = e.attachments[0];
        const at = await dbp.get('attachments', ref.storeId);
        const url = URL.createObjectURL(at.blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(()=>URL.revokeObjectURL(url), 60000);
      });
    }

    li.querySelector('.edit').addEventListener('click', () => openEditDialog(e));
    li.querySelector('.delete').addEventListener('click', () => deleteExpense(e.id));

    list.appendChild(li);
  }
}

function openIncomeDialog() {
  $('#incomeInput').value = state.income || '';
  $('#incomeDialog').showModal();
}

async function saveIncome(ev) {
  ev.preventDefault();
  const v = parseAmount($('#incomeInput'));
  await dbp.put('meta', { key: 'income', value: v });
  state.income = v;
  $('#incomeDialog').close();
  computeAndRender();
}

function openEditDialog(expense) {
  state.editId = expense.id;
  $('#editName').value = expense.name;
  $('#editAmount').value = expense.amount;
  $('#editDate').value = expense.date;
  $('#editDialog').showModal();
}

async function updateExpense(ev) {
  ev.preventDefault();
  if (!state.editId) return;
  const name = $('#editName').value.trim();
  const amount = parseAmount($('#editAmount'));
  const date = $('#editDate').value || todayStr();
  if (!name || amount <= 0) return;

  const e = await dbp.get('expenses', state.editId);
  e.name = name;
  e.amount = amount;
  e.date = date;
  await dbp.put('expenses', e);
  const idx = state.expenses.findIndex(x => x.id === e.id);
  state.expenses[idx] = e;
  state.expenses.sort((a,b)=> b.date.localeCompare(a.date) || b.id - a.id);

  $('#editDialog').close();
  computeAndRender();
}

async function deleteExpense(id) {
  await dbp.delete('expenses', id);
  state.expenses = state.expenses.filter(e => e.id !== id);
  computeAndRender();
}

// ---------- Info panel (índices y cripto) ----------
async function refreshInfoPanel() {
  setInfoListsLoading();
  try {
    const [cl, crypto] = await Promise.all([
      fetch('https://mindicador.cl/api', { cache: 'no-store' }).then(r => r.json()),
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,clp', { cache: 'no-store' }).then(r => r.json()),
    ]);

    const clList = $('#clIndicators');
    clList.innerHTML = '';
    addInfo(clList, 'UF', cl?.uf?.valor ? fmt(Math.round(cl.uf.valor)) : '—');
    addInfo(clList, 'UTM', cl?.utm?.valor ? fmt(Math.round(cl.utm.valor)) : '—');
    addInfo(clList, 'IPC', cl?.ipc?.variacion ? `${cl.ipc.variacion}%` : (cl?.ipc?.valor ? `${cl.ipc.valor}%` : '—'));
    addInfo(clList, 'Imacec', cl?.imacec?.valor ?? '—');

    const fxList = $('#fxIndicators');
    fxList.innerHTML = '';
    addInfo(fxList, 'USD/CLP', cl?.dolar?.valor ? fmt(Math.round(cl.dolar.valor)) : '—');
    addInfo(fxList, 'EUR/CLP', cl?.euro?.valor ? fmt(Math.round(cl.euro.valor)) : '—');

    const cList = $('#cryptoIndicators');
    cList.innerHTML = '';
    addInfo(cList, 'BTC', crypto?.bitcoin ? `$${Math.round(crypto.bitcoin.usd).toLocaleString('en-US')} | ${fmt(Math.round(crypto.bitcoin.clp))}` : '—');
    addInfo(cList, 'ETH', crypto?.ethereum ? `$${Math.round(crypto.ethereum.usd).toLocaleString('en-US')} | ${fmt(Math.round(crypto.ethereum.clp))}` : '—');
    addInfo(cList, 'SOL', crypto?.solana ? `$${Math.round(crypto.solana.usd).toLocaleString('en-US')} | ${fmt(Math.round(crypto.solana.clp))}` : '—');

    $('#lastUpdate').textContent = `Actualizado: ${new Date().toLocaleString('es-CL')}`;
  } catch (e) {
    $('#lastUpdate').textContent = 'No se pudo actualizar. Revisa tu conexión.';
  }
}

function setInfoListsLoading() {
  const lists = [$('#clIndicators'), $('#fxIndicators'), $('#cryptoIndicators')];
  for (const ul of lists) ul.innerHTML = '<li><span class="k">Cargando…</span><span>—</span></li>';
}

function addInfo(ul, key, value) {
  const li = document.createElement('li');
  const k = document.createElement('span'); k.className = 'k'; k.textContent = key;
  const v = document.createElement('span'); v.textContent = value;
  li.append(k, v);
  ul.appendChild(li);
}

// ---------- PWA install ----------
let deferredPrompt = null;
function setupInstall() {
  const btn = $('#installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.style.display = '';
  });
  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.style.display = 'none';
  });
}

// ---------- Service Worker ----------
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
  }
}
