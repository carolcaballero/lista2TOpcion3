// ═══════════════════════════════════════════════════════════════
//  CONTROL ELECTORAL — app.js v10.0
//  Menú 3 puntos corregido, checkboxes, barra inferior,
//  limpiar bitácora, mesas completas, Material Icons
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
    collection, onSnapshot, serverTimestamp, query, orderBy, limit
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
const ADMIN_USER_ID   = "admin";
const ADMIN_HASH      = "3125998a39f131e03ee8a3cad1ea1fb31327e6a610e1c21cc0ff50ee00495a03";
const ADMIN_FULLNAME  = "Administrador/a";
const SESSION_KEY     = "ce_session_v5";
const SESSION_TTL_MS  = 7 * 24 * 60 * 60 * 1000;
const TZ_PY           = "America/Asuncion";
const OFFLINE_QUEUE_KEY = "ce_offline_queue_v1";

// ── Estado global ───────────────────────────────────────────────
const state = {
    currentUser:      null,
    padron:           [],
    votos:            {},
    usuarios:         [],
    currentFilter:    "todos",
    searchQuery:      "",
    searchAllStates:  false,
    pendingNoVoto:    null,
    unsubVotos:       null,
    unsubPresencia:   null,
    unsubBitacora:    null,
    onlineUsers:      {},
    presenceInterval: null,
    prevMetrics:      { total: 0, voted: 0, novoted: 0, pending: 0 },
    pagination:       { page: 1, perPage: 50 },
    charts:           { mesa: null, global: null, hora: null },
    notifiedThresholds: new Set(),
    isRendering:      false,
    offlineRetryInterval: null,
};

// Set de cédulas seleccionadas mediante checkboxes
const selectedCedulas = new Set();

// ═══════════════════════════════════════════════════════════════
//  SHA-256
// ═══════════════════════════════════════════════════════════════
async function sha256(texto) {
    const encoder = new TextEncoder();
    const data    = encoder.encode(texto);
    const hash    = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}
window.sha256 = sha256;

// ── Fecha/hora Paraguay robusta ─────────────────────────────────
function formatearFechaParaguay(date) {
    if (!date) return "---";
    try {
        return new Intl.DateTimeFormat("es-PY", {
            timeZone: TZ_PY,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(date);
    } catch(e) {
        const d = new Date(date);
        const offset = -4 * 60;
        const local = new Date(d.getTime() + (offset - d.getTimezoneOffset()) * 60000);
        return local.toLocaleString("es-PY", {
            day:"2-digit", month:"2-digit", year:"numeric",
            hour:"2-digit", minute:"2-digit", hour12:false
        });
    }
}

function ahoraParaguay() {
    return formatearFechaParaguay(new Date());
}

function timestampAParaguay(ts) {
    if (!ts) return "---";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return formatearFechaParaguay(d);
}

// ═══════════════════════════════════════════════════════════════
//  OFFLINE QUEUE con reintentos automáticos
// ═══════════════════════════════════════════════════════════════
function getOfflineQueue() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]"); }
    catch { return []; }
}
function saveOfflineQueue(q) {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
    updateOfflineBadge();
}
function addOfflineAction(action) {
    const q = getOfflineQueue();
    q.push({ ...action, queuedAt: Date.now() });
    saveOfflineQueue(q);
}
async function syncOfflineQueue() {
    const q = getOfflineQueue();
    if (!q.length) return;
    if (!navigator.onLine) return;
    let ok = 0, err = 0;
    const remaining = [];
    for (const item of q) {
        try {
            await setDoc(doc(db, "votos", item.cedula), {
                voto:           item.voto,
                observaciones:  item.observaciones || "",
                modificado_por: item.modificado_por,
                timestamp:      serverTimestamp()
            });
            if (item.historial) {
                await addDoc(collection(db, "votos", item.cedula, "historial"), item.historial);
            }
            ok++;
        } catch (e) {
            remaining.push(item);
            err++;
        }
    }
    saveOfflineQueue(remaining);
    updateOfflineBadge();
    if (ok > 0) {
        toast(`✔ ${ok} acciones offline sincronizadas.`, "ok");
        actualizarDashboard();
    }
    if (err > 0) toast(`⚠ ${err} acciones quedaron pendientes.`, "warn");
}

function iniciarReintentosOffline() {
    if (state.offlineRetryInterval) clearInterval(state.offlineRetryInterval);
    state.offlineRetryInterval = setInterval(() => {
        if (navigator.onLine && getOfflineQueue().length > 0) {
            syncOfflineQueue();
        }
    }, 30000);
}

function updateOfflineBadge() {
    const q = getOfflineQueue();
    const el = document.getElementById("offline-indicator");
    if (el) {
        if (q.length === 0 && navigator.onLine) {
            el.classList.add("hidden");
        } else {
            el.classList.remove("hidden");
            const countSpan = el.querySelector(".offline-count") || (() => {
                const span = document.createElement("span");
                span.className = "offline-count";
                el.appendChild(span);
                return span;
            })();
            countSpan.textContent = q.length ? ` (${q.length})` : "";
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  BITÁCORA
// ═══════════════════════════════════════════════════════════════
async function registrarBitacora(accion, detalle) {
    try {
        await addDoc(collection(db, "bitacora"), {
            operador:  state.currentUser?.fullname || "---",
            username:  state.currentUser?.username || "---",
            accion, detalle,
            hora_py:   ahoraParaguay(),
            timestamp: serverTimestamp()
        });
    } catch (e) { console.warn("Bitácora error:", e); }
}

function escucharBitacora() {
    if (state.unsubBitacora) state.unsubBitacora();
    const q = query(collection(db, "bitacora"), orderBy("timestamp", "desc"), limit(150));
    state.unsubBitacora = onSnapshot(q, snap => {
        const eventos = [];
        snap.forEach(d => eventos.push({ id: d.id, ...d.data() }));
        renderBitacora(eventos);
    }, err => console.error("Bitácora listener:", err));
}

function renderBitacora(eventos) {
    const tbody = document.getElementById("bitacora-tbody");
    if (!tbody) return;
    if (!eventos.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-gray);padding:20px;">Sin actividad registrada aún.</td></tr>`;
        return;
    }
    const colorMap = {
        "Votó":"#15803D","No Votó":"#B45309","Quitar Voto":"#B91C1C",
        "Quitar No Votó":"#7F1D1D","Nuevo Votante":"#374151","Nuevo Operador":"#B91C1C",
        "Eliminar Operador":"#B91C1C","Observación":"#B45309","Login":"#15803D",
        "Logout":"#6B7280","Consulta Padrón":"#B45309","Cambio Contraseña":"#7F1D1D",
        "Exportar XLSX":"#374151","Exportar Estadísticas":"#374151"
    };
    tbody.innerHTML = eventos.map(e => {
        const hora  = e.hora_py || timestampAParaguay(e.timestamp) || "---";
        const color = colorMap[e.accion] || "#6B7280";
        return `
            <tr>
                <td style="white-space:nowrap;font-size:.76rem;color:var(--color-gray);font-family:monospace">${hora}</td>
                <td><strong style="color:var(--color-dark);font-size:.85rem">${escHtml(e.operador)}</strong><br>
                    <span style="font-size:.7rem;color:var(--color-gray)">${escHtml(e.username)}</span></td>
                <td><span class="bit-badge" style="background:${color}1f;color:${color};border:1px solid ${color}55">${escHtml(e.accion)}</span></td>
                <td style="font-size:.8rem;color:var(--color-dark)">${escHtml(e.detalle)}</td>
            </tr>`;
    }).join("");
}

// ═══════════════════════════════════════════════════════════════
//  INICIO
// ═══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    bindNetworkEvents();
    iniciarReintentosOffline();
    ajustarStickyFiltros();
    checkSession();

    // Cerrar menú al hacer clic fuera
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.menu-tres-puntos')) {
            document.querySelectorAll('.menu-tres-puntos .dropdown.show').forEach(d => d.classList.remove('show'));
        }
    });

    // Cerrar menú con Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.menu-tres-puntos .dropdown.show').forEach(d => d.classList.remove('show'));
        }
    });
});

function bindNetworkEvents() {
    window.addEventListener("online",  () => {
        setStatus(true);
        updateOfflineBadge();
        syncOfflineQueue();
        toast("Conexión restablecida", "ok");
    });
    window.addEventListener("offline", () => {
        setStatus(false);
        updateOfflineBadge();
        toast("Sin conexión. Modo offline activado.", "warn");
    });
}

function ajustarStickyFiltros() {
    const filterWrapper = document.getElementById("filter-wrapper");
    const header = document.querySelector(".main-header");
    if (!filterWrapper || !header) return;
    const updateTop = () => {
        if (window.innerWidth < 768) {
            const headerHeight = header.offsetHeight;
            filterWrapper.style.top = `${headerHeight}px`;
        } else {
            filterWrapper.style.top = "";
        }
    };
    updateTop();
    window.addEventListener("resize", updateTop);
    const observer = new ResizeObserver(updateTop);
    observer.observe(header);
}

