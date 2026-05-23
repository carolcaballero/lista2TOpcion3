// ═══════════════════════════════════════════════════════════════
//  CONTROL ELECTORAL — app.js
//  Firebase Firestore (tiempo real) + CSV padrón base
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    doc, getDoc, getDocs, setDoc, deleteDoc,
    collection, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Firebase config ─────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyAPOUL6dxwCVgJxhGbBudKbWcyfiFFZt88",
    authDomain:        "lista2topcion3.firebaseapp.com",
    projectId:         "lista2topcion3",
    storageBucket:     "lista2topcion3.firebasestorage.app",
    messagingSenderId: "121196945937",
    appId:             "1:121196945937:web:1d4eac42d712927f4b87b0",
    measurementId:     "G-J6NJZ4ZNWK"
};

const firebaseApp = initializeApp(firebaseConfig);
const db          = getFirestore(firebaseApp);

// ── Constantes ──────────────────────────────────────────────────
const ADMIN_USER = "Admin";
const ADMIN_PASS = "CAROL2T3";
const CSV_PATH   = "data/votantes.csv";

// ── Estado global ───────────────────────────────────────────────
const state = {
    currentUser:   null,
    padron:        [],
    votos:         {},
    usuarios:      [],
    currentFilter: "Pendiente",
    searchQuery:   "",
    pendingNoVoto: null,
    unsubVotos:    null,
    unsubUsuarios: null,   // listener en tiempo real de usuarios online
    onlineUsers:   {},     // { username: { fullname, lastSeen } }
    presenceInterval: null,
};

// ═══════════════════════════════════════════════════════════════
//  INICIO
// ═══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    checkSession();
});

// ═══════════════════════════════════════════════════════════════
//  SESIÓN
// ═══════════════════════════════════════════════════════════════
function checkSession() {
    const saved = sessionStorage.getItem("active_user");
    if (saved) {
        try {
            const user = JSON.parse(saved);
            loginSuccess(user, false);
            return;
        } catch { /**/ }
    }
    showLogin();
}

async function handleLogin(e) {
    e.preventDefault();
    const userIn  = document.getElementById("username").value.trim();
    const passIn  = document.getElementById("password").value;
    const errEl   = document.getElementById("login-error");
    errEl.textContent = "";

    if (userIn === ADMIN_USER && passIn === ADMIN_PASS) {
        loginSuccess({ username: ADMIN_USER, fullname: "Administrador/a", isAdmin: true }, true);
        return;
    }

    try {
        const snap = await getDoc(doc(db, "usuarios", userIn.toLowerCase()));
        if (snap.exists()) {
            const u = snap.data();
            if (u.password === passIn) {
                loginSuccess({ username: u.username, fullname: u.fullname, isAdmin: false }, true);
                return;
            }
        }
        errEl.textContent = "Usuario o contraseña incorrectos.";
    } catch (err) {
        console.error(err);
        errEl.textContent = "Error de conexión con el servidor.";
    }
}

function loginSuccess(user, persist) {
    state.currentUser = user;
    if (persist) sessionStorage.setItem("active_user", JSON.stringify(user));

    document.getElementById("user-prefix").textContent         = user.isAdmin ? "" : "Operador: ";
    document.getElementById("current-user-display").textContent = user.fullname;
    document.getElementById("login-form").reset();

    const tabAdmin = document.getElementById("tab-admin");
    user.isAdmin ? tabAdmin.classList.remove("hidden") : tabAdmin.classList.add("hidden");

    showApp();
    switchTab("planilla");
    loadPadronYEscuchar();
    iniciarPresencia();
}

function handleLogout() {
    quitarPresencia();
    sessionStorage.removeItem("active_user");
    if (state.unsubVotos)    { state.unsubVotos();    state.unsubVotos    = null; }
    if (state.unsubUsuarios) { state.unsubUsuarios(); state.unsubUsuarios = null; }
    if (state.presenceInterval) { clearInterval(state.presenceInterval); state.presenceInterval = null; }
    state.currentUser = null;
    state.padron      = [];
    state.votos       = {};
    state.onlineUsers = {};
    setStatus(false);
    showLogin();
}

