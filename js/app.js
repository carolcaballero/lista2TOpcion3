/* =============================================
   MGTR. CAROLINA CABALLERO - SISTEMA DE VOTANTES
   app.js — Lógica principal
   ============================================= */

'use strict';

// ──────────────────────────────────────────────
// ESTADO GLOBAL
// ──────────────────────────────────────────────
const APP = {
  usuarios: [],          // usuarios del sistema
  votantes: [],          // padrón cargado desde CSV
  filtroActual: 'todos', // todos | voto | no
  busqueda: '',
  paginaActual: 1,
  porPagina: 50,
  usuarioLogueado: null,
  panelActivo: 'panel-votantes',
};

// ──────────────────────────────────────────────
// USUARIOS POR DEFECTO
// ──────────────────────────────────────────────
function initUsuarios() {
  const guardados = localStorage.getItem('cv_usuarios');
  if (guardados) {
    APP.usuarios = JSON.parse(guardados);
  } else {
    APP.usuarios = [
      {
        id: 'admin-001',
        nombre: 'Admin',
        apellido: 'Sistema',
        telefono: '0000000000',
        usuario: 'Admin',
        password: 'CAROL2T3',
        rol: 'admin',
        creado: new Date().toISOString(),
      }
    ];
    guardarUsuarios();
  }
}

function guardarUsuarios() {
  localStorage.setItem('cv_usuarios', JSON.stringify(APP.usuarios));
}

// ──────────────────────────────────────────────
// VOTANTES — persistencia
// ──────────────────────────────────────────────
function guardarVotantes() {
  localStorage.setItem('cv_votantes', JSON.stringify(APP.votantes));
}

function cargarVotantesGuardados() {
  const data = localStorage.getItem('cv_votantes');
  if (data) {
    APP.votantes = JSON.parse(data);
    return true;
  }
  return false;
}

// ──────────────────────────────────────────────
// PARSEO CSV
// ──────────────────────────────────────────────
function parseCSV(texto) {
  const lineas = texto.trim().split('\n');
  const headers = lineas[0].split(',').map(h => h.trim().toLowerCase());
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const vals = lineas[i].split(',').map(v => v.trim());
    if (vals.length < 3) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
    filas.push({
      id:            obj.nro || String(i),
      nro:           obj.nro || String(i),
      nombre:        obj.nombre || '',
      apellido:      obj.apellido || '',
      cedula:        obj.cedula || '',
      voto:          (obj.voto || 'no').toLowerCase() === 'si' ? 'si' : 'no',
      domicilio:     obj.domicilio || '',
      observaciones: obj.observaciones || '',
      marcadoPor:    obj.marcadopor || '',
      fechaVoto:     obj.fechavoto || '',
    });
  }
  return filas;
}

// ──────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────
function intentarLogin() {
  const usuario  = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-pass').value.trim();
  const errorEl  = document.getElementById('login-error');

  const encontrado = APP.usuarios.find(
    u => u.usuario === usuario && u.password === password
  );

  if (!encontrado) {
    errorEl.textContent = 'Usuario o contraseña incorrectos.';
    errorEl.style.display = 'block';
    shake(document.querySelector('.login-box'));
    return;
  }

  APP.usuarioLogueado = encontrado;
  errorEl.style.display = 'none';
  mostrarApp();
}

function mostrarApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';

  // Mostrar nombre de usuario
  document.getElementById('topbar-username').textContent =
    APP.usuarioLogueado.nombre + ' ' + APP.usuarioLogueado.apellido;

  // Mostrar/ocultar elementos de admin
  const esAdmin = APP.usuarioLogueado.rol === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = esAdmin ? '' : 'none';
  });

  activarPanel('panel-votantes');
  renderVotantes();
  renderStats();
}

function cerrarSesion() {
  APP.usuarioLogueado = null;
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-usuario').value = '';
  document.getElementById('login-pass').value = '';
}

// ──────────────────────────────────────────────
// NAVEGACIÓN
// ──────────────────────────────────────────────
function activarPanel(id) {
  APP.panelActivo = id;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('activo'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('activo'));
  const panel = document.getElementById(id);
  if (panel) panel.classList.add('activo');
  const navItem = document.querySelector(`[data-panel="${id}"]`);
  if (navItem) navItem.classList.add('activo');

  if (id === 'panel-votantes') renderVotantes();
  if (id === 'panel-usuarios') renderUsuarios();
  if (id === 'panel-stats')    renderStats();
}