// ═══════════════════════════════════════════════════════════════
//  SESIÓN
// ═══════════════════════════════════════════════════════════════
function checkSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
            const session = JSON.parse(raw);
            const age = Date.now() - (session.loginAt || 0);
            if (age < SESSION_TTL_MS && session.user) {
                loginSuccess(session.user, false);
                return;
            } else {
                localStorage.removeItem(SESSION_KEY);
            }
        }
    } catch { /**/ }
    showLogin();
}

async function handleLogin(e) {
    e.preventDefault();
    const userIn   = document.getElementById("username").value.replace(/\s+/g, "").trim();
    const passIn   = document.getElementById("password").value.replace(/\s+/g, "").trim();
    const errEl    = document.getElementById("login-error");
    const btnLogin = e.target.querySelector("button[type=submit]");
    errEl.textContent = "";
    if (!userIn || !passIn) { errEl.textContent = "Completá usuario y contraseña."; return; }
    if (btnLogin) { btnLogin.disabled = true; btnLogin.textContent = "Verificando..."; }
    const resetBtn = () => { if (btnLogin) { btnLogin.disabled = false; btnLogin.textContent = "Ingresar al Sistema"; } };

    try {
        const passHash = await sha256(passIn);
        if (userIn.toLowerCase() === ADMIN_USER_ID) {
            if (passHash === ADMIN_HASH) {
                resetBtn();
                loginSuccess({ username: ADMIN_USER_ID, fullname: ADMIN_FULLNAME, isAdmin: true, local: "" }, true);
                return;
            } else {
                errEl.textContent = "Contraseña incorrecta para Admin.";
                resetBtn(); return;
            }
        }
        const snap = await getDoc(doc(db, "usuarios", userIn.toLowerCase()));
        if (snap.exists()) {
            const u = snap.data();
            const match = u.passwordHash ? u.passwordHash === passHash : u.password === passIn;
            if (match) {
                resetBtn();
                loginSuccess({ username: u.username, fullname: u.fullname, isAdmin: false, local: u.local || "" }, true);
                return;
            }
        }
        errEl.textContent = "Usuario o contraseña incorrectos.";
        resetBtn();
    } catch (err) {
        console.error("Login error:", err);
        if (err.code === "unavailable" || err.message?.includes("network")) {
            errEl.textContent = "Sin conexión. Verificá tu red e intentá de nuevo.";
        } else if (err.code === "permission-denied") {
            errEl.textContent = "Error de permisos. Contactá al administrador.";
        } else {
            errEl.textContent = "Error al conectar. Revisá tu internet.";
        }
        resetBtn();
    }
}

function loginSuccess(user, persist) {
    try {
        state.currentUser = user;
        if (persist) {
            try { localStorage.setItem(SESSION_KEY, JSON.stringify({ user, loginAt: Date.now() })); }
            catch(e) { console.warn("No se pudo guardar sesión:", e); }
        }

        const prefixEl  = document.getElementById("user-prefix");
        const displayEl = document.getElementById("current-user-display");
        const assignEl  = document.getElementById("user-assignment");
        if (prefixEl)  prefixEl.textContent  = user.isAdmin ? "" : "Operador: ";
        if (displayEl) displayEl.textContent = user.fullname;

        if (assignEl) {
            if (user.local) {
                assignEl.classList.remove("hidden");
                assignEl.textContent = `📍 ${user.local}`;
            } else {
                assignEl.classList.add("hidden");
            }
        }

        const tabAdmin    = document.getElementById("tab-admin");
        const btnExportar = document.getElementById("btn-exportar");
        const bottomAdmin = document.getElementById("bottom-tab-admin");
        if (tabAdmin)    user.isAdmin ? tabAdmin.classList.remove("hidden")  : tabAdmin.classList.add("hidden");
        if (btnExportar) btnExportar.style.display = user.isAdmin ? "flex" : "none";
        if (bottomAdmin) bottomAdmin.classList.toggle("hidden", !user.isAdmin);

        showApp();
        state.currentFilter = "todos";
        switchTab("planilla");
        updateOfflineBadge();

        const loginForm = document.getElementById("login-form");
        if (loginForm) loginForm.reset();

        loadPadronYEscuchar();
        iniciarPresencia();
        registrarBitacora("Login", `${user.fullname} ingresó al sistema`);
    } catch(err) {
        console.error("Error en loginSuccess:", err);
        try { showApp(); } catch(e2) { /**/ }
    }
}

function handleLogout() {
    registrarBitacora("Logout", `${state.currentUser?.fullname} cerró sesión`);
    selectedCedulas.clear();
    actualizarBarraSeleccion();
    quitarPresencia();
    localStorage.removeItem(SESSION_KEY);
    if (state.unsubVotos)     { state.unsubVotos();     state.unsubVotos     = null; }
    if (state.unsubPresencia) { state.unsubPresencia(); state.unsubPresencia = null; }
    if (state.unsubBitacora)  { state.unsubBitacora();  state.unsubBitacora  = null; }
    if (state.presenceInterval) { clearInterval(state.presenceInterval); state.presenceInterval = null; }
    if (state.offlineRetryInterval) { clearInterval(state.offlineRetryInterval); state.offlineRetryInterval = null; }
    state.currentUser = null;
    state.padron      = [];
    state.votos       = {};
    state.onlineUsers = {};
    state.notifiedThresholds.clear();
    setStatus(false);
    showLogin();
}

// ═══════════════════════════════════════════════════════════════
//  PRESENCIA
// ═══════════════════════════════════════════════════════════════
async function iniciarPresencia() {
    if (!state.currentUser) return;
    await marcarOnline();
    state.presenceInterval = setInterval(marcarOnline, 25000);

    if (state.unsubPresencia) state.unsubPresencia();
    state.unsubPresencia = onSnapshot(collection(db, "presencia"), snap => {
        state.onlineUsers = {};
        const ahora = Date.now();
        snap.forEach(d => {
            const data     = d.data();
            const lastSeen = data.lastSeen?.toMillis?.() || 0;
            if (ahora - lastSeen < 90000) {
                state.onlineUsers[d.id] = data;
            }
        });
    }, err => console.warn("Presencia listener:", err));

    window.addEventListener("beforeunload", quitarPresencia);
}

async function marcarOnline() {
    if (!state.currentUser) return;
    try {
        await setDoc(doc(db, "presencia", state.currentUser.username.toLowerCase()), {
            username: state.currentUser.username,
            fullname: state.currentUser.fullname,
            isAdmin:  state.currentUser.isAdmin,
            lastSeen: serverTimestamp()
        });
    } catch (e) { console.warn("marcarOnline:", e); }
}

async function quitarPresencia() {
    if (!state.currentUser) return;
    try {
        await deleteDoc(doc(db, "presencia", state.currentUser.username.toLowerCase()));
    } catch { /**/ }
}

// ═══════════════════════════════════════════════════════════════
//  CARGA DE DATOS
// ═══════════════════════════════════════════════════════════════
async function loadPadronYEscuchar() {
    state.padron = [];

    try {
        const snap = await getDocs(collection(db, "padron_extra"));
        snap.forEach(d => {
            const v   = d.data();
            const ced = String(v.cedula || "").replace(/[\s\-]/g, "").replace(/^0+/, "");
            if (!state.padron.some(p => p.cedula === ced))
                state.padron.push({
                    id:        d.id,
                    nombre:    v.nombre    || "Sin nombre",
                    cedula:    ced,
                    domicilio: v.domicilio || "---",
                    local:     v.local     || "",
                    mesa:      v.mesa      || "",
                    orden:     v.orden     || "",
                });
        });
    } catch { /**/ }

    if (state.unsubVotos) state.unsubVotos();
    state.unsubVotos = onSnapshot(
        collection(db, "votos"),
        snap => {
            state.votos = {};
            snap.forEach(d => { state.votos[d.id] = d.data(); });
            setStatus(true);
            actualizarDashboard();
            checkNotificationThresholds();
        },
        err => { console.error(err); setStatus(false); }
    );

    if (state.currentUser?.isAdmin) {
        cargarUsuarios();
        escucharBitacora();
        cargarLocalesDesdePadron();
    }
}

const getVoto = c => state.votos[c]?.voto          || "Pendiente";
const getObs  = c => state.votos[c]?.observaciones || "";
const getLog  = c => state.votos[c]?.modificado_por || "---";

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD (métricas internas)
// ═══════════════════════════════════════════════════════════════
function actualizarDashboard() {
    renderTablaVotantes();
}

// ═══════════════════════════════════════════════════════════════
//  NOTIFICACIONES DE UMBRALES
// ═══════════════════════════════════════════════════════════════
function checkNotificationThresholds() {
    if (!state.currentUser?.isAdmin) return;
    const total = state.padron.length;
    if (!total) return;
    const voted = state.padron.filter(v => getVoto(v.cedula) === "Votó").length;
    const pct = (voted / total) * 100;
    [50, 75, 90].forEach(t => {
        if (pct >= t && !state.notifiedThresholds.has(t)) {
            state.notifiedThresholds.add(t);
            sendNotification(`🗳️ ${t}% de participación alcanzado`, `${voted} de ${total} votantes han votado.`);
        }
    });
}

function sendNotification(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        new Notification(title, { body, icon: "https://cdn-icons-png.flaticon.com/512/2099/2099190.png" });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(p => {
            if (p === "granted") new Notification(title, { body });
        });
    }
}

