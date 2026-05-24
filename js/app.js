// ═══════════════════════════════════════════════════════════════
//  CONTROL ELECTORAL — app.js  v4  (SEGURO)
//  Firebase Firestore (tiempo real) + CSV padrón base
//  — Usuarios online en tiempo real (onSnapshot presencia)
//  — Bitácora completa de actividad en Firestore
//  — Cualquier operador puede quitar Voto y No Votó
//  — Hora en zona Paraguay (America/Asuncion) formato 24 h
//  — Contraseñas hasheadas SHA-256 (nunca en texto plano)
//  — Sesión persistente en localStorage con expiración 7 días
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
// SEGURIDAD: Las credenciales del Admin se verifican con SHA-256.
// El hash de abajo corresponde a tu contraseña actual "CAROL2T3".
// Para cambiarlo: abrí la consola del navegador y ejecutá:
//   sha256("NUEVA_CONTRASEÑA")  →  copiá el resultado aquí.
const ADMIN_USER_ID   = "admin";   // ID interno (minúsculas, no visible al usuario)
const ADMIN_HASH      = "3125998a39f131e03ee8a3cad1ea1fb31327e6a610e1c21cc0ff50ee00495a03"; // SHA-256 de "CAROL2T3"
const ADMIN_FULLNAME  = "Administrador/a";
const SESSION_KEY     = "ce_session_v4";
const SESSION_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos
const CSV_PATH        = "data/votantes.csv";
const TZ_PY           = "America/Asuncion";

// ── Estado global ───────────────────────────────────────────────
const state = {
    currentUser:      null,
    padron:           [],
    votos:            {},
    usuarios:         [],
    currentFilter:    "Pendiente",
    searchQuery:      "",
    searchAllStates:  false,
    pendingNoVoto:    null,
    unsubVotos:       null,
    unsubPresencia:   null,
    unsubBitacora:    null,
    onlineUsers:      {},
    presenceInterval: null,
};

// ═══════════════════════════════════════════════════════════════
//  SEGURIDAD — SHA-256 con Web Crypto API (nativo del navegador)
// ═══════════════════════════════════════════════════════════════
async function sha256(texto) {
    const encoder = new TextEncoder();
    const data    = encoder.encode(texto);
    const hash    = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

// Expone sha256 en consola para que el admin pueda generar hashes
window.sha256 = sha256;


function ahoraParaguay() {
    return new Date().toLocaleString("es-PY", {
        timeZone:  TZ_PY,
        day:       "2-digit",
        month:     "2-digit",
        year:      "numeric",
        hour:      "2-digit",
        minute:    "2-digit",
        hour12:    false
    });
    // Ej: "23/05/2026, 14:37"
}

function timestampAParaguay(ts) {
    if (!ts) return "---";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("es-PY", {
        timeZone: TZ_PY,
        day:      "2-digit",
        month:    "2-digit",
        year:     "numeric",
        hour:     "2-digit",
        minute:   "2-digit",
        hour12:   false
    });
}

// ═══════════════════════════════════════════════════════════════
//  BITÁCORA
// ═══════════════════════════════════════════════════════════════
async function registrarBitacora(accion, detalle) {
    try {
        await addDoc(collection(db, "bitacora"), {
            operador:  state.currentUser?.fullname || "---",
            username:  state.currentUser?.username || "---",
            accion,
            detalle,
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
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-gray);padding:20px;">Sin actividad registrada aún.</td></tr>`;
        return;
    }

    // Colores por tipo de acción
    const colorMap = {
        "Votó":             "#22c55e",
        "No Votó":          "#f59e0b",
        "Quitar Voto":      "#ef4444",
        "Quitar No Votó":   "#a78bfa",
        "Nuevo Votante":    "#38bdf8",
        "Nuevo Operador":   "#f472b6",
        "Eliminar Operador":"#ef4444",
        "Observación":      "#94a3b8",
        "Login":            "#6ee7b7",
        "Logout":           "#9ca3af",
        "Consulta Padrón":  "#facc15",
    };

    tbody.innerHTML = eventos.map(e => {
        const hora  = e.hora_py || timestampAParaguay(e.timestamp) || "---";
        const color = colorMap[e.accion] || "#aaa";
        return `
            <tr>
                <td style="white-space:nowrap;font-size:0.78rem;color:var(--color-gray);font-family:monospace">${hora}</td>
                <td><strong style="color:var(--color-light)">${escHtml(e.operador)}</strong><br>
                    <span style="font-size:0.72rem;color:var(--color-gray)">${escHtml(e.username)}</span></td>
                <td><span class="bit-badge" style="background:${color}22;color:${color};border:1px solid ${color}55">${escHtml(e.accion)}</span></td>
                <td style="font-size:0.82rem;color:var(--color-light)">${escHtml(e.detalle)}</td>
            </tr>`;
    }).join("");
}

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
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
            const session = JSON.parse(raw);
            const age     = Date.now() - (session.loginAt || 0);
            if (age < SESSION_TTL_MS && session.user) {
                loginSuccess(session.user, false);
                return;
            } else {
                localStorage.removeItem(SESSION_KEY); // sesión expirada
            }
        }
    } catch { /**/ }
    showLogin();
}

