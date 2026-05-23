/* ============================================
   APP.JS - Sistema de Votantes
   MGTR. Carolina Caballero - Lista 2T Opción 3
   ============================================ */

// ===== AUTH SYSTEM =====
const Auth = {
  DEFAULT_ADMIN: { id:'admin-001', nombre:'Administrador', apellido:'Sistema', telefono:'', username:'Admin', password:'CAROL2T3', rol:'admin', fechaRegistro: new Date().toISOString() },
  init() {
    if (!localStorage.getItem('usuarios')) {
      localStorage.setItem('usuarios', JSON.stringify([this.DEFAULT_ADMIN]));
    }
    if (!localStorage.getItem('votantes')) localStorage.setItem('votantes', JSON.stringify([]));
    if (!localStorage.getItem('actividad')) localStorage.setItem('actividad', JSON.stringify([]));
  },
  login(u,p) {
    const users = JSON.parse(localStorage.getItem('usuarios')||'[]');
    const user = users.find(x=>x.username.toLowerCase()===u.toLowerCase() && x.password===p);
    if (user) {
      const session = { id:user.id, username:user.username, nombre:user.nombre, apellido:user.apellido, rol:user.rol, loginTime:new Date().toISOString() };
      localStorage.setItem('session', JSON.stringify(session));
      return {success:true, user:session};
    }
    return {success:false, error:'Usuario o contraseña incorrectos'};
  },
  logout() { localStorage.removeItem('session'); window.location.href='index.html'; },
  getUser() { const s=localStorage.getItem('session'); return s?JSON.parse(s):null; },
  isAdmin() { const u=this.getUser(); return u&&u.rol==='admin'; },
  check() { if(!this.getUser()){window.location.href='index.html';return false;} return true; },
  getUsers() { return JSON.parse(localStorage.getItem('usuarios')||'[]'); },
  saveUsers(users) { localStorage.setItem('usuarios', JSON.stringify(users)); },
  register(data) {
    const users = this.getUsers();
    if (users.some(u=>u.username.toLowerCase()===data.username.toLowerCase())) return {success:false, error:'Usuario ya existe'};
    const newUser = { id:'user-'+Date.now(), ...data, rol:'user', fechaRegistro:new Date().toISOString() };
    users.push(newUser); this.saveUsers(users);
    return {success:true, user:newUser};
  },
  deleteUser(id) {
    let users = this.getUsers();
    const target = users.find(u=>u.id===id);
    if (target && target.username==='Admin') return {success:false, error:'No se puede eliminar al admin principal'};
    users = users.filter(u=>u.id!==id); this.saveUsers(users);
    return {success:true};
  }
};

