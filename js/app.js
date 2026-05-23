/**
 * SISTEMA DE REGISTRO DE VOTANTES
 * Mgtr. Carolina Caballero - Lista 2T Opción 3
 * =============================================
 * Lógica principal: autenticación, CRUD votantes, usuarios, CSV
 */

'use strict';

/* ============================================
   ESTADO GLOBAL
   ============================================ */
const STATE = {
  currentUser: null,
  users: [],
  votantes: [],
  filteredVotantes: [],
  page: 1,
  perPage: 15,
  filterVoto: 'todos',
  searchQuery: '',
};

/* ============================================
   DATOS INICIALES
   ============================================ */
const DEFAULT_USERS = [
  {
    id: 1,
    nombre: 'Administrador',
    apellido: 'Sistema',
    usuario: 'Admin',
    password: 'CAROL2T3',
    telefono: '',
    rol: 'admin',
    fechaCreacion: new Date().toISOString(),
  }
];

/* ============================================
   STORAGE HELPERS
   ============================================ */
const STORAGE_KEYS = { USERS: 'vot_users', VOTANTES: 'vot_votantes' };

function loadUsers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USERS);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveUsers() {
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(STATE.users));
}

function loadVotantes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VOTANTES);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveVotantes() {
  localStorage.setItem(STORAGE_KEYS.VOTANTES, JSON.stringify(STATE.votantes));
}

/* ============================================
   INICIALIZACIÓN
   ============================================ */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Cargar SVG sprite
  await loadSVGSprite();

  // Usuarios
  const storedUsers = loadUsers();
  STATE.users = storedUsers ?? JSON.parse(JSON.stringify(DEFAULT_USERS));
  if (!storedUsers) saveUsers();

  // Votantes: intentar desde storage; si no, cargar CSV
  const storedVotantes = loadVotantes();
  if (storedVotantes && storedVotantes.length > 0) {
    STATE.votantes = storedVotantes;
  } else {
    await loadCSV();
  }

  bindLoginForm();
  bindNavTabs();
  bindModals();
  bindSearch();
}

async function loadSVGSprite() {
  try {
    const resp = await fetch('./assets/icons.svg');
    const text = await resp.text();
    const div = document.createElement('div');
    div.style.display = 'none';
    div.innerHTML = text;
    document.body.insertBefore(div, document.body.firstChild);
  } catch (e) {
    console.warn('SVG sprite no cargado:', e);
  }
}

/* ============================================
   CARGA DE CSV
   ============================================ */
async function loadCSV() {
  // URL del CSV en GitHub (raw) — se puede cambiar en la UI
  const csvUrl = getCSVUrl();
  if (!csvUrl) { STATE.votantes = []; return; }

  try {
    const resp = await fetch(csvUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    STATE.votantes = parseCSV(text);
    saveVotantes();
    showToast('CSV cargado correctamente', 'success');
  } catch (e) {
    console.warn('No se pudo cargar CSV remoto, usando local:', e);
    try {
      const resp = await fetch('./data/votantes.csv');
      const text = await resp.text();
      STATE.votantes = parseCSV(text);
      saveVotantes();
    } catch {
      STATE.votantes = [];
    }
  }
}

function getCSVUrl() {
  return localStorage.getItem('vot_csv_url') || './data/votantes.csv';
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  // header: nro,nombre,apellido,cedula,voto,domicilio,observaciones,marcadoPor,fechaMarca
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (!cols[0]) continue;
    result.push({
      id: parseInt(cols[0]) || i,
      nombre: cols[1] || '',
      apellido: cols[2] || '',
      cedula: cols[3] || '',
      voto: (cols[4] || 'no').toLowerCase() === 'si' ? 'si' : 'no',
      domicilio: cols[5] || '',
      observaciones: cols[6] || '',
      marcadoPor: cols[7] || '',
      fechaMarca: cols[8] || '',
    });
  }
  return result;
}

/* ============================================
   AUTENTICACIÓN
   ============================================ */