// ═══════════════════════════════════════════════════════════════
//  PRESENCIA (usuarios en línea)
// ═══════════════════════════════════════════════════════════════
async function iniciarPresencia() {
    if (!state.currentUser) return;
    const key = state.currentUser.username.toLowerCase();

    // Marcar como online
    await marcarOnline();

    // Actualizar cada 30 segundos
    state.presenceInterval = setInterval(marcarOnline, 30000);

    // Escuchar cambios en presencia
    if (state.unsubUsuarios) state.unsubUsuarios();
    state.unsubUsuarios = onSnapshot(collection(db, "presencia"), snap => {
        state.onlineUsers = {};
        const ahora = Date.now();
        snap.forEach(d => {
            const data = d.data();
            // Considerar online si actualizó en los últimos 2 minutos
            const lastSeen = data.lastSeen?.toMillis?.() || 0;
            if (ahora - lastSeen < 120000) {
                state.onlineUsers[d.id] = data;
            }
        });
        renderOnlineUsers();
    });

    // Remover al cerrar ventana
    window.addEventListener("beforeunload", quitarPresencia);
}

async function marcarOnline() {
    if (!state.currentUser) return;
    const key = state.currentUser.username.toLowerCase();
    try {
        await setDoc(doc(db, "presencia", key), {
            username: state.currentUser.username,
            fullname: state.currentUser.fullname,
            isAdmin:  state.currentUser.isAdmin,
            lastSeen: serverTimestamp()
        });
    } catch (e) { console.warn("Presencia error:", e); }
}

async function quitarPresencia() {
    if (!state.currentUser) return;
    try {
        await deleteDoc(doc(db, "presencia", state.currentUser.username.toLowerCase()));
    } catch { /**/ }
}

function renderOnlineUsers() {
    const container = document.getElementById("online-users-list");
    if (!container) return;

    const users = Object.values(state.onlineUsers);
    const countEl = document.getElementById("online-count");
    if (countEl) countEl.textContent = users.length;

    if (!users.length) {
        container.innerHTML = `<div class="online-empty">Ningún operador activo ahora mismo.</div>`;
        return;
    }

    container.innerHTML = users.map(u => `
        <div class="online-user-item">
            <span class="online-dot-sm"></span>
            <span class="online-name">${escHtml(u.fullname)}</span>
            ${u.isAdmin ? '<span class="online-badge-admin">Admin</span>' : ''}
        </div>
    `).join("");
}

// ═══════════════════════════════════════════════════════════════
//  CARGA DE DATOS
// ═══════════════════════════════════════════════════════════════
async function loadPadronYEscuchar() {
    try {
        const res    = await fetch(CSV_PATH);
        const texto  = await res.text();
        state.padron = parsearCSV(texto);
    } catch (err) {
        console.error("Error cargando CSV:", err);
        toast("No se pudo cargar el padrón base.", "error");
        state.padron = [];
    }

    try {
        const snap = await getDocs(collection(db, "padron_extra"));
        snap.forEach(d => {
            const v = d.data();
            if (!state.padron.some(p => p.cedula === v.cedula)) {
                state.padron.push({ id: v.id, nombre: v.nombre, cedula: v.cedula, domicilio: v.domicilio });
            }
        });
    } catch { /* ignorar */ }

    if (state.unsubVotos) state.unsubVotos();
    state.unsubVotos = onSnapshot(
        collection(db, "votos"),
        (snapshot) => {
            state.votos = {};
            snapshot.forEach(d => { state.votos[d.id] = d.data(); });
            setStatus(true);
            actualizarDashboard();
        },
        (err) => {
            console.error("Listener error:", err);
            setStatus(false);
        }
    );

    if (state.currentUser?.isAdmin) cargarUsuarios();
}