// ===== DATA MANAGER =====
const Data = {
  getVotantes() { return JSON.parse(localStorage.getItem('votantes')||'[]'); },
  saveVotantes(v) { localStorage.setItem('votantes', JSON.stringify(v)); },
  getActivity() { return JSON.parse(localStorage.getItem('actividad')||'[]'); },
  logActivity(tipo, desc, user) {
    const act = this.getActivity();
    act.unshift({ id:'act-'+Date.now(), tipo, descripcion:desc, usuario:user||'Sistema', fecha:new Date().toISOString() });
    if (act.length>50) act.pop();
    localStorage.setItem('actividad', JSON.stringify(act));
  },
  addVotante(data) {
    const v = this.getVotantes();
    const user = Auth.getUser();
    const nuevo = { id:'vot-'+Date.now(), numero:v.length+1, nombre:data.nombre, cedula:data.cedula, estado:data.estado||'pendiente', barrio:data.barrio||'', observaciones:data.observaciones||'', registradoPor:user?user.username:'Sistema', fechaRegistro:new Date().toISOString(), fechaVoto:null, marcadoPor:null };
    v.push(nuevo); this.saveVotantes(v);
    this.logActivity('registro', 'Votante registrado: '+nuevo.nombre, user?.username);
    return {success:true, votante:nuevo};
  },
  updateVotante(id, data) {
    let v = this.getVotantes();
    const i = v.findIndex(x=>x.id===id);
    if (i===-1) return {success:false, error:'No encontrado'};
    v[i] = {...v[i], ...data}; this.saveVotantes(v);
    return {success:true, votante:v[i]};
  },
  deleteVotante(id) {
    let v = this.getVotantes();
    const target = v.find(x=>x.id===id);
    if (!target) return {success:false, error:'No encontrado'};
    v = v.filter(x=>x.id!==id);
    v.forEach((x,idx)=>x.numero=idx+1);
    this.saveVotantes(v);
    this.logActivity('eliminacion', 'Votante eliminado: '+target.nombre, Auth.getUser()?.username);
    return {success:true};
  },
  marcarVoto(id, estado, obs) {
    const user = Auth.getUser();
    const updates = { estado, marcadoPor:user?user.username:'Sistema', fechaVoto:new Date().toISOString() };
    if (obs) updates.observaciones = obs;
    const result = this.updateVotante(id, updates);
    if (result.success) {
      const v = this.getVotantes().find(x=>x.id===id);
      this.logActivity('voto', 'Votante '+ (estado==='votado'?'marcado como votó':'marcado como no votó') +': '+v.nombre, user?.username);
    }
    return result;
  },
  search(query) {
    const v = this.getVotantes();
    if (!query) return v;
    const q = query.toLowerCase();
    return v.filter(x=>x.nombre.toLowerCase().includes(q)||x.cedula.toLowerCase().includes(q)||x.barrio.toLowerCase().includes(q));
  },
  importCSV(csv) {
    const lines = csv.split('\n').filter(l=>l.trim());
    if (lines.length<2) return {success:false, error:'CSV vacío'};
    const sep = lines[0].includes(';')?';':',';
    const headers = lines[0].split(sep).map(h=>h.trim().toLowerCase());
    const v = this.getVotantes();
    const user = Auth.getUser();
    let imported = 0;
    for (let i=1; i<lines.length; i++) {
      const vals = lines[i].split(sep).map(x=>x.trim());
      const nombre = vals[1]||vals[0]||'';
      const cedula = vals[2]||'';
      const barrio = vals[3]||'';
      if (nombre) {
        v.push({ id:'vot-'+Date.now()+'-'+i, numero:v.length+1, nombre, cedula, estado:'pendiente', barrio, observaciones:'', registradoPor:user?user.username:'CSV', fechaRegistro:new Date().toISOString(), fechaVoto:null, marcadoPor:null });
        imported++;
      }
    }
    this.saveVotantes(v);
    if (imported>0) this.logActivity('importacion', 'Importados '+imported+' votantes desde CSV', user?.username);
    return {success:true, imported, message:imported+' votantes importados'};
  },
  stats() {
    const v = this.getVotantes();
    const total=v.length, votados=v.filter(x=>x.estado==='votado').length, pendientes=total-votados, porcentaje=total>0?Math.round((votados/total)*100):0;
    const porBarrio = {};
    v.forEach(x=>{ const b=x.barrio||'Sin barrio'; if(!porBarrio[b]) porBarrio[b]={total:0,votados:0}; porBarrio[b].total++; if(x.estado==='votado') porBarrio[b].votados++; });
    return {total,votados,pendientes,porcentaje,porBarrio};
  }
};

// ===== UI HELPERS =====
function toast(msg, type='info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast '+type;
  const icons = {
    success:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>',
    error:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  toast.innerHTML = icons[type]+'<div class="toast-message">'+msg+'</div>';
  container.appendChild(toast);
  setTimeout(()=>{ toast.classList.add('toast-out'); setTimeout(()=>toast.remove(),400); },3000);
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); document.body.style.overflow=''; }

let confirmCallback = null;
function showConfirm(title, msg, callback) {
  confirmCallback = callback;
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').innerHTML = msg;
  openModal('modalConfirm');
}

document.getElementById('confirmActionBtn').addEventListener('click', function() {
  if (confirmCallback) confirmCallback();
  closeModal('modalConfirm');
});

function formatDate(d) { if(!d)return'-'; const date=new Date(d); return date.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'}); }
function formatDateTime(d) { if(!d)return'-'; const date=new Date(d); return date.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }

function debounce(fn, wait) { let t; return function(...args){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args),wait); }; }

// ===== APP STATE =====
let currentPage = 1;
const perPage = 15;
let editingId = null;
let pendingVoteId = null;
let pendingVoteEstado = null;

// ===== LOGIN =====
document.addEventListener('DOMContentLoaded', function() {
  Auth.init();

  // Si estamos en index.html y hay sesión, ir al dashboard
  if (document.getElementById('loginForm')) {
    if (Auth.getUser()) { window.location.href='index.html#app'; return; }
    document.getElementById('loginForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const u = document.getElementById('username').value.trim();
      const p = document.getElementById('password').value;
      const r = Auth.login(u,p);
      if (r.success) {
        window.location.href = 'index.html#app';
        window.location.reload();
      } else {
        document.getElementById('loginError').textContent = r.error;
      }
    });
  }

  // Si hay hash #app mostrar dashboard
  if (window.location.hash === '#app') {
    if (!Auth.check()) return;
    showApp();
  }
});

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');

  const user = Auth.getUser();
  document.getElementById('currentUserName').textContent = user.nombre+' '+(user.apellido||'');

  if (Auth.isAdmin()) {
    document.querySelectorAll('.admin-only').forEach(el=>{ el.classList.remove('hidden'); });
  }

  initApp();
}

