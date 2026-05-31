// ═══════════════════════════════════════════════════════════════
//  CONTROL ELECTORAL — app.js v8.4
//  Modo eliminación delegado + offline queue con reintentos + gráficos mejorados
//  Formulario manual de votantes + sticky dinámico + fechas robustas
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
    isRendering:      false,   // para indicador de carga
    offlineRetryInterval: null,
};

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
        // fallback manual
        const d = new Date(date);
        const offset = -4 * 60; // UTC-4 aproximado
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
    ajustarStickyFiltros();   // sticky dinámico
    checkSession();
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

// Sticky dinámico para filtros en móvil
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
        if (tabAdmin)    user.isAdmin ? tabAdmin.classList.remove("hidden")  : tabAdmin.classList.add("hidden");
        if (btnExportar) btnExportar.style.display = user.isAdmin ? "flex" : "none";

        showApp();
        state.currentFilter = "todos";
        switchTab("planilla");
        actualizarBotonTrash();
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
    if (elimState?.activo) cancelarModoEliminar();
    const btnTrash = document.getElementById("btn-trash-flotante");
    if (btnTrash) btnTrash.classList.add("hidden");
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
//  DASHBOARD + ANIMACIÓN NUMÉRICA
// ═══════════════════════════════════════════════════════════════
function animateMetric(el, valor, prevValor) {
    if (!el) return;
    el.textContent = valor;
    if (prevValor !== undefined && prevValor !== valor) {
        el.classList.remove("bumping");
        void el.offsetWidth;
        el.classList.add("bumping");
        setTimeout(() => el.classList.remove("bumping"), 500);
    }
}

function actualizarDashboard() {
    const total   = state.padron.length;
    const voted   = state.padron.filter(v => getVoto(v.cedula) === "Votó").length;
    const noVoted = state.padron.filter(v => getVoto(v.cedula) === "No Votó").length;
    const pending = total - voted - noVoted;

    const elTot = document.getElementById("metric-total");
    const elVot = document.getElementById("metric-voted");
    const elNov = document.getElementById("metric-novoted");
    const elPen = document.getElementById("metric-pending");

    animateMetric(elTot, total,   state.prevMetrics.total);
    animateMetric(elVot, voted,   state.prevMetrics.voted);
    animateMetric(elNov, noVoted, state.prevMetrics.novoted);
    animateMetric(elPen, pending, state.prevMetrics.pending);

    state.prevMetrics = { total, voted, novoted: noVoted, pending };

    const pctVoted   = total > 0 ? (voted   / total * 100) : 0;
    const pctNoVoted = total > 0 ? (noVoted / total * 100) : 0;
    const pctPending = total > 0 ? (pending / total * 100) : 0;
    const progV = document.getElementById("prog-voted");
    const progN = document.getElementById("prog-novoted");
    const progP = document.getElementById("prog-pending");
    if (progV) progV.style.width = pctVoted.toFixed(1)   + "%";
    if (progN) progN.style.width = pctNoVoted.toFixed(1) + "%";
    if (progP) progP.style.width = pctPending.toFixed(1) + "%";
    setText("pct-voted",   pctVoted.toFixed(0)   + "%");
    setText("pct-novoted", pctNoVoted.toFixed(0) + "%");
    setText("pct-pending", pctPending.toFixed(0) + "%");

    renderTablaVotantes();
}

function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
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
//  TABLA/TARJETAS VOTANTES (con indicador de carga)
// ═══════════════════════════════════════════════════════════════
async function renderTablaVotantes() {
    if (state.isRendering) return;
    state.isRendering = true;
    mostrarLoadingEnTabla(true);

    // Pequeño delay para que el spinner se vea si la operación es rápida
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
                    <svg width="13" height="13" style="flex-shrink:0"><use href="#icon-search"/></svg>
                    <span>Se encontraron <strong>${otros}</strong> resultado${otros>1?"s":""} en otros estados.</span>
                    <button onclick="activarBusquedaGlobal()" class="btn-hint-global">Ver todos</button>`;
            } else {
                searchHint.style.display = "none";
            }
        } else if (q && state.searchAllStates) {
            searchHint.style.display = "flex";
            searchHint.innerHTML = `
                <svg width="13" height="13" style="flex-shrink:0"><use href="#icon-search"/></svg>
                <span>Mostrando resultados de <strong>todos los estados</strong>.</span>
                <button onclick="desactivarBusquedaGlobal()" class="btn-hint-volver">Volver al filtro</button>`;
        } else {
            searchHint.style.display = "none";
        }
    }

    const cardsContainer = document.getElementById("cards-container");
    if (cardsContainer) {
        if (!paginatedList.length) {
            cardsContainer.innerHTML = `
                <div class="empty-state">
                    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-inbox"/></svg>
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

    const tbody = document.getElementById("votantes-table-body");
    if (tbody) {
        if (!paginatedList.length) {
            tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--color-gray);padding:30px;">No se encontraron registros.</td></tr>`;
        } else {
            tbody.innerHTML = "";
            paginatedList.forEach((v, idx) => {
                const voto = getVoto(v.cedula);
                const obs  = getObs(v.cedula);
                const log  = getLog(v.cedula);

                let badgeClass = "badge badge-pending", badgeLabel = "Pendiente";
                if (voto === "Votó")    { badgeClass = "badge badge-voted";   badgeLabel = "Votó"; }
                if (voto === "No Votó") { badgeClass = "badge badge-novoted"; badgeLabel = "No Votó"; }

                const clsVoto   = voto === "Votó"    ? "btn-accion sel-voto"   : "btn-accion";
                const clsNoVoto = voto === "No Votó" ? "btn-accion sel-novoto" : "btn-accion";

                const tr = document.createElement("tr");
                tr.dataset.cedula = v.cedula;
                tr.innerHTML = `
                    <td><strong>${start + idx + 1}</strong></td>
                    <td>${escHtml(v.nombre)}</td>
                    <td style="font-family:monospace">${v.cedula}</td>
                    <td style="font-size:.82rem;">${escHtml(v.local || "—")}</td>
                    <td style="font-size:.82rem;font-family:monospace;">${escHtml(v.mesa || "—")}</td>
                    <td style="font-size:.82rem;font-family:monospace;">${escHtml(v.orden || "—")}</td>
                    <td><span class="${badgeClass}">${badgeLabel}</span></td>
                    <td>
                        <div class="action-btns">
                            <button class="${clsVoto}" onclick="accionVoto('${v.cedula}','Votó')" title="${voto==='Votó'?'Quitar voto':'Marcar como Votó'}">
                                <svg width="12" height="12"><use href="#icon-check"/></svg>
                                ${voto === "Votó" ? "Votó ✕" : "Votó"}
                            </button>
                            <button class="${clsNoVoto}" onclick="accionVoto('${v.cedula}','No Votó')" title="${voto==='No Votó'?'Quitar No Votó':'Marcar como No Votó'}">
                                <svg width="12" height="12"><use href="#icon-x"/></svg>
                                ${voto === "No Votó" ? "No Votó ✕" : "No Votó"}
                            </button>
                        </div>
                    </td>
                    <td>
                        <button class="btn-obs ${obs ? 'has-obs' : ''}"
                            style="min-width:130px;"
                            onclick="abrirModalObservacion('${v.cedula}', ${jsEscape(v.nombre)})">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            <span class="obs-preview">${obs ? escHtml(obs) : "Agregar obs..."}</span>
                        </button>
                    </td>
                    <td><span class="log-span">${escHtml(log)}</span></td>
                    <td>
                        <button class="btn-secondary" style="padding:6px 10px;font-size:.72rem;" onclick="abrirHistorial('${v.cedula}', ${jsEscape(v.nombre)})" title="Ver historial">
                            <svg width="12" height="12"><use href="#icon-history"/></svg>
                        </button>
                    </td>`;
                tbody.appendChild(tr);
            });
        }
    }

    renderPaginationControls(totalItems);
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
            tbody.innerHTML = `<tr><td colspan="11" class="spinner-cell"><div class="spinner"></div></td></tr>`;
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

    const renderGrupo = (titulo, items, claseSection, iconId) => {
        if (!items.length) return "";
        let h = `
            <div class="section-divider ${claseSection}">
                <svg><use href="#${iconId}"/></svg>
                ${titulo}
                <span class="sd-count">${items.length}</span>
            </div>`;
        items.forEach(v => {
            contadorGlobal++;
            h += construirTarjeta(v, contadorGlobal - 1);
        });
        return h;
    };

    html += renderGrupo("Votaron",    grupos["Votó"],     "sd-voted",   "icon-check");
    html += renderGrupo("No Votaron", grupos["No Votó"],  "sd-novoted", "icon-x");
    html += renderGrupo("Pendientes", grupos["Pendiente"], "sd-pending", "icon-clock");
    return html;
}