async function handleLogin(e) {
    e.preventDefault();
    // Limpieza exhaustiva: elimina espacios, saltos de línea y caracteres invisibles
    const userIn   = document.getElementById("username").value.replace(/\s+/g, "").trim();
    const passIn   = document.getElementById("password").value.replace(/\s+/g, "").trim();
    const errEl    = document.getElementById("login-error");
    const btnLogin = e.target.querySelector("button[type=submit]");
    errEl.textContent = "";

    if (!userIn || !passIn) {
        errEl.textContent = "Completá usuario y contraseña.";
        return;
    }

    if (btnLogin) { btnLogin.disabled = true; btnLogin.textContent = "Verificando..."; }

    const resetBtn = () => {
        if (btnLogin) { btnLogin.disabled = false; btnLogin.textContent = "Ingresar al Sistema"; }
    };

    try {
        const passHash = await sha256(passIn);

        // ── Admin: acepta "Admin", "admin", "ADMIN" — cualquier capitalización ──
        if (userIn.toLowerCase() === ADMIN_USER_ID) {
            if (passHash === ADMIN_HASH) {
                resetBtn();
                loginSuccess({ username: ADMIN_USER_ID, fullname: ADMIN_FULLNAME, isAdmin: true }, true);
                return;
            } else {
                errEl.textContent = "Contraseña incorrecta para Admin.";
                resetBtn();
                return;
            }
        }

        // ── Operadores en Firestore ───────────────────────────────
        const snap = await getDoc(doc(db, "usuarios", userIn.toLowerCase()));
        if (snap.exists()) {
            const u = snap.data();
            const match = u.passwordHash
                ? u.passwordHash === passHash
                : u.password === passIn; // compatibilidad cuentas viejas
            if (match) {
                resetBtn();
                loginSuccess({ username: u.username, fullname: u.fullname, isAdmin: false }, true);
                return;
            }
        }

        errEl.textContent = "Usuario o contraseña incorrectos.";
        resetBtn();
    } catch (err) {
        console.error("Login error:", err);
        // Mostrar mensaje más específico según tipo de error
        if (err.code === "unavailable" || err.message?.includes("network")) {
            errEl.textContent = "Sin conexión a internet. Verificá tu red e intentá de nuevo.";
        } else if (err.code === "permission-denied") {
            errEl.textContent = "Error de permisos en la base de datos. Contactá al administrador.";
        } else {
            errEl.textContent = "Error al conectar. Revisá tu internet e intentá de nuevo.";
        }
        resetBtn();
    }
}

function loginSuccess(user, persist) {
    try {
        state.currentUser = user;

        if (persist) {
            try {
                localStorage.setItem(SESSION_KEY, JSON.stringify({ user, loginAt: Date.now() }));
            } catch(e) { console.warn("No se pudo guardar sesión:", e); }
        }

        // Mostrar nombre de usuario en la app
        const prefixEl  = document.getElementById("user-prefix");
        const displayEl = document.getElementById("current-user-display");
        if (prefixEl)  prefixEl.textContent  = user.isAdmin ? "" : "Operador: ";
        if (displayEl) displayEl.textContent = user.fullname;

        // Mostrar/ocultar tab Admin y botón Exportar
        const tabAdmin    = document.getElementById("tab-admin");
        const btnExportar = document.getElementById("btn-exportar");
        if (tabAdmin)    user.isAdmin ? tabAdmin.classList.remove("hidden")  : tabAdmin.classList.add("hidden");
        if (btnExportar) btnExportar.style.display = user.isAdmin ? "flex" : "none";

        // Cambiar vista PRIMERO, limpiar form DESPUÉS
        showApp();
        state.currentFilter = "todos";
        switchTab("planilla");

        // Limpiar el formulario de login (ahora ya no se ve)
        const loginForm = document.getElementById("login-form");
        if (loginForm) loginForm.reset();

        // Cargar datos en segundo plano
        loadPadronYEscuchar();
        iniciarPresencia();

        registrarBitacora("Login", `${user.fullname} ingresó al sistema`);

    } catch(err) {
        console.error("Error en loginSuccess:", err);
        // Aunque falle algo interno, al menos mostrar la app
        try { showApp(); } catch(e2) { /**/ }
    }
}

function handleLogout() {
    registrarBitacora("Logout", `${state.currentUser?.fullname} cerró sesión`);
    quitarPresencia();
    localStorage.removeItem(SESSION_KEY);
    if (state.unsubVotos)     { state.unsubVotos();     state.unsubVotos     = null; }
    if (state.unsubPresencia) { state.unsubPresencia(); state.unsubPresencia = null; }
    if (state.unsubBitacora)  { state.unsubBitacora();  state.unsubBitacora  = null; }
    if (state.presenceInterval) { clearInterval(state.presenceInterval); state.presenceInterval = null; }
    state.currentUser = null;
    state.padron      = [];
    state.votos       = {};
    state.onlineUsers = {};
    setStatus(false);
    showLogin();
}

