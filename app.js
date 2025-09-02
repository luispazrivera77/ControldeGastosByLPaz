// app.js — Control de Gastos por LPaz (transacciones completas)

const CURRENCY = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

// ---------- IndexedDB ----------
const dbp = (function () {
  let db;
  return {
    open: () =>
      new Promise((resolve, reject) => {
        // Nueva DB/versión para modelo de "transacciones"
        const req = indexedDB.open('gastosDB_v2', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('transactions')) {
            const s = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
            s.createIndex('by_date', 'date', { unique: false });
            s.createIndex('by_name', 'name', { unique: false });
            s.createIndex('by_type', 'type', { unique: false }); // 'expense'|'income'
          }
          if (!db.objectStoreNames.contains('attachments')) {
            db.createObjectStore('attachments', { keyPath: 'id', autoIncrement: true });
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
function endOfDay(d) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function within(dateISO, start, end) {
  const t = new Date(dateISO);
  return t >= start && t <= end;
}
function groupByDate(txs) {
  const map = new Map();
  for (const t of txs) {
    const k = t.date;
    map.set(k, (map.get(k) || 0) + (t.type === 'expense' ? t.amount : 0));
  }
  return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
}
function ranges() {
  const now = new Date();
  const today = { start: startOfDay(now), end: endOfDay(now) };
  const weekEnd = endOfDay(now);
  const weekStart = new Date(weekEnd); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0,0,0,0);
  const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate();
  const fortnight = d <= 15
    ? { start: new Date(y, m, 1, 0,0,0,0), end: new Date(y, m, 15, 23,59,59,999) }
    : { start: new Date(y, m, 16, 0,0,0,0), end: new Date(y, m + 1, 0, 23,59,59,999) };
  const month = { start: new Date(y, m, 1, 0,0,0,0), end: new Date(y, m + 1, 0, 23,59,59,999) };
  return { today, week: { start: weekStart, end: weekEnd }, fortnight, month };
}

// ---------- State ----------
let state = {
  txs: [],
  editId: null,
};

// ---------- Init ----------
await dbp.open();
await loadAll();
initUI();
registerSW();
autoSetDefaultDate();
refreshInfoPanel();
setInterval(refreshInfoPanel, 10 * 60 * 1000); // cada 10 minutos

function autoSetDefaultDate() {
  $('#date').value = todayStr();
}

// ---------- Load & compute ----------
async function loadAll() {
  const txs = await dbp.getAll('transactions');
  state.txs = txs.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  computeAndRender();
}

function computeAndRender() {
  // Balance (sum ingresos/gastos)
  const incomeSum = state.txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenseSum = state.txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const available = incomeSum - expenseSum;

  $('#incomeDisplay').textContent = fmt(incomeSum);
  $('#spentDisplay').textContent = fmt(expenseSum);
  $('#availableDisplay').textContent = fmt(available);
  const ratio = (incomeSum > 0) ? Math.min(100, Math.round((expenseSum / incomeSum) * 100)) : 0;
  $('#progressBar').style.width = ratio + '%';

  // Estadísticas (solo gastos)
  const r = ranges();
  const sumRange = (rg) => state.txs
    .filter(t => t.type === 'expense' && within(t.date, rg.start, rg.end))
    .reduce((s, t) => s + t.amount, 0);

  $('#statTotal').textContent = fmt(expenseSum);
  $('#statToday').textContent = fmt(sumRange(r.today));
  $('#statWeek').textContent = fmt(sumRange(r.week));
  $('#statFortnight').textContent = fmt(sumRange(r.fortnight));
  $('#statMonth').textContent = fmt(sumRange(r.month));

  renderList();
  renderMiniChart(); // barras por día, gastos
}

function renderMiniChart() {
  const container = $('#chartBars');
  container.innerHTML = '';
  const byDate = groupByDate(state.txs);
  const values = byDate.map(([, v]) => v);
  const max = Math.max(1, ...values);
  // Limitar a últimos 14 días visibles
  const last14 = byDate.slice(-14);
  for (const [, v] of last14) {
    const h = Math.max(4, Math.round((v / max) * 100));
    const bar = document.createElement('div');
    bar.style.height = h + '%';
    container.appendChild(bar);
  }
}

// ---------- UI ----------
function initUI() {
  $('#txForm').addEventListener('submit', onAddTx);
  $('#search').addEventListener('input', onSearch);
  $('#refreshDataBtn').addEventListener('click', refreshInfoPanel);
  $('#updateTxBtn').addEventListener('click', updateTx);
  setupInstall();
}

function onSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  const items = $$('#txList .item');
  let visible = 0;
  for (const li of items) {
    const title = li.querySelector('.title').textContent.toLowerCase();
    const show = title.includes(q);
    li.style.display = show ? '' : 'none';
    if (show) visible++;
  }
  $('#emptyState').style.display = visible === 0 ? '' : 'none';
}

async function onAddTx(e) {
  e.preventDefault();
  const type = $('#type').value; // 'expense'|'income'
  const name = $('#name').value.trim();
  const amount = parseAmount($('#amount'));
  const date = $('#date').value || todayStr();
  if (!name || amount <= 0) return;

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

  const tx = { type, name, amount, date, attachments: attachmentRefs, created: Date.now() };
  const id = await dbp.add('transactions', tx);
  tx.id = id;
  state.txs.unshift(tx);

  $('#txForm').reset();
  autoSetDefaultDate();
  computeAndRender();
}

function renderList() {
  const list = $('#txList');
  list.innerHTML = '';
  const empty = $('#emptyState');
  empty.style.display = state.txs.length ? 'none' : '';

  const tpl = $('#itemTemplate');
  for (const t of state.txs) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = t.id;

    const sign = t.type === 'expense' ? '-' : '+';
    const color = t.type === 'expense' ? 'negative' : 'positive';

    li.querySelector('.title').innerHTML = `${t.name} — <span class="${color}">${sign} ${fmt(t.amount)}</span>`;
    li.querySelector('.meta').textContent = new Date(t.date).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });

    const badge = li.querySelector('.badge');
    badge.classList.add(t.type);
    badge.textContent = t.type === 'expense' ? 'Gasto' : 'Ingreso';

    const link = li.querySelector('.thumb');
    if (t.attachments?.length) {
      link.classList.remove('hidden');
      link.textContent = t.attachments.length === 1 ? 'Comprobante' : `${t.attachments.length} archivos`;
      link.href = '#';
      link.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const ref = t.attachments[0];
        const at = await dbp.get('attachments', ref.storeId);
        const url = URL.createObjectURL(at.blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(()=>URL.revokeObjectURL(url), 60000);
      });
    }

    li.querySelector('.edit').addEventListener('click', () => openEditDialog(t));
    li.querySelector('.delete').addEventListener('click', () => deleteTx(t.id));

    list.appendChild(li);
  }
}

function openEditDialog(tx) {
  state.editId = tx.id;
  $('#editType').value = tx.type;
  $('#editName').value = tx.name;
  $('#editAmount').value = tx.amount;
  $('#editDate').value = tx.date;
  $('#editDialog').showModal();
}

async function updateTx(ev) {
  ev.preventDefault();
  if (!state.editId) return;
  const type = $('#editType').value;
  const name = $('#editName').value.trim();
  const amount = parseAmount($('#editAmount'));
  const date = $('#editDate').value || todayStr();
  if (!name || amount <= 0) return;

  const photoFile = $('#editPhoto').files[0] || null;
  const docFile = $('#editDocument').files[0] || null;

  const tx = await dbp.get('transactions', state.editId);
  tx.type = type; tx.name = name; tx.amount = amount; tx.date = date;

  // Si se proporcionan archivos nuevos, reemplaza los existentes