// ═══════════════════════════════════════════════════════════════
//  PAGINACIÓN
// ═══════════════════════════════════════════════════════════════
function renderPaginationControls(totalItems) {
    const totalPages = Math.ceil(totalItems / state.pagination.perPage) || 1;
    const container = document.getElementById("pagination-controls");
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    const { page } = state.pagination;
    let html = `<div class="pagination-bar">`;
    html += `<span class="pagination-info">Página <strong>${page}</strong> de ${totalPages} · ${totalItems} registros</span>`;
    html += `<div class="pagination-buttons">`;

    html += `<button class="btn-page ${page === 1 ? "disabled" : ""}" onclick="cambiarPagina(${page - 1})" ${page === 1 ? "disabled" : ""}>← Ant.</button>`;

    let startPage = Math.max(1, page - 2);
    let endPage   = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="btn-page ${i === page ? "active" : ""}" onclick="cambiarPagina(${i})">${i}</button>`;
    }

    html += `<button class="btn-page ${page === totalPages ? "disabled" : ""}" onclick="cambiarPagina(${page + 1})" ${page === totalPages ? "disabled" : ""}>Sig. →</button>`;
    html += `</div></div>`;

    container.innerHTML = html;
}

window.cambiarPagina = function(nuevaPagina) {
    state.pagination.page = nuevaPagina;
    renderTablaVotantes();
    const target = document.getElementById("cards-container") || document.querySelector(".tabla-desktop");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
};

// ═══════════════════════════════════════════════════════════════
//  TABLA/TARJETAS VOTANTES (con checkboxes, menú 3 puntos)
// ═══════════════════════════════════════════════════════════════
async function renderTablaVotantes() {
    if (state.isRendering) return;
    state.isRendering = true;
    mostrarLoadingEnTabla(true);

    await new Promise(r => setTimeout(r, 10));

    const searchHint = document.getElementById("search-hint");
    const q = state.searchQuery;

    const ordenEstado = v => {
        const voto = getVoto(v.cedula);
        if (voto === "Votó")    return 0;
        if (voto === "No Votó") return 1;
        return 2;
    };
    const compararLista = (a, b) => {
        const d = ordenEstado(a) - ordenEstado(b);
        if (d !== 0) return d;
        return (a.nombre || "").localeCompare(b.nombre || "", "es");
    };

    let lista;
    if (q && state.searchAllStates) {
        lista = state.padron.filter(v =>
            v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
        lista.sort(compararLista);
    } else if (state.currentFilter === "todos") {
        lista = [...state.padron];
        if (q) lista = lista.filter(v =>
            v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
        lista.sort(compararLista);
    } else {
        lista = state.padron.filter(v => getVoto(v.cedula) === state.currentFilter);
        if (q) lista = lista.filter(v =>
            v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
        lista.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
    }

    if (state.currentUser && !state.currentUser.isAdmin) {
        const asigLocal = (state.currentUser.local || "").trim().toLowerCase();
        if (asigLocal) {
            lista = lista.filter(v => (v.local || "").toLowerCase() === asigLocal);
        }
    }

    const totalItems = lista.length;
    const totalPages = Math.ceil(totalItems / state.pagination.perPage) || 1;
    if (state.pagination.page > totalPages) state.pagination.page = totalPages || 1;
    const start = (state.pagination.page - 1) * state.pagination.perPage;
    const end   = start + state.pagination.perPage;
    const paginatedList = lista.slice(start, end);

    const btnT = document.getElementById("btn-filter-todos");
    const btnP = document.getElementById("btn-filter-pending");
    const btnV = document.getElementById("btn-filter-voted");
    const btnN = document.getElementById("btn-filter-novoted");

    if (btnT && btnP && btnV && btnN) {
        [btnT, btnP, btnV, btnN].forEach(b => b.className = "filter-btn");
        if (state.currentFilter === "todos")     btnT.classList.add("f-todos");
        if (state.currentFilter === "Pendiente") btnP.classList.add("f-pending");
        if (state.currentFilter === "Votó")      btnV.classList.add("f-voted");
        if (state.currentFilter === "No Votó")   btnN.classList.add("f-novoted");
    }

    if (searchHint) {
        if (q && !state.searchAllStates && state.currentFilter !== "todos") {
            const totalMatch = state.padron.filter(v =>
                v.nombre.toLowerCase().includes(q) || v.cedula.includes(q)).length;
            const otros = totalMatch - lista.length;
            if (otros > 0) {
                searchHint.style.display = "flex";
                searchHint.innerHTML = `
                    <span class="material-icons" style="font-size:16px;">search</span>
                    <span>Se encontraron <strong>${otros}</strong> resultado${otros>1?"s":""} en otros estados.</span>
                    <button onclick="activarBusquedaGlobal()" class="btn-hint-global">Ver todos</button>`;
            } else {
                searchHint.style.display = "none";
            }
        } else if (q && state.searchAllStates) {
            searchHint.style.display = "flex";
            searchHint.innerHTML = `
                <span class="material-icons" style="font-size:16px;">search</span>
                <span>Mostrando resultados de <strong>todos los estados</strong>.</span>
                <button onclick="desactivarBusquedaGlobal()" class="btn-hint-volver">Volver al filtro</button>`;
        } else {
            searchHint.style.display = "none";
        }
    }

    // ── Tarjetas móviles ──
    const cardsContainer = document.getElementById("cards-container");
    if (cardsContainer) {
        if (!paginatedList.length) {
            cardsContainer.innerHTML = `
                <div class="empty-state">
                    <span class="material-icons" style="font-size:48px;opacity:.3;">inbox</span>
                    <strong>Sin resultados</strong>
                    No se encontraron registros para este criterio.
                </div>`;
        } else {
            const debeMostrarSecciones = (state.currentFilter === "todos" && !q && totalPages === 1);
            if (debeMostrarSecciones) {
                cardsContainer.innerHTML = construirCardsConSecciones(lista, true);
            } else {
                cardsContainer.innerHTML = paginatedList.map((v, idx) => construirTarjeta(v, start + idx)).join("");
            }
        }
    }

    // ── Tabla escritorio ──
    const tbody = document.getElementById("votantes-table-body");
    if (tbody) {
        if (!paginatedList.length) {
            tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:30px;">No se encontraron registros.</td></tr>`;
        } else {
            tbody.innerHTML = "";
            paginatedList.forEach((v, idx) => {
                const voto = getVoto(v.cedula);
                const obs  = getObs(v.cedula);
                const log  = getLog(v.cedula);

                let badgeClass = "badge badge-pending", badgeLabel = "Pendiente";
                if (voto === "Votó")    { badgeClass = "badge badge-voted";   badgeLabel = "Votó"; }
                if (voto === "No Votó") { badgeClass = "badge badge-novoted"; badgeLabel = "No Votó"; }

                const checked = selectedCedulas.has(v.cedula) ? "checked" : "";

                const tr = document.createElement("tr");
                tr.dataset.cedula = v.cedula;
                tr.innerHTML = `
                    <td><input type="checkbox" class="sel-checkbox" data-cedula="${v.cedula}" ${checked} onchange="handleCheckboxChange(this)"></td>
                    <td><strong>${start + idx + 1}</strong></td>
                    <td>${escHtml(v.nombre)}</td>
                    <td style="font-family:monospace">${v.cedula}</td>
                    <td style="font-size:.82rem;">${escHtml(v.local || "—")}</td>
                    <td style="font-size:.82rem;font-family:monospace;">${escHtml(v.mesa || "—")}</td>
                    <td style="font-size:.82rem;font-family:monospace;">${escHtml(v.orden || "—")}</td>
                    <td><span class="${badgeClass}">${badgeLabel}</span></td>
                    <td>
                        <div class="action-btns">
                            <button class="btn-accion ${voto==='Votó'?'sel-voto':''}" onclick="accionVoto('${v.cedula}','Votó')" title="Votó">
                                <span class="material-icons" style="font-size:18px;">check_circle</span>
                            </button>
                            <button class="btn-accion ${voto==='No Votó'?'sel-novoto':''}" onclick="accionVoto('${v.cedula}','No Votó')" title="No Votó">
                                <span class="material-icons" style="font-size:18px;">cancel</span>
                            </button>
                        </div>
                    </td>
                    <td>
                        <button class="btn-obs ${obs ? 'has-obs' : ''}" onclick="abrirModalObservacion('${v.cedula}', ${jsEscape(v.nombre)})">
                            <span class="material-icons" style="font-size:16px;">edit</span>
                            <span class="obs-preview">${obs ? escHtml(obs) : "Agregar obs..."}</span>
                        </button>
                    </td>
                    <td><span class="log-span">${escHtml(log)}</span></td>
                    <td>
                        <div class="menu-tres-puntos">
                            <button class="btn-puntos" onclick="toggleMenu(event, '${v.cedula}')">⋯</button>
                            <div class="dropdown" id="menu-${v.cedula}">
                                <a href="#" onclick="event.preventDefault(); abrirHistorial('${v.cedula}', ${jsEscape(v.nombre)})"><span class="material-icons">history</span> Historial</a>
                                <a href="#" onclick="event.preventDefault(); abrirModalObservacion('${v.cedula}', ${jsEscape(v.nombre)})"><span class="material-icons">edit</span> Observación</a>
                                <a href="#" onclick="event.preventDefault(); eliminarIndividual('${v.cedula}')"><span class="material-icons">delete</span> Eliminar</a>
                            </div>
                        </div>
                    </td>`;
                tbody.appendChild(tr);
            });
        }
    }

    // Actualizar checkbox maestro
    const master = document.getElementById("checkbox-todos");
    if (master) {
        master.checked = paginatedList.length > 0 && paginatedList.every(v => selectedCedulas.has(v.cedula));
    }

    renderPaginationControls(totalItems);
    actualizarBarraSeleccion();
    state.isRendering = false;
    mostrarLoadingEnTabla(false);
}

