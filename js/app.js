// ═══════════════════════════════════════════════════════════════
//  CONTROL ELECTORAL — app.js
//  Firebase Firestore (tiempo real) + CSV padrón base
//  Usuarios y votos guardados en Firestore
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
    padron:        [],    // leído del CSV (inmutable en sesión)
    votos:         {},    // { [cedula]: {voto, observaciones, modificado_por} }
    usuarios:      [],    // operadores desde Firestore
    currentFilter: "Pendiente",
    searchQuery:   "",
    pendingNoVoto: null,  // { cedula, nombre } esperando modal
    unsubVotos:    null,  // cancelar listener Firestore
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

    // Admin hardcoded
    if (userIn === ADMIN_USER && passIn === ADMIN_PASS) {
        loginSuccess({ username: ADMIN_USER, fullname: "Administrador/a", isAdmin: true }, true);
        return;
    }

    // Operador desde Firestore
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

    // Actualizar UI header
    document.getElementById("user-prefix").textContent    = user.isAdmin ? "" : "Operador: ";
    document.getElementById("current-user-display").textContent = user.fullname;

    document.getElementById("login-form").reset();

    // Tab admin: solo para Admin
    const tabAdmin = document.getElementById("tab-admin");
    user.isAdmin ? tabAdmin.classList.remove("hidden") : tabAdmin.classList.add("hidden");

    showApp();
    switchTab("planilla");
    loadPadronYEscuchar();
}

function handleLogout() {
    sessionStorage.removeItem("active_user");
    if (state.unsubVotos) { state.unsubVotos(); state.unsubVotos = null; }
    state.currentUser = null;
    state.padron      = [];
    state.votos       = {};
    setStatus(false);
    showLogin();
}

// ═══════════════════════════════════════════════════════════════
//  CARGA DE DATOS
// ═══════════════════════════════════════════════════════════════
async function loadPadronYEscuchar() {
    // 1. Leer CSV (padrón base, solo lectura)
    try {
        const res    = await fetch(CSV_PATH);
        const texto  = await res.text();
        state.padron = parsearCSV(texto);
    } catch (err) {
        console.error("Error cargando CSV:", err);
        toast("No se pudo cargar el padrón base.", "error");
        state.padron = [];
    }

    // 2. Cargar votantes extra (agregados manualmente en admin)
    try {
        const snap = await getDocs(collection(db, "padron_extra"));
        snap.forEach(d => {
            const v = d.data();
            if (!state.padron.some(p => p.cedula === v.cedula)) {
                state.padron.push({ id: v.id, nombre: v.nombre, cedula: v.cedula, domicilio: v.domicilio });
            }
        });
    } catch { /* si falla, se ignora */ }

    // 3. Escuchar cambios de votos en tiempo real (Firestore onSnapshot)
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

    // 4. Si es admin, cargar también la tabla de usuarios
    if (state.currentUser?.isAdmin) cargarUsuarios();
}

function parsearCSV(texto) {
    const lineas  = texto.split("\n").filter(l => l.trim());
    const result  = [];
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

// ── Helpers para leer estado de voto desde Firestore ────────────
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

    lista.forEach((v, idx) => {
        const voto = getVoto(v.cedula);
        const obs  = getObs(v.cedula);
        const log  = getLog(v.cedula);

        // Badge de estado
        let badgeClass = "badge badge-pending", badgeLabel = "Pendiente";
        if (voto === "Votó")    { badgeClass = "badge badge-voted";   badgeLabel = "Votó"; }
        if (voto === "No Votó") { badgeClass = "badge badge-novoted"; badgeLabel = "No Votó"; }

        // Botones de acción
        const clsVoto   = voto === "Votó"    ? "btn-accion sel-voto"   : "btn-accion";
        const clsNoVoto = voto === "No Votó" ? "btn-accion sel-novoto" : "btn-accion";

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${idx + 1}</strong></td>
            <td>${v.nombre}</td>
            <td style="font-family:monospace">${v.cedula}</td>
            <td>${v.domicilio}</td>
            <td><span class="${badgeClass}">${badgeLabel}</span></td>
            <td>
                <div class="action-btns">
                    <button class="${clsVoto}" onclick="accionVoto('${v.cedula}','Votó')">
                        <svg width="12" height="12"><use href="#icon-check"/></svg>
                        Votó
                    </button>
                    <button class="${clsNoVoto}" onclick="accionVoto('${v.cedula}','No Votó')">
                        <svg width="12" height="12"><use href="#icon-x"/></svg>
                        No Votó
                    </button>
                </div>
            </td>
            <td>
                <input class="obs-input" value="${escHtml(obs)}"
                    placeholder="Sin observación..."
                    onchange="actualizarObservacion('${v.cedula}', this.value)">
            </td>
            <td><span class="log-span">${log}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// ═══════════════════════════════════════════════════════════════
//  ACCIONES DE VOTO
// ═══════════════════════════════════════════════════════════════
window.accionVoto = function(cedula, accion) {
    const actual = getVoto(cedula);

    // Toggle: mismo estado → vuelve a Pendiente
    if (actual === accion) {
        guardarVoto(cedula, "Pendiente", "");
        return;
    }

    if (accion === "No Votó") {
        // Pide justificación por modal
        const v = state.padron.find(p => p.cedula === cedula);
        state.pendingNoVoto = { cedula, nombre: v?.nombre || cedula };
        document.getElementById("modal-novoto-name").textContent =
            `${v?.nombre || cedula} — registrá el motivo de ausencia`;
        document.getElementById("modal-obs-input").value = getObs(cedula);
        abrirModal("modal-novoto");
    } else {
        guardarVoto(cedula, "Votó", "");
    }
};

window.confirmNoVoto = function() {
    if (!state.pendingNoVoto) return;
    const { cedula } = state.pendingNoVoto;
    const obs = document.getElementById("modal-obs-input").value.trim()
        || "No asistió (sin motivo especificado)";
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
        toast(`${nombre} inscrito correctamente en el padrón.`);
    } catch {
        toast("Inscripto en esta sesión, pero error al sincronizar.", "warn");
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
    const fullname  = document.getElementById("reg-fullname").value.trim();
    const phone     = document.getElementById("reg-phone").value.trim();
    const username  = document.getElementById("reg-username").value.trim().toLowerCase();
    const password  = document.getElementById("reg-password").value;

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
        toast(`Operador "${fullname}" creado correctamente.`);
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
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-gray);padding:20px;">No hay operadores registrados.</td></tr>`;
        return;
    }

    state.usuarios.forEach(u => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${u.fullname}</td>
            <td>${u.phone}</td>
            <td><code>${u.username}</code></td>
            <td>
                <button class="btn-danger" onclick="deleteUser('${u.username}')" style="display:flex;align-items:center;gap:5px;justify-content:center;">
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
window.closeModal = function(id) {
    document.getElementById(id).classList.remove("active");
    state.pendingNoVoto = null;
};

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

    // Cerrar modal clickeando fuera
    document.getElementById("modal-novoto").addEventListener("click", function(e) {
        if (e.target === this) closeModal("modal-novoto");
    });
}