function initApp() {
  // Navegación
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.dataset.section;
      switchSection(section);
      document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
      this.classList.add('active');
    });
  });

  // Logout
  document.getElementById('btnLogout').addEventListener('click', ()=>Auth.logout());

  // Búsqueda votantes
  document.getElementById('searchVotante').addEventListener('input', debounce(function() {
    currentPage = 1; loadVotantes(this.value);
  }, 300));

  // Botones toolbar
  document.getElementById('btnAddVotante').addEventListener('click', openVotanteModal);
  document.getElementById('btnImportCSV').addEventListener('click', importCSV);

  // Form votante
  document.getElementById('formVotante').addEventListener('submit', function(e) {
    e.preventDefault();
    saveVotante();
  });

  // Form observación
  document.getElementById('formObservacion').addEventListener('submit', function(e) {
    e.preventDefault();
    saveObservacionAndMark();
  });

  // Usuarios
  document.getElementById('btnAddUsuario').addEventListener('click', openUsuarioModal);
  document.getElementById('formUsuario').addEventListener('submit', function(e) {
    e.preventDefault();
    saveUsuario();
  });
  document.getElementById('searchUsuario').addEventListener('input', debounce(function() {
    loadUsuarios(this.value);
  }, 300));

  // Cerrar modales al click fuera
  document.querySelectorAll('.modal').forEach(m=>{
    m.addEventListener('click', function(e) { if(e.target===this) closeModal(this.id); });
  });

  // Cargar datos iniciales
  loadVotantes();
  updateHeaderStats();
}

// ===== SECCIONES =====
function switchSection(section) {
  document.querySelectorAll('.content-section').forEach(s=>s.classList.remove('active'));
  const map = {votantes:'sectionVotantes',estadisticas:'sectionEstadisticas',usuarios:'sectionUsuarios'};
  const id = map[section];
  if (id) document.getElementById(id).classList.add('active');
  const titles = {votantes:'Planilla de Votantes',estadisticas:'Estadísticas',usuarios:'Gestión de Usuarios'};
  document.getElementById('sectionTitle').textContent = titles[section]||'';
  if (section==='estadisticas') loadEstadisticas();
  else if (section==='usuarios') loadUsuarios();
}

// ===== VOTANTES =====
function loadVotantes(query='') {
  const votantes = Data.search(query);
  const totalPages = Math.ceil(votantes.length/perPage);
  if (currentPage>totalPages) currentPage = totalPages||1;
  const start = (currentPage-1)*perPage;
  const paginated = votantes.slice(start, start+perPage);
  renderVotantesTable(paginated);
  renderPagination(totalPages, votantes.length);
  updateHeaderStats();
}

function renderVotantesTable(votantes) {
  const tbody = document.getElementById('tbodyVotantes');
  if (votantes.length===0) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><h3>No hay votantes registrados</h3><p>Importe un CSV o agregue votantes manualmente</p></div></td></tr>';
    return;
  }

  const searchVal = document.getElementById('searchVotante').value.toLowerCase();
  const highlight = (text) => {
    if (!searchVal) return text;
    return text.replace(new RegExp('('+searchVal+')','gi'), '<span class="highlight">$1</span>');
  };

  tbody.innerHTML = votantes.map(v=>`
    <tr data-id="${v.id}">
      <td><strong>${v.numero}</strong></td>
      <td>${highlight(v.nombre)}</td>
      <td>${highlight(v.cedula)}</td>
      <td><span class="status-badge ${v.estado}">${v.estado==='votado'?'YA VOTÓ':'PENDIENTE'}</span></td>
      <td>${v.barrio||'-'}</td>
      <td>${v.observaciones||'-'}</td>
      <td><small style="color:#999">${v.marcadoPor||v.registradoPor||'-'}</small></td>
      <td>
        <div class="actions-cell">
          ${v.estado==='pendiente'
            ? `<button class="btn-action vote-yes" onclick="marcarVoto('${v.id}','votado')" title="Marcar como votó"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>Votó</button>`
            : `<button class="btn-action vote-no" onclick="marcarVoto('${v.id}','pendiente')" title="Marcar como no votó"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>No votó</button>`
          }
          <button class="btn-action edit" onclick="editVotante('${v.id}')" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-action delete" onclick="deleteVotante('${v.id}')" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderPagination(totalPages, totalItems) {
  const pag = document.getElementById('pagination');
  if (totalPages<=1) { pag.innerHTML=''; return; }
  let html = `<button class="page-btn" ${currentPage===1?'disabled':''} onclick="changePage(${currentPage-1})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="15,18 9,12 15,6"/></svg></button>`;
  for (let i=1; i<=totalPages; i++) {
    if (i===1||i===totalPages||(i>=currentPage-1&&i<=currentPage+1)) html+=`<button class="page-btn ${i===currentPage?'active':''}" onclick="changePage(${i})">${i}</button>`;
    else if (i===currentPage-2||i===currentPage+2) html+='<span style="padding:8px">...</span>';
  }
  html += `<button class="page-btn" ${currentPage===totalPages?'disabled':''} onclick="changePage(${currentPage+1})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9,18 15,12 9,6"/></svg></button>`;
  html += `<span style="margin-left:15px;font-size:0.85rem;color:#999">Total: ${totalItems}</span>`;
  pag.innerHTML = html;
}

