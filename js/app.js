const STORAGE_KEYS = {
  users: 'cc_votantes_users',
  session: 'cc_votantes_session',
  voters: 'cc_votantes_registry'
};

const DEFAULT_ADMIN = {
  id: 'user-admin',
  fullName: 'Administrador General',
  phone: '000000000',
  username: 'Admin',
  password: 'CAROL2T3',
  role: 'admin',
  createdAt: new Date().toISOString()
};

const FALLBACK_CSV = `numero,nombre_apellido,cedula,estado,domicilio_barrio,observaciones
1,Ana Gómez,1234567,pendiente,Barrio Centro,
2,Carlos Medina,2345678,pendiente,San José,
3,María López,3456789,no_voto,Villa Esperanza,Trabaja fuera del distrito
4,Pedro Benítez,4567890,ya_voto,Barrio Norte,Confirmado por coordinación`;

const state = {
  users: [],
  voters: [],
  currentUser: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const elements = {};

document.addEventListener('DOMContentLoaded', async () => {
  captureElements();
  seedAdminUser();
  await bootstrapVoters();
  restoreSession();
  bindEvents();
  refreshUI();
});

function captureElements() {
  elements.loginView = $('#loginView');
  elements.dashboardView = $('#dashboardView');
  elements.adminSection = $('#adminSection');
  elements.loginForm = $('#loginForm');
  elements.logoutBtn = $('#logoutBtn');
  elements.searchInput = $('#searchInput');
  elements.statusFilter = $('#statusFilter');
  elements.votersTableBody = $('#votersTableBody');
  elements.usersTableBody = $('#usersTableBody');
  elements.userForm = $('#userForm');
  elements.sessionInfo = $('#sessionInfo');
  elements.totalCount = $('#totalCount');
  elements.votedCount = $('#votedCount');
  elements.notVotedCount = $('#notVotedCount');
  elements.pendingCount = $('#pendingCount');
  elements.addVoterBtn = $('#addVoterBtn');
  elements.exportBtn = $('#exportBtn');
  elements.reloadBaseBtn = $('#reloadBaseBtn');
  elements.voterDialog = $('#voterDialog');
  elements.closeVoterDialog = $('#closeVoterDialog');
  elements.cancelVoterBtn = $('#cancelVoterBtn');
  elements.voterForm = $('#voterForm');
  elements.voterNumber = $('#voterNumber');
  elements.voterName = $('#voterName');
  elements.voterCi = $('#voterCi');
  elements.voterAddress = $('#voterAddress');
  elements.voterNotes = $('#voterNotes');
}

function bindEvents() {
  elements.loginForm.addEventListener('submit', onLogin);
  elements.logoutBtn.addEventListener('click', onLogout);
  elements.searchInput.addEventListener('input', renderVoters);
  elements.statusFilter.addEventListener('change', renderVoters);
  elements.userForm.addEventListener('submit', onCreateUser);
  elements.addVoterBtn.addEventListener('click', openVoterDialog);
  elements.exportBtn.addEventListener('click', exportCurrentCsv);
  elements.reloadBaseBtn.addEventListener('click', reloadBasePadron);
  elements.closeVoterDialog.addEventListener('click', closeVoterDialog);
  elements.cancelVoterBtn.addEventListener('click', closeVoterDialog);
  elements.voterForm.addEventListener('submit', onCreateVoter);
  elements.votersTableBody.addEventListener('click', onVoterTableClick);
  elements.usersTableBody.addEventListener('click', onUserTableClick);
}

function seedAdminUser() {
  const users = readStorage(STORAGE_KEYS.users, []);
  const adminExists = users.some((user) => user.username.toLowerCase() === DEFAULT_ADMIN.username.toLowerCase());

  if (!adminExists) {
    users.unshift(DEFAULT_ADMIN);
    saveStorage(STORAGE_KEYS.users, users);
  }

  state.users = users;
}

async function bootstrapVoters() {
  const storedVoters = readStorage(STORAGE_KEYS.voters, null);

  if (storedVoters && Array.isArray(storedVoters)) {
    state.voters = storedVoters;
    return;
  }

  const baseVoters = await loadBaseCsv();
  state.voters = baseVoters;
  persistVoters();
}

async function loadBaseCsv() {
  try {
    const response = await fetch(`data/votantes.csv?cacheBust=${Date.now()}`);
    if (!response.ok) {
      throw new Error('No se pudo cargar el CSV base.');
    }

    const csvText = await response.text();
    const parsed = parseCsv(csvText);
    return parsed.length ? parsed : parseCsv(FALLBACK_CSV);
  } catch (error) {
    console.warn(error);
    return parseCsv(FALLBACK_CSV);
  }
}

function restoreSession() {
  const session = readStorage(STORAGE_KEYS.session, null);

  if (!session) {
    state.currentUser = null;
    return;
  }

  const user = state.users.find((item) => item.id === session.id);
  state.currentUser = user || null;
}

function refreshUI() {
  if (!state.currentUser) {
    elements.loginView.classList.remove('view-hidden');
    elements.loginView.classList.add('view-active');
    elements.dashboardView.classList.add('view-hidden');
    elements.loginForm.reset();
    return;
  }

  elements.loginView.classList.add('view-hidden');
  elements.dashboardView.classList.remove('view-hidden');

  const roleLabel = state.currentUser.role === 'admin' ? 'Administrador' : 'Usuario';
  elements.sessionInfo.textContent = `${state.currentUser.fullName} · ${roleLabel} · Usuario: ${state.currentUser.username}`;
  elements.adminSection.classList.toggle('view-hidden', state.currentUser.role !== 'admin');
  elements.reloadBaseBtn.disabled = state.currentUser.role !== 'admin';
  elements.addVoterBtn.disabled = false;
  renderUsers();
  renderVoters();
  updateStats();
}

function onLogin(event) {
  event.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value.trim();

  const user = state.users.find(
    (item) => item.username.toLowerCase() === username.toLowerCase() && item.password === password
  );

  if (!user) {
    window.alert('Usuario o contraseña incorrectos.');
    return;
  }

  state.currentUser = user;
  saveStorage(STORAGE_KEYS.session, { id: user.id });
  refreshUI();
}

function onLogout() {
  state.currentUser = null;
  localStorage.removeItem(STORAGE_KEYS.session);
  refreshUI();
}

function onCreateUser(event) {
  event.preventDefault();

  if (!isAdmin()) {
    window.alert('Solo el administrador puede registrar usuarios.');
    return;
  }

  const fullName = $('#newFullName').value.trim();
  const phone = $('#newPhone').value.trim();
  const username = $('#newUsername').value.trim();
  const password = $('#newPassword').value.trim();

  if (!fullName || !phone || !username || !password) {
    window.alert('Complete todos los datos del usuario.');
    return;
  }

  const duplicated = state.users.some((user) => user.username.toLowerCase() === username.toLowerCase());
  if (duplicated) {
    window.alert('Ese nombre de usuario ya existe.');
    return;
  }

  state.users.push({
    id: crypto.randomUUID(),
    fullName,
    phone,
    username,
    password,
    role: 'usuario',
    createdAt: new Date().toISOString()
  });

  persistUsers();
  elements.userForm.reset();
  renderUsers();
  window.alert('Usuario registrado correctamente.');
}

function onUserTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const userId = button.dataset.id;
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;

  if (action === 'delete-user') {
    if (!isAdmin()) {
      window.alert('Solo el administrador puede eliminar usuarios.');
      return;
    }

    const isDefaultAdmin = user.username.toLowerCase() === DEFAULT_ADMIN.username.toLowerCase();
    const isOwnAccount = state.currentUser && user.id === state.currentUser.id;

    if (isDefaultAdmin || isOwnAccount) {
      window.alert('No se puede eliminar esa cuenta.');
      return;
    }

    const confirmed = window.confirm(`¿Desea eliminar al usuario ${user.fullName}?`);
    if (!confirmed) return;

    state.users = state.users.filter((item) => item.id !== user.id);
    persistUsers();
    renderUsers();
  }
}