function parsearCSV(texto) {
    const lineas = texto.split("\n").filter(l => l.trim());
    const result = [];
    for (let i = 1; i < lineas.length; i++) {
        const c = lineas[i].split(",");
        result.push({
            id:        c[0]?.trim() || String(i),
            nombre:    c[1]?.trim() || "Sin nombre",
            cedula:    c[2]?.trim() || "",
            domicilio: c[4]?.trim() || "---",
        });
    }
    return result;
}

const getVoto = (cedula) => state.votos[cedula]?.voto          || "Pendiente";
const getObs  = (cedula) => state.votos[cedula]?.observaciones || "";
const getLog  = (cedula) => state.votos[cedula]?.modificado_por || "---";

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════
function actualizarDashboard() {
    const total   = state.padron.length;
    const voted   = state.padron.filter(v => getVoto(v.cedula) === "Votó").length;
    const noVoted = state.padron.filter(v => getVoto(v.cedula) === "No Votó").length;
    const pending = total - voted - noVoted;

    document.getElementById("metric-total").textContent   = total;
    document.getElementById("metric-voted").textContent   = voted;
    document.getElementById("metric-novoted").textContent = noVoted;
    document.getElementById("metric-pending").textContent = pending;

    renderTablaVotantes();
}

// ═══════════════════════════════════════════════════════════════
//  TABLA DE VOTANTES
// ═══════════════════════════════════════════════════════════════
function renderTablaVotantes() {
    const tbody = document.getElementById("votantes-table-body");
    tbody.innerHTML = "";

    let lista = state.padron.filter(v => getVoto(v.cedula) === state.currentFilter);

    if (state.searchQuery) {
        const q = state.searchQuery;
        lista = lista.filter(v =>
            v.nombre.toLowerCase().includes(q) || v.cedula.includes(q)
        );
    }

    if (!lista.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center;color:var(--color-gray);padding:30px;">
                    No se encontraron registros.
                </td>
            </tr>`;
        return;
    }

    const isAdmin = state.currentUser?.isAdmin;

    lista.forEach((v, idx) => {
        const voto = getVoto(v.cedula);
        const obs  = getObs(v.cedula);
        const log  = getLog(v.cedula);

        let badgeClass = "badge badge-pending", badgeLabel = "Pendiente";
        if (voto === "Votó")    { badgeClass = "badge badge-voted";   badgeLabel = "Votó"; }
        if (voto === "No Votó") { badgeClass = "badge badge-novoted"; badgeLabel = "No Votó"; }

        const clsVoto   = voto === "Votó"    ? "btn-accion sel-voto"   : "btn-accion";
        const clsNoVoto = voto === "No Votó" ? "btn-accion sel-novoto" : "btn-accion";

        // ── Lógica de botones según rol ──────────────────────────
        // Botón "Votó": marcar. Si ya votó, solo ADMIN puede quitar
        let btnVotoHtml = "";
        if (voto === "Votó") {
            if (isAdmin) {
                btnVotoHtml = `
                    <button class="${clsVoto}" onclick="accionVoto('${v.cedula}','Votó')" title="Admin: quitar voto">
                        <svg width="12" height="12"><use href="#icon-check"/></svg>
                        Votó ✕
                    </button>`;
            } else {
                // Operador: solo lee, no puede quitar
                btnVotoHtml = `
                    <button class="${clsVoto} btn-bloqueado" disabled title="Solo Admin puede quitar">
                        <svg width="12" height="12"><use href="#icon-check"/></svg>
                        Votó
                    </button>`;
            }
        } else {
            btnVotoHtml = `
                <button class="${clsVoto}" onclick="accionVoto('${v.cedula}','Votó')">
                    <svg width="12" height="12"><use href="#icon-check"/></svg>
                    Votó
                </button>`;
        }

        // Botón "No Votó": cualquier user puede marcar/modificar
        const btnNoVotoHtml = `
            <button class="${clsNoVoto}" onclick="accionVoto('${v.cedula}','No Votó')">
                <svg width="12" height="12"><use href="#icon-x"/></svg>
                No Votó
            </button>`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${idx + 1}</strong></td>
            <td>${escHtml(v.nombre)}</td>
            <td style="font-family:monospace">${v.cedula}</td>
            <td>${escHtml(v.domicilio)}</td>
            <td><span class="${badgeClass}">${badgeLabel}</span></td>
            <td>
                <div class="action-btns">
                    ${btnVotoHtml}
                    ${btnNoVotoHtml}
                </div>
            </td>
            <td>
                <input class="obs-input" value="${escHtml(obs)}"
                    placeholder="Sin observación..."
                    onchange="actualizarObservacion('${v.cedula}', this.value)">
            </td>
            <td><span class="log-span">${escHtml(log)}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// ═══════════════════════════════════════════════════════════════
//  ACCIONES DE VOTO
// ═══════════════════════════════════════════════════════════════
window.accionVoto = function(cedula, accion) {
    const actual  = getVoto(cedula);
    const isAdmin = state.currentUser?.isAdmin;

    // Toggle "Votó" → Pendiente: SOLO admin
    if (actual === "Votó" && accion === "Votó") {
        if (!isAdmin) {
            toast("Solo el Administrador puede quitar el voto.", "error");
            return;
        }
        guardarVoto(cedula, "Pendiente", "");
        return;
    }

    // Toggle "No Votó" → Pendiente: cualquier usuario
    if (actual === "No Votó" && accion === "No Votó") {
        guardarVoto(cedula, "Pendiente", "");
        return;
    }

    if (accion === "No Votó") {
        // Abrir modal (motivo OPCIONAL)
        const v = state.padron.find(p => p.cedula === cedula);
        state.pendingNoVoto = { cedula, nombre: v?.nombre || cedula };
        document.getElementById("modal-novoto-name").textContent = v?.nombre || cedula;
        document.getElementById("modal-obs-input").value = getObs(cedula);
        abrirModal("modal-novoto");
    } else {
        // "Votó" directo
        guardarVoto(cedula, "Votó", "");
    }
};

// Confirmar "No Votó" desde el modal (motivo OPCIONAL)
window.confirmNoVoto = function() {
    if (!state.pendingNoVoto) return;
    const { cedula } = state.pendingNoVoto;
    const obs = document.getElementById("modal-obs-input").value.trim();
    // obs puede quedar vacío — no es obligatorio
    guardarVoto(cedula, "No Votó", obs);
    cerrarModal("modal-novoto");
    state.pendingNoVoto = null;
};

async function guardarVoto(cedula, voto, observaciones) {
    const operador = state.currentUser.isAdmin
        ? "Administrador/a"
        : state.currentUser.username;
    try {
        await setDoc(doc(db, "votos", cedula), {
            voto,
            observaciones,
            modificado_por: `Por: ${operador}`,
            timestamp:      serverTimestamp()
        });
        // Mensaje de éxito
        if (voto === "Votó") {
            toast("✔ ¡Voto registrado correctamente!", "ok");
        } else if (voto === "No Votó") {
            toast("Registrado como No Votó.", "ok");
        }
        // Si vuelve a Pendiente no mostramos toast especial
    } catch (err) {
        console.error("Error guardando voto:", err);
        toast("Error al guardar. Verificá la conexión.", "error");
    }
}

window.actualizarObservacion = async function(cedula, texto) {
    const actual   = state.votos[cedula] || {};
    const operador = state.currentUser.isAdmin ? "Administrador/a" : state.currentUser.username;
    try {
        await setDoc(doc(db, "votos", cedula), {
            voto:           actual.voto || "Pendiente",
            observaciones:  texto.trim(),
            modificado_por: `Por: ${operador}`,
            timestamp:      serverTimestamp()
        });
    } catch {
        toast("Error al guardar observación.", "error");
    }
};

// ═══════════════════════════════════════════════════════════════
//  ADMIN: VOTANTES
// ═══════════════════════════════════════════════════════════════
async function handleRegistrarVotante(e) {
    e.preventDefault();
    const nombre    = document.getElementById("vot-fullname").value.trim();
    const cedula    = document.getElementById("vot-cedula").value.trim();
    const domicilio = document.getElementById("vot-domicilio").value.trim() || "---";

    if (state.padron.some(v => v.cedula === cedula)) {
        toast(`Ya existe un votante con la cédula ${cedula}.`, "error");
        return;
    }

    const nuevo = { id: "manual_" + Date.now(), nombre, cedula, domicilio };
    state.padron.push(nuevo);

    try {
        await setDoc(doc(db, "padron_extra", cedula), {
            ...nuevo,
            creado_por: state.currentUser.isAdmin ? "Administrador/a" : state.currentUser.username,
            timestamp:  serverTimestamp()
        });
        toast(`✔ ${nombre} registrado como votante correctamente.`);
    } catch {
        toast("Registrado en sesión, pero error al sincronizar.", "warn");
    }

    document.getElementById("register-votante-form").reset();
    cambiarFiltro("Pendiente");
    actualizarDashboard();
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN: OPERADORES
// ═══════════════════════════════════════════════════════════════
async function cargarUsuarios() {
    try {
        const snap = await getDocs(collection(db, "usuarios"));
        state.usuarios = [];
        snap.forEach(d => state.usuarios.push(d.data()));
        renderTablaUsuarios();
    } catch (err) {
        console.error("Error cargando usuarios:", err);
    }
}

async function handleRegistrarUsuario(e) {
    e.preventDefault();
    const fullname = document.getElementById("reg-fullname").value.trim();
    const phone    = document.getElementById("reg-phone").value.trim();
    const username = document.getElementById("reg-username").value.trim().toLowerCase();
    const password = document.getElementById("reg-password").value;

    if (username === ADMIN_USER.toLowerCase()) {
        toast("Ese nombre de usuario está reservado.", "error");
        return;
    }

    try {
        const existe = await getDoc(doc(db, "usuarios", username));
        if (existe.exists()) {
            toast("El nombre de usuario ya existe.", "error");
            return;
        }
        await setDoc(doc(db, "usuarios", username), {
            username, fullname, phone, password, isAdmin: false
        });
        toast(`✔ Operador "${fullname}" creado correctamente.`);
        document.getElementById("register-user-form").reset();
        cargarUsuarios();
    } catch (err) {
        console.error(err);
        toast("Error al crear el usuario.", "error");
    }
}

window.deleteUser = async function(username) {
    if (!confirm(`¿Eliminar al operador "${username}"?`)) return;
    try {
        await deleteDoc(doc(db, "usuarios", username));
        toast(`Operador "${username}" eliminado.`, "warn");
        cargarUsuarios();
    } catch {
        toast("Error al eliminar el operador.", "error");
    }
};

function renderTablaUsuarios() {
    const tbody = document.getElementById("users-table-body");
    tbody.innerHTML = "";

    if (!state.usuarios.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-gray);padding:20px;">No hay operadores registrados.</td></tr>`;
        return;
    }

    state.usuarios.forEach(u => {
        // Número limpio para WhatsApp (quitar espacios, guiones, +)
        const phoneClean = (u.phone || "").replace(/[\s\-\+]/g, "");
        const waLink     = phoneClean
            ? `https://wa.me/${phoneClean}`
            : null;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${escHtml(u.fullname)}</td>
            <td>
                ${waLink
                    ? `<a href="${waLink}" target="_blank" rel="noopener" class="wa-link">
                           <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px">
                               <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
                           </svg>
                           ${escHtml(u.phone)}
                       </a>`
                    : escHtml(u.phone || "---")
                }
            </td>
            <td><code>${escHtml(u.username)}</code></td>
            <td>
                <button class="btn-danger" onclick="deleteUser('${escHtml(u.username)}')" style="display:flex;align-items:center;gap:5px;justify-content:center;">
                    <svg class="icon" style="color:#fff;width:14px;height:14px"><use href="#icon-trash"/></svg>
                    Eliminar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ═══════════════════════════════════════════════════════════════
//  FILTROS
// ═══════════════════════════════════════════════════════════════
function cambiarFiltro(destino) {
    state.currentFilter = destino;

    const btnP = document.getElementById("btn-filter-pending");
    const btnV = document.getElementById("btn-filter-voted");
    const btnN = document.getElementById("btn-filter-novoted");

    [btnP, btnV, btnN].forEach(b => b.className = "filter-btn");
    if (destino === "Pendiente")  btnP.classList.add("f-pending");
    if (destino === "Votó")       btnV.classList.add("f-voted");
    if (destino === "No Votó")    btnN.classList.add("f-novoted");

    renderTablaVotantes();
}

// ═══════════════════════════════════════════════════════════════
//  NAVEGACIÓN
// ═══════════════════════════════════════════════════════════════
function showLogin() {
    document.getElementById("login-section").classList.remove("hidden");
    document.getElementById("app-section").classList.add("hidden");
}

function showApp() {
    document.getElementById("login-section").classList.add("hidden");
    document.getElementById("app-section").classList.remove("hidden");
}

function switchTab(tab) {
    if (tab === "admin" && !state.currentUser?.isAdmin) {
        toast("Acceso denegado. Solo el Administrador.", "error");
        return;
    }

    const planilla    = document.getElementById("view-planilla");
    const admin       = document.getElementById("view-admin");
    const fw          = document.getElementById("filter-wrapper");
    const tabPlanilla = document.getElementById("tab-planilla");
    const tabAdmin    = document.getElementById("tab-admin");

    if (tab === "planilla") {
        planilla.style.display = "";
        admin.classList.remove("visible");
        fw.style.display = "flex";
        tabPlanilla.classList.add("active");
        tabAdmin.classList.remove("active");
        renderTablaVotantes();
    } else {
        planilla.style.display = "none";
        admin.classList.add("visible");
        fw.style.display = "none";
        tabPlanilla.classList.remove("active");
        tabAdmin.classList.add("active");
        cargarUsuarios();
    }
}

// ═══════════════════════════════════════════════════════════════
//  MODALES
// ═══════════════════════════════════════════════════════════════
function abrirModal(id)  { document.getElementById(id).classList.add("active"); }
function cerrarModal(id) { document.getElementById(id).classList.remove("active"); state.pendingNoVoto = null; }
window.closeModal = cerrarModal;

// ═══════════════════════════════════════════════════════════════
//  TOASTS
// ═══════════════════════════════════════════════════════════════
function toast(msg, tipo = "ok") {
    const el = document.createElement("div");
    el.className = tipo === "error" ? "toast error" : tipo === "warn" ? "toast warn" : "toast";
    el.textContent = msg;
    document.getElementById("toast-container").appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

// ═══════════════════════════════════════════════════════════════
//  STATUS DOT
// ═══════════════════════════════════════════════════════════════
function setStatus(online) {
    const dot   = document.getElementById("status-dot");
    const label = document.getElementById("status-label");
    dot.className = "status-dot" + (online ? " online" : "");
    label.textContent = online ? "en línea" : "sin conexión";
}

// ═══════════════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════════════
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ═══════════════════════════════════════════════════════════════
//  BIND EVENTOS
// ═══════════════════════════════════════════════════════════════
function bindEvents() {
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("logout-btn").addEventListener("click", handleLogout);

    document.getElementById("search-input").addEventListener("input", e => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        renderTablaVotantes();
    });

    document.getElementById("btn-filter-pending").addEventListener("click", () => cambiarFiltro("Pendiente"));
    document.getElementById("btn-filter-voted").addEventListener("click",   () => cambiarFiltro("Votó"));
    document.getElementById("btn-filter-novoted").addEventListener("click", () => cambiarFiltro("No Votó"));

    document.getElementById("tab-planilla").addEventListener("click", () => switchTab("planilla"));
    document.getElementById("tab-admin").addEventListener("click",    () => switchTab("admin"));

    document.getElementById("register-user-form").addEventListener("submit",    handleRegistrarUsuario);
    document.getElementById("register-votante-form").addEventListener("submit", handleRegistrarVotante);

    document.getElementById("modal-novoto").addEventListener("click", function(e) {
        if (e.target === this) cerrarModal("modal-novoto");
    });
}