function bindLoginForm() {
  const form = document.getElementById('login-form');
  const errMsg = document.getElementById('login-error');
  const toggleBtn = document.getElementById('toggle-password');
  const passInput = document.getElementById('login-password');

  toggleBtn?.addEventListener('click', () => {
    const isText = passInput.type === 'text';
    passInput.type = isText ? 'password' : 'text';
    toggleBtn.innerHTML = svgUse(isText ? 'icon-eye' : 'icon-eye-off');
  });

  form?.addEventListener('submit', e => {
    e.preventDefault();
    errMsg.style.display = 'none';

    const usuario = document.getElementById('login-usuario').value.trim();
    const password = passInput.value;

    const user = STATE.users.find(u => u.usuario === usuario && u.password === password);
    if (!user) {
      errMsg.style.display = 'flex';
      errMsg.querySelector('span').textContent = 'Usuario o contraseña incorrectos.';
      return;
    }

    loginSuccess(user);
  });
}

function loginSuccess(user) {
  STATE.currentUser = user;

  // Mostrar/ocultar secciones admin
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = user.rol === 'admin' ? '' : 'none';
  });

  // Actualizar badge usuario
  document.getElementById('user-display').textContent = user.usuario;
  document.getElementById('user-role-badge').textContent = user.rol === 'admin' ? 'Admin' : 'Usuario';

  // Cambiar pantallas
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');

  // Cargar datos
  renderDashboard();
  renderVotantes();

  // Tab inicial
  switchTab('planilla');
}

function logout() {
  STATE.currentUser = null;
  document.getElementById('login-screen').style.display = '';
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-form').reset();
  document.getElementById('login-error').style.display = 'none';
}

/* ============================================
   NAVEGACIÓN / TABS
   ============================================ */
function bindNavTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('active', p.id === 'panel-' + tabId);
  });

  if (tabId === 'planilla') renderVotantes();
  if (tabId === 'dashboard') renderDashboard();
  if (tabId === 'usuarios') renderUsuarios();
}

/* ============================================
   DASHBOARD
   ============================================ */