// ──────────────────────────────────────────────
// STATS
// ──────────────────────────────────────────────
function renderStats() {
  const total   = APP.votantes.length;
  const votaron = APP.votantes.filter(v => v.voto === 'si').length;
  const noVotaron = total - votaron;
  const pct     = total > 0 ? Math.round((votaron / total) * 100) : 0;

  setEl('stat-total',     total);
  setEl('stat-voto',      votaron);
  setEl('stat-no',        noVotaron);
  setEl('stat-pct',       pct + '%');
  setEl('progreso-txt',   `${votaron} de ${total} votantes registrados (${pct}%)`);

  const barra = document.getElementById('progreso-fill');
  if (barra) barra.style.width = pct + '%';
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ──────────────────────────────────────────────
// TABLA DE VOTANTES
// ──────────────────────────────────────────────
function filtrarVotantes() {
  let lista = [...APP.votantes];
  const q   = APP.busqueda.toLowerCase();

  if (q) {
    lista = lista.filter(v =>
      v.nombre.toLowerCase().includes(q)   ||
      v.apellido.toLowerCase().includes(q) ||
      v.cedula.includes(q)                 ||
      v.domicilio.toLowerCase().includes(q)
    );
  }

  if (APP.filtroActual === 'voto')   lista = lista.filter(v => v.voto === 'si');
  if (APP.filtroActual === 'no')     lista = lista.filter(v => v.voto === 'no');

  return lista;
}

function renderVotantes() {
  renderStats();
  const lista    = filtrarVotantes();
  const tbody    = document.getElementById('tbody-votantes');
  const conteo   = document.getElementById('conteo-votantes');
  if (!tbody) return;

  if (conteo) conteo.textContent = `${lista.length} votantes`;

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:40px;color:var(--gris-claro);font-family:var(--font-ui);letter-spacing:1px;">
          No se encontraron votantes
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = lista.map(v => `
    <tr class="${v.voto === 'si' ? 'votado' : ''}" data-id="${v.id}">
      <td class="nro-cell">${v.nro}</td>
      <td>${esc(v.nombre)}</td>
      <td>${esc(v.apellido)}</td>
      <td style="font-family:var(--font-ui);letter-spacing:1px;">${esc(v.cedula)}</td>
      <td>
        <span class="badge ${v.voto === 'si' ? 'badge-voto' : 'badge-no'}">
          <svg class="icon"><use href="assets/icons.svg#${v.voto === 'si' ? 'icon-check' : 'icon-x'}"/></svg>
          ${v.voto === 'si' ? 'VOTÓ' : 'NO VOTÓ'}
        </span>
        ${v.marcadoPor ? `<div class="marcado-por">por: ${esc(v.marcadoPor)}</div>` : ''}
      </td>
      <td>${esc(v.domicilio)}</td>
      <td><span class="obs-text" title="${esc(v.observaciones)}">${esc(v.observaciones) || '—'}</span></td>
      <td>
        <div class="acciones-cell">
          ${v.voto === 'si'
            ? `<button class="btn btn-sm btn-danger" onclick="marcarVoto('${v.id}','no')">
                 <svg class="icon"><use href="assets/icons.svg#icon-x"/></svg> Desmarcar
               </button>`
            : `<button class="btn btn-sm btn-success" onclick="marcarVoto('${v.id}','si')">
                 <svg class="icon"><use href="assets/icons.svg#icon-check"/></svg> Votó
               </button>`
          }
          <button class="btn-icon" title="Observación" onclick="abrirObservacion('${v.id}')">
            <svg class="icon"><use href="assets/icons.svg#icon-alert"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ──────────────────────────────────────────────
// MARCAR VOTO
// ──────────────────────────────────────────────
function marcarVoto(id, estado) {
  const idx = APP.votantes.findIndex(v => v.id === id);
  if (idx === -1) return;

  APP.votantes[idx].voto = estado;

  if (estado === 'si') {
    APP.votantes[idx].marcadoPor = APP.usuarioLogueado.usuario;
    APP.votantes[idx].fechaVoto  = new Date().toLocaleString('es-PY');
    toast(`✓ Marcado como VOTÓ — ${APP.votantes[idx].nombre} ${APP.votantes[idx].apellido}`, 'success');
  } else {
    APP.votantes[idx].marcadoPor = '';
    APP.votantes[idx].fechaVoto  = '';
    toast(`↩ Desmarcado — ${APP.votantes[idx].nombre} ${APP.votantes[idx].apellido}`, 'error');
  }

  guardarVotantes();
  renderVotantes();
}

// ──────────────────────────────────────────────
// OBSERVACION MODAL
// ──────────────────────────────────────────────
let _obsId = null;

function abrirObservacion(id) {
  const v = APP.votantes.find(x => x.id === id);
  if (!v) return;
  _obsId = id;
  document.getElementById('obs-nombre').textContent = v.nombre + ' ' + v.apellido;
  document.getElementById('obs-texto').value = v.observaciones || '';
  abrirModal('modal-observacion');
}

function guardarObservacion() {
  if (!_obsId) return;
  const idx = APP.votantes.findIndex(v => v.id === _obsId);
  if (idx === -1) return;
  APP.votantes[idx].observaciones = document.getElementById('obs-texto').value.trim();
  guardarVotantes();
  cerrarModal('modal-observacion');
  renderVotantes();
  toast('Observación guardada', 'success');
}

// ──────────────────────────────────────────────
// BUSCAR / FILTRAR
// ──────────────────────────────────────────────
function onBusqueda(val) {
  APP.busqueda = val;
  APP.paginaActual = 1;
  renderVotantes();
}

function setFiltro(filtro) {
  APP.filtroActual = filtro;
  document.querySelectorAll('.filtro-tab').forEach(t => {
    t.classList.toggle('activo', t.dataset.filtro === filtro);
  });
  renderVotantes();
}

// ──────────────────────────────────────────────
// USUARIOS — RENDER
// ──────────────────────────────────────────────
function renderUsuarios() {
  const container = document.getElementById('lista-usuarios');
  if (!container) return;

  const lista = APP.usuarios.filter(u => u.id !== 'admin-001');

  if (lista.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--gris-claro);font-family:var(--font-ui);letter-spacing:1px;">
        No hay usuarios registrados aún.
      </div>`;
    return;
  }

  container.innerHTML = lista.map(u => `
    <div class="user-card">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="width:42px;height:42px;background:var(--rojo);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg class="icon-lg" style="color:white"><use href="assets/icons.svg#icon-user"/></svg>
        </div>
        <div class="user-card-info">
          <div class="user-card-nombre">${esc(u.nombre)} ${esc(u.apellido)}</div>
          <div class="user-card-detalle">
            <svg class="icon" style="color:var(--rojo)"><use href="assets/icons.svg#icon-phone"/></svg>
            ${esc(u.telefono)} &nbsp;|&nbsp; @${esc(u.usuario)}
          </div>
          <div class="user-card-rol">${u.rol}</div>
        </div>
      </div>
      <button class="btn btn-sm btn-danger admin-only" onclick="eliminarUsuario('${u.id}')" style="display:flex;">
        <svg class="icon"><use href="assets/icons.svg#icon-trash"/></svg> Eliminar
      </button>
    </div>
  `).join('');
}

// ──────────────────────────────────────────────
// CREAR USUARIO
// ──────────────────────────────────────────────
function abrirModalUsuario() {
  document.getElementById('form-nuevo-usuario').reset();
  document.getElementById('nuevo-user-error').style.display = 'none';
  abrirModal('modal-nuevo-usuario');
}

function crearUsuario() {
  const nombre   = document.getElementById('nu-nombre').value.trim();
  const apellido = document.getElementById('nu-apellido').value.trim();
  const telefono = document.getElementById('nu-telefono').value.trim();
  const usuario  = document.getElementById('nu-usuario').value.trim();
  const password = document.getElementById('nu-password').value.trim();
  const errorEl  = document.getElementById('nuevo-user-error');

  if (!nombre || !apellido || !telefono || !usuario || !password) {
    errorEl.textContent = 'Todos los campos son obligatorios.';
    errorEl.style.display = 'block';
    return;
  }

  if (APP.usuarios.find(u => u.usuario === usuario)) {
    errorEl.textContent = 'El nombre de usuario ya existe.';
    errorEl.style.display = 'block';
    return;
  }

  const nuevo = {
    id:       'u-' + Date.now(),
    nombre, apellido, telefono, usuario, password,
    rol: 'operador',
    creado: new Date().toISOString(),
  };

  APP.usuarios.push(nuevo);
  guardarUsuarios();
  cerrarModal('modal-nuevo-usuario');
  renderUsuarios();
  toast('Usuario creado: @' + usuario, 'success');
}

// ──────────────────────────────────────────────
// ELIMINAR USUARIO
// ──────────────────────────────────────────────
function eliminarUsuario(id) {
  if (!confirm('¿Eliminar este usuario?')) return;
  APP.usuarios = APP.usuarios.filter(u => u.id !== id);
  guardarUsuarios();
  renderUsuarios();
  toast('Usuario eliminado', 'error');
}

// ──────────────────────────────────────────────
// CARGA CSV
// ──────────────────────────────────────────────
function onArchivoCSV(e) {
  const archivo = e.target.files[0];
  if (!archivo) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const votantes = parseCSV(ev.target.result);
    if (votantes.length === 0) {
      toast('El CSV no contiene datos válidos.', 'error');
      return;
    }
    // Preservar estados de voto ya marcados
    const prevMap = {};
    APP.votantes.forEach(v => { prevMap[v.cedula] = v; });
    APP.votantes = votantes.map(v => {
      if (prevMap[v.cedula]) {
        return { ...v, voto: prevMap[v.cedula].voto, marcadoPor: prevMap[v.cedula].marcadoPor, fechaVoto: prevMap[v.cedula].fechaVoto, observaciones: prevMap[v.cedula].observaciones };
      }
      return v;
    });
    guardarVotantes();
    renderVotantes();
    renderStats();
    toast(`Padrón cargado: ${votantes.length} votantes`, 'success');
  };
  reader.readAsText(archivo, 'UTF-8');
}