function construirTarjeta(v, idx) {
    const voto = getVoto(v.cedula);
    const obs  = getObs(v.cedula);
    const log  = getLog(v.cedula);

    let badgeClass = "badge badge-pending", badgeLabel = "Pendiente";
    if (voto === "Votó")    { badgeClass = "badge badge-voted";   badgeLabel = "Votó"; }
    if (voto === "No Votó") { badgeClass = "badge badge-novoted"; badgeLabel = "No Votó"; }

    const clsVoto   = voto === "Votó"    ? "btn-accion sel-voto"   : "btn-accion";
    const clsNoVoto = voto === "No Votó" ? "btn-accion sel-novoto" : "btn-accion";

    const estadoClass = voto === "Votó" ? "estado-voto" : voto === "No Votó" ? "estado-novoto" : "";
    const obsLabel    = obs ? escHtml(obs) : "Agregar observación...";
    const obsClass    = obs ? "btn-obs has-obs" : "btn-obs";

    const elimCheck = elimState.activo ? `<div class="elim-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>` : '';

    return `
        <div class="card-votante ${estadoClass}" data-cedula="${escHtml(v.cedula)}">
            ${elimCheck}
            <div class="card-top">
                <div class="card-info">
                    <div class="card-num">${idx+1}.</div>
                    <div class="card-nombre" title="${escHtml(v.nombre)}">${escHtml(v.nombre)}</div>
                    <div class="card-cedula">CI: ${escHtml(v.cedula)}</div>
                    ${v.local  ? `<div class="card-domicilio" style="font-size:.74rem;opacity:.85;">📍 ${escHtml(v.local)}</div>` : ""}
                ${v.mesa   ? `<div class="card-domicilio" style="font-size:.74rem;opacity:.85;">🗳️ Mesa <strong>${escHtml(v.mesa)}</strong>${v.orden ? " · Orden " + escHtml(v.orden) : ""}</div>` : ""}
                </div>
                <span class="${badgeClass}">${badgeLabel}</span>
            </div>
            <div class="action-btns">
                <button class="${clsVoto}" onclick="accionVoto('${v.cedula}','Votó')">
                    <svg width="13" height="13"><use href="#icon-check"/></svg>
                    ${voto === "Votó" ? "Votó ✕" : "Votó"}
                </button>
                <button class="${clsNoVoto}" onclick="accionVoto('${v.cedula}','No Votó')">
                    <svg width="13" height="13"><use href="#icon-x"/></svg>
                    ${voto === "No Votó" ? "No Votó ✕" : "No Votó"}
                </button>
            </div>
            <button class="${obsClass}"
                onclick="abrirModalObservacion('${v.cedula}', ${jsEscape(v.nombre)})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span class="obs-preview">${obsLabel}</span>
            </button>
            ${log !== "---" ? `<div class="card-log">${escHtml(log)}</div>` : ""}
            <div style="margin-top:8px;text-align:right;">
                <button class="btn-secondary" style="padding:5px 10px;font-size:.7rem;" onclick="abrirHistorial('${v.cedula}', ${jsEscape(v.nombre)})">
                    <svg width="11" height="11"><use href="#icon-history"/></svg> Historial
                </button>
            </div>
        </div>`;
}

window.activarBusquedaGlobal = function() {
    state.searchAllStates = true;
    state.pagination.page = 1;
    renderTablaVotantes();
};
window.desactivarBusquedaGlobal = function() {
    state.searchAllStates = false;
    state.pagination.page = 1;
    renderTablaVotantes();
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
//  ADMIN: VOTANTES — Carga únicamente desde Padrón ANR
//  (La función manual fue eliminada. Usar agregarDesdePardon().)

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
    const local    = (document.getElementById("reg-local-value")?.value || document.getElementById("reg-local")?.value || "").trim();

    if (username === ADMIN_USER_ID) {
        toast("Ese nombre de usuario está reservado.", "error");
        return;
    }

    try {
        const existe = await getDoc(doc(db, "usuarios", username));
        if (existe.exists()) { toast("El nombre de usuario ya existe.", "error"); return; }
        const passwordHash = await sha256(password);
        await setDoc(doc(db, "usuarios", username), { username, fullname, phone, passwordHash, isAdmin: false, local });
        toast(`✔ Operador "${fullname}" creado correctamente.`);
        await registrarBitacora("Nuevo Operador", `Creó operador ${fullname} (usuario: ${username})${local ? " · Local: "+local : ""}`);
        document.getElementById("register-user-form").reset();
        cargarUsuarios();
    } catch (err) {
        console.error(err);
        toast("Error al crear el usuario.", "error");
    }
}