function renderUsers() {
  if (!elements.usersTableBody) return;

  const rows = state.users
    .map((user) => {
      const roleLabel = user.role === 'admin' ? 'Administrador' : 'Usuario';
      const deleteDisabled =
        user.username.toLowerCase() === DEFAULT_ADMIN.username.toLowerCase() ||
        (state.currentUser && user.id === state.currentUser.id);

      return `
        <tr>
          <td>${escapeHtml(user.fullName)}</td>
          <td>${escapeHtml(user.phone)}</td>
          <td>${escapeHtml(user.username)}</td>
          <td><span class="badge badge--dark">${roleLabel}</span></td>
          <td>
            ${deleteDisabled
              ? '<span class="muted">Protegido</span>'
              : `<button class="btn btn--danger" data-action="delete-user" data-id="${user.id}" type="button">
                  <svg class="icon"><use href="assets/icons.svg#icon-trash"></use></svg>
                  Eliminar
                </button>`}
          </td>
        </tr>
      `;
    })
    .join('');

  elements.usersTableBody.innerHTML = rows || '<tr><td colspan="5" class="empty-state">No hay usuarios registrados.</td></tr>';
}

function openVoterDialog() {
  elements.voterForm.reset();
  const nextNumber = getNextVoterNumber();
  elements.voterNumber.value = nextNumber;

  if (typeof elements.voterDialog.showModal === 'function') {
    elements.voterDialog.showModal();
  } else {
    elements.voterDialog.setAttribute('open', 'open');
  }
}