window.changePage = function(p) { currentPage=p; loadVotantes(document.getElementById('searchVotante').value); };

window.marcarVoto = function(id, estado) {
  pendingVoteId = id; pendingVoteEstado = estado;
  if (estado==='pendiente') {
    document.getElementById('obsTexto').value = '';
    openModal('modalObservacion');
  } else {
    const r = Data.marcarVoto(id, estado);
    if (r.success) { toast('Votante marcado como "Ya votó"', 'success'); loadVotantes(); updateHeaderStats(); }
  }
};

function saveObservacionAndMark() {
  const obs = document.getElementById('obsTexto').value.trim();
  const r = Data.marcarVoto(pendingVoteId, pendingVoteEstado, obs);
  if (r.success) { toast('Votante marcado como "No votó"', 'warning'); loadVotantes(); updateHeaderStats(); }
  closeModal('modalObservacion');
  pendingVoteId = null; pendingVoteEstado = null;
}

window.editVotante = function(id) {
  const v = Data.getVotantes().find(x=>x.id===id);
  if (!v) return;
  editingId = id;
  document.getElementById('modalVotanteTitle').textContent = 'Editar Votante';
  document.getElementById('vNombre').value = v.nombre;
  document.getElementById('vCedula').value = v.cedula;
  document.getElementById('vBarrio').value = v.barrio||'';
  document.getElementById('vEstado').value = v.estado;
  document.getElementById('vObservaciones').value = v.observaciones||'';
  openModal('modalVotante');
};

window.deleteVotante = function(id) {
  const v = Data.getVotantes().find(x=>x.id===id);
  if (!v) return;
  showConfirm('Eliminar Votante', '¿Eliminar a <strong>'+v.nombre+'</strong>?', function() {
    const r = Data.deleteVotante(id);
    if (r.success) { toast('Votante eliminado', 'success'); loadVotantes(); updateHeaderStats(); }
    else toast(r.error, 'error');
  });
};

function openVotanteModal() {
  editingId = null;
  document.getElementById('modalVotanteTitle').textContent = 'Agregar Votante';
  document.getElementById('formVotante').reset();
  openModal('modalVotante');
}

function saveVotante() {
  const nombre = document.getElementById('vNombre').value.trim();
  const cedula = document.getElementById('vCedula').value.trim();
  const barrio = document.getElementById('vBarrio').value.trim();
  const estado = document.getElementById('vEstado').value;
  const observaciones = document.getElementById('vObservaciones').value.trim();
  if (!nombre||!cedula) { toast('Nombre y cédula son obligatorios', 'error'); return; }
  const data = {nombre, cedula, barrio, estado, observaciones};
  if (editingId) {
    const r = Data.updateVotante(editingId, data);
    if (r.success) { toast('Votante actualizado', 'success'); loadVotantes(); updateHeaderStats(); closeModal('modalVotante'); }
  } else {
    const r = Data.addVotante(data);
    if (r.success) { toast('Votante agregado', 'success'); loadVotantes(); updateHeaderStats(); closeModal('modalVotante'); }
  }
}

function importCSV() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv';
  input.onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      const r = Data.importCSV(ev.target.result);
      if (r.success) { toast(r.message, 'success'); loadVotantes(); updateHeaderStats(); }
      else toast(r.error, 'error');
    };
    reader.readAsText(file);
  };
  input.click();
}

function updateHeaderStats() {
  const s = Data.stats();
  document.getElementById('totalVotados').textContent = s.votados;
  document.getElementById('totalPendientes').textContent = s.pendientes;
}