function mostrarLoadingEnTabla(show) {
    const cards = document.getElementById("cards-container");
    const tbody = document.getElementById("votantes-table-body");
    if (show) {
        if (cards && cards.children.length === 0) {
            cards.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span class="loading-text">Cargando...</span></div>`;
        }
        if (tbody && tbody.children.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        }
    }
}

function construirCardsConSecciones(lista, mostrarSecciones) {
    if (!mostrarSecciones) {
        return lista.map((v, idx) => construirTarjeta(v, idx)).join("");
    }

    const grupos = { "Votó": [], "No Votó": [], "Pendiente": [] };
    lista.forEach(v => {
        const estado = getVoto(v.cedula);
        if (grupos[estado]) grupos[estado].push(v);
    });

    let html = "";
    let contadorGlobal = 0;

    const renderGrupo = (titulo, items, claseSection, iconName) => {
        if (!items.length) return "";
        let h = `
            <div class="section-divider ${claseSection}">
                <span class="material-icons">${iconName}</span>
                ${titulo}
                <span class="sd-count">${items.length}</span>
            </div>`;
        items.forEach(v => {
            contadorGlobal++;
            h += construirTarjeta(v, contadorGlobal - 1);
        });
        return h;
    };

    html += renderGrupo("Votaron",    grupos["Votó"],     "sd-voted",   "check_circle");
    html += renderGrupo("No Votaron", grupos["No Votó"],  "sd-novoted", "cancel");
    html += renderGrupo("Pendientes", grupos["Pendiente"], "sd-pending", "schedule");
    return html;
}

function construirTarjeta(v, idx) {
    const voto = getVoto(v.cedula);
    const obs  = getObs(v.cedula);
    const log  = getLog(v.cedula);

    let badgeClass = "badge badge-pending", badgeLabel = "Pendiente";
    if (voto === "Votó")    { badgeClass = "badge badge-voted";   badgeLabel = "Votó"; }
    if (voto === "No Votó") { badgeClass = "badge badge-novoted"; badgeLabel = "No Votó"; }

    const estadoClass = voto === "Votó" ? "estado-voto" : voto === "No Votó" ? "estado-novoto" : "";
    const obsLabel    = obs ? escHtml(obs) : "Agregar observación...";
    const obsClass    = obs ? "btn-obs has-obs" : "btn-obs";
    const checked = selectedCedulas.has(v.cedula) ? "checked" : "";

    return `
        <div class="card-votante ${estadoClass}" data-cedula="${escHtml(v.cedula)}">
            <div class="card-top">
                <div class="card-info">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" class="sel-checkbox" data-cedula="${v.cedula}" ${checked} onchange="handleCheckboxChange(this)" onclick="event.stopPropagation()">
                        <div class="card-num">${idx+1}.</div>
                    </div>
                    <div class="card-nombre" title="${escHtml(v.nombre)}">${escHtml(v.nombre)}</div>
                    <div class="card-cedula">CI: ${escHtml(v.cedula)}</div>
                    ${v.local  ? `<div class="card-domicilio" style="font-size:.74rem;">📍 ${escHtml(v.local)}</div>` : ""}
                    ${v.mesa   ? `<div class="card-domicilio" style="font-size:.74rem;">🗳️ Mesa <strong>${escHtml(v.mesa)}</strong>${v.orden ? " · Orden " + escHtml(v.orden) : ""}</div>` : ""}
                </div>
                <span class="${badgeClass}">${badgeLabel}</span>
            </div>
            <div class="action-btns">
                <button class="btn-accion ${voto==='Votó'?'sel-voto':''}" onclick="accionVoto('${v.cedula}','Votó')">
                    <span class="material-icons" style="font-size:18px;">check_circle</span>
                    ${voto === "Votó" ? "Quitar" : "Votó"}
                </button>
                <button class="btn-accion ${voto==='No Votó'?'sel-novoto':''}" onclick="accionVoto('${v.cedula}','No Votó')">
                    <span class="material-icons" style="font-size:18px;">cancel</span>
                    ${voto === "No Votó" ? "Quitar" : "No Votó"}
                </button>
            </div>
            <button class="${obsClass}" onclick="abrirModalObservacion('${v.cedula}', ${jsEscape(v.nombre)})">
                <span class="material-icons" style="font-size:16px;">edit</span>
                <span class="obs-preview">${obsLabel}</span>
            </button>
            ${log !== "---" ? `<div class="card-log">${escHtml(log)}</div>` : ""}
            <div class="menu-tres-puntos" style="margin-top:8px;text-align:right;">
                <button class="btn-puntos" onclick="toggleMenu(event, '${v.cedula}')">⋯</button>
                <div class="dropdown" id="menu-${v.cedula}">
                    <a href="#" onclick="event.preventDefault(); abrirHistorial('${v.cedula}', ${jsEscape(v.nombre)})"><span class="material-icons">history</span> Historial</a>
                    <a href="#" onclick="event.preventDefault(); abrirModalObservacion('${v.cedula}', ${jsEscape(v.nombre)})"><span class="material-icons">edit</span> Observación</a>
                    <a href="#" onclick="event.preventDefault(); eliminarIndividual('${v.cedula}')"><span class="material-icons">delete</span> Eliminar</a>
                </div>
            </div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  CHECKBOXES Y SELECCIÓN MÚLTIPLE
// ═══════════════════════════════════════════════════════════════
window.handleCheckboxChange = function(checkbox) {
    const cedula = checkbox.dataset.cedula;
    if (checkbox.checked) selectedCedulas.add(cedula);
    else selectedCedulas.delete(cedula);
    actualizarBarraSeleccion();
    const master = document.getElementById("checkbox-todos");
    if (master) {
        const allCheckboxes = document.querySelectorAll('.sel-checkbox');
        master.checked = allCheckboxes.length > 0 && [...allCheckboxes].every(cb => cb.checked);
    }
};

window.toggleTodosCheckbox = function() {
    const master = document.getElementById("checkbox-todos");
    const checkboxes = document.querySelectorAll(".sel-checkbox");
    checkboxes.forEach(cb => {
        cb.checked = master.checked;
        if (master.checked) selectedCedulas.add(cb.dataset.cedula);
        else selectedCedulas.delete(cb.dataset.cedula);
    });
    actualizarBarraSeleccion();
};

window.seleccionarTodosCheckbox = function() {
    document.querySelectorAll(".sel-checkbox").forEach(cb => { cb.checked = true; selectedCedulas.add(cb.dataset.cedula); });
    const master = document.getElementById("checkbox-todos");
    if (master) master.checked = true;
    actualizarBarraSeleccion();
};

window.deseleccionarTodos = function() {
    document.querySelectorAll(".sel-checkbox").forEach(cb => { cb.checked = false; });
    selectedCedulas.clear();
    const master = document.getElementById("checkbox-todos");
    if (master) master.checked = false;
    actualizarBarraSeleccion();
};

function actualizarBarraSeleccion() {
    const barra = document.getElementById("barra-seleccion");
    const contador = document.getElementById("contador-seleccion");
    if (!barra) return;
    const count = selectedCedulas.size;
    if (count > 0) {
        barra.style.display = "flex";
        if (contador) contador.textContent = `${count} seleccionado${count>1?'s':''}`;
    } else {
        barra.style.display = "none";
    }
}

// ═══════════════════════════════════════════════════════════════
//  MENÚ DE 3 PUNTOS (CORREGIDO)
// ═══════════════════════════════════════════════════════════════
window.toggleMenu = function(event, cedula) {
    event.stopPropagation();
    event.preventDefault();

    // Cerrar todos los demás menús
    document.querySelectorAll('.menu-tres-puntos .dropdown.show').forEach(d => {
        if (d.id !== `menu-${cedula}`) d.classList.remove('show');
    });

    const menu = document.getElementById(`menu-${cedula}`);
    if (menu) menu.classList.toggle('show');
};

// ═══════════════════════════════════════════════════════════════
//  ELIMINACIÓN INDIVIDUAL (desde menú)
// ═══════════════════════════════════════════════════════════════
window.eliminarIndividual = async function(cedula) {
    if (!state.currentUser?.isAdmin) {
        toast("Solo el administrador puede eliminar registros.", "error");
        return;
    }
    if (!confirm(`¿Eliminar definitivamente al votante CI ${cedula}?`)) return;
    try {
        await deleteDoc(doc(db, "padron_extra", cedula));
        await deleteDoc(doc(db, "votos", cedula));
        state.padron = state.padron.filter(p => p.cedula !== cedula);
        delete state.votos[cedula];
        selectedCedulas.delete(cedula);
        toast("Registro eliminado.", "ok");
        registrarBitacora("Eliminar Votante", `Eliminó CI ${cedula}`);
        actualizarDashboard();
        renderTablaVotantes();
    } catch (e) {
        toast("Error al eliminar. Verificá la conexión.", "error");
    }
};

// ═══════════════════════════════════════════════════════════════
//  ELIMINACIÓN MÚLTIPLE (desde barra de selección)
// ═══════════════════════════════════════════════════════════════
window.pedirConfirmacionEliminar = function() {
    if (selectedCedulas.size === 0) return;
    if (!state.currentUser?.isAdmin) {
        toast("Solo el administrador puede eliminar registros.", "error");
        return;
    }
    const n = selectedCedulas.size;
    const txt = document.getElementById("modal-eliminar-texto");
    if (txt) txt.textContent = `¿Estás seguro que querés eliminar ${n} registro${n > 1 ? "s" : ""} de la planilla? Esta acción no se puede deshacer.`;
    abrirModal("modal-eliminar-confirm");
};

window.confirmarEliminarSeleccionados = async function() {
    if (!state.currentUser?.isAdmin || selectedCedulas.size === 0) return;
    cerrarModal("modal-eliminar-confirm");

    const cedulas = [...selectedCedulas];
    let ok = 0, err = 0;

    for (const cedula of cedulas) {
        try {
            await deleteDoc(doc(db, "padron_extra", cedula));
            await deleteDoc(doc(db, "votos", cedula));
            state.padron = state.padron.filter(p => p.cedula !== cedula);
            delete state.votos[cedula];
            ok++;
        } catch (e) { console.error("Error eliminando", cedula, e); err++; }
    }

    await registrarBitacora("Eliminar Votantes",
        `Admin eliminó ${ok} votante${ok > 1 ? "s" : ""}. Cédulas: ${cedulas.join(", ")}`);

    selectedCedulas.clear();
    const master = document.getElementById("checkbox-todos");
    if (master) master.checked = false;
    actualizarBarraSeleccion();
    actualizarDashboard();
    renderTablaVotantes();

    toast(err === 0
        ? `✔ ${ok} registro${ok > 1 ? "s eliminados" : " eliminado"} correctamente.`
        : `⚠ ${ok} eliminados, ${err} con error.`,
        err === 0 ? "ok" : "warn");
};

// ═══════════════════════════════════════════════════════════════
//  HISTORIAL DE CAMBIOS
// ═══════════════════════════════════════════════════════════════
window.abrirHistorial = async function(cedula, nombre) {
    document.getElementById("modal-hist-nombre").textContent = `${nombre} (CI: ${cedula})`;
    const list = document.getElementById("modal-hist-list");
    list.innerHTML = `<div style="text-align:center;padding:20px;"><div class="spinner" style="margin:0 auto 10px;"></div>Cargando historial...</div>`;
    abrirModal("modal-historial");

    try {
        const qRef = query(collection(db, "votos", cedula, "historial"), orderBy("timestamp", "desc"), limit(30));
        const snap = await getDocs(qRef);
        if (snap.empty) {
            list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--color-gray);font-size:.9rem;">Sin cambios registrados.</div>`;
            return;
        }
        let html = "";
        snap.forEach(d => {
            const h = d.data();
            const hora = h.hora_py || timestampAParaguay(h.timestamp);
            html += `
                <div class="historial-item">
                    <div class="historial-time">${hora}</div>
                    <div class="historial-body">
                        <div class="historial-accion">${escHtml(h.accion || "Cambio")}</div>
                        <div class="historial-meta">por ${escHtml(h.operador || "---")}${h.detalle ? " · " + escHtml(h.detalle) : ""}</div>
                    </div>
                </div>`;
        });
        list.innerHTML = html;
    } catch (e) {
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--color-danger);">Error al cargar historial.</div>`;
    }
};

// ═══════════════════════════════════════════════════════════════
//  ACCIONES DE VOTO
// ═══════════════════════════════════════════════════════════════
window.accionVoto = function(cedula, accion) {
    const actual = getVoto(cedula);
    const v      = state.padron.find(p => p.cedula === cedula);
    const nombre = v?.nombre || cedula;

    if (actual === "Votó" && accion === "Votó") {
        guardarVoto(cedula, "Pendiente", "", "Quitar Voto", `Quitó VOTO de ${nombre}`, actual, "Pendiente");
        return;
    }
    if (actual === "No Votó" && accion === "No Votó") {
        guardarVoto(cedula, "Pendiente", "", "Quitar No Votó", `Quitó NO VOTÓ de ${nombre}`, actual, "Pendiente");
        return;
    }

    if (accion === "No Votó") {
        state.pendingNoVoto = { cedula, nombre };
        document.getElementById("modal-novoto-name").textContent = nombre;
        document.getElementById("modal-obs-input").value = getObs(cedula);
        abrirModal("modal-novoto");
    } else {
        guardarVoto(cedula, "Votó", "", "Votó", `Registró a ${nombre} como VOTÓ`, actual, "Votó");
    }
};

window.confirmNoVoto = function() {
    if (!state.pendingNoVoto) return;
    const { cedula, nombre } = state.pendingNoVoto;
    const obs = document.getElementById("modal-obs-input").value.trim();
    guardarVoto(cedula, "No Votó", obs, "No Votó",
        `Registró a ${nombre} como NO VOTÓ${obs ? " — " + obs : ""}`, "Pendiente", "No Votó");
    cerrarModal("modal-novoto");
    state.pendingNoVoto = null;
};

async function guardarVoto(cedula, voto, observaciones, accionBit, detalleBit, estadoAnterior, estadoNuevo) {
    const operador = state.currentUser.isAdmin ? "Administrador/a" : state.currentUser.username;
    const hora     = ahoraParaguay();
    const modPor   = `${operador} — ${hora}`;

    const payload = {
        voto, observaciones,
        modificado_por: modPor,
        timestamp:      serverTimestamp()
    };

    const histPayload = {
        accion: accionBit,
        detalle: detalleBit,
        operador: state.currentUser.fullname || operador,
        hora_py: hora,
        estadoAnterior: estadoAnterior || "Pendiente",
        estadoNuevo: estadoNuevo || voto,
        timestamp: serverTimestamp()
    };

    if (!navigator.onLine) {
        addOfflineAction({ cedula, voto, observaciones, modificado_por: modPor, historial: histPayload });
        toast("Sin conexión. Acción guardada para sincronizar.", "warn");
        state.votos[cedula] = { ...payload, timestamp: { toDate: () => new Date() } };
        actualizarDashboard();
        await registrarBitacora(accionBit, detalleBit + " (OFFLINE)");
        return;
    }

    try {
        await setDoc(doc(db, "votos", cedula), payload);
        await addDoc(collection(db, "votos", cedula, "historial"), histPayload);
        if      (voto === "Votó")    toast("✔ ¡Voto registrado correctamente!", "ok");
        else if (voto === "No Votó") toast("✔ Registrado como No Votó.", "ok");
        else                         toast("Registro vuelto a Pendiente.", "warn");
        await registrarBitacora(accionBit, detalleBit);
    } catch (err) {
        console.error(err);
        toast("Error al guardar. Verificá la conexión.", "error");
    }
}

// ═══════════════════════════════════════════════════════════════
//  OBSERVACIONES — modal
// ═══════════════════════════════════════════════════════════════
let _obsPendiente = null;

window.abrirModalObservacion = function(cedula, nombre) {
    const obsActual = getObs(cedula);
    _obsPendiente = { cedula, nombre, anterior: obsActual };

    const textoEl  = document.getElementById("modal-obs-texto");
    const nombreEl = document.getElementById("modal-obs-nombre");

    if (nombreEl) nombreEl.textContent = `Votante: ${nombre}`;
    if (textoEl)  {
        textoEl.value = obsActual;
        setTimeout(() => {
            textoEl.focus();
            textoEl.setSelectionRange(textoEl.value.length, textoEl.value.length);
        }, 150);
    }

    abrirModal("modal-obs-confirm");
};

window.confirmarObservacion = async function() {
    if (!_obsPendiente) return;
    const { cedula, nombre } = _obsPendiente;
    const texto = (document.getElementById("modal-obs-texto")?.value || "").trim();
    cerrarModal("modal-obs-confirm");
    await actualizarObservacion(cedula, texto, nombre);
    _obsPendiente = null;
};

window.cancelarObservacion = function() {
    _obsPendiente = null;
    cerrarModal("modal-obs-confirm");
};

window.actualizarObservacion = async function(cedula, texto, nombre) {
    const actual   = state.votos[cedula] || {};
    const operador = state.currentUser.isAdmin ? "Administrador/a" : state.currentUser.username;
    const hora     = ahoraParaguay();
    const v        = state.padron.find(p => p.cedula === cedula);
    try {
        await setDoc(doc(db, "votos", cedula), {
            voto:           actual.voto || "Pendiente",
            observaciones:  texto,
            modificado_por: `${operador} — ${hora}`,
            timestamp:      serverTimestamp()
        });
        toast("✔ Observación guardada.", "ok");
        await registrarBitacora("Observación",
            `Actualizó obs. de ${v?.nombre || nombre || cedula}: "${texto.substring(0,60)}"`);
    } catch {
        toast("Error al guardar observación.", "error");
    }
};

// ═══════════════════════════════════════════════════════════════
//  ADMIN: OPERADORES
// ═══════════════════════════════════════════════════════════════
async function cargarUsuarios() {
    try {
        const snap = await getDocs(collection(db, "usuarios"));
        state.usuarios = [];
        snap.forEach(d => state.usuarios.push(d.data()));
        renderTablaUsuarios();
    } catch (err) { console.error(err); }
}

async function handleRegistrarUsuario(e) {
    e.preventDefault();
    const fullname = document.getElementById("reg-fullname").value.trim();
    const phone    = document.getElementById("reg-phone").value.trim();
    const username = document.getElementById("reg-username").value.trim().toLowerCase();
    const password = document.getElementById("reg-password").value;
    const local    = (document.getElementById("reg-local-value")?.value || "").trim();

    if (!local) { toast("Seleccioná un local para el operador.", "error"); return; }
    if (username === ADMIN_USER_ID) { toast("Ese nombre de usuario está reservado.", "error"); return; }

    try {
        const existe = await getDoc(doc(db, "usuarios", username));
        if (existe.exists()) { toast("El nombre de usuario ya existe.", "error"); return; }
        const passwordHash = await sha256(password);
        await setDoc(doc(db, "usuarios", username), { username, fullname, phone, passwordHash, isAdmin: false, local });
        toast(`✔ Operador "${fullname}" creado correctamente.`);
        await registrarBitacora("Nuevo Operador", `Creó operador ${fullname} (${username})`);
        document.getElementById("register-user-form").reset();
        cargarLocalesDesdePadron();
        cargarUsuarios();
    } catch (err) { console.error(err); toast("Error al crear el usuario.", "error"); }
}

window.deleteUser = async function(username) {
    if (!confirm(`¿Eliminar al operador "${username}"?`)) return;
    const u = state.usuarios.find(x => x.username === username);
    try {
        await deleteDoc(doc(db, "usuarios", username));
        toast(`Operador "${username}" eliminado.`, "warn");
        await registrarBitacora("Eliminar Operador", `Eliminó operador ${u?.fullname || username}`);
        cargarUsuarios();
    } catch { toast("Error al eliminar el operador.", "error"); }
};

function renderTablaUsuarios() {
    const tbody = document.getElementById("users-table-body");
    tbody.innerHTML = "";
    if (!state.usuarios.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No hay operadores registrados.</td></tr>`;
        return;
    }
    state.usuarios.forEach(u => {
        const phoneRaw   = (u.phone || "").replace(/[\s\-\+]/g, "");
        const phoneClean = phoneRaw.startsWith("0") ? "595" + phoneRaw.slice(1) : phoneRaw;
        const waLink     = phoneClean ? `https://wa.me/${phoneClean}` : null;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${escHtml(u.fullname)}</td>
            <td>${waLink ? `<a href="${waLink}" target="_blank" class="wa-link"><span class="material-icons" style="font-size:16px;">phone</span> ${escHtml(u.phone)}</a>` : escHtml(u.phone || "---")}</td>
            <td><code>${escHtml(u.username)}</code></td>
            <td>${escHtml(u.local || "—")}</td>
            <td>
                <button class="btn-secondary" onclick="abrirCambiarPassword('${escHtml(u.username)}')"><span class="material-icons">lock</span> Clave</button>
                <button class="btn-icon-danger" onclick="deleteUser('${escHtml(u.username)}')"><span class="material-icons">delete</span> Eliminar</button>
            </td>`;
        tbody.appendChild(tr);
    });
}

// ═══════════════════════════════════════════════════════════════
//  LOCALES CONFIG (Gimnasio con ícono stadium)
// ═══════════════════════════════════════════════════════════════
const LOCALES_CONFIG = {
    "GIMNASIO MUNICIPAL":                   { mesaMin: 1,  mesaMax: 20, color: "#B91C1C", colorSoft: "#FCA5A5", icon: "stadium" },
    "COLEGIO NACIONAL SEBASTIAN DE YEGROS": { mesaMin: 21, mesaMax: 40, color: "#1E40AF", colorSoft: "#93C5FD", icon: "school" },
    "ESC.CARLOS ANTONIO LOPEZ":             { mesaMin: 41, mesaMax: 65, color: "#15803D", colorSoft: "#86EFAC", icon: "local_library" }
};

function getColorLocal(local) { return (LOCALES_CONFIG[local] && LOCALES_CONFIG[local].color) || "#9CA3AF"; }
function getColorLocalSoft(local) { return (LOCALES_CONFIG[local] && LOCALES_CONFIG[local].colorSoft) || "#D1D5DB"; }
function determinarLocal(votante) {
    const numMesa = parseInt(String(votante.mesa || "").replace(/\D/g, '')) || 0;
    for (const [local, config] of Object.entries(LOCALES_CONFIG)) {
        if (numMesa >= config.mesaMin && numMesa <= config.mesaMax) return local;
    }
    return "OTRO";
}

async function cargarLocalesDesdePadron() {
    const picker = document.getElementById("reg-local-picker");
    const hidden = document.getElementById("reg-local-value");
    if (picker) {
        picker.innerHTML = "";
        Object.entries(LOCALES_CONFIG).forEach(([loc, conf]) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "local-picker-btn";
            btn.dataset.local = loc;
            btn.style.setProperty("--lc", conf.color);
            btn.style.setProperty("--ls", conf.colorSoft);
            btn.innerHTML = `<span class="material-icons" style="color:${conf.color};">${conf.icon}</span><span>${loc}</span><span class="lp-mesas">M${conf.mesaMin}–${conf.mesaMax}</span>`;
            btn.onclick = () => {
                picker.querySelectorAll(".local-picker-btn").forEach(b => b.classList.remove("selected"));
                btn.classList.add("selected");
                btn.style.background = conf.color + "18";
                btn.style.borderColor = conf.color;
                if (hidden) hidden.value = loc;
            };
            picker.appendChild(btn);
        });
    }
    if (hidden) hidden.value = "";
}

// ═══════════════════════════════════════════════════════════════
//  ESTADÍSTICAS (mesas completas)
// ═══════════════════════════════════════════════════════════════
let currentStatsView = "locales";
let currentLocalForMesas = null;

const doughnutLabelsPlugin = {
    id: 'doughnutLabels',
    afterDraw(chart) {
        const { ctx, data } = chart;
        const dataset = data.datasets[0];
        const total = dataset.data.reduce((a, b) => a + b, 0);
        if (!total) return;
        const meta = chart.getDatasetMeta(0);
        meta.data.forEach((arc, i) => {
            const value = dataset.data[i];
            if (!value) return;
            const pct = ((value / total) * 100).toFixed(1) + '%';
            const radius = (arc.outerRadius + arc.innerRadius) / 2;
            const angle = (arc.startAngle + arc.endAngle) / 2;
            const x = arc.x + radius * Math.cos(angle);
            const y = arc.y + radius * Math.sin(angle);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Inter, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = 4;
            ctx.fillText(pct, x, y);
            ctx.shadowBlur = 0;
        });
    }
};

function renderLocalesSummary() {
    const container = document.getElementById("locales-summary");
    if (!container) return;
    container.innerHTML = "";

    const todos = [...Object.keys(LOCALES_CONFIG), "OTRO"];
    todos.forEach(local => {
        const conf = LOCALES_CONFIG[local];
        let total = 0, voted = 0;
        state.padron.forEach(v => {
            if (determinarLocal(v) !== local) return;
            total++;
            if (getVoto(v.cedula) === "Votó") voted++;
        });
        if (total === 0 && local === "OTRO") return;

        const pct = total ? Math.round((voted/total)*100) : 0;
        const color = getColorLocal(local);
        const colorSoft = getColorLocalSoft(local);
        const icon  = (conf && conf.icon) || "grid_view";

        const card = document.createElement("div");
        card.className = "local-card";
        card.style.borderLeftColor = color;
        card.innerHTML = `
            <div class="local-card-name" style="color:${color}"><span class="material-icons">${icon}</span>${local}</div>
            <div class="local-card-num" style="color:${color}">${voted}<span style="font-size:.85rem;color:var(--color-gray);"> / ${total}</span></div>
            <div class="local-card-meta">${conf ? `Mesas ${conf.mesaMin}–${conf.mesaMax}` : "Sin asignar"}</div>
            <div class="local-card-bar"><div class="local-card-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${color},${colorSoft})"></div></div>
            <div class="local-card-pct" style="color:${color}">${pct}% de participación</div>
        `;
        if (local !== "OTRO") {
            card.addEventListener("click", () => {
                currentStatsView = "mesas";
                currentLocalForMesas = local;
                renderStatsCharts();
            });
        }
        container.appendChild(card);
    });
}

function renderStatsCharts() {
    renderLocalesSummary();

    if (!state.padron.length) return;

    const titleEl   = document.getElementById("bar-chart-title");
    const btnVolver = document.getElementById("btn-volver-locales");
    const hintEl    = document.getElementById("chart-hint");
    const mesaWrap  = document.getElementById("chart-mesa-wrap");

    if (currentStatsView === "mesas" && currentLocalForMesas) {
        const conf = LOCALES_CONFIG[currentLocalForMesas];
        const colorLocal = getColorLocal(currentLocalForMesas);
        if (titleEl) titleEl.textContent = `Votos por mesa — ${currentLocalForMesas}`;
        if (btnVolver) btnVolver.classList.remove("hidden");
        if (hintEl) hintEl.style.display = "none";
        if (mesaWrap) mesaWrap.style.display = "";

        if (conf) {
            const mesas = {};
            for (let m = conf.mesaMin; m <= conf.mesaMax; m++) mesas[m] = { voted:0, noVoted:0, pending:0, total:0 };
            state.padron.forEach(v => {
                if (determinarLocal(v) !== currentLocalForMesas) return;
                const numMesa = parseInt(String(v.mesa || "").replace(/\D/g, '')) || 0;
                if (mesas[numMesa] === undefined) return;
                mesas[numMesa].total++;
                const estado = getVoto(v.cedula);
                if (estado === "Votó") mesas[numMesa].voted++;
                else if (estado === "No Votó") mesas[numMesa].noVoted++;
                else mesas[numMesa].pending++;
            });

            const mesasActivas = Object.entries(mesas).map(([m, d]) => ({ mesa: m, ...d }));
            const labels = mesasActivas.map(d => `M${d.mesa}`);
            const dataVoted = mesasActivas.map(d => d.voted);

            const ctxMesa = document.getElementById("chart-mesa");
            if (ctxMesa) {
                if (state.charts.mesa) state.charts.mesa.destroy();
                state.charts.mesa = new Chart(ctxMesa, {
                    type: "bar",
                    data: {
                        labels,
                        datasets: [{
                            label: "Votaron",
                            data: dataVoted,
                            backgroundColor: colorLocal + "cc",
                            borderColor: colorLocal,
                            borderWidth: 1.5,
                            borderRadius: 5,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { grid: { display: false } },
                            y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } }
                        }
                    }
                });
            }
            _renderTablaMesas(mesasActivas, colorLocal);
        }
    } else {
        if (titleEl) titleEl.textContent = "Tocá una tarjeta para ver votos por mesa";
        if (btnVolver) btnVolver.classList.add("hidden");
        if (hintEl) hintEl.style.display = "";
        if (mesaWrap) mesaWrap.style.display = "none";
    }

    // Gráfico global
    const total = state.padron.length;
    const voted = state.padron.filter(v => getVoto(v.cedula)==="Votó").length;
    const noVoted = state.padron.filter(v => getVoto(v.cedula)==="No Votó").length;
    const pending = total - voted - noVoted;
    const ctxGlobal = document.getElementById("chart-global");
    if (ctxGlobal) {
        if (state.charts.global) state.charts.global.destroy();
        state.charts.global = new Chart(ctxGlobal, {
            type: "doughnut",
            plugins: [doughnutLabelsPlugin],
            data: {
                labels: ["Votaron","No Votaron","Pendientes"],
                datasets: [{ data: [voted, noVoted, pending], backgroundColor: ["#15803D","#B91C1C","#9CA3AF"], borderColor: "#fff", borderWidth: 3 }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
}

function _renderTablaMesas(mesasActivas, colorLocal) {
    const tablaWrap = document.getElementById("mesa-tabla-wrap");
    if (!tablaWrap) return;
    let totalV = 0, totalNV = 0, totalP = 0, totalT = 0;
    mesasActivas.forEach(d => { totalV += d.voted; totalNV += d.noVoted; totalP += d.pending; totalT += d.total; });
    const rows = mesasActivas.map(d => {
        const pct = d.total ? ((d.voted/d.total)*100).toFixed(1) : "0.0";
        return `<tr><td><strong>M${d.mesa}</strong></td><td>${d.total}</td><td style="color:#15803D;">${d.voted}</td><td style="color:#B91C1C;">${d.noVoted}</td><td>${d.pending}</td><td>${pct}%</td></tr>`;
    }).join("");
    tablaWrap.innerHTML = `<table><thead><tr><th>Mesa</th><th>Insc.</th><th>Votaron</th><th>No Vot.</th><th>Pend.</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>`;
}

window.volverALocales = function() {
    currentStatsView = "locales";
    currentLocalForMesas = null;
    renderStatsCharts();
};

// ═══════════════════════════════════════════════════════════════
//  MODALES
// ═══════════════════════════════════════════════════════════════
function abrirModal(id) { document.getElementById(id)?.classList.add("active"); }
function cerrarModal(id) { document.getElementById(id)?.classList.remove("active"); state.pendingNoVoto = null; }
window.closeModal = cerrarModal;

// ═══════════════════════════════════════════════════════════════
//  TOASTS
// ═══════════════════════════════════════════════════════════════
function toast(msg, tipo = "ok") {
    const el = document.createElement("div");
    el.className = tipo === "error" ? "toast error" : tipo === "warn" ? "toast warn" : tipo === "offline" ? "toast offline" : "toast";
    el.textContent = msg;
    document.getElementById("toast-container").appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0"; el.style.transform = "translateY(20px)"; el.style.transition = "all .3s ease";
        setTimeout(() => el.remove(), 320);
    }, 3200);
}

// ═══════════════════════════════════════════════════════════════
//  STATUS DOT
// ═══════════════════════════════════════════════════════════════
function setStatus(online) {
    const dot = document.getElementById("status-dot"), label = document.getElementById("status-label");
    if (dot) dot.className = "status-dot" + (online ? " online" : "");
    if (label) label.textContent = online ? "en línea" : "sin conexión";
}

// ═══════════════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════════════
function escHtml(str) { return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function jsEscape(str) { return JSON.stringify(String(str ?? "")).replace(/"/g,"&quot;"); }
function debounce(fn, ms=300) { let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); }; }

// ═══════════════════════════════════════════════════════════════
//  EXPORTAR XLSX
// ═══════════════════════════════════════════════════════════════
window.exportarXLSX = function() {
    const filas = [["N°","Nombre","Cédula","Domicilio","Local","Mesa","Orden","Estado","Operador","Observación"]];
    state.padron.forEach((v,i)=> filas.push([i+1,v.nombre,v.cedula,v.domicilio||"",v.local||"",v.mesa||"",v.orden||"",getVoto(v.cedula),getLog(v.cedula),getObs(v.cedula)]));
    const ws = XLSX.utils.aoa_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planilla");
    XLSX.writeFile(wb, `planilla-electoral-${Date.now()}.xlsx`);
    toast("✔ Planilla exportada.", "ok");
};

// ═══════════════════════════════════════════════════════════════
//  CAMBIAR CONTRASEÑA
// ═══════════════════════════════════════════════════════════════
window.abrirCambiarPassword = function(username) {
    const u = state.usuarios.find(x => x.username === username);
    document.getElementById("chpass-username").value = username;
    document.getElementById("chpass-nueva").value = "";
    document.getElementById("chpass-confirmar").value = "";
    document.getElementById("chpass-error").textContent = "";
    const lbl = document.getElementById("chpass-user-label");
    if (lbl) lbl.textContent = u?.fullname ? `${u.fullname} (${username})` : username;
    abrirModal("modal-chpass");
};
window.confirmarCambiarPassword = async function() {
    const username = document.getElementById("chpass-username").value;
    const nueva = document.getElementById("chpass-nueva").value;
    const confirmar = document.getElementById("chpass-confirmar").value;
    const errEl = document.getElementById("chpass-error");
    errEl.textContent = "";
    if (nueva.length < 4) { errEl.textContent = "La contraseña debe tener al menos 4 caracteres."; return; }
    if (nueva !== confirmar) { errEl.textContent = "Las contraseñas no coinciden."; return; }
    try {
        const passwordHash = await sha256(nueva);
        const ref = doc(db, "usuarios", username);
        const snap = await getDoc(ref);
        if (!snap.exists()) { errEl.textContent = "Operador no encontrado."; return; }
        const u = snap.data();
        await setDoc(ref, { ...u, passwordHash, password: null }, { merge: true });
        toast(`✔ Contraseña de "${username}" actualizada.`, "ok");
        cerrarModal("modal-chpass");
    } catch (err) { errEl.textContent = "Error al guardar."; }
};

// ═══════════════════════════════════════════════════════════════
//  BIND EVENTOS
// ═══════════════════════════════════════════════════════════════
function bindEvents() {
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("logout-btn").addEventListener("click", handleLogout);

    document.getElementById("btn-filter-todos").addEventListener("click", ()=> cambiarFiltro("todos"));
    document.getElementById("btn-filter-pending").addEventListener("click", ()=> cambiarFiltro("Pendiente"));
    document.getElementById("btn-filter-voted").addEventListener("click", ()=> cambiarFiltro("Votó"));
    document.getElementById("btn-filter-novoted").addEventListener("click", ()=> cambiarFiltro("No Votó"));

    document.getElementById("tab-planilla").addEventListener("click", ()=> switchTab("planilla"));
    document.getElementById("tab-stats").addEventListener("click", ()=> switchTab("stats"));
    document.getElementById("tab-admin").addEventListener("click", ()=> switchTab("admin"));
    document.getElementById("tab-padron-anr").addEventListener("click", ()=> switchTab("padron-anr"));

    document.getElementById("register-user-form").addEventListener("submit", handleRegistrarUsuario);

    ["modal-novoto","modal-chpass","modal-obs-confirm","modal-historial"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("click", function(e) { if (e.target === this) cerrarModal(id); });
    });

    const runSearch = debounce((val) => { state.searchQuery = val; if(!val) state.searchAllStates=false; state.pagination.page=1; renderTablaVotantes(); }, 300);
    document.getElementById("search-input").addEventListener("input", e => runSearch(e.target.value.toLowerCase().trim()));

    document.getElementById("padron-anr-input")?.addEventListener("keydown", e => { if(e.key==="Enter") buscarPadronANR(); });

    // Barra de navegación inferior
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

// ═══════════════════════════════════════════════════════════════
//  PADRÓN ANR
// ═══════════════════════════════════════════════════════════════
let _padronCache = null;
async function cargarPadronCSV() {
    if (_padronCache) return _padronCache;
    const resp = await fetch("data/padron_san_estanislao_2026_completo.csv");
    if (!resp.ok) throw new Error("No se pudo cargar el padrón CSV.");
    const texto = await resp.text();
    const lineas = texto.split("\n").filter(l => l.trim() !== "");
    const headers = lineas[0].split(",").map(h => h.trim().replace(/^\uFEFF/, ""));
    _padronCache = lineas.slice(1).map(linea => {
        const cols = []; let actual = "", enComilla = false;
        for (const ch of linea) {
            if (ch === '"') enComilla = !enComilla;
            else if (ch === "," && !enComilla) { cols.push(actual.trim()); actual = ""; }
            else actual += ch;
        }
        cols.push(actual.trim());
        const obj = {};
        headers.forEach((h,i) => { obj[h] = cols[i] ?? ""; });
        return obj;
    });
    return _padronCache;
}

window.buscarPadronANR = async function() {
    const input = document.getElementById("padron-anr-input");
    const cedula = input ? input.value.trim().replace(/\D/g, "") : "";
    if (!cedula || cedula.length < 3) return;
    const loading = document.getElementById("padron-anr-loading");
    const error = document.getElementById("padron-anr-error");
    const result = document.getElementById("padron-anr-resultado");
    error.style.display = "none"; result.style.display = "none"; loading.style.display = "block";
    try {
        const padron = await cargarPadronCSV();
        const persona = padron.find(r => String(r.CEDULA).trim() === cedula);
        loading.style.display = "none";
        if (persona) {
            document.getElementById("pr-cedula").textContent = persona.CEDULA;
            document.getElementById("pr-nombres").textContent = persona.NOMBRES;
            document.getElementById("pr-apellidos").textContent = persona.APELLIDOS;
            document.getElementById("pr-departamento").textContent = persona.DEPARTAMENTO;
            document.getElementById("pr-distrito").textContent = persona.DISTRITO;
            document.getElementById("pr-seccional").textContent = persona.SECCIONAL;
            document.getElementById("pr-local").textContent = persona.LOCAL_VOTACION;
            document.getElementById("pr-mesa").textContent = persona.MESA;
            document.getElementById("pr-orden").textContent = persona.ORDEN;
            result.style.display = "block";
        } else {
            error.innerHTML = `<span class="material-icons" style="color:#B91C1C;">error_outline</span> No está en el padrón`;
            error.style.display = "block";
        }
    } catch (err) {
        loading.style.display = "none";
        error.innerHTML = `<span class="material-icons">warning_amber</span> Error al cargar`;
        error.style.display = "block";
    }
};

window.agregarDesdePardon = async function() {
    const cedula = document.getElementById("pr-cedula")?.textContent?.trim();
    const nombres = document.getElementById("pr-nombres")?.textContent?.trim() || "";
    const apellidos = document.getElementById("pr-apellidos")?.textContent?.trim() || "";
    const nombre = `${nombres} ${apellidos}`.trim();
    if (!cedula || !nombre) { toast("No hay datos para agregar.", "error"); return; }

    const cedulaNorm = String(cedula).replace(/[\s\-]/g, "").replace(/^0+/, "");
    if (state.padron.some(p => p.cedula === cedulaNorm)) { toast("Ya está en la planilla.", "warn"); return; }

    const local = document.getElementById("pr-local")?.textContent?.trim() || "";
    const mesa = document.getElementById("pr-mesa")?.textContent?.trim() || "";
    const orden = document.getElementById("pr-orden")?.textContent?.trim() || "";
    const nuevo = { id: "padron_"+Date.now(), nombre, cedula: cedulaNorm, domicilio:"---", local, mesa, orden };
    state.padron.push(nuevo);
    try {
        await setDoc(doc(db, "padron_extra", cedulaNorm), { ...nuevo, timestamp: serverTimestamp() });
        toast(`✔ ${nombre} agregado.`, "ok");
        actualizarDashboard();
    } catch (e) {
        state.padron = state.padron.filter(p => p.cedula !== cedulaNorm);
        toast("Error al guardar.", "error");
    }
};

// ═══════════════════════════════════════════════════════════════
//  LIMPIAR BITÁCORA
// ═══════════════════════════════════════════════════════════════
window.limpiarBitacora = async function() {
    if (!state.currentUser?.isAdmin) return;
    if (!confirm("¿Borrar TODA la bitácora?")) return;
    const snap = await getDocs(collection(db, "bitacora"));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    toast("Bitácora limpiada.", "ok");
};

// ═══════════════════════════════════════════════════════════════
//  FILTROS Y NAVEGACIÓN
// ═══════════════════════════════════════════════════════════════
function cambiarFiltro(destino) {
    state.currentFilter = destino;
    state.searchAllStates = false;
    state.pagination.page = 1;
    renderTablaVotantes();
}
window.cambiarFiltro = cambiarFiltro;

function showLogin() { document.getElementById("login-section").classList.remove("hidden"); document.getElementById("app-section").classList.add("hidden"); }
function showApp() { document.getElementById("login-section").classList.add("hidden"); document.getElementById("app-section").classList.remove("hidden"); }

function switchTab(tab) {
    if (tab === "admin" && !state.currentUser?.isAdmin) { toast("Acceso denegado.", "error"); return; }
    document.getElementById("view-planilla").style.display = "none";
    document.getElementById("view-stats").style.display = "none";
    document.getElementById("view-admin").style.display = "none";
    document.getElementById("view-padron-anr").style.display = "none";
    document.getElementById("filter-wrapper").style.display = "none";
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".bottom-nav-item").forEach(b => b.classList.remove("active"));

    if (tab === "planilla") {
        document.getElementById("view-planilla").style.display = "";
        document.getElementById("filter-wrapper").style.display = "";
        document.getElementById("tab-planilla").classList.add("active");
        document.querySelector('.bottom-nav-item[data-tab="planilla"]')?.classList.add("active");
        renderTablaVotantes();
    } else if (tab === "stats") {
        document.getElementById("view-stats").style.display = "block";
        document.getElementById("tab-stats").classList.add("active");
        document.querySelector('.bottom-nav-item[data-tab="stats"]')?.classList.add("active");
        currentStatsView = "locales";
        renderStatsCharts();
    } else if (tab === "admin") {
        document.getElementById("view-admin").style.display = "flex";
        document.getElementById("tab-admin").classList.add("active");
        document.querySelector('.bottom-nav-item[data-tab="admin"]')?.classList.add("active");
        cargarUsuarios();
        escucharBitacora();
    } else if (tab === "padron-anr") {
        document.getElementById("view-padron-anr").style.display = "";
        document.getElementById("tab-padron-anr").classList.add("active");
        document.querySelector('.bottom-nav-item[data-tab="padron-anr"]')?.classList.add("active");
    }
}

// Exponer funciones globales
window.exportarXLSX = exportarXLSX;
window.exportarEstadisticasXLSX = function() { toast("Función disponible en administración.", "warn"); };
window.accionVoto = accionVoto;
window.abrirModalObservacion = abrirModalObservacion;
window.abrirHistorial = abrirHistorial;
window.activarBusquedaGlobal = ()=>{ state.searchAllStates=true; state.pagination.page=1; renderTablaVotantes(); };
window.desactivarBusquedaGlobal = ()=>{ state.searchAllStates=false; state.pagination.page=1; renderTablaVotantes(); };
window.confirmNoVoto = confirmNoVoto;
window.confirmarObservacion = confirmarObservacion;
window.cancelarObservacion = cancelarObservacion;
window.volverALocales = volverALocales;
window.agregarDesdePardon = agregarDesdePardon;
window.buscarPadronANR = buscarPadronANR;
window.abrirCambiarPassword = abrirCambiarPassword;
window.confirmarCambiarPassword = confirmarCambiarPassword;
window.deleteUser = deleteUser;
window.handleCheckboxChange = handleCheckboxChange;
window.toggleTodosCheckbox = toggleTodosCheckbox;
window.seleccionarTodosCheckbox = seleccionarTodosCheckbox;
window.deseleccionarTodos = deseleccionarTodos;
window.pedirConfirmacionEliminar = pedirConfirmacionEliminar;
window.confirmarEliminarSeleccionados = confirmarEliminarSeleccionados;
window.eliminarIndividual = eliminarIndividual;
window.toggleMenu = toggleMenu;
window.limpiarBitacora = limpiarBitacora;