function closeVoterDialog() {
  if (typeof elements.voterDialog.close === 'function') {
    elements.voterDialog.close();
  } else {
    elements.voterDialog.removeAttribute('open');
  }
}

function onCreateVoter(event) {
  event.preventDefault();

  const numero = Number(elements.voterNumber.value);
  const nombre = elements.voterName.value.trim();
  const cedula = elements.voterCi.value.trim();
  const domicilio = elements.voterAddress.value.trim();
  const observaciones = elements.voterNotes.value.trim();

  if (!numero || !nombre || !cedula) {
    window.alert('Número, nombre y cédula son obligatorios.');
    return;
  }

  const duplicateCi = state.voters.some((voter) => voter.cedula.toLowerCase() === cedula.toLowerCase());
  if (duplicateCi) {
    window.alert('Ya existe un votante con esa cédula.');
    return;
  }

  state.voters.push({
    id: crypto.randomUUID(),
    numero,
    nombreApellido: nombre,
    cedula,
    estado: 'pendiente',
    domicilioBarrio: domicilio,
    observaciones,
    actualizadoPor: state.currentUser ? state.currentUser.username : 'Sistema',
    actualizadoEn: new Date().toISOString()
  });

  sortVoters();
  persistVoters();
  closeVoterDialog();
  renderVoters();
  updateStats();
}

function onVoterTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const voterId = button.dataset.id;
  const voter = state.voters.find((item) => item.id === voterId);
  if (!voter) return;

  if (action === 'mark-voted') {
    updateVoterStatus(voter, 'ya_voto', voter.observaciones || '');
    return;
  }

  if (action === 'mark-not-voted') {
    const current = voter.estado === 'no_voto' ? voter.observaciones || '' : '';
    const reason = window.prompt('Observación de por qué no votó. Puede dejarse vacía.', current);
    if (reason === null) return;
    updateVoterStatus(voter, 'no_voto', reason.trim());
    return;
  }

  if (action === 'reset-status') {
    const confirmed = window.confirm(`¿Desea dejar a ${voter.nombreApellido} como pendiente?`);
    if (!confirmed) return;
    updateVoterStatus(voter, 'pendiente', voter.observaciones || '');
    return;
  }

  if (action === 'delete-voter') {
    if (!isAdmin()) {
      window.alert('Solo el administrador puede eliminar votantes.');
      return;
    }

    const confirmed = window.confirm(`¿Desea eliminar a ${voter.nombreApellido}?`);
    if (!confirmed) return;

    state.voters = state.voters.filter((item) => item.id !== voter.id);
    persistVoters();
    renderVoters();
    updateStats();
  }
}