// Cargar CSV desde URL (GitHub)
async function cargarCSVUrl() {
  const url = document.getElementById('csv-url').value.trim();
  if (!url) { toast('Ingrese una URL válida', 'error'); return; }
  try {
    const res  = await fetch(url);
    const text = await res.text();
    const votantes = parseCSV(text);
    if (votantes.length === 0) { toast('CSV sin datos válidos.', 'error'); return; }
    const prevMap = {};
    APP.votantes.forEach(v => { prevMap[v.cedula] = v; });
    APP.votantes = votantes.map(v => prevMap[v.cedula]
      ? { ...v, voto: prevMap[v.cedula].voto, marcadoPor: prevMap[v.cedula].marcadoPor, fechaVoto: prevMap[v.cedula].fechaVoto, observaciones: prevMap[v.cedula].observaciones }
      : v
    );
    guardarVotantes();
    renderVotantes();
    renderStats();
    toast(`CSV cargado desde URL: ${votantes.length} votantes`, 'success');
  } catch (err) {
    toast('Error al cargar CSV: ' + err.message, 'error');
  }
}

// ──────────────────────────────────────────────
// EXPORTAR CSV
// ──────────────────────────────────────────────
function exportarCSV() {
  const headers = 'nro,nombre,apellido,cedula,voto,domicilio,observaciones,marcadoPor,fechaVoto';
  const filas = APP.votantes.map(v =>
    [v.nro,v.nombre,v.apellido,v.cedula,v.voto,v.domicilio,v.observaciones,v.marcadoPor,v.fechaVoto]
      .map(x => `"${(x||'').replace(/"/g,'""')}"`)
      .join(',')
  );
  const csv  = [headers, ...filas].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'votantes_export_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  toast('CSV exportado correctamente', 'success');
}