// ═══════════════════════════════════════════════════════════════
//  PRESENCIA — onSnapshot en tiempo real
// ═══════════════════════════════════════════════════════════════
async function iniciarPresencia() {
    if (!state.currentUser) return;

    await marcarOnline();
    state.presenceInterval = setInterval(marcarOnline, 25000);

    // onSnapshot → actualización en tiempo real sin polling
    if (state.unsubPresencia) state.unsubPresencia();
    state.unsubPresencia = onSnapshot(collection(db, "presencia"), snap => {
        state.onlineUsers = {};
        const ahora = Date.now();
        snap.forEach(d => {
            const data     = d.data();
            const lastSeen = data.lastSeen?.toMillis?.() || 0;
            // Online = heartbeat en últimos 90 s
            if (ahora - lastSeen < 90000) {
                state.onlineUsers[d.id] = data;
            }
        });
        renderOnlineUsers();
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

function renderOnlineUsers() {
    const container = document.getElementById("online-users-list");
    if (!container) return;
    const users   = Object.values(state.onlineUsers);
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
        </div>`).join("");
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
        console.error("CSV error:", err);
        toast("No se pudo cargar el padrón base.", "error");
        state.padron = [];
    }

    try {
        const snap = await getDocs(collection(db, "padron_extra"));
        snap.forEach(d => {
            const v = d.data();
            const ced = String(v.cedula || "").replace(/[\s\-]/g, "").replace(/^0+/, "");
            if (!state.padron.some(p => p.cedula === ced))
                state.padron.push({ id: v.id, nombre: v.nombre, cedula: ced, domicilio: v.domicilio });
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
        },
        err => { console.error(err); setStatus(false); }
    );

    if (state.currentUser?.isAdmin) {
        cargarUsuarios();
        escucharBitacora();
    }
}

function parsearCSV(texto) {
    const lineas = texto.split("\n").filter(l => l.trim());
    const result = [];
    for (let i = 1; i < lineas.length; i++) {
        const c = lineas[i].split(",");
        const ced = String(c[2]?.trim() || "").replace(/[\s\-]/g, "").replace(/^0+/, "");
        result.push({
            id:        c[0]?.trim() || String(i),
            nombre:    c[1]?.trim() || "Sin nombre",
            cedula:    ced,
            domicilio: c[4]?.trim() || "---",
        });
    }
    return result;
}

const getVoto = c => state.votos[c]?.voto          || "Pendiente";
const getObs  = c => state.votos[c]?.observaciones || "";
const getLog  = c => state.votos[c]?.modificado_por || "---";

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
//  TABLA VOTANTES — con búsqueda global y vista móvil
// ═══════════════════════════════════════════════════════════════
function renderTablaVotantes() {
    const tbody      = document.getElementById("votantes-table-body");
    const searchHint = document.getElementById("search-hint");
    tbody.innerHTML  = "";

    const q = state.searchQuery;

    // Orden de estado: Votó=0, No Votó=1, Pendiente=2
    const ordenEstado = v => {
        const voto = getVoto(v.cedula);
        if (voto === "Votó")    return 0;
        if (voto === "No Votó") return 1;
        return 2;
    };

    let lista;
    if (q && state.searchAllStates) {
        lista = state.padron.filter(v =>
            v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
        lista.sort((a, b) => ordenEstado(a) - ordenEstado(b));
    } else if (state.currentFilter === "todos") {
        lista = [...state.padron];
        if (q) lista = lista.filter(v =>
            v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
        lista.sort((a, b) => ordenEstado(a) - ordenEstado(b));
    } else {
        lista = state.padron.filter(v => getVoto(v.cedula) === state.currentFilter);
        if (q) lista = lista.filter(v =>
            v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
    }

    // Actualizar visualmente los botones de filtro
    const btnP = document.getElementById("btn-filter-pending");
    const btnV = document.getElementById("btn-filter-voted");
    const btnN = document.getElementById("btn-filter-novoted");
    if (btnP && btnV && btnN) {
        [btnP, btnV, btnN].forEach(b => b.className = "filter-btn");
        if (state.currentFilter === "Pendiente") btnP.classList.add("f-pending");
        if (state.currentFilter === "Votó")      btnV.classList.add("f-voted");
        if (state.currentFilter === "No Votó")   btnN.classList.add("f-novoted");
    }

    // Hint: avisa si hay resultados en otros estados
    if (searchHint) {
        if (q && !state.searchAllStates) {
            const totalMatch = state.padron.filter(v =>
                v.nombre.toLowerCase().includes(q) || v.cedula.includes(q)).length;
            const otros = totalMatch - lista.length;
            if (otros > 0) {
                searchHint.style.display = "flex";
                searchHint.innerHTML = `
                    <svg width="14" height="14" style="flex-shrink:0"><use href="#icon-search"/></svg>
                    <span>Se encontraron <strong>${otros}</strong> resultado${otros>1?"s":""} en otros estados.</span>
                    <button onclick="activarBusquedaGlobal()" class="btn-hint-global">Ver todos</button>`;
            } else {
                searchHint.style.display = "none";
            }
        } else if (q && state.searchAllStates) {
            searchHint.style.display = "flex";
            searchHint.innerHTML = `
                <svg width="14" height="14" style="flex-shrink:0"><use href="#icon-search"/></svg>
                <span>Mostrando resultados de <strong>todos los estados</strong>.</span>
                <button onclick="desactivarBusquedaGlobal()" class="btn-hint-volver">Volver al filtro</button>`;
        } else {
            searchHint.style.display = "none";
        }
    }

    if (!lista.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--color-gray);padding:30px;">No se encontraron registros.</td></tr>`;
        return;
    }

    const esMobile = window.innerWidth < 640;

    lista.forEach((v, idx) => {
        const voto = getVoto(v.cedula);
        const obs  = getObs(v.cedula);
        const log  = getLog(v.cedula);

        let badgeClass = "badge badge-pending", badgeLabel = "Pendiente";
        if (voto === "Votó")    { badgeClass = "badge badge-voted";   badgeLabel = "Votó"; }
        if (voto === "No Votó") { badgeClass = "badge badge-novoted"; badgeLabel = "No Votó"; }

        const clsVoto   = voto === "Votó"    ? "btn-accion sel-voto"   : "btn-accion";
        const clsNoVoto = voto === "No Votó" ? "btn-accion sel-novoto" : "btn-accion";

        const btnVotoHtml = `
            <button class="${clsVoto}" onclick="accionVoto('${v.cedula}','Votó')" title="${voto==='Votó'?'Quitar voto':'Marcar como Votó'}">
                <svg width="12" height="12"><use href="#icon-check"/></svg>
                ${voto === "Votó" ? "Votó ✕" : "Votó"}
            </button>`;

        const btnNoVotoHtml = `
            <button class="${clsNoVoto}" onclick="accionVoto('${v.cedula}','No Votó')" title="${voto==='No Votó'?'Quitar No Votó':'Marcar como No Votó'}">
                <svg width="12" height="12"><use href="#icon-x"/></svg>
                ${voto === "No Votó" ? "No Votó ✕" : "No Votó"}
            </button>`;

        const tr = document.createElement("tr");

        if (esMobile) {
            tr.className = "fila-mobile";
            tr.innerHTML = `
                <td colspan="8" class="celda-mobile">
                    <div class="card-mobile">
                        <div class="card-mobile-top">
                            <div style="min-width:0;flex:1">
                                <span class="card-mobile-num">${idx+1}.</span>
                                <strong class="card-mobile-nombre">${escHtml(v.nombre)}</strong>
                                <div class="card-mobile-cedula">CI: ${v.cedula} · ${escHtml(v.domicilio)}</div>
                            </div>
                            <span class="${badgeClass}" style="flex-shrink:0">${badgeLabel}</span>
                        </div>
                        <div class="card-mobile-btns action-btns">
                            ${btnVotoHtml}
                            ${btnNoVotoHtml}
                        </div>
                        <input class="obs-input obs-mobile" value="${escHtml(obs)}"
                            placeholder="Observación..."
                            onblur="pedirConfirmarObservacion('${v.cedula}', this, '${escHtml(v.nombre)}')">
                        <div class="log-span" style="margin-top:4px;font-size:.7rem">${escHtml(log)}</div>
                    </div>
                </td>`;
        } else {
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
                        onblur="pedirConfirmarObservacion('${v.cedula}', this, '${escHtml(v.nombre)}')">
                </td>
                <td><span class="log-span">${escHtml(log)}</span></td>`;
        }
        tbody.appendChild(tr);
    });
}

window.activarBusquedaGlobal = function() {
    state.searchAllStates = true;
    renderTablaVotantes();
};
window.desactivarBusquedaGlobal = function() {
    state.searchAllStates = false;
    renderTablaVotantes();
};

// ═══════════════════════════════════════════════════════════════
//  ACCIONES DE VOTO
// ═══════════════════════════════════════════════════════════════
window.accionVoto = function(cedula, accion) {
    const actual = getVoto(cedula);
    const v      = state.padron.find(p => p.cedula === cedula);
    const nombre = v?.nombre || cedula;

    // Toggle Votó → Pendiente (cualquier usuario)
    if (actual === "Votó" && accion === "Votó") {
        guardarVoto(cedula, "Pendiente", "", "Quitar Voto",
            `Quitó VOTO de ${nombre}`);
        return;
    }

    // Toggle No Votó → Pendiente (cualquier usuario)
    if (actual === "No Votó" && accion === "No Votó") {
        guardarVoto(cedula, "Pendiente", "", "Quitar No Votó",
            `Quitó NO VOTÓ de ${nombre}`);
        return;
    }

    if (accion === "No Votó") {
        state.pendingNoVoto = { cedula, nombre };
        document.getElementById("modal-novoto-name").textContent = nombre;
        document.getElementById("modal-obs-input").value = getObs(cedula);
        abrirModal("modal-novoto");
    } else {
        guardarVoto(cedula, "Votó", "", "Votó",
            `Registró a ${nombre} como VOTÓ`);
    }
};

window.confirmNoVoto = function() {
    if (!state.pendingNoVoto) return;
    const { cedula, nombre } = state.pendingNoVoto;
    const obs = document.getElementById("modal-obs-input").value.trim();
    guardarVoto(cedula, "No Votó", obs, "No Votó",
        `Registró a ${nombre} como NO VOTÓ${obs ? " — " + obs : ""}`);
    cerrarModal("modal-novoto");
    state.pendingNoVoto = null;
};

async function guardarVoto(cedula, voto, observaciones, accionBit, detalleBit) {
    const operador = state.currentUser.isAdmin ? "Administrador/a" : state.currentUser.username;
    const hora     = ahoraParaguay();
    try {
        await setDoc(doc(db, "votos", cedula), {
            voto,
            observaciones,
            modificado_por: `${operador} — ${hora}`,
            timestamp:      serverTimestamp()
        });
        // Toast
        if      (voto === "Votó")    toast("✔ ¡Voto registrado correctamente!", "ok");
        else if (voto === "No Votó") toast("✔ Registrado como No Votó.", "ok");
        else                         toast("Registro vuelto a Pendiente.", "warn");
        // Bitácora
        await registrarBitacora(accionBit, detalleBit);
    } catch (err) {
        console.error(err);
        toast("Error al guardar. Verificá la conexión.", "error");
    }
}

// Estado temporal para obs pendiente de confirmar
let _obsPendiente = null;

window.pedirConfirmarObservacion = function(cedula, inputEl, nombre) {
    const texto = inputEl.value.trim();
    const anterior = getObs(cedula);
    // Solo abrir modal si el texto cambió y no está vacío o si se borró
    if (texto === anterior) return;

    _obsPendiente = { cedula, texto, inputEl, anterior };

    document.getElementById("modal-obs-nombre").textContent =
        `Votante: ${nombre || cedula}`;
    document.getElementById("modal-obs-preview").textContent =
        texto || "(sin observación)";

    abrirModal("modal-obs-confirm");
};

window.confirmarObservacion = async function() {
    if (!_obsPendiente) return;
    const { cedula, texto, inputEl } = _obsPendiente;
    cerrarModal("modal-obs-confirm");
    await actualizarObservacion(cedula, texto);
    _obsPendiente = null;
};

window.cancelarObservacion = function() {
    if (_obsPendiente) {
        // Revertir el input al valor anterior
        if (_obsPendiente.inputEl) _obsPendiente.inputEl.value = _obsPendiente.anterior;
        _obsPendiente = null;
    }
    cerrarModal("modal-obs-confirm");
};

window.actualizarObservacion = async function(cedula, texto) {
    const actual   = state.votos[cedula] || {};
    const operador = state.currentUser.isAdmin ? "Administrador/a" : state.currentUser.username;
    const hora     = ahoraParaguay();
    const v        = state.padron.find(p => p.cedula === cedula);
    try {
        await setDoc(doc(db, "votos", cedula), {
            voto:           actual.voto || "Pendiente",
            observaciones:  texto.trim(),
            modificado_por: `${operador} — ${hora}`,
            timestamp:      serverTimestamp()
        });
        toast("✔ Observación guardada correctamente.", "ok");
        await registrarBitacora("Observación",
            `Actualizó obs. de ${v?.nombre || cedula}: "${texto.trim().substring(0,60)}"`);
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
        await registrarBitacora("Nuevo Votante",
            `Registró a ${nombre} (CI: ${cedula}) en el padrón`);
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
    } catch (err) { console.error(err); }
}

async function handleRegistrarUsuario(e) {
    e.preventDefault();
    const fullname = document.getElementById("reg-fullname").value.trim();
    const phone    = document.getElementById("reg-phone").value.trim();
    const username = document.getElementById("reg-username").value.trim().toLowerCase();
    const password = document.getElementById("reg-password").value;

    if (username === ADMIN_USER_ID) {
        toast("Ese nombre de usuario está reservado.", "error");
        return;
    }

    try {
        const existe = await getDoc(doc(db, "usuarios", username));
        if (existe.exists()) { toast("El nombre de usuario ya existe.", "error"); return; }

        // Guardar solo el hash, NUNCA la contraseña en texto plano
        const passwordHash = await sha256(password);

        await setDoc(doc(db, "usuarios", username), {
            username, fullname, phone, passwordHash, isAdmin: false
            // "password" ya no se guarda
        });
        toast(`✔ Operador "${fullname}" creado correctamente.`);
        await registrarBitacora("Nuevo Operador",
            `Creó operador ${fullname} (usuario: ${username})`);
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
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-gray);padding:20px;">No hay operadores registrados.</td></tr>`;
        return;
    }

    state.usuarios.forEach(u => {
        const phoneRaw   = (u.phone || "").replace(/[\s\-\+]/g, "");
        // Si empieza con 0 (formato local paraguayo 09xx), reemplazar por 595
        const phoneClean = phoneRaw.startsWith("0") ? "595" + phoneRaw.slice(1) : phoneRaw;
        const waLink     = phoneClean ? `https://wa.me/${phoneClean}` : null;
        const isOnline   = !!state.onlineUsers[u.username?.toLowerCase()];

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>
                ${isOnline ? '<span class="online-dot-sm" style="display:inline-block;margin-right:5px"></span>' : ''}
                ${escHtml(u.fullname)}
            </td>
            <td>
                ${waLink
                    ? `<a href="${waLink}" target="_blank" rel="noopener" class="wa-link">
                           <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
                           ${escHtml(u.phone)}
                       </a>`
                    : escHtml(u.phone || "---")
                }
            </td>
            <td><code>${escHtml(u.username)}</code></td>
            <td style="white-space:nowrap">
                <div style="display:flex;gap:6px;">
                    <button class="btn-secondary" onclick="abrirCambiarPassword('${escHtml(u.username)}')" style="padding:7px 12px;font-size:.75rem;font-weight:700;display:flex;align-items:center;gap:4px;min-width:82px;justify-content:center;">
                        <svg class="icon" style="width:13px;height:13px;color:var(--color-primary)"><use href="#icon-lock"/></svg>
                        Clave
                    </button>
                    <button class="btn-danger" onclick="deleteUser('${escHtml(u.username)}')" style="padding:7px 12px;font-size:.75rem;font-weight:700;display:flex;align-items:center;gap:4px;min-width:82px;justify-content:center;">
                        <svg class="icon" style="color:#fff;width:13px;height:13px"><use href="#icon-trash"/></svg>
                        Eliminar
                    </button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

// ═══════════════════════════════════════════════════════════════
//  FILTROS
// ═══════════════════════════════════════════════════════════════
function cambiarFiltro(destino) {
    state.currentFilter = destino;
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
        toast("Acceso denegado. Solo el Administrador.", "error"); return;
    }
    const planilla      = document.getElementById("view-planilla");
    const admin         = document.getElementById("view-admin");
    const padronAnr     = document.getElementById("view-padron-anr");
    const fw            = document.getElementById("filter-wrapper");
    const tabPlanilla   = document.getElementById("tab-planilla");
    const tabAdmin      = document.getElementById("tab-admin");
    const tabPadronAnr  = document.getElementById("tab-padron-anr");
    const onlinePanel   = document.querySelector(".online-panel");

    if (!planilla || !admin) return;

    // Ocultar todo primero
    planilla.style.display = "none";
    admin.classList.remove("visible");
    if (padronAnr) padronAnr.style.display = "none";
    if (fw) fw.style.display = "none";
    if (tabPlanilla)  tabPlanilla.classList.remove("active");
    if (tabAdmin)     tabAdmin.classList.remove("active");
    if (tabPadronAnr) tabPadronAnr.classList.remove("active");

    if (tab === "planilla") {
        planilla.style.display = "";
        if (fw) fw.style.display = "flex";
        if (tabPlanilla) tabPlanilla.classList.add("active");
        if (onlinePanel) onlinePanel.style.display = "";
        const mg = document.querySelector(".metrics-grid");
        if (mg) mg.style.display = "grid";
        state.currentFilter = "todos";
        renderTablaVotantes();
    } else if (tab === "admin") {
        admin.classList.add("visible");
        if (tabAdmin) tabAdmin.classList.add("active");
        if (onlinePanel) onlinePanel.style.display = "none";
        const mg = document.querySelector(".metrics-grid");
        if (mg) mg.style.display = "none";
        cargarUsuarios();
        escucharBitacora();
    } else if (tab === "padron-anr") {
        if (padronAnr) padronAnr.style.display = "";
        if (tabPadronAnr) tabPadronAnr.classList.add("active");
        if (onlinePanel) onlinePanel.style.display = "";
        const mg = document.querySelector(".metrics-grid");
        if (mg) mg.style.display = "none";
        // Limpiar búsqueda anterior al entrar
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
    dot.className     = "status-dot" + (online ? " online" : "");
    label.textContent = online ? "en línea" : "sin conexión";
}

// ═══════════════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════════════
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ═══════════════════════════════════════════════════════════════
//  EXPORTAR CSV
// ═══════════════════════════════════════════════════════════════
window.exportarCSV = function() {
    const filas = [["N°","Nombre","Cédula","Domicilio","Estado","Operador","Observación"]];
    state.padron.forEach((v, i) => {
        filas.push([
            i + 1,
            v.nombre,
            v.cedula,
            v.domicilio,
            getVoto(v.cedula),
            getLog(v.cedula),
            getObs(v.cedula)
        ]);
    });
    const bom  = "\uFEFF"; // BOM para que Excel abra con tildes correctas
    const csv  = bom + filas.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const fecha = new Date().toLocaleString("es-PY", { timeZone: "America/Asuncion",
        day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })
        .replace(/[\/:, ]/g, "-").replace(/--/g, "-");
    a.href     = url;
    a.download = `padron-electoral-${fecha}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("✔ Padrón exportado correctamente.", "ok");
    registrarBitacora("Exportar CSV", `Exportó el padrón completo (${state.padron.length} registros)`);
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
        const ref = doc(db, "usuarios", username);
        const snap = await getDoc(ref);
        if (!snap.exists()) { errEl.textContent = "Operador no encontrado."; return; }
        const u = snap.data();
        await setDoc(ref, { ...u, passwordHash, password: null }, { merge: true });
        toast(`✔ Contraseña de "${username}" actualizada.`, "ok");
        await registrarBitacora("Cambio Contraseña", `Cambió contraseña del operador ${u.fullname} (${username})`);
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
    document.getElementById("logout-btn").addEventListener("click", handleLogout);

    document.getElementById("btn-filter-pending").addEventListener("click", () => cambiarFiltro("Pendiente"));
    document.getElementById("btn-filter-voted").addEventListener("click",   () => cambiarFiltro("Votó"));
    document.getElementById("btn-filter-novoted").addEventListener("click", () => cambiarFiltro("No Votó"));

    document.getElementById("tab-planilla").addEventListener("click", () => switchTab("planilla"));
    document.getElementById("tab-admin").addEventListener("click",    () => switchTab("admin"));
    document.getElementById("tab-padron-anr").addEventListener("click", () => switchTab("padron-anr"));

    document.getElementById("register-user-form").addEventListener("submit",    handleRegistrarUsuario);
    document.getElementById("register-votante-form").addEventListener("submit", handleRegistrarVotante);

    document.getElementById("modal-novoto").addEventListener("click", function(e) {
        if (e.target === this) cerrarModal("modal-novoto");
    });

    // Modal cambiar contraseña
    document.getElementById("modal-chpass").addEventListener("click", function(e) {
        if (e.target === this) cerrarModal("modal-chpass");
    });

    // Modal confirmar observación — click fuera cancela
    document.getElementById("modal-obs-confirm").addEventListener("click", function(e) {
        if (e.target === this) cancelarObservacion();
    });

    // Re-render tabla al cambiar tamaño de pantalla (móvil ↔ escritorio)
    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (state.padron.length) renderTablaVotantes();
        }, 200);
    });

    // Búsqueda: resetear búsqueda global al limpiar el campo
    document.getElementById("search-input").addEventListener("input", e => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        if (!state.searchQuery) state.searchAllStates = false;
        renderTablaVotantes();
    });
}

// ═══════════════════════════════════════════════════════════════
//  PADRÓN LOCAL — Consulta desde CSV local (San Estanislao 2026)
//  Archivo: data/padron_san_estanislao_2026_completo.csv
//  Columnas: CEDULA, NOMBRES, APELLIDOS, DEPARTAMENTO, DISTRITO,
//            SECCIONAL, LOCAL_VOTACION, MESA, ORDEN, DIRECCION,
//            FECHA_NACIMIENTO, SEXO
// ═══════════════════════════════════════════════════════════════

// Cache del padrón en memoria para no releer el CSV en cada búsqueda
let _padronCache = null;

async function cargarPadronCSV() {
    if (_padronCache) return _padronCache;

    const resp = await fetch("data/padron_san_estanislao_2026_completo.csv");
    if (!resp.ok) throw new Error("No se pudo cargar el padrón CSV.");
    const texto = await resp.text();

    const lineas = texto.split("\n").filter(l => l.trim() !== "");
    const headers = lineas[0].split(",").map(h => h.trim().replace(/^\uFEFF/, "")); // quitar BOM

    _padronCache = lineas.slice(1).map(linea => {
        // Parseo simple respetando comas dentro de comillas
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
        input.style.outline = "2px solid var(--color-primary)";
        input.focus();
        setTimeout(() => input.style.outline = "", 1500);
        return;
    }

    error.style.display   = "none";
    result.style.display  = "none";
    loading.style.display = "block";

    // Resetear botón añadir
    const btnAgregar = document.getElementById("pr-btn-agregar");
    if (btnAgregar) {
        btnAgregar.disabled = false;
        btnAgregar.style.background = "";
        btnAgregar.style.borderColor = "";
        btnAgregar.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/><line x1="18" y1="13" x2="18" y2="19"/><line x1="15" y1="16" x2="21" y2="16"/></svg> Añadir como votante a la planilla`;
    }

    try {
        const padron = await cargarPadronCSV();
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
            registrarBitacora("Consulta Padrón", `Consultó CI ${cedula} → ${persona.NOMBRES} ${persona.APELLIDOS} · Mesa ${persona.MESA} · Orden ${persona.ORDEN}`);
        } else {
            error.innerHTML     = `
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 10px;display:block;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div style="font-size:.95rem;font-weight:700;color:#ef4444;margin-bottom:6px;">Esta persona no está en el padrón</div>
                <div style="font-size:.82rem;color:#999;">La cédula <strong style="color:#ccc;">${cedula}</strong> no figura en el padrón ANR de San Estanislao 2026.</div>`;
            error.style.display = "block";
            registrarBitacora("Consulta Padrón", `CI ${cedula} — no encontrado en el padrón`);
        }

    } catch (err) {
        loading.style.display = "none";
        error.innerHTML       = `
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 10px;display:block;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div style="font-size:.9rem;font-weight:700;color:#f59e0b;margin-bottom:6px;">No se pudo cargar el padrón</div>
                <div style="font-size:.8rem;color:#999;">${err.message}</div>`;
        error.style.display   = "block";
        console.error("Error padrón CSV:", err);
    }
};

// Enter en el input también dispara la búsqueda
document.addEventListener("DOMContentLoaded", () => {
    const inp = document.getElementById("padron-anr-input");
    if (inp) inp.addEventListener("keydown", e => { if (e.key === "Enter") buscarPadronANR(); });
});

// ═══════════════════════════════════════════════════════════════
//  AÑADIR DESDE PADRÓN → PLANILLA VOTANTES
// ═══════════════════════════════════════════════════════════════
// Normaliza cédula: elimina espacios, guiones y ceros a la izquierda
function normalizarCedula(c) {
    return String(c).replace(/[\s\-]/g, "").replace(/^0+/, "");
}

window.agregarDesdePardon = async function() {
    const cedula   = document.getElementById("pr-cedula")?.textContent?.trim();
    const nombres  = document.getElementById("pr-nombres")?.textContent?.trim()  || "";
    const apellidos= document.getElementById("pr-apellidos")?.textContent?.trim()|| "";
    const nombre   = `${nombres} ${apellidos}`.trim();

    if (!cedula || !nombre) {
        toast("No hay datos de consulta para agregar.", "error");
        return;
    }

    const cedulaNorm = normalizarCedula(cedula);

    // ── 1. Verificar contra state.padron (votantes.csv + padron_extra ya cargados) ──
    const enMemoria = state.padron.find(p => normalizarCedula(p.cedula) === cedulaNorm);
    if (enMemoria) {
        toast(`⚠ ${enMemoria.nombre} (CI: ${cedula}) ya está en la planilla.`, "warn");
        const btn = document.getElementById("pr-btn-agregar");
        if (btn) {
            btn.disabled = true;
            btn.style.background  = "#78350f";
            btn.style.borderColor = "#78350f";
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Ya existe en la planilla`;
        }
        return;
    }

    // ── 2. Verificar contra Firebase (por si fue agregado desde otra sesión) ──
    try {
        const snap = await getDoc(doc(db, "padron_extra", cedulaNorm));
        if (!snap.exists()) {
            // También probar con la cédula tal como viene (por si fue guardada sin normalizar)
            const snap2 = await getDoc(doc(db, "padron_extra", cedula));
            if (snap2.exists()) {
                const d = snap2.data();
                toast(`⚠ ${d.nombre || nombre} (CI: ${cedula}) ya fue agregado previamente.`, "warn");
                return;
            }
        } else {
            const d = snap.data();
            toast(`⚠ ${d.nombre || nombre} (CI: ${cedula}) ya fue agregado previamente.`, "warn");
            return;
        }
    } catch (err) {
        console.warn("Verificación Firebase:", err);
        // Si falla la verificación online, continuar con la verificación en memoria ya hecha
    }

    const btn = document.getElementById("pr-btn-agregar");
    if (btn) { btn.disabled = true; btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Guardando...`; }

    const nuevo = { id: "padron_" + Date.now(), nombre, cedula, domicilio: "---" };
    state.padron.push(nuevo);

    try {
        await setDoc(doc(db, "padron_extra", cedula), {
            ...nuevo,
            creado_por: state.currentUser?.isAdmin ? "Administrador/a" : (state.currentUser?.username || "---"),
            origen:     "Padrón ANR",
            timestamp:  serverTimestamp()
        });
        toast(`✔ ${nombre} agregado a la planilla de votantes.`, "ok");
        await registrarBitacora("Nuevo Votante",
            `Agregó desde padrón ANR: ${nombre} (CI: ${cedula})`);

        // Cambiar el botón a estado "ya agregado"
        if (btn) {
            btn.disabled = true;
            btn.style.background = "#166534";
            btn.style.borderColor = "#166534";
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Ya está en la planilla`;
        }
        actualizarDashboard();
    } catch (err) {
        console.error(err);
        // Revertir del array si falló Firestore
        state.padron = state.padron.filter(p => p.cedula !== cedula);
        toast("Error al guardar. Verificá la conexión.", "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/><line x1="18" y1="13" x2="18" y2="19"/><line x1="15" y1="16" x2="21" y2="16"/></svg> Añadir como votante a la planilla`;
        }
    }
};