function updateVoterStatus(voter, status, observaciones) {
  voter.estado = status;
  if (status === 'no_voto') {
    voter.observaciones = observaciones;
  } else if (status === 'ya_voto') {
    voter.observaciones = observaciones || voter.observaciones || '';
  }

  if (status === 'pendiente' && observaciones === '') {
    voter.observaciones = '';
  }

  voter.actualizadoPor = state.currentUser ? state.currentUser.username : 'Sistema';
  voter.actualizadoEn = new Date().toISOString();

  persistVoters();
  renderVoters();
  updateStats();
}

function renderVoters() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const statusFilter = elements.statusFilter.value;

  const filtered = state.voters.filter((voter) => {
    const matchesSearch =
      !query ||
      voter.nombreApellido.toLowerCase().includes(query) ||
      voter.cedula.toLowerCase().includes(query);

    const matchesStatus = statusFilter === 'todos' || voter.estado === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (!filtered.length) {
    elements.votersTableBody.innerHTML = '<tr><td colspan="8" class="empty-state">No se encontraron votantes con ese criterio.</td></tr>';
    return;
  }

  elements.votersTableBody.innerHTML = filtered
    .map((voter) => {
      const badge = getStatusBadge(voter.estado);
      const auditText = voter.actualizadoPor
        ? `${escapeHtml(voter.actualizadoPor)}<br><span class="muted">${formatDate(voter.actualizadoEn)}</span>`
        : '<span class="muted">Sin registro</span>';

      const deleteButton = isAdmin()
        ? `<button class="btn btn--danger" data-action="delete-voter" data-id="${voter.id}" type="button">
            <svg class="icon"><use href="assets/icons.svg#icon-trash"></use></svg>
            Eliminar
          </button>`
        : '';

      return `
        <tr>
          <td>${escapeHtml(String(voter.numero))}</td>
          <td>${escapeHtml(voter.nombreApellido)}</td>
          <td>${escapeHtml(voter.cedula)}</td>
          <td>${badge}</td>
          <td>${escapeHtml(voter.domicilioBarrio || '')}</td>
          <td>${escapeHtml(voter.observaciones || '') || '<span class="muted">Sin observaciones</span>'}</td>
          <td>${auditText}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn--primary" data-action="mark-voted" data-id="${voter.id}" type="button">
                <svg class="icon"><use href="assets/icons.svg#icon-check"></use></svg>
                Ya votó
              </button>
              <button class="btn btn--ghost" data-action="mark-not-voted" data-id="${voter.id}" type="button">
                <svg class="icon"><use href="assets/icons.svg#icon-x"></use></svg>
                No votó
              </button>
              <button class="btn btn--secondary" data-action="reset-status" data-id="${voter.id}" type="button">
                <svg class="icon"><use href="assets/icons.svg#icon-refresh"></use></svg>
                Pendiente
              </button>
              ${deleteButton}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function getStatusBadge(status) {
  if (status === 'ya_voto') {
    return '<span class="badge badge--success"><svg class="icon"><use href="assets/icons.svg#icon-check"></use></svg>Ya votó</span>';
  }

  if (status === 'no_voto') {
    return '<span class="badge badge--danger"><svg class="icon"><use href="assets/icons.svg#icon-x"></use></svg>No votó</span>';
  }

  return '<span class="badge badge--neutral"><svg class="icon"><use href="assets/icons.svg#icon-clock"></use></svg>Pendiente</span>';
}

function updateStats() {
  const total = state.voters.length;
  const voted = state.voters.filter((item) => item.estado === 'ya_voto').length;
  const notVoted = state.voters.filter((item) => item.estado === 'no_voto').length;
  const pending = state.voters.filter((item) => item.estado === 'pendiente').length;

  elements.totalCount.textContent = String(total);
  elements.votedCount.textContent = String(voted);
  elements.notVotedCount.textContent = String(notVoted);
  elements.pendingCount.textContent = String(pending);
}

async function reloadBasePadron() {
  if (!isAdmin()) {
    window.alert('Solo el administrador puede recargar el padrón base.');
    return;
  }

  const confirmed = window.confirm('Esto reemplazará los cambios guardados en este navegador por el CSV base.');
  if (!confirmed) return;

  state.voters = await loadBaseCsv();
  persistVoters();
  renderVoters();
  updateStats();
  window.alert('Padrón base recargado correctamente.');
}

function exportCurrentCsv() {
  const headers = [
    'numero',
    'nombre_apellido',
    'cedula',
    'estado',
    'domicilio_barrio',
    'observaciones',
    'actualizado_por',
    'actualizado_en'
  ];

  const lines = state.voters.map((voter) => [
    voter.numero,
    voter.nombreApellido,
    voter.cedula,
    voter.estado,
    voter.domicilioBarrio || '',
    voter.observaciones || '',
    voter.actualizadoPor || '',
    voter.actualizadoEn || ''
  ]);

  const csv = [headers, ...lines].map((line) => line.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'votantes-actualizado.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map(parseCsvLine);

  if (rows.length <= 1) return [];

  const headers = rows[0].map(normalizeHeader);
  const dataRows = rows.slice(1);

  return dataRows.map((row, index) => {
    const record = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] || '']));
    const numero = Number(getValue(record, ['numero', 'n', 'nro', 'número'])) || index + 1;
    const nombreApellido = getValue(record, ['nombre_apellido', 'nombre_y_apellido', 'nombre', 'nombreapellido']) || `Votante ${index + 1}`;
    const cedula = getValue(record, ['cedula', 'ci', 'numero_de_cedula', 'numero_cedula']) || `sin-ci-${index + 1}`;
    const estado = normalizeStatus(getValue(record, ['estado', 'voto_no_voto', 'voto', 'estado_voto']) || 'pendiente');
    const domicilioBarrio = getValue(record, ['domicilio_barrio', 'domicilio', 'barrio', 'direccion']) || '';
    const observaciones = getValue(record, ['observaciones', 'obs', 'nota', 'notas']) || '';

    return {
      id: crypto.randomUUID(),
      numero,
      nombreApellido,
      cedula,
      estado,
      domicilioBarrio,
      observaciones,
      actualizadoPor: 'Carga inicial CSV',
      actualizadoEn: new Date().toISOString()
    };
  });
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function normalizeHeader(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getValue(record, possibleKeys) {
  for (const key of possibleKeys) {
    if (record[key]) return String(record[key]).trim();
  }
  return '';
}

function normalizeStatus(status) {
  const clean = String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (['ya_voto', 'voto', 'si', 'si_voto', 'ya voto'].includes(clean)) return 'ya_voto';
  if (['no_voto', 'no', 'no voto'].includes(clean)) return 'no_voto';
  return 'pendiente';
}

function getNextVoterNumber() {
  if (!state.voters.length) return 1;
  return Math.max(...state.voters.map((item) => Number(item.numero) || 0)) + 1;
}

function sortVoters() {
  state.voters.sort((a, b) => Number(a.numero) - Number(b.numero));
}

function persistUsers() {
  saveStorage(STORAGE_KEYS.users, state.users);
}

function persistVoters() {
  sortVoters();
  saveStorage(STORAGE_KEYS.voters, state.voters);
}

function isAdmin() {
  return Boolean(state.currentUser && state.currentUser.role === 'admin');
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(error);
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  return new Date(value).toLocaleString('es-ES');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function csvCell(value) {
  const safe = String(value ?? '');
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}