// ──────────────────────────────────────────────
// MODAL HELPERS
// ──────────────────────────────────────────────
function abrirModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('abierto');
}

function cerrarModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('abierto');
}

// Cerrar al click en overlay
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('abierto');
  }
});

// ──────────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────────
function toast(msg, tipo = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `toast ${tipo}`;
  div.textContent = msg;
  container.appendChild(div);
  setTimeout(() => {
    div.style.animation = 'fadeOut 0.4s ease forwards';
    setTimeout(() => div.remove(), 400);
  }, 3200);
}

// ──────────────────────────────────────────────
// UTILIDADES
// ──────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => { el.style.animation = ''; }, 400);
}

// ──────────────────────────────────────────────
// ENTER en login
// ──────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen && loginScreen.style.display !== 'none' && !loginScreen.style.display.includes('none')
        || getComputedStyle(loginScreen).display !== 'none') {
      intentarLogin();
    }
  }
});

// ──────────────────────────────────────────────
// INICIALIZACIÓN
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initUsuarios();

  // Intentar cargar votantes guardados
  if (!cargarVotantesGuardados()) {
    // Si no hay datos, cargar CSV por defecto
    fetch('data/votantes.csv')
      .then(r => r.ok ? r.text() : null)
      .then(text => {
        if (text) {
          APP.votantes = parseCSV(text);
          guardarVotantes();
        }
      })
      .catch(() => {});
  }
});