window.deleteUser = async function(username) {
    if (!confirm(`¿Eliminar al operador "${username}"?`)) return;
    const u = state.usuarios.find(x => x.username === username);
    try {
        await deleteDoc(doc(db, "usuarios", username));
        toast(`Operador "${username}" eliminado.`, "warn");
        await registrarBitacora("Eliminar Operador",
            `Eliminó operador ${u?.fullname || username} (usuario: ${username})`);
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
        const phoneRaw   = (u.phone || "").replace(/[\s\-\+]/g, "");
        const phoneClean = phoneRaw.startsWith("0") ? "595" + phoneRaw.slice(1) : phoneRaw;
        const waLink     = phoneClean ? `https://wa.me/${phoneClean}` : null;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${escHtml(u.fullname)}</td>
            <td>
                ${waLink
                    ? `<a href="${waLink}" target="_blank" rel="noopener" class="wa-link">
                           <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
                           ${escHtml(u.phone)}
                       </a>`
                    : escHtml(u.phone || "---")
                }
            </td>
            <td><code>${escHtml(u.username)}</code></td>
            <td>${escHtml(u.local || "—")}</td>
            <td style="white-space:nowrap">
                <div style="display:flex;gap:6px;align-items:center;">
                    <button class="btn-secondary" onclick="abrirCambiarPassword('${escHtml(u.username)}')"
                        style="padding:7px 11px;font-size:.75rem;font-weight:800;display:flex;align-items:center;gap:4px;">
                        <svg class="icon" style="width:12px;height:12px;color:var(--color-primary);margin:0"><use href="#icon-lock"/></svg>
                        Clave
                    </button>
                    <button class="btn-icon-danger" onclick="deleteUser('${escHtml(u.username)}')" title="Eliminar operador"
                        style="padding:7px 10px;font-size:.75rem;font-weight:800;display:flex;align-items:center;gap:4px;width:auto;height:auto;border-radius:var(--r-md);">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        Eliminar
                    </button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

// ═══════════════════════════════════════════════════════════════
//  CARGAR LOCALES (desde configuración fija)
// ═══════════════════════════════════════════════════════════════
const LOCALES_CONFIG = {
    "GIMNASIO MUNICIPAL":       { mesaMin: 1,  mesaMax: 20, color: "#B91C1C", colorSoft: "#FCA5A5", icon: "icon-shield"     },
    "COLEGIO NACIONAL SEBASTIAN DE YEGROS": { mesaMin: 21, mesaMax: 40, color: "#1E40AF", colorSoft: "#93C5FD", icon: "icon-users"    },
    "ESC.CARLOS ANTONIO LOPEZ": { mesaMin: 41, mesaMax: 65, color: "#15803D", colorSoft: "#86EFAC", icon: "icon-file-text"  }
};

const LOCAL_COLOR_FALLBACK      = "#9CA3AF";
const LOCAL_COLOR_FALLBACK_SOFT = "#D1D5DB";

function getColorLocal(local) {
    return (LOCALES_CONFIG[local] && LOCALES_CONFIG[local].color) || LOCAL_COLOR_FALLBACK;
}
function getColorLocalSoft(local) {
    return (LOCALES_CONFIG[local] && LOCALES_CONFIG[local].colorSoft) || LOCAL_COLOR_FALLBACK_SOFT;
}

function normalizarLocal(nombre) {
    if (!nombre) return "";
    return nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function determinarLocal(votante) {
    if (votante.local) {
        const norm = normalizarLocal(votante.local);
        for (const local of Object.keys(LOCALES_CONFIG)) {
            if (normalizarLocal(local) === norm) return local;
        }
    }
    const numMesa = parseInt(String(votante.mesa || "").replace(/\D/g, '')) || 0;
    for (const [local, config] of Object.entries(LOCALES_CONFIG)) {
        if (numMesa >= config.mesaMin && numMesa <= config.mesaMax) return local;
    }
    return "OTRO";
}

async function cargarLocalesDesdePadron() {
    // Poblar selector visual de locales en formulario de operadores
    const localPickerWrap = document.getElementById("reg-local-picker");
    const localHidden = document.getElementById("reg-local-value");
    if (localPickerWrap) {
        localPickerWrap.innerHTML = "";
        Object.entries(LOCALES_CONFIG).forEach(([loc, conf]) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "local-picker-btn";
            btn.dataset.local = loc;
            btn.style.setProperty("--lc", conf.color);
            btn.style.setProperty("--ls", conf.colorSoft);
            btn.innerHTML = `
                <svg width="13" height="13" style="color:${conf.color}"><use href="#${conf.icon}"/></svg>
                <span>${loc}</span>
                <span class="lp-mesas" style="color:${conf.color}">M${conf.mesaMin}–${conf.mesaMax}</span>`;
            btn.addEventListener("click", () => {
                localPickerWrap.querySelectorAll(".local-picker-btn").forEach(b => b.classList.remove("selected"));
                btn.classList.add("selected");
                btn.style.background = conf.color + "18";
                btn.style.borderColor = conf.color;
                if (localHidden) localHidden.value = loc;
            });
            localPickerWrap.appendChild(btn);
        });
        // Reset on re-open
        if (localHidden) localHidden.value = "";
    }
    // Fallback: si existe el <select> viejo, también poblarlo
    const select = document.getElementById("reg-local");
    if (select) {
        select.innerHTML = '<option value="">Seleccionar local...</option>';
        Object.keys(LOCALES_CONFIG).forEach(loc => {
            const opt = document.createElement("option");
            opt.value = loc;
            opt.textContent = loc;
            select.appendChild(opt);
        });
    }
}

// ═══════════════════════════════════════════════════════════════
//  ESTADÍSTICAS (sin selector de locales, con clic en barras)
// ═══════════════════════════════════════════════════════════════
let currentStatsView = "locales"; // "locales" o "mesas"
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
            // Calcular centro del arco de forma manual
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
        if (total === 0 && local === "OTRO") return; // ocultar OTRO si está vacío

        const pct = total ? Math.round((voted/total)*100) : 0;
        const color = getColorLocal(local);
        const colorSoft = getColorLocalSoft(local);
        const icon  = (conf && conf.icon) || "icon-grid";

        const card = document.createElement("div");
        card.className = "local-card";
        card.style.borderLeftColor = color;
        card.innerHTML = `
            <div class="local-card-name" style="color:${color}">
                <svg width="14" height="14"><use href="#${icon}"/></svg>
                ${local}
            </div>
            <div class="local-card-num" style="color:${color}">${voted}<span style="font-size:.85rem;color:var(--color-gray);font-weight:700;"> / ${total}</span></div>
            <div class="local-card-meta">${conf ? `Mesas ${conf.mesaMin}–${conf.mesaMax}` : "Sin asignar"}</div>
            <div class="local-card-bar"><div class="local-card-bar-fill" style="width:${pct}%;background:linear-gradient(90deg, ${color}, ${colorSoft})"></div></div>
            <div class="local-card-pct" style="color:${color}">${pct}% de participación</div>
        `;
        if (local !== "OTRO") {
            card.addEventListener("click", () => {
                currentStatsView = "mesas";
                currentLocalForMesas = local;
                renderStatsCharts();
                document.getElementById("chart-mesa")?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        } else {
            card.style.cursor = "default";
        }
        container.appendChild(card);
    });
}

function renderStatsCharts() {
    // Render summary cards always
    renderLocalesSummary();

    if (!state.padron.length) {
        ["chart-mesa", "chart-global", "chart-hora"].forEach(id => {
            const canvas = document.getElementById(id);
            if (canvas) {
                const ctx = canvas.getContext("2d");
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        });
        // Mostrar selector de locales cuando no hay datos
        _renderSelectorLocales();
        return;
    }

    const titleEl   = document.getElementById("bar-chart-title");
    const btnVolver = document.getElementById("btn-volver-locales");
    const hintEl    = document.getElementById("chart-hint");

    if (currentStatsView === "mesas" && currentLocalForMesas) {
        // ── Vista mesas: barras por mesa mostrando solo Votaron ──
        if (titleEl)   titleEl.textContent = `Mesas — ${currentLocalForMesas}`;
        if (btnVolver) btnVolver.classList.remove("hidden");
        if (hintEl)    hintEl.style.display = "none";

        // Ocultar el selector de locales, mostrar canvas
        const selectorEl = document.getElementById("local-selector-btns");
        if (selectorEl) selectorEl.style.display = "none";
        const chartWrap = document.getElementById("chart-mesa-wrap");
        if (chartWrap) chartWrap.style.display = "block";

        const config = LOCALES_CONFIG[currentLocalForMesas];
        if (config) {
            const colorLocal   = getColorLocal(currentLocalForMesas);
            const colorSoftL   = getColorLocalSoft(currentLocalForMesas);

            // Construir datos por mesa (solo mesas con al menos 1 inscripto)
            const mesas = {};
            for (let m = config.mesaMin; m <= config.mesaMax; m++) {
                mesas[m] = { voted: 0, noVoted: 0, pending: 0, total: 0 };
            }
            state.padron.forEach(v => {
                if (determinarLocal(v) !== currentLocalForMesas) return;
                const numMesa = parseInt(String(v.mesa || "").replace(/\D/g, '')) || 0;
                if (mesas[numMesa] === undefined) return;
                mesas[numMesa].total++;
                const estado = getVoto(v.cedula);
                if (estado === "Votó")        mesas[numMesa].voted++;
                else if (estado === "No Votó") mesas[numMesa].noVoted++;
                else                          mesas[numMesa].pending++;
            });

            // Filtrar solo mesas con inscriptos
            const mesasActivas = Object.entries(mesas).filter(([, d]) => d.total > 0);
            const labels    = mesasActivas.map(([m]) => `M${m}`);
            const dataVoted = mesasActivas.map(([, d]) => d.voted);
            const totals    = mesasActivas.map(([, d]) => d.total);

            const ctxMesa = document.getElementById("chart-mesa");
            if (ctxMesa) {
                if (state.charts.mesa) state.charts.mesa.destroy();

                // Gradientes por barra según % de participación
                const ctx2d = ctxMesa.getContext("2d");
                const gradients = dataVoted.map(() => {
                    const g = ctx2d.createLinearGradient(0, 0, 0, 300);
                    g.addColorStop(0, colorLocal);
                    g.addColorStop(1, colorSoftL);
                    return g;
                });

                state.charts.mesa = new Chart(ctxMesa, {
                    type: "bar",
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: "Votaron",
                                data: dataVoted,
                                backgroundColor: gradients,
                                borderColor: colorLocal,
                                borderWidth: 2,
                                borderRadius: 6,
                                maxBarThickness: 55
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    title: (items) => `Mesa ${items[0]?.label?.replace('M','') || ''}`,
                                    label: (ctx) => {
                                        const i = ctx.dataIndex;
                                        const v = dataVoted[i];
                                        const t = totals[i];
                                        return `Votaron: ${v} de ${t} inscriptos (${t ? ((v/t)*100).toFixed(1) : 0}%)`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { ticks: { font: { size: 11, weight: '700' }, color: '#374151' } },
                            y: {
                                beginAtZero: true,
                                ticks: { stepSize: 1, precision: 0 },
                                title: { display: true, text: 'Votantes', font: { size: 11, weight: '700' }, color: '#6B7280' }
                            }
                        }
                    }
                });
            }

            // ── Tabla de detalle por mesa ──
            _renderTablaMesas(mesasActivas, colorLocal);
        }
    } else {
        // ── Vista selector: mostrar botones de locales para elegir ──
        currentStatsView = "locales";
        if (titleEl)   titleEl.textContent = "Seleccioná un local para ver estadísticas por mesa";
        if (btnVolver) btnVolver.classList.add("hidden");
        if (hintEl)    hintEl.style.display = "none";

        // Ocultar canvas, mostrar selector
        const chartWrap2 = document.getElementById("chart-mesa-wrap");
        if (chartWrap2) chartWrap2.style.display = "none";

        // Limpiar chart anterior
        const ctxMesa = document.getElementById("chart-mesa");
        if (ctxMesa) {
            if (state.charts.mesa) { state.charts.mesa.destroy(); state.charts.mesa = null; }
            const ctx2d = ctxMesa.getContext("2d");
            ctx2d.clearRect(0, 0, ctxMesa.width, ctxMesa.height);
        }

        // Limpiar tabla de mesas
        const tablaWrap = document.getElementById("mesa-tabla-wrap");
        if (tablaWrap) tablaWrap.innerHTML = "";

        // Mostrar selector de locales
        _renderSelectorLocales();
    }

    // ── Gráfico de torta global (siempre visible) ──
    const total   = state.padron.length;
    const voted   = state.padron.filter(v => getVoto(v.cedula) === "Votó").length;
    const noVoted = state.padron.filter(v => getVoto(v.cedula) === "No Votó").length;
    const pending = total - voted - noVoted;

    const ctxGlobal = document.getElementById("chart-global");
    if (ctxGlobal) {
        if (state.charts.global) state.charts.global.destroy();
        state.charts.global = new Chart(ctxGlobal, {
            type: "doughnut",
            plugins: [doughnutLabelsPlugin],
            data: {
                labels: ["Votaron", "No Votaron", "Pendientes"],
                datasets: [{
                    data: [voted, noVoted, pending],
                    backgroundColor: ["#15803D", "#B91C1C", "#9CA3AF"],
                    borderColor: "#fff",
                    borderWidth: 3,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { boxWidth: 12, font: { size: 11, weight: '700' }, padding: 14 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const t = total || 1;
                                return `${ctx.label}: ${ctx.raw} (${((ctx.raw/t)*100).toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ── Gráfico horario — hasta las 17:00 ──
    const horas = {};
    for (let h = 7; h <= 17; h++) horas[`${h}:00`] = 0;
    Object.entries(state.votos).forEach(([, v]) => {
        if (v.voto !== "Votó" || !v.timestamp) return;
        const d = v.timestamp.toDate ? v.timestamp.toDate() : new Date(v.timestamp);
        const horaPY = new Date(d.toLocaleString("en-US", { timeZone: TZ_PY }));
        const bucket = `${horaPY.getHours()}:00`;
        if (horas[bucket] !== undefined) horas[bucket]++;
    });
    const ctxHora = document.getElementById("chart-hora");
    if (ctxHora) {
        if (state.charts.hora) state.charts.hora.destroy();
        const ctx2dH = ctxHora.getContext("2d");
        const grad = ctx2dH.createLinearGradient(0, 0, 0, 220);
        grad.addColorStop(0, "rgba(185,28,28,0.38)");
        grad.addColorStop(1, "rgba(185,28,28,0.02)");

        state.charts.hora = new Chart(ctxHora, {
            type: "line",
            data: {
                labels: Object.keys(horas),
                datasets: [{
                    label: "Votos por hora",
                    data: Object.values(horas),
                    borderColor: "#B91C1C",
                    backgroundColor: grad,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointBackgroundColor: "#B91C1C",
                    pointBorderColor: "#fff",
                    pointBorderWidth: 2,
                    borderWidth: 2.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: (ctx) => `${ctx.raw} voto${ctx.raw === 1 ? '' : 's'} a las ${ctx.label}` }
                    }
                },
                scales: {
                    x: { ticks: { font: { size: 10, weight: '600' } } },
                    y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } }
                }
            }
        });
    }
}

// ── Renderiza botones para elegir local ──────────────────────────
function _renderSelectorLocales() {
    const selectorEl = document.getElementById("local-selector-btns");
    if (!selectorEl) return;
    selectorEl.innerHTML = "";
    selectorEl.style.display = "flex";

    Object.entries(LOCALES_CONFIG).forEach(([local, conf]) => {
        // Contar inscriptos y votaron de este local
        let total = 0, voted = 0;
        state.padron.forEach(v => {
            if (determinarLocal(v) !== local) return;
            total++;
            if (getVoto(v.cedula) === "Votó") voted++;
        });
        const pct = total ? Math.round((voted / total) * 100) : 0;

        const btn = document.createElement("button");
        btn.className = "local-sel-btn";
        btn.style.borderColor = conf.color;
        btn.style.setProperty("--local-color", conf.color);
        btn.style.setProperty("--local-soft", conf.colorSoft);
        btn.innerHTML = `
            <div class="local-sel-icon" style="background:${conf.color}">
                <svg width="16" height="16"><use href="#${conf.icon}"/></svg>
            </div>
            <div class="local-sel-body">
                <div class="local-sel-name" style="color:${conf.color}">${local}</div>
                <div class="local-sel-mesas">Mesas ${conf.mesaMin}–${conf.mesaMax}</div>
                <div class="local-sel-stat">
                    <span style="color:${conf.color};font-weight:800;">${voted}</span>
                    <span style="color:#6B7280"> / ${total} votaron</span>
                    <span class="local-sel-pct" style="background:${conf.color}15;color:${conf.color}">${pct}%</span>
                </div>
                <div class="local-sel-bar">
                    <div class="local-sel-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${conf.color},${conf.colorSoft})"></div>
                </div>
            </div>
            <svg class="local-sel-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${conf.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        `;
        btn.addEventListener("click", () => {
            currentStatsView = "mesas";
            currentLocalForMesas = local;
            renderStatsCharts();
            document.getElementById("chart-mesa")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        selectorEl.appendChild(btn);
    });
}

// ── Renderiza tabla de detalle por mesa ─────────────────────────
function _renderTablaMesas(mesasActivas, colorLocal) {
    const tablaWrap = document.getElementById("mesa-tabla-wrap");
    if (!tablaWrap) return;

    if (!mesasActivas.length) {
        tablaWrap.innerHTML = `<p style="text-align:center;color:var(--color-gray);font-size:.85rem;padding:16px;">Sin datos de mesas para este local.</p>`;
        return;
    }

    let totalVoted = 0, totalNoVoted = 0, totalPend = 0, totalTotal = 0;
    mesasActivas.forEach(([, d]) => {
        totalVoted  += d.voted;
        totalNoVoted += d.noVoted;
        totalPend   += d.pending;
        totalTotal  += d.total;
    });

    const rows = mesasActivas.map(([mesa, d]) => {
        const pct = d.total ? ((d.voted / d.total) * 100).toFixed(1) : "0.0";
        const pctNum = parseFloat(pct);
        const barColor = pctNum >= 70 ? "#15803D" : pctNum >= 40 ? colorLocal : "#9CA3AF";
        return `
        <tr>
            <td><strong style="color:${colorLocal}">M${mesa}</strong></td>
            <td style="text-align:center;">${d.total}</td>
            <td style="text-align:center;"><span style="color:#15803D;font-weight:800;">${d.voted}</span></td>
            <td style="text-align:center;"><span style="color:#B91C1C;font-weight:700;">${d.noVoted}</span></td>
            <td style="text-align:center;"><span style="color:#6B7280;">${d.pending}</span></td>
            <td style="min-width:110px;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="flex:1;height:6px;background:#F3F4F6;border-radius:100px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:${barColor};border-radius:100px;transition:width .6s ease;"></div>
                    </div>
                    <span style="font-size:.75rem;font-weight:800;color:${barColor};min-width:36px;text-align:right;">${pct}%</span>
                </div>
            </td>
        </tr>`;
    }).join("");

    const totalPct = totalTotal ? ((totalVoted / totalTotal) * 100).toFixed(1) : "0.0";

    tablaWrap.innerHTML = `
        <div style="margin-top:18px;background:#fff;border:1px solid var(--color-border);border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--shadow-sm);">
            <div style="padding:10px 16px;background:linear-gradient(135deg,${colorLocal},${colorLocal}cc);display:flex;align-items:center;gap:8px;">
                <svg width="14" height="14" style="color:#fff"><use href="#icon-list"/></svg>
                <span style="color:#fff;font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;">Detalle por Mesa — ${currentLocalForMesas}</span>
            </div>
            <div style="overflow-x:auto;">
                <table style="white-space:nowrap;">
                    <thead>
                        <tr>
                            <th>Mesa</th>
                            <th style="text-align:center;">Inscriptos</th>
                            <th style="text-align:center;">Votaron</th>
                            <th style="text-align:center;">No Votaron</th>
                            <th style="text-align:center;">Pendientes</th>
                            <th>Participación</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                        <tr style="background:${colorLocal}0d;border-top:2px solid ${colorLocal}44;">
                            <td><strong style="color:${colorLocal}">TOTAL</strong></td>
                            <td style="text-align:center;"><strong>${totalTotal}</strong></td>
                            <td style="text-align:center;"><strong style="color:#15803D;">${totalVoted}</strong></td>
                            <td style="text-align:center;"><strong style="color:#B91C1C;">${totalNoVoted}</strong></td>
                            <td style="text-align:center;"><strong style="color:#6B7280;">${totalPend}</strong></td>
                            <td><strong style="color:${colorLocal}">${totalPct}%</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>`;
}

window.volverALocales = function() {
    currentStatsView = "locales";
    currentLocalForMesas = null;
    renderStatsCharts();
};

};

// ═══════════════════════════════════════════════════════════════
//  MODALES
// ═══════════════════════════════════════════════════════════════
function abrirModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("active");
}
function cerrarModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
    state.pendingNoVoto = null;
}
window.closeModal = cerrarModal;

// ═══════════════════════════════════════════════════════════════
//  TOASTS
// ═══════════════════════════════════════════════════════════════
function toast(msg, tipo = "ok") {
    const el = document.createElement("div");
    el.className  = tipo === "error" ? "toast error" : tipo === "warn" ? "toast warn" : tipo === "offline" ? "toast offline" : "toast";
    el.textContent = msg;
    document.getElementById("toast-container").appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(20px)";
        el.style.transition = "all .3s ease";
        setTimeout(() => el.remove(), 320);
    }, 3200);
}

// ═══════════════════════════════════════════════════════════════
//  STATUS DOT
// ═══════════════════════════════════════════════════════════════
function setStatus(online) {
    const dot   = document.getElementById("status-dot");
    const label = document.getElementById("status-label");
    if (dot)   dot.className     = "status-dot" + (online ? " online" : "");
    if (label) label.textContent = online ? "en línea" : "sin conexión";
}

// ═══════════════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════════════
function escHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function jsEscape(str) {
    return JSON.stringify(String(str ?? "")).replace(/"/g, "&quot;");
}

function debounce(fn, ms = 300) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

// ═══════════════════════════════════════════════════════════════
//  EXPORTAR XLSX (Planilla simple)
// ═══════════════════════════════════════════════════════════════
window.exportarXLSX = function() {
    const filas = [["N°","Nombre","Cédula","Domicilio","Local","Mesa","Orden","Estado","Operador","Observación"]];
    state.padron.forEach((v, i) => {
        filas.push([
            i+1,
            v.nombre,
            v.cedula,
            v.domicilio || "",
            v.local || "",
            v.mesa || "",
            v.orden || "",
            getVoto(v.cedula),
            getLog(v.cedula),
            getObs(v.cedula)
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planilla");

    const fecha = new Date().toLocaleString("es-PY", {
        timeZone:"America/Asuncion",
        day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"
    }).replace(/[\/:, ]/g,"-").replace(/--/g,"-");

    XLSX.writeFile(wb, `planilla-electoral-${fecha}.xlsx`);
    toast("✔ Planilla exportada correctamente (XLSX).", "ok");
    registrarBitacora("Exportar XLSX", `Exportó la planilla (${state.padron.length} registros)`);
};

// ═══════════════════════════════════════════════════════════════
//  EXPORTAR ESTADÍSTICAS XLSX (Admin — 4 hojas)
// ═══════════════════════════════════════════════════════════════
window.exportarEstadisticasXLSX = function() {
    const wb = XLSX.utils.book_new();

    // 1. Planilla
    const filasPlanilla = [["N°","Nombre","Cédula","Domicilio","Local","Mesa","Orden","Estado","Operador","Observación"]];
    state.padron.forEach((v, i) => {
        filasPlanilla.push([
            i+1, v.nombre, v.cedula, v.domicilio||"", v.local||"", v.mesa||"", v.orden||"",
            getVoto(v.cedula), getLog(v.cedula), getObs(v.cedula)
        ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasPlanilla), "Planilla");

    // 2. Por Local
    const locales = {};
    state.padron.forEach(v => {
        const loc = v.local || "Sin local";
        if (!locales[loc]) locales[loc] = { total:0, voted:0, novoted:0, pending:0 };
        locales[loc].total++;
        const voto = getVoto(v.cedula);
        if (voto === "Votó") locales[loc].voted++;
        else if (voto === "No Votó") locales[loc].novoted++;
        else locales[loc].pending++;
    });
    const filasLocal = [["Local","Total","Votaron","No Votaron","Pendientes","% Participación"]];
    Object.entries(locales).sort((a,b) => b[1].voted - a[1].voted).forEach(([loc, d]) => {
        const pct = d.total ? ((d.voted/d.total)*100).toFixed(1) + "%" : "0%";
        filasLocal.push([loc, d.total, d.voted, d.novoted, d.pending, pct]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasLocal), "Por Local");

    // 3. Por Mesa
    const mesas = {};
    state.padron.forEach(v => {
        if (!v.mesa) return;
        const key = v.local ? `${v.mesa} | ${v.local}` : v.mesa;
        if (!mesas[key]) mesas[key] = { total:0, voted:0, novoted:0, pending:0, mesa:v.mesa, local:v.local||"" };
        mesas[key].total++;
        const voto = getVoto(v.cedula);
        if (voto === "Votó") mesas[key].voted++;
        else if (voto === "No Votó") mesas[key].novoted++;
        else mesas[key].pending++;
    });
    const filasMesa = [["Mesa","Local","Total","Votaron","No Votaron","Pendientes","% Participación"]];
    Object.entries(mesas).sort((a,b) => b[1].voted - a[1].voted).forEach(([key, d]) => {
        const pct = d.total ? ((d.voted/d.total)*100).toFixed(1) + "%" : "0%";
        filasMesa.push([d.mesa, d.local, d.total, d.voted, d.novoted, d.pending, pct]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasMesa), "Por Mesa");

    // 4. Resumen General
    const total = state.padron.length;
    const voted = state.padron.filter(v => getVoto(v.cedula)==="Votó").length;
    const noVoted = state.padron.filter(v => getVoto(v.cedula)==="No Votó").length;
    const pending = total - voted - noVoted;
    const filasResumen = [
        ["Métrica","Valor","%"],
        ["Total Votantes", total, "100%"],
        ["Votaron", voted, total ? ((voted/total)*100).toFixed(1)+"%" : "0%"],
        ["No Votaron", noVoted, total ? ((noVoted/total)*100).toFixed(1)+"%" : "0%"],
        ["Pendientes", pending, total ? ((pending/total)*100).toFixed(1)+"%" : "0%"]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasResumen), "Resumen General");

    const fecha = new Date().toLocaleString("es-PY", {
        timeZone:"America/Asuncion",
        day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"
    }).replace(/[\/:, ]/g,"-").replace(/--/g,"-");

    XLSX.writeFile(wb, `estadisticas-electoral-${fecha}.xlsx`);
    toast("✔ Excel de estadísticas descargado.", "ok");
    registrarBitacora("Exportar Estadísticas", `Exportó Excel completo con ${state.padron.length} registros`);
};

// ═══════════════════════════════════════════════════════════════
//  CAMBIAR CONTRASEÑA DE OPERADOR
// ═══════════════════════════════════════════════════════════════
window.abrirCambiarPassword = function(username) {
    const u = state.usuarios.find(x => x.username === username);
    document.getElementById("chpass-username").value    = username;
    document.getElementById("chpass-nueva").value       = "";
    document.getElementById("chpass-confirmar").value   = "";
    document.getElementById("chpass-error").textContent = "";
    const lbl = document.getElementById("chpass-user-label");
    if (lbl) lbl.textContent = u?.fullname ? `${u.fullname} (${username})` : username;
    abrirModal("modal-chpass");
};

window.confirmarCambiarPassword = async function() {
    const username  = document.getElementById("chpass-username").value;
    const nueva     = document.getElementById("chpass-nueva").value;
    const confirmar = document.getElementById("chpass-confirmar").value;
    const errEl     = document.getElementById("chpass-error");
    errEl.textContent = "";
    if (nueva.length < 4) { errEl.textContent = "La contraseña debe tener al menos 4 caracteres."; return; }
    if (nueva !== confirmar) { errEl.textContent = "Las contraseñas no coinciden."; return; }
    try {
        const passwordHash = await sha256(nueva);
        const ref  = doc(db, "usuarios", username);
        const snap = await getDoc(ref);
        if (!snap.exists()) { errEl.textContent = "Operador no encontrado."; return; }
        const u = snap.data();
        await setDoc(ref, { ...u, passwordHash, password: null }, { merge: true });
        toast(`✔ Contraseña de "${username}" actualizada.`, "ok");
        await registrarBitacora("Cambio Contraseña",
            `Cambió contraseña del operador ${u.fullname} (${username})`);
        cerrarModal("modal-chpass");
    } catch (err) {
        console.error(err);
        errEl.textContent = "Error al guardar. Intentá de nuevo.";
    }
};

// ═══════════════════════════════════════════════════════════════
//  BIND EVENTOS
// ═══════════════════════════════════════════════════════════════
function bindEvents() {
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("logout-btn").addEventListener("click",  handleLogout);

    document.getElementById("btn-filter-todos").addEventListener("click",   () => cambiarFiltro("todos"));
    document.getElementById("btn-filter-pending").addEventListener("click", () => cambiarFiltro("Pendiente"));
    document.getElementById("btn-filter-voted").addEventListener("click",   () => cambiarFiltro("Votó"));
    document.getElementById("btn-filter-novoted").addEventListener("click", () => cambiarFiltro("No Votó"));

    document.querySelectorAll(".dash-row[data-filter]").forEach(row => {
        row.addEventListener("click", () => {
            const f = row.getAttribute("data-filter");
            if (f) {
                const tabPlanilla = document.getElementById("tab-planilla");
                if (tabPlanilla && !tabPlanilla.classList.contains("active")) {
                    switchTab("planilla");
                    setTimeout(() => cambiarFiltro(f), 50);
                } else {
                    cambiarFiltro(f);
                }
            }
        });
    });

    document.getElementById("tab-planilla").addEventListener("click",   () => switchTab("planilla"));
    document.getElementById("tab-stats").addEventListener("click",      () => switchTab("stats"));
    document.getElementById("tab-admin").addEventListener("click",      () => switchTab("admin"));
    document.getElementById("tab-padron-anr").addEventListener("click", () => switchTab("padron-anr"));

    document.getElementById("register-user-form").addEventListener("submit",    handleRegistrarUsuario);
    // Carga manual de votantes eliminada — todo se gestiona desde la pestaña Padrón ANR

    ["modal-novoto","modal-chpass","modal-obs-confirm","modal-historial"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("click", function(e) {
            if (e.target === this) {
                if (id === "modal-obs-confirm") cancelarObservacion();
                else cerrarModal(id);
            }
        });
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            ["modal-novoto", "modal-chpass", "modal-obs-confirm", "modal-historial"].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.classList.contains("active")) {
                    if (id === "modal-obs-confirm") cancelarObservacion();
                    else cerrarModal(id);
                }
            });
        }
    });

    const runSearch = debounce((val) => {
        state.searchQuery = val;
        if (!val) state.searchAllStates = false;
        state.pagination.page = 1;
        renderTablaVotantes();
    }, 300);

    document.getElementById("search-input").addEventListener("input", e => {
        runSearch(e.target.value.toLowerCase().trim());
    });

    const padronInp = document.getElementById("padron-anr-input");
    if (padronInp) padronInp.addEventListener("keydown", e => {
        if (e.key === "Enter") buscarPadronANR();
    });
}

// ═══════════════════════════════════════════════════════════════
//  PADRÓN ANR — Consulta desde CSV local
// ═══════════════════════════════════════════════════════════════
let _padronCache = null;

async function cargarPadronCSV() {
    if (_padronCache) return _padronCache;
    const resp = await fetch("data/padron_san_estanislao_2026_completo.csv");
    if (!resp.ok) throw new Error("No se pudo cargar el padrón CSV.");
    const texto   = await resp.text();
    const lineas  = texto.split("\n").filter(l => l.trim() !== "");
    const headers = lineas[0].split(",").map(h => h.trim().replace(/^\uFEFF/, ""));

    _padronCache = lineas.slice(1).map(linea => {
        const cols = [];
        let actual = "", enComilla = false;
        for (const ch of linea) {
            if (ch === '"') { enComilla = !enComilla; }
            else if (ch === "," && !enComilla) { cols.push(actual.trim()); actual = ""; }
            else { actual += ch; }
        }
        cols.push(actual.trim());
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] ?? ""; });
        return obj;
    });
    return _padronCache;
}

window.buscarPadronANR = async function() {
    const input   = document.getElementById("padron-anr-input");
    const loading = document.getElementById("padron-anr-loading");
    const error   = document.getElementById("padron-anr-error");
    const result  = document.getElementById("padron-anr-resultado");

    const cedula = input ? input.value.trim().replace(/\D/g, "") : "";
    if (!cedula || cedula.length < 3) {
        if (input) {
            input.style.outline = "2px solid var(--color-primary)";
            input.focus();
            setTimeout(() => input.style.outline = "", 1500);
        }
        return;
    }

    error.style.display   = "none";
    result.style.display  = "none";
    loading.style.display = "block";

    const btnAgregar = document.getElementById("pr-btn-agregar");
    if (btnAgregar) {
        btnAgregar.disabled = false;
        btnAgregar.style.background = "";
        btnAgregar.style.borderColor = "";
        btnAgregar.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Añadir a la planilla`;
    }

    try {
        const padron  = await cargarPadronCSV();
        const persona = padron.find(r => String(r.CEDULA).trim() === cedula);
        loading.style.display = "none";

        if (persona) {
            document.getElementById("pr-cedula").textContent       = persona.CEDULA        || cedula;
            document.getElementById("pr-nombres").textContent      = persona.NOMBRES        || "—";
            document.getElementById("pr-apellidos").textContent    = persona.APELLIDOS      || "—";
            document.getElementById("pr-departamento").textContent = persona.DEPARTAMENTO   || "—";
            document.getElementById("pr-distrito").textContent     = persona.DISTRITO       || "—";
            document.getElementById("pr-seccional").textContent    = persona.SECCIONAL      || "—";
            document.getElementById("pr-local").textContent        = persona.LOCAL_VOTACION || "—";
            document.getElementById("pr-mesa").textContent         = persona.MESA           || "—";
            document.getElementById("pr-orden").textContent        = persona.ORDEN          || "—";
            result.style.display = "block";
            registrarBitacora("Consulta Padrón",
                `Consultó CI ${cedula} → ${persona.NOMBRES} ${persona.APELLIDOS} · Mesa ${persona.MESA}`);
        } else {
            error.innerHTML = `
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#B91C1C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 10px;display:block;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div style="font-size:.92rem;font-weight:800;color:#B91C1C;margin-bottom:5px;">No está en el padrón</div>
                <div style="font-size:.8rem;color:#6B7280;">La cédula <strong style="color:#374151;">${cedula}</strong> no figura en el padrón ANR de San Estanislao 2026.</div>`;
            error.style.display = "block";
            registrarBitacora("Consulta Padrón", `CI ${cedula} — no encontrado`);
        }
    } catch (err) {
        loading.style.display = "none";
        error.innerHTML = `
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 10px;display:block;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <div style="font-size:.88rem;font-weight:800;color:#B45309;margin-bottom:5px;">No se pudo cargar el padrón</div>
            <div style="font-size:.78rem;color:#6B7280;">${escHtml(err.message)}</div>`;
        error.style.display = "block";
        console.error("Error padrón CSV:", err);
    }
};

// ═══════════════════════════════════════════════════════════════
//  AÑADIR DESDE PADRÓN → PLANILLA
// ═══════════════════════════════════════════════════════════════
function normalizarCedula(c) {
    return String(c).replace(/[\s\-]/g, "").replace(/^0+/, "");
}

window.agregarDesdePardon = async function() {
    const cedula    = document.getElementById("pr-cedula")?.textContent?.trim();
    const nombres   = document.getElementById("pr-nombres")?.textContent?.trim()   || "";
    const apellidos = document.getElementById("pr-apellidos")?.textContent?.trim() || "";
    const nombre    = `${nombres} ${apellidos}`.trim();

    if (!cedula || !nombre) { toast("No hay datos de consulta para agregar.", "error"); return; }

    const cedulaNorm = normalizarCedula(cedula);
    const enMemoria  = state.padron.find(p => normalizarCedula(p.cedula) === cedulaNorm);
    if (enMemoria) {
        toast(`⚠ ${enMemoria.nombre} (CI: ${cedula}) ya está en la planilla.`, "warn");
        _marcarBtnAgregado(false);
        return;
    }

    try {
        const snap = await getDoc(doc(db, "padron_extra", cedulaNorm));
        if (snap.exists()) {
            const d = snap.data();
            toast(`⚠ ${d.nombre || nombre} (CI: ${cedula}) ya fue agregado.`, "warn");
            return;
        }
        const snap2 = await getDoc(doc(db, "padron_extra", cedula));
        if (snap2.exists()) {
            const d = snap2.data();
            toast(`⚠ ${d.nombre || nombre} (CI: ${cedula}) ya fue agregado.`, "warn");
            return;
        }
    } catch (err) { console.warn("Verificación Firebase:", err); }

    const btn = document.getElementById("pr-btn-agregar");
    if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="margin:0 auto;width:20px;height:20px;"></div>`; }

    const local    = document.getElementById("pr-local")?.textContent?.trim()     || "";
    const mesa     = document.getElementById("pr-mesa")?.textContent?.trim()      || "";
    const orden    = document.getElementById("pr-orden")?.textContent?.trim()     || "";
    const seccional= document.getElementById("pr-seccional")?.textContent?.trim() || "";
    const nuevo = { id: "padron_" + Date.now(), nombre, cedula, domicilio: "---", local, mesa, orden, seccional };
    state.padron.push(nuevo);

    try {
        await setDoc(doc(db, "padron_extra", cedula), {
            ...nuevo,
            local:      document.getElementById("pr-local")?.textContent?.trim()     || "",
            mesa:       document.getElementById("pr-mesa")?.textContent?.trim()      || "",
            orden:      document.getElementById("pr-orden")?.textContent?.trim()     || "",
            seccional:  document.getElementById("pr-seccional")?.textContent?.trim() || "",
            creado_por: state.currentUser?.isAdmin ? "Administrador/a" : (state.currentUser?.username || "---"),
            origen:     "Padrón ANR",
            timestamp:  serverTimestamp()
        });
        toast(`✔ ${nombre} agregado a la planilla.`, "ok");
        await registrarBitacora("Nuevo Votante", `Agregó desde padrón ANR: ${nombre} (CI: ${cedula})`);
        _marcarBtnAgregado(true);
        actualizarDashboard();
    } catch (err) {
        console.error(err);
        state.padron = state.padron.filter(p => p.cedula !== cedula);
        toast("Error al guardar. Verificá la conexión.", "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Añadir a la planilla`;
        }
    }
};

function _marcarBtnAgregado(exito) {
    const btn = document.getElementById("pr-btn-agregar");
    if (!btn) return;
    btn.disabled = true;
    if (exito) {
        btn.style.background = "linear-gradient(135deg, #15803D, #166534)";
        btn.style.borderColor = "#166534";
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Ya está en la planilla`;
    } else {
        btn.style.background = "linear-gradient(135deg, #B45309, #92400E)";
        btn.style.borderColor = "#78350F";
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Ya existe en la planilla`;
    }
}

// ═══════════════════════════════════════════════════════════════
//  MODO ELIMINACIÓN — Solo ADMIN (con delegación de eventos)
// ═══════════════════════════════════════════════════════════════
const elimState = {
    activo:        false,
    seleccionados: new Set()
};

function actualizarBotonTrash() {
    const btn = document.getElementById("btn-trash-flotante");
    if (!btn) return;
    if (state.currentUser?.isAdmin) {
        btn.classList.remove("hidden");
        btn.title = elimState.activo ? "Cancelar selección" : "Eliminar registros";
    } else {
        btn.classList.add("hidden");
        if (elimState.activo) cancelarModoEliminar();
    }
}

function toggleModoEliminar() {
    if (!state.currentUser?.isAdmin) return;
    if (elimState.activo) {
        cancelarModoEliminar();
    } else {
        activarModoEliminar();
    }
}

window.activarModoEliminar = function() {
    if (!state.currentUser?.isAdmin) return;
    elimState.activo = true;
    elimState.seleccionados.clear();

    document.getElementById("cards-container")?.classList.add("modo-eliminar");
    document.querySelector(".tabla-desktop")?.classList.add("modo-eliminar");

    const btnTrash = document.getElementById("btn-trash-flotante");
    if (btnTrash) {
        btnTrash.classList.add("modo-activo");
        btnTrash.title = "Cancelar selección";
    }

    document.getElementById("banner-eliminar")?.classList.remove("hidden");
    actualizarBannerCount();
};

window.cancelarModoEliminar = function() {
    elimState.activo = false;
    elimState.seleccionados.clear();

    const cards = document.getElementById("cards-container");
    const wrap  = document.querySelector(".tabla-desktop");
    if (cards) {
        cards.classList.remove("modo-eliminar");
        cards.querySelectorAll(".card-votante.seleccionado").forEach(el => el.classList.remove("seleccionado"));
    }
    if (wrap) {
        wrap.classList.remove("modo-eliminar");
        wrap.querySelectorAll("tr.seleccionado").forEach(el => el.classList.remove("seleccionado"));
    }

    const btnTrash = document.getElementById("btn-trash-flotante");
    if (btnTrash) {
        btnTrash.classList.remove("modo-activo");
        btnTrash.title = "Eliminar registros";
    }

    document.getElementById("banner-eliminar")?.classList.add("hidden");
    cerrarModal("modal-eliminar-confirm");
};

window.seleccionarTodosEliminar = function() {
    const cards = document.querySelectorAll('.card-votante[data-cedula]');
    const filas = document.querySelectorAll('#votantes-table-body tr[data-cedula]');
    const todos = [...cards, ...filas];
    const todosSeleccionados = todos.every(el => el.classList.contains('seleccionado'));
    todos.forEach(el => {
        const cedula = el.dataset.cedula;
        if (!cedula) return;
        if (todosSeleccionados) {
            el.classList.remove("seleccionado");
            elimState.seleccionados.delete(cedula);
        } else {
            el.classList.add("seleccionado");
            elimState.seleccionados.add(cedula);
        }
    });
    actualizarBannerCount();
};

function _toggleSeleccion(cedula) {
    const card = document.querySelector(`.card-votante[data-cedula="${cedula}"]`);
    const fila = document.querySelector(`#votantes-table-body tr[data-cedula="${cedula}"]`);
    if (elimState.seleccionados.has(cedula)) {
        elimState.seleccionados.delete(cedula);
        card?.classList.remove("seleccionado");
        fila?.classList.remove("seleccionado");
    } else {
        elimState.seleccionados.add(cedula);
        card?.classList.add("seleccionado");
        fila?.classList.add("seleccionado");
    }
    actualizarBannerCount();
}

function actualizarBannerCount() {
    const n = elimState.seleccionados.size;
    const span = document.getElementById("banner-eliminar-count");
    if (span) span.textContent = n === 0 ? "Ninguno seleccionado" : `${n} seleccionado${n > 1 ? "s" : ""}`;
    const btn = document.getElementById("btn-eliminar-seleccionados");
    if (btn) {
        btn.style.opacity        = n > 0 ? "1" : ".4";
        btn.style.pointerEvents  = n > 0 ? "auto" : "none";
    }
}

window.pedirConfirmacionEliminar = function() {
    if (!elimState.activo || elimState.seleccionados.size === 0) return;
    const n = elimState.seleccionados.size;
    const txt = document.getElementById("modal-eliminar-texto");
    if (txt) txt.textContent =
        `¿Estás seguro que querés eliminar ${n} registro${n > 1 ? "s" : ""} de la planilla? Esta acción no se puede deshacer.`;
    abrirModal("modal-eliminar-confirm");
};

window.confirmarEliminarSeleccionados = async function() {
    if (!state.currentUser?.isAdmin || elimState.seleccionados.size === 0) return;
    cerrarModal("modal-eliminar-confirm");

    const cedulas = [...elimState.seleccionados];
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

    cancelarModoEliminar();
    actualizarDashboard();
    renderTablaVotantes();

    toast(err === 0
        ? `✔ ${ok} registro${ok > 1 ? "s eliminados" : " eliminado"} correctamente.`
        : `⚠ ${ok} eliminados, ${err} con error.`,
        err === 0 ? "ok" : "warn");
};

// Delegación de eventos para modo eliminar (evita conflictos con botones)
document.addEventListener("DOMContentLoaded", () => {
    const cardsContainer = document.getElementById("cards-container");
    const tablaBody = document.getElementById("votantes-table-body");

    if (cardsContainer) {
        cardsContainer.addEventListener("click", (e) => {
            if (!elimState.activo) return;
            let target = e.target.closest(".card-votante");
            if (!target) return;
            // Si el clic fue sobre un botón o dentro de un botón, no seleccionar
            if (e.target.closest("button") || e.target.closest(".btn-accion") || e.target.closest(".btn-obs") || e.target.closest(".btn-secondary")) {
                return;
            }
            const cedula = target.dataset.cedula;
            if (cedula) _toggleSeleccion(cedula);
        });
    }

    if (tablaBody) {
        tablaBody.addEventListener("click", (e) => {
            if (!elimState.activo) return;
            let target = e.target.closest("tr");
            if (!target) return;
            if (e.target.closest("button") || e.target.closest(".btn-accion") || e.target.closest(".btn-obs") || e.target.closest(".btn-secondary")) {
                return;
            }
            const cedula = target.dataset.cedula;
            if (cedula) _toggleSeleccion(cedula);
        });
    }

    // Botón flotante toggle
    const btnTrash = document.getElementById("btn-trash-flotante");
    if (btnTrash) {
        btnTrash.addEventListener("click", toggleModoEliminar);
    }
});

// ═══════════════════════════════════════════════════════════════
//  FILTROS Y NAVEGACIÓN
// ═══════════════════════════════════════════════════════════════
function cambiarFiltro(destino) {
    state.currentFilter = destino;
    state.searchAllStates = false;
    state.pagination.page = 1;
    renderTablaVotantes();
    const cards = document.getElementById("cards-container");
    if (cards && window.innerWidth < 768) {
        cards.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}
window.cambiarFiltro = cambiarFiltro;

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
        toast("Acceso denegado. Solo el Administrador.", "error"); return;
    }
    const planilla     = document.getElementById("view-planilla");
    const stats        = document.getElementById("view-stats");
    const admin        = document.getElementById("view-admin");
    const padronAnr    = document.getElementById("view-padron-anr");
    const fw           = document.getElementById("filter-wrapper");
    const metrics      = document.getElementById("metrics-wrapper");
    const tabPlanilla  = document.getElementById("tab-planilla");
    const tabStats     = document.getElementById("tab-stats");
    const tabAdmin     = document.getElementById("tab-admin");
    const tabPadronAnr = document.getElementById("tab-padron-anr");

    if (!planilla || !admin) return;

    planilla.style.display = "none";
    stats.classList.remove("visible");
    stats.style.display = "none";
    admin.classList.remove("visible");
    admin.style.display = "none";
    if (padronAnr) padronAnr.style.display = "none";
    if (fw)        fw.style.display        = "none";
    if (metrics)   metrics.style.display   = "none";
    if (tabPlanilla)  tabPlanilla.classList.remove("active");
    if (tabStats)     tabStats.classList.remove("active");
    if (tabAdmin)     tabAdmin.classList.remove("active");
    if (tabPadronAnr) tabPadronAnr.classList.remove("active");

    if (tab === "planilla") {
        planilla.style.display = "";
        if (fw)        fw.style.display      = "block";
        if (metrics)   metrics.style.display = "grid";
        if (tabPlanilla) tabPlanilla.classList.add("active");
        state.currentFilter = "todos";
        renderTablaVotantes();
    } else if (tab === "stats") {
        stats.style.display = "block";
        stats.classList.add("visible");
        if (tabStats) tabStats.classList.add("active");
        // Reiniciar vista de estadísticas
        currentStatsView = "locales";
        currentLocalForMesas = null;
        renderStatsCharts();
    } else if (tab === "admin") {
        admin.style.display = "flex";
        admin.classList.add("visible");
        if (tabAdmin) tabAdmin.classList.add("active");
        cargarUsuarios();
        escucharBitacora();
        cargarLocalesDesdePadron();
    } else if (tab === "padron-anr") {
        if (padronAnr) padronAnr.style.display = "";
        if (tabPadronAnr) tabPadronAnr.classList.add("active");
        const inp = document.getElementById("padron-anr-input");
        const err = document.getElementById("padron-anr-error");
        const res = document.getElementById("padron-anr-resultado");
        const lod = document.getElementById("padron-anr-loading");
        if (inp) inp.value = "";
        if (err) err.style.display = "none";
        if (res) res.style.display = "none";
        if (lod) lod.style.display = "none";
        setTimeout(() => { if (inp) inp.focus(); }, 100);
    }
}

// Exponer funciones globales necesarias
window.exportarXLSX = exportarXLSX;
window.exportarEstadisticasXLSX = exportarEstadisticasXLSX;
window.accionVoto = accionVoto;
window.abrirModalObservacion = abrirModalObservacion;
window.abrirHistorial = abrirHistorial;
window.activarBusquedaGlobal = activarBusquedaGlobal;
window.desactivarBusquedaGlobal = desactivarBusquedaGlobal;
window.confirmNoVoto = confirmNoVoto;
window.confirmarObservacion = confirmarObservacion;
window.cancelarObservacion = cancelarObservacion;
window.cambiarFiltro = cambiarFiltro;
window.volverALocales = volverALocales;
window.agregarDesdePardon = agregarDesdePardon;
window.buscarPadronANR = buscarPadronANR;
window.abrirCambiarPassword = abrirCambiarPassword;
window.confirmarCambiarPassword = confirmarCambiarPassword;
window.deleteUser = deleteUser;
window.toggleModoEliminar = toggleModoEliminar;
window.activarModoEliminar = activarModoEliminar;
window.cancelarModoEliminar = cancelarModoEliminar;
window.seleccionarTodosEliminar = seleccionarTodosEliminar;
window.pedirConfirmacionEliminar = pedirConfirmacionEliminar;
window.confirmarEliminarSeleccionados = confirmarEliminarSeleccionados;