function renderDashboard() {
  const total = STATE.votantes.length;
  const votaron = STATE.votantes.filter(v => v.voto === 'si').length;
  const noVotaron = total - votaron;
  const pct = total > 0 ? Math.round((votaron / total) * 100) : 0;

  setEl('stat-total', total);
  setEl('stat-votaron', votaron);
  setEl('stat-novotaron', noVotaron);
  setEl('stat-pct', pct + '%');

  const fill = document.getElementById('progress-fill');
  const pctLabel = document.getElementById('progress-pct');
  if (fill) fill.style.width = pct + '%';
  if (pctLabel) pctLabel.textContent = pct + '%';

  // Recientes marcados
  const recientes = [...STATE.votantes]
    .filter(v => v.marcadoPor)
    .sort((a, b) => new Date(b.fechaMarca) - new Date(a.fechaMarca))
    .slice(0, 5);

  const tbody = document.getElementById('recientes-tbody');
  if (!tbody) return;
  if (!recientes.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="text-align:center;padding:24px;color:var(--gris-light);">Sin registros aún</td></tr>`;
    return;
  }
  tbody.innerHTML = recientes.map(v => `
    <tr>
      <td class="td-nombre">${v.nombre} ${v.apellido}</td>
      <td class="td-ci">${v.cedula}</td>
      <td><span class="badge-voto ${v.voto}"><span class="badge-voto dot"></span>${v.voto === 'si' ? 'Votó' : 'No votó'}</span></td>
      <td class="td-marcado">${v.marcadoPor}</td>
      <td class="td-marcado">${v.fechaMarca ? formatDate(v.fechaMarca) : '—'}</td>
    </tr>
  `).join('');
}

/* ============================================
   TABLA DE VOTANTES
   ============================================ */
function bindSearch() {
  const input = document.getElementById('search-input');
  const filterSel = document.getElementById('filter-voto');

  input?.addEventListener('input', () => {
    STATE.searchQuery = input.value.toLowerCase().trim();
    STATE.page = 1;
    renderVotantes();
  });

  filterSel?.addEventListener('change', () => {
    STATE.filterVoto = filterSel.value;
    STATE.page = 1;
    renderVotantes();
  });
}

function renderVotantes() {
  applyFilters();

  const tbody = document.getElementById('votantes-tbody');
  if (!tbody) return;

  const start = (STATE.page - 1) * STATE.perPage;
  const slice = STATE.filteredVotantes.slice(start, start + STATE.perPage);

  if (!slice.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:40px;">
          <div class="empty-state">
            <svg viewBox="0 0 24 24"><use href="#icon-search"/></svg>
            <p>No se encontraron votantes</p>
          </div>
        </td>
      </tr>`;
    renderPagination();
    return;
  }

  tbody.innerHTML = slice.map(v => `
    <tr data-id="${v.id}">
      <td class="td-nro">${v.id}</td>
      <td class="td-nombre">${esc(v.nombre)}</td>
      <td class="td-nombre">${esc(v.apellido)}</td>
      <td class="td-ci">${esc(v.cedula)}</td>
      <td>
        <span class="badge-voto ${v.voto}">
          <span class="badge-voto dot"></span>
          ${v.voto === 'si' ? 'Votó' : 'No votó'}
        </span>
      </td>
      <td class="td-dom">${esc(v.domicilio)}</td>
      <td class="td-obs" title="${esc(v.observaciones)}">${esc(v.observaciones) || '—'}</td>
      <td class="td-marcado">${v.marcadoPor ? `<span title="Marcado por ${esc(v.marcadoPor)} el ${formatDate(v.fechaMarca)}">${esc(v.marcadoPor)}</span>` : '—'}</td>
      <td class="td-acciones">
        <div class="actions-wrap">
          ${v.voto === 'no'
            ? `<button class="btn btn-voto" onclick="marcarVoto(${v.id}, 'si')" title="Marcar como Votó">
                <svg viewBox="0 0 24 24"><use href="#icon-check"/></svg> Votó
              </button>`
            : `<button class="btn btn-novoto" onclick="marcarVoto(${v.id}, 'no')" title="Desmarcar voto">
                <svg viewBox="0 0 24 24"><use href="#icon-cancel"/></svg> Desmarcar
              </button>`
          }
          ${STATE.currentUser?.rol === 'admin' ? `
            <button class="btn btn-secondary btn-sm btn-icon" onclick="editarVotante(${v.id})" title="Editar">
              <svg viewBox="0 0 24 24"><use href="#icon-edit"/></svg>
            </button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="eliminarVotante(${v.id})" title="Eliminar">
              <svg viewBox="0 0 24 24"><use href="#icon-delete"/></svg>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  renderPagination();
  updateCountLabel();
}

function applyFilters() {
  let list = [...STATE.votantes];
  if (STATE.filterVoto !== 'todos') {
    list = list.filter(v => v.voto === STATE.filterVoto);
  }
  if (STATE.searchQuery) {
    const q = STATE.searchQuery;
    list = list.filter(v =>
      v.nombre.toLowerCase().includes(q) ||
      v.apellido.toLowerCase().includes(q) ||
      v.cedula.includes(q) ||
      v.domicilio.toLowerCase().includes(q)
    );
  }
  STATE.filteredVotantes = list;
}

function updateCountLabel() {
  const label = document.getElementById('count-label');
  if (label) label.textContent = `${STATE.filteredVotantes.length} votante(s)`;
}

function renderPagination() {
  const total = STATE.filteredVotantes.length;
  const pages = Math.ceil(total / STATE.perPage) || 1;
  const pg = document.getElementById('pg-info');
  const pgBtns = document.getElementById('pg-btns');
  if (!pgBtns) return;

  if (pg) pg.textContent = `Página ${STATE.page} de ${pages}  ·  ${total} registros`;

  pgBtns.innerHTML = '';

  const prev = document.createElement('button');
  prev.className = 'pg-btn';
  prev.innerHTML = '‹';
  prev.disabled = STATE.page <= 1;
  prev.onclick = () => { STATE.page--; renderVotantes(); };
  pgBtns.appendChild(prev);

  const maxShow = 5;
  let startP = Math.max(1, STATE.page - 2);
  let endP = Math.min(pages, startP + maxShow - 1);
  startP = Math.max(1, endP - maxShow + 1);

  for (let i = startP; i <= endP; i++) {
    const btn = document.createElement('button');
    btn.className = 'pg-btn' + (i === STATE.page ? ' active' : '');
    btn.textContent = i;
    btn.onclick = () => { STATE.page = i; renderVotantes(); };
    pgBtns.appendChild(btn);
  }

  const next = document.createElement('button');
  next.className = 'pg-btn';
  next.innerHTML = '›';
  next.disabled = STATE.page >= pages;
  next.onclick = () => { STATE.page++; renderVotantes(); };
  pgBtns.appendChild(next);
}

/* ============================================
   MARCAR VOTO
   ============================================ */
function marcarVoto(id, estado) {
  const v = STATE.votantes.find(x => x.id === id);
  if (!v) return;

  if (estado === 'no' && v.voto === 'si') {
    // Desmarcar — preguntar observación opcional
    openObsModal(id);
    return;
  }

  // Marcar como votó
  v.voto = 'si';
  v.marcadoPor = STATE.currentUser.usuario;
  v.fechaMarca = new Date().toISOString();
  v.observaciones = '';
  saveVotantes();
  renderVotantes();
  renderDashboard();
  showToast(`✓ ${v.nombre} ${v.apellido} marcado como VOTÓ`, 'success');
}

/* ============================================
   MODAL OBSERVACIÓN (desmarcar voto)
   ============================================ */
function openObsModal(votanteId) {
  const v = STATE.votantes.find(x => x.id === votanteId);
  if (!v) return;
  const modal = document.getElementById('modal-obs');
  modal.dataset.votanteId = votanteId;
  document.getElementById('obs-nombre').textContent = `${v.nombre} ${v.apellido}`;
  document.getElementById('obs-input').value = '';
  modal.classList.add('open');
}

function confirmDesmarcar() {
  const modal = document.getElementById('modal-obs');
  const id = parseInt(modal.dataset.votanteId);
  const obs = document.getElementById('obs-input').value.trim();
  const v = STATE.votantes.find(x => x.id === id);
  if (!v) return;

  v.voto = 'no';
  v.marcadoPor = STATE.currentUser.usuario;
  v.fechaMarca = new Date().toISOString();
  v.observaciones = obs;
  saveVotantes();
  closeModal('modal-obs');
  renderVotantes();
  renderDashboard();
  showToast(`${v.nombre} ${v.apellido} desmarcado`, 'info');
}

/* ============================================
   CRUD VOTANTES
   ============================================ */
function openAgregarVotante() {
  if (STATE.currentUser?.rol !== 'admin') return;
  const modal = document.getElementById('modal-votante');
  modal.dataset.mode = 'add';
  document.getElementById('modal-votante-title').textContent = 'Agregar Votante';
  document.getElementById('form-votante').reset();
  document.getElementById('vtid').value = '';
  modal.classList.add('open');
}

function editarVotante(id) {
  if (STATE.currentUser?.rol !== 'admin') return;
  const v = STATE.votantes.find(x => x.id === id);
  if (!v) return;

  const modal = document.getElementById('modal-votante');
  modal.dataset.mode = 'edit';
  document.getElementById('modal-votante-title').textContent = 'Editar Votante';
  document.getElementById('vtid').value = v.id;
  document.getElementById('vt-nombre').value = v.nombre;
  document.getElementById('vt-apellido').value = v.apellido;
  document.getElementById('vt-cedula').value = v.cedula;
  document.getElementById('vt-domicilio').value = v.domicilio;
  document.getElementById('vt-observaciones').value = v.observaciones;
  modal.classList.add('open');
}

function saveVotante() {
  const modal = document.getElementById('modal-votante');
  const mode = modal.dataset.mode;
  const nombre = document.getElementById('vt-nombre').value.trim();
  const apellido = document.getElementById('vt-apellido').value.trim();
  const cedula = document.getElementById('vt-cedula').value.trim();
  const domicilio = document.getElementById('vt-domicilio').value.trim();
  const observaciones = document.getElementById('vt-observaciones').value.trim();

  if (!nombre || !apellido || !cedula) {
    showToast('Nombre, apellido y cédula son obligatorios', 'error');
    return;
  }

  if (mode === 'add') {
    const newId = STATE.votantes.length > 0 ? Math.max(...STATE.votantes.map(v => v.id)) + 1 : 1;
    STATE.votantes.push({ id: newId, nombre, apellido, cedula, voto: 'no', domicilio, observaciones, marcadoPor: '', fechaMarca: '' });
    showToast('Votante agregado', 'success');
  } else {
    const id = parseInt(document.getElementById('vtid').value);
    const v = STATE.votantes.find(x => x.id === id);
    if (v) { v.nombre = nombre; v.apellido = apellido; v.cedula = cedula; v.domicilio = domicilio; v.observaciones = observaciones; }
    showToast('Votante actualizado', 'success');
  }

  saveVotantes();
  closeModal('modal-votante');
  renderVotantes();
  renderDashboard();
}

function eliminarVotante(id) {
  if (STATE.currentUser?.rol !== 'admin') return;
  const v = STATE.votantes.find(x => x.id === id);
  if (!v) return;
  if (!confirm(`¿Eliminar a ${v.nombre} ${v.apellido}?`)) return;
  STATE.votantes = STATE.votantes.filter(x => x.id !== id);
  saveVotantes();
  renderVotantes();
  renderDashboard();
  showToast('Votante eliminado', 'success');
}

/* ============================================
   CRUD USUARIOS (Admin)
   ============================================ */
function renderUsuarios() {
  const grid = document.getElementById('users-grid');
  if (!grid) return;
  grid.innerHTML = STATE.users.map(u => `
    <div class="user-card" data-uid="${u.id}">
      <div class="user-card-header">
        <div class="user-avatar">${u.nombre.charAt(0)}${u.apellido.charAt(0)}</div>
        <div>
          <div class="user-info-name">${esc(u.nombre)} ${esc(u.apellido)}</div>
          <div class="user-info-user">@${esc(u.usuario)}</div>
          <span class="user-info-role ${u.rol === 'admin' ? 'role-admin' : 'role-user'}">${u.rol}</span>
        </div>
      </div>
      ${u.telefono ? `<div class="text-muted" style="font-size:0.8rem;margin-bottom:8px;">📞 ${esc(u.telefono)}</div>` : ''}
      <div class="user-card-footer">
        <button class="btn btn-secondary btn-sm" onclick="editarUsuario(${u.id})">
          <svg viewBox="0 0 24 24"><use href="#icon-edit"/></svg> Editar
        </button>
        ${u.usuario !== 'Admin' ? `
          <button class="btn btn-danger btn-sm" onclick="eliminarUsuario(${u.id})">
            <svg viewBox="0 0 24 24"><use href="#icon-delete"/></svg> Eliminar
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function openAgregarUsuario() {
  const modal = document.getElementById('modal-usuario');
  modal.dataset.mode = 'add';
  document.getElementById('modal-usuario-title').textContent = 'Agregar Usuario';
  document.getElementById('form-usuario').reset();
  document.getElementById('uid').value = '';
  document.getElementById('usr-pass-group').style.display = '';
  modal.classList.add('open');
}

function editarUsuario(id) {
  const u = STATE.users.find(x => x.id === id);
  if (!u) return;
  const modal = document.getElementById('modal-usuario');
  modal.dataset.mode = 'edit';
  document.getElementById('modal-usuario-title').textContent = 'Editar Usuario';
  document.getElementById('uid').value = u.id;
  document.getElementById('usr-nombre').value = u.nombre;
  document.getElementById('usr-apellido').value = u.apellido;
  document.getElementById('usr-telefono').value = u.telefono;
  document.getElementById('usr-usuario').value = u.usuario;
  document.getElementById('usr-rol').value = u.rol;
  document.getElementById('usr-pass').value = '';
  document.getElementById('usr-pass-group').style.display = '';
  modal.classList.add('open');
}

function saveUsuario() {
  const modal = document.getElementById('modal-usuario');
  const mode = modal.dataset.mode;
  const nombre   = document.getElementById('usr-nombre').value.trim();
  const apellido = document.getElementById('usr-apellido').value.trim();
  const telefono = document.getElementById('usr-telefono').value.trim();
  const usuario  = document.getElementById('usr-usuario').value.trim();
  const rol      = document.getElementById('usr-rol').value;
  const pass     = document.getElementById('usr-pass').value;

  if (!nombre || !apellido || !usuario) {
    showToast('Nombre, apellido y usuario son obligatorios', 'error');
    return;
  }

  if (mode === 'add') {
    if (!pass) { showToast('La contraseña es obligatoria para nuevo usuario', 'error'); return; }
    // Verificar usuario único
    if (STATE.users.find(u => u.usuario === usuario)) {
      showToast('El nombre de usuario ya existe', 'error');
      return;
    }
    const newId = STATE.users.length > 0 ? Math.max(...STATE.users.map(u => u.id)) + 1 : 1;
    STATE.users.push({ id: newId, nombre, apellido, telefono, usuario, password: pass, rol, fechaCreacion: new Date().toISOString() });
    showToast('Usuario creado', 'success');
  } else {
    const id = parseInt(document.getElementById('uid').value);
    const u = STATE.users.find(x => x.id === id);
    if (u) {
      u.nombre = nombre; u.apellido = apellido; u.telefono = telefono;
      if (u.usuario !== 'Admin') u.usuario = usuario;
      u.rol = rol;
      if (pass) u.password = pass;
    }
    showToast('Usuario actualizado', 'success');
  }

  saveUsers();
  closeModal('modal-usuario');
  renderUsuarios();
}

function eliminarUsuario(id) {
  const u = STATE.users.find(x => x.id === id);
  if (!u || u.usuario === 'Admin') return;
  if (!confirm(`¿Eliminar al usuario ${u.usuario}?`)) return;
  STATE.users = STATE.users.filter(x => x.id !== id);
  saveUsers();
  renderUsuarios();
  showToast('Usuario eliminado', 'success');
}

/* ============================================
   MODALES - BIND GENERAL
   ============================================ */
function bindModals() {
  // Cerrar al click fuera
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

/* ============================================
   CONFIGURACIÓN CSV URL
   ============================================ */
function saveCSVUrl() {
  const val = document.getElementById('csv-url-input')?.value.trim();
  if (!val) return;
  localStorage.setItem('vot_csv_url', val);
  showToast('URL guardada. Recargando datos...', 'info');
  loadCSV().then(() => { renderVotantes(); renderDashboard(); });
}

function reloadCSV() {
  loadCSV().then(() => { renderVotantes(); renderDashboard(); });
}

/* ============================================
   EXPORTAR CSV
   ============================================ */
function exportarCSV() {
  const header = 'nro,nombre,apellido,cedula,voto,domicilio,observaciones,marcadoPor,fechaMarca\n';
  const rows = STATE.votantes.map(v =>
    [v.id, v.nombre, v.apellido, v.cedula, v.voto, v.domicilio, v.observaciones, v.marcadoPor, v.fechaMarca].join(',')
  ).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `votantes_${dateStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado', 'success');
}

/* ============================================
   TOAST
   ============================================ */
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

/* ============================================
   HELPERS
   ============================================ */
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function svgUse(id) {
  return `<svg viewBox="0 0 24 24"><use href="#${id}"/></svg>`;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-PY', { day:'2-digit', month:'2-digit', year:'numeric' });
  } catch { return iso; }
}

function dateStr() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}