// ===== USUARIOS =====
function loadUsuarios(query='') {
  if (!Auth.isAdmin()) return;
  const users = Auth.getUsers();
  const filtered = query ? users.filter(u=>u.nombre.toLowerCase().includes(query.toLowerCase())||u.username.toLowerCase().includes(query.toLowerCase())) : users;
  const tbody = document.getElementById('tbodyUsuarios');
  if (filtered.length===0) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><h3>No hay usuarios</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map((u,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${u.nombre} ${u.apellido||''}</td>
      <td>${u.telefono||'-'}</td>
      <td><strong>${u.username}</strong></td>
      <td><span class="status-badge ${u.rol==='admin'?'votado':'pendiente'}">${u.rol==='admin'?'Admin':'Usuario'}</span></td>
      <td>${formatDate(u.fechaRegistro)}</td>
      <td>${u.username!=='Admin'?`<button class="btn-action delete" onclick="deleteUsuario('${u.id}')" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`:'<small style="color:#999">No editable</small>'}</td>
    </tr>
  `).join('');
}

window.deleteUsuario = function(id) {
  const users = Auth.getUsers();
  const u = users.find(x=>x.id===id);
  showConfirm('Eliminar Usuario', '¿Eliminar a <strong>'+(u?.nombre||'')+'</strong>?', function() {
    const r = Auth.deleteUser(id);
    if (r.success) { toast('Usuario eliminado', 'success'); loadUsuarios(); }
    else toast(r.error, 'error');
  });
};

function openUsuarioModal() {
  document.getElementById('formUsuario').reset();
  openModal('modalUsuario');
}

function saveUsuario() {
  const nombre = document.getElementById('usrNombre').value.trim();
  const telefono = document.getElementById('usrTelefono').value.trim();
  const username = document.getElementById('usrUsername').value.trim();
  const password = document.getElementById('usrPassword').value;
  if (!nombre||!telefono||!username||!password) { toast('Todos los campos son obligatorios', 'error'); return; }
  if (password.length<4) { toast('Mínimo 4 caracteres', 'error'); return; }
  const parts = nombre.split(' ');
  const r = Auth.register({ nombre:parts[0]||nombre, apellido:parts.slice(1).join(' ')||'', telefono, username, password });
  if (r.success) { toast('Usuario registrado', 'success'); loadUsuarios(); closeModal('modalUsuario'); }
  else toast(r.error, 'error');
}

// ===== ESTADÍSTICAS =====
function loadEstadisticas() {
  const s = Data.stats();
  document.getElementById('statTotal').textContent = s.total;
  document.getElementById('statVotados').textContent = s.votados;
  document.getElementById('statPendientes').textContent = s.pendientes;
  document.getElementById('statPorcentaje').textContent = s.porcentaje+'%';

  const barrios = Object.entries(s.porBarrio).sort((a,b)=>b[1].total-a[1].total);
  const chart = document.getElementById('chartBarrios');
  if (barrios.length===0) { chart.innerHTML='<div class="empty-state"><p>Sin datos</p></div>'; }
  else {
    const max = Math.max(...barrios.map(b=>b[1].total));
    chart.innerHTML = '<div class="bar-chart">'+barrios.map(([n,d])=>{
      const w = max>0?(d.total/max)*100:0;
      return `<div class="bar-item"><div class="bar-label">${n}</div><div class="bar-track"><div class="bar-fill" style="width:${w}%"><span>${d.total}</span></div></div></div>`;
    }).join('')+'</div>';
  }

  const act = Data.getActivity().slice(0,10);
  const actContainer = document.getElementById('chartActividad');
  if (act.length===0) { actContainer.innerHTML='<div class="empty-state"><p>Sin actividad</p></div>'; }
  else {
    actContainer.innerHTML = '<div class="activity-list">'+act.map(a=>`
      <div class="activity-item">
        <div class="activity-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${getActivityIcon(a.tipo)}</svg></div>
        <div class="activity-info"><p>${a.descripcion}</p><span>${a.usuario} - ${formatDateTime(a.fecha)}</span></div>
      </div>
    `).join('')+'</div>';
  }
}

function getActivityIcon(t) {
  const icons = {
    registro:'<path d="M12 5v14M5 12h14"/>',
    voto:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/>',
    eliminacion:'<polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    importacion:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    default:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
  };
  return icons[t]||icons.default;
}

// Si hay #app al cargar, mostrar app
if (window.location.hash==='#app' && Auth.getUser()) {
  showApp();
}
