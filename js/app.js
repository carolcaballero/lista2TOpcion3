// ═══════════════════════════════════════════════════════════════
//  CONTROL ELECTORAL — app.js v12.1
//  • Fix: Material Symbols no aparecían por destrucción del DOM
//  • Delegación de eventos real (sin cloneNode)
//  • Espera document.fonts.load() antes de primer render
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
    collection, onSnapshot, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

const ADMIN_USER_ID   = "admin";
const ADMIN_HASH      = "3125998a39f131e03ee8a3cad1ea1fb31327e6a610e1c21cc0ff50ee00495a03";
const ADMIN_FULLNAME  = "Administrador/a";
const SESSION_KEY     = "ce_session_v5";
const SESSION_TTL_MS  = 7 * 24 * 60 * 60 * 1000;
const TZ_PY           = "America/Asuncion";
const OFFLINE_QUEUE_KEY = "ce_offline_queue_v1";

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
    pagination:       { page: 1, perPage: 50 },
    charts:           { mesa: null, global: null, hora: null },
    notifiedThresholds: new Set(),
    isRendering:      false,
    offlineRetryInterval: null,
};

const selectedCedulas = new Set();

// Helper para iconos Material Symbols (con fallback visual)
function icon(name, extraClasses = "") {
    return `<span class="material-symbols-outlined ${extraClasses}" aria-hidden="true">${name}</span>`;
}
window.icon = icon;

const MATERIAL_SYMBOLS_FALLBACK = {
    more_vert: '<circle cx="12" cy="5" r="1.9"></circle><circle cx="12" cy="12" r="1.9"></circle><circle cx="12" cy="19" r="1.9"></circle>',
    check_circle: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm-1.1 14.3-4.2-4.2 1.4-1.4 2.8 2.79 5.79-5.79 1.41 1.41-7.2 7.19Z"></path>',
    cancel: '<path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2Zm4 13.59L14.59 17 12 14.41 9.41 17 8 15.59 10.59 13 8 10.41 9.41 9 12 11.59 14.59 9 16 10.41 13.41 13 16 15.59Z"></path>',
    edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58ZM20.71 7.04a1 1 0 0 0 0-1.41L18.37 3.29a1 1 0 0 0-1.41 0L15.13 5.12l3.75 3.75 1.83-1.83Z"></path>',
    person: '<path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2.5c-3.34 0-10 1.67-10 5V22h20v-2.5c0-3.33-6.66-5-10-5Z"></path>',
    history: '<path d="M13 3a9 9 0 0 0-8.95 8H1l4 4 4-4H6.07A7 7 0 1 1 13 18a6.96 6.96 0 0 1-4.95-2.05l-1.42 1.42A9 9 0 1 0 13 3Zm-1 5h2v5h-5v-2h3V8Z"></path>',
    schedule: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 11h-5V7h2v4h3Z"></path>',
    history_toggle_off: '<path d="M13 3a9 9 0 0 0-8.95 8H1l4 4 4-4H6.07A7 7 0 1 1 13 18a6.97 6.97 0 0 1-4.28-1.46l-1.43 1.43A9 9 0 1 0 13 3Zm-1 4h2v4.17l2.67 1.6-1 1.65L12 12.25V7Z"></path>',
    arrow_right_alt: '<path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8Z"></path>',
    remove_circle: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm5 11H7v-2h10Z"></path>',
    delete_forever: '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12Zm4.59-6-2.3-2.29L9.7 9.3 12 11.59l2.29-2.29 1.41 1.41L13.41 13l2.29 2.29-1.41 1.41L12 14.41l-2.29 2.29-1.41-1.41L10.59 13ZM15.5 4l-1-1h-5l-1 1H5v2h14V4Z"></path>',
    info: '<path d="M11 9h2V7h-2v2Zm0 8h2v-6h-2v6Zm1-15a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z"></path>',
    warning: '<path d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z"></path>',
    delete_sweep: '<path d="M15 16h4v2h-4v-2ZM3 18c0 .55.45 1 1 1h7v-2H5V7h10v6h2V7h2V5h-3.5l-1-1h-5l-1 1H5v2H3v11Z"></path>',
    lock: '<path d="M17 9h-1V7a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm2 10a2 2 0 0 1-1-3.73V12h2v1.27A2 2 0 0 1 12 17Z"></path>',
    person_add: '<path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm-8 0V9H4V7h3V4h2v3h3v2H9v3H7Zm8 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z"></path>',
    download: '<path d="M5 20h14v-2H5v2ZM12 2v12l4-4 1.41 1.41L12 17.83l-5.41-5.42L8 10l4 4V2h0Z"></path>',
    people: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.96 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z"></path>',
    phone: '<path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1-.24c1.12.37 2.33.57 3.59.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.26.2 2.47.57 3.59a1 1 0 0 1-.25 1l-2.2 2.2Z"></path>',
    search: '<path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 1 0 14 15.5l.27.28v.79L20 22l2-2-6.5-6ZM10 14A4 4 0 1 1 10 6a4 4 0 0 1 0 8Z"></path>',
    inbox: '<path d="M19 3H4.99A2 2 0 0 0 3 5l.01 14A2 2 0 0 0 5 21h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10Z"></path>',
    grid_view: '<path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 7v-7h7v7h-7Z"></path>',
    error_outline: '<path d="M11 15h2v2h-2v-2Zm0-8h2v6h-2V7Zm1 15A10 10 0 1 1 22 12 10 10 0 0 1 12 22Z"></path>',
    warning_amber: '<path d="M12 5.99 19.53 19H4.47L12 5.99ZM12 2 1 21h22L12 2Zm-1 14h2v2h-2v-2Zm0-6h2v5h-2v-5Z"></path>'
};

let materialSymbolsObserver = null;

function buildMaterialSymbolSvg(name) {
    const svg = MATERIAL_SYMBOLS_FALLBACK[name];
    if (!svg) return '';
    return `<svg class="ms-fallback-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${svg}</svg>`;
}

function applyMaterialSymbolsFallback(root = document) {
    if (!document.documentElement.classList.contains('ms-fallback-active')) return;
    root.querySelectorAll?.('.material-symbols-outlined').forEach(el => {
        const iconName = (el.dataset.iconName || el.textContent || '').trim();
        if (!iconName) return;
        el.dataset.iconName = iconName;
        const svg = buildMaterialSymbolSvg(iconName);
        if (!svg) return;
        if (el.dataset.msFallbackApplied === '1') return;
        el.dataset.msFallbackApplied = '1';
        el.classList.add('ms-fallback-applied');
        el.setAttribute('aria-label', iconName.replace(/_/g, ' '));
        el.textContent = '';
        el.insertAdjacentHTML('afterbegin', svg);
    });
}

function activateMaterialSymbolsFallback(reason = '') {
    if (!document.documentElement.classList.contains('ms-fallback-active')) {
        document.documentElement.classList.add('ms-fallback-active');
        if (reason) console.warn('Fallback Material Symbols activado:', reason);
    }
    applyMaterialSymbolsFallback(document);
    if (!materialSymbolsObserver) {
        materialSymbolsObserver = new MutationObserver(mutations => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.matches?.('.material-symbols-outlined')) applyMaterialSymbolsFallback(node.parentElement || document);
                    else applyMaterialSymbolsFallback(node);
                });
            });
        });
        materialSymbolsObserver.observe(document.body, { childList: true, subtree: true });
    }
}

async function ensureMaterialSymbolsReady() {
    // Sin API de fonts → fallback inmediato
    if (!document.fonts?.load) {
        activateMaterialSymbolsFallback('API document.fonts no disponible');
        return;
    }

    // Esperar que el CSS de Google Fonts haya sido parseado y las @font-face registradas
    // fonts.ready se resuelve cuando el motor de fuentes termina de procesar los @font-face del DOM
    try {
        await Promise.race([
            document.fonts.ready,
            new Promise(r => setTimeout(r, 4000)) // máximo 4s de espera
        ]);
    } catch (_) { /* ignorar */ }

    // Intentar cargar ambas variantes con varios tamaños (el nombre exacto depende del UA)
    const intentos = [
        document.fonts.load('400 24px "Material Symbols Outlined"'),
        document.fonts.load('400 24px "Material Symbols Rounded"'),
        document.fonts.load('24px "Material Symbols Outlined"'),
        document.fonts.load('24px "Material Symbols Rounded"'),
    ];

    try {
        const resultados = await Promise.allSettled(intentos);
        const cargó = resultados.some(r => r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0);

        if (!cargó) {
            // Verificar con check() como último recurso (menos fiable pero cubre edge cases)
            const checkOk = (
                (document.fonts.check?.('24px "Material Symbols Outlined"') ||
                 document.fonts.check?.('24px "Material Symbols Rounded"'))
            );
            if (!checkOk) {
                activateMaterialSymbolsFallback('fuente no disponible o ligaduras no activas');
            }
            // Si checkOk es true, la fuente está cargada aunque fonts.load no devolvió elementos
        }
        // Si cargó → no hacer nada, los iconos ya renderizan correctamente
    } catch (e) {
        activateMaterialSymbolsFallback(e?.message || 'error al cargar fuente');
    }
}

window.ensureMaterialSymbolsReady = ensureMaterialSymbolsReady;

// ═══════════════ SHA-256 ═══════════════
async function sha256(texto) {
    const encoder = new TextEncoder();
    const data    = encoder.encode(texto);
    const hash    = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}
window.sha256 = sha256;

// ═══════════════ FECHA/HORA PARAGUAY ═══════════════
function formatearFechaParaguay(date) {
    if (!date) return "---";
    try {
        return new Intl.DateTimeFormat("es-PY", {
            timeZone: TZ_PY,
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: false
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
function ahoraParaguay() { return formatearFechaParaguay(new Date()); }
function timestampAParaguay(ts) {
    if (!ts) return "---";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return formatearFechaParaguay(d);
}
function horaEnParaguay(ts) {
    if (!ts) return null;
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    try {
        const partes = new Intl.DateTimeFormat("es-PY", {
            timeZone: TZ_PY, hour: "2-digit", hour12: false
        }).formatToParts(d);
        const h = partes.find(p => p.type === "hour");
        return h ? parseInt(h.value, 10) : null;
    } catch { return d.getHours(); }
}

// ═══════════════ OFFLINE QUEUE ═══════════════
function getOfflineQueue() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]"); }
    catch { return []; }
}
function saveOfflineQueue(q) { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); updateOfflineBadge(); }
function addOfflineAction(action) { const q = getOfflineQueue(); q.push({ ...action, queuedAt: Date.now() }); saveOfflineQueue(q); }
async function syncOfflineQueue() {
    const q = getOfflineQueue();
    if (!q.length || !navigator.onLine) return;
    let ok = 0, err = 0;
    const remaining = [];
    for (const item of q) {
        try {
            await setDoc(doc(db, "votos", item.cedula), {
                voto: item.voto, observaciones: item.observaciones || "",
                modificado_por: item.modificado_por, timestamp: serverTimestamp()
            });
            if (item.historial) await addDoc(collection(db, "votos", item.cedula, "historial"), item.historial);
            ok++;
        } catch (e) { remaining.push(item); err++; }
    }
    saveOfflineQueue(remaining);
    updateOfflineBadge();
    if (ok > 0) { toast(`${ok} acciones offline sincronizadas.`, "ok"); actualizarDashboard(); }
    if (err > 0) toast(`⚠ ${err} acciones quedaron pendientes.`, "warn");
}
function iniciarReintentosOffline() {
    if (state.offlineRetryInterval) clearInterval(state.offlineRetryInterval);
    state.offlineRetryInterval = setInterval(() => {
        if (navigator.onLine && getOfflineQueue().length > 0) syncOfflineQueue();
    }, 30000);
}
function updateOfflineBadge() {
    const q = getOfflineQueue();
    const el = document.getElementById("offline-indicator");
    if (!el) return;
    if (q.length === 0 && navigator.onLine) el.classList.add("hidden");
    else {
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

// ═══════════════ BITÁCORA ═══════════════
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
        "Exportar XLSX":"#374151","Exportar Estadísticas":"#374151","Limpiar Bitácora":"#7F1D1D"
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

// ═══════════════ INICIO ═══════════════
document.addEventListener("DOMContentLoaded", async () => {
    // 🔑 Esperar a que Material Symbols cargue antes de renderizar UI
    await ensureMaterialSymbolsReady();

    bindEvents();
    bindNetworkEvents();
    iniciarReintentosOffline();
    ajustarStickyFiltros();
    
    // Bindear eventos de votantes UNA SOLA VEZ
    bindRowEvents();
    
    checkSession();

    document.addEventListener('click', function(e) {
        const enMenuBtn = e.target.closest('.menu-tres-puntos');
        const enDropdownTeleportado = e.target.closest('.dropdown.dropdown-teleported');
        if (!enMenuBtn && !enDropdownTeleportado) closeAllMenus();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeAllMenus();
    });
    document.getElementById('menu-backdrop')?.addEventListener('click', () => closeAllMenus());
    window.addEventListener('resize', () => closeAllMenus());
    // Cerrar en cualquier scroll (captura eventos de scroll dentro de tabla tambien)
    window.addEventListener('scroll', () => { closeAllMenus(); }, true);
    document.addEventListener('scroll', () => { closeAllMenus(); }, true);
});

function bindNetworkEvents() {
    window.addEventListener("online",  () => {
        setStatus(true); updateOfflineBadge(); syncOfflineQueue();
        toast("Conexión restablecida", "ok");
    });
    window.addEventListener("offline", () => {
        setStatus(false); updateOfflineBadge();
        toast("Sin conexión. Modo offline activado.", "warn");
    });
}

// ── Referencia al dropdown actualmente "teleportado" al body (desktop tabla) ──
let _teleportedMenu = null;
let _teleportedMenuOriginalParent = null;

function closeAllMenus(exceptCedula = null) {
    // Devolver al DOM original cualquier menú teleportado
    if (_teleportedMenu && (!exceptCedula || _teleportedMenu.id !== `menu-${exceptCedula}`)) {
        _returnTeleportedMenu();
    }

    document.querySelectorAll('.menu-tres-puntos .dropdown.show').forEach(d => {
        if (!exceptCedula || d.id !== `menu-${exceptCedula}`) {
            d.classList.remove('show', 'dropdown-mobile-sheet', 'dropdown-teleported');
            d.style.cssText = '';
        }
    });
    // También limpiar cualquier dropdown teleportado suelto en body
    document.querySelectorAll('.dropdown.dropdown-teleported.show').forEach(d => {
        if (!exceptCedula || d.id !== `menu-${exceptCedula}`) {
            d.classList.remove('show', 'dropdown-teleported');
            d.style.cssText = '';
        }
    });
    document.querySelectorAll('.card-votante.menu-open').forEach(card => {
        if (!exceptCedula || card.dataset.cedula !== exceptCedula) card.classList.remove('menu-open');
    });
    document.body.classList.remove('menu-sheet-open');
    const backdrop = document.getElementById('menu-backdrop');
    if (backdrop && !exceptCedula) backdrop.classList.remove('show');
}

function _returnTeleportedMenu() {
    if (!_teleportedMenu || !_teleportedMenuOriginalParent) return;
    try {
        _teleportedMenuOriginalParent.appendChild(_teleportedMenu);
        _teleportedMenu.classList.remove('dropdown-teleported');
        _teleportedMenu.style.cssText = '';
    } catch(e) { /* si el padre ya no existe, ignorar */ }
    _teleportedMenu = null;
    _teleportedMenuOriginalParent = null;
}

function syncMenuCardState() {
    document.querySelectorAll('.card-votante').forEach(card => {
        const open = !!card.querySelector('.menu-tres-puntos .dropdown.show');
        card.classList.toggle('menu-open', open);
    });
}

function positionDropdown(menuBtn, menu) {
    if (!menuBtn || !menu) return;

    // ── MÓVIL: sheet desde abajo ──
    if (window.innerWidth <= 768) {
        menu.classList.add('dropdown-mobile-sheet');
        menu.classList.remove('dropdown-teleported');
        document.body.classList.add('menu-sheet-open');
        const backdrop = document.getElementById('menu-backdrop');
        if (backdrop) backdrop.classList.add('show');
        return;
    }

    // ── DESKTOP ──
    // Si está dentro de una tabla (overflow contenedor), teleportar al body
    const isInsideTable = !!menuBtn.closest('.tabla-desktop, .table-responsive');

    if (isInsideTable) {
        // Teleportar al body con position:fixed calculado
        _teleportedMenuOriginalParent = menu.parentElement;
        _teleportedMenu = menu;
        document.body.appendChild(menu);
        menu.classList.add('dropdown-teleported');

        // Calcular posición desde el botón
        const btnRect = menuBtn.getBoundingClientRect();
        const menuW = 288; // ancho estimado del dropdown
        const gap = 6;

        let top = btnRect.bottom + gap + window.scrollY;
        let left = btnRect.right - menuW; // alinear borde derecho

        // Ajustar si se sale por la izquierda
        if (left < 12) left = 12;
        // Ajustar si se sale por la derecha
        if (left + menuW > window.innerWidth - 12) left = window.innerWidth - menuW - 12;

        menu.style.cssText = `
            position: fixed !important;
            top: ${btnRect.bottom + gap}px !important;
            left: ${left}px !important;
            right: auto !important;
            bottom: auto !important;
            z-index: 99999 !important;
            min-width: ${menuW}px;
        `;

        // Ajustar si el menú se desborda por abajo
        requestAnimationFrame(() => {
            const mRect = menu.getBoundingClientRect();
            if (mRect.bottom > window.innerHeight - 12) {
                menu.style.top = `${btnRect.top - mRect.height - gap}px`;
            }
        });
    } else {
        // Tarjeta móvil / posicionamiento relativo normal
        menu.classList.remove('dropdown-teleported');
        menu.style.cssText = 'right: 0; top: calc(100% + 6px);';

        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            const vw = window.innerWidth;
            if (rect.right > vw - 12) {
                menu.style.right = 'auto';
                menu.style.left = `${Math.max(12, menuBtn.offsetWidth - rect.width)}px`;
            }
            if (rect.bottom > window.innerHeight - 12) {
                menu.style.top = 'auto';
                menu.style.bottom = 'calc(100% + 6px)';
            }
        });
    }
}

function openDropdownMenu(menuBtn, cedula) {
    const menu = document.getElementById(`menu-${cedula}`);
    const card = menuBtn?.closest('.card-votante');
    if (!menu) return;
    const willShow = !menu.classList.contains('show');
    closeAllMenus();
    if (!willShow) return;
    menu.classList.add('show');
    positionDropdown(menuBtn, menu);
    if (card) card.classList.add('menu-open');
}

function ajustarStickyFiltros() {
    const filterWrapper = document.getElementById("filter-wrapper");
    const header = document.querySelector(".main-header");
    if (!filterWrapper || !header) return;
    const updateTop = () => {
        if (window.innerWidth < 768) filterWrapper.style.top = `${header.offsetHeight}px`;
        else filterWrapper.style.top = "";
    };
    updateTop();
    window.addEventListener("resize", updateTop);
    const observer = new ResizeObserver(updateTop);
    observer.observe(header);
}

function limpiarCredencialesLogin() {
    try {
        const userEl = document.getElementById("username");
        const passEl = document.getElementById("password");
        if (userEl) userEl.value = "";
        if (passEl) passEl.value = "";
        const form = document.getElementById("login-form");
        if (form) form.reset();
    } catch(e) { /* silent */ }
}

// ═══════════════ SESIÓN ═══════════════
function checkSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
            const session = JSON.parse(raw);
            const age = Date.now() - (session.loginAt || 0);
            if (age < SESSION_TTL_MS && session.user) { loginSuccess(session.user, false); return; }
            else localStorage.removeItem(SESSION_KEY);
        }
    } catch { /**/ }
    showLogin();
    limpiarCredencialesLogin();
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
            } else { errEl.textContent = "Contraseña incorrecta para Admin."; resetBtn(); return; }
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
        if (err.code === "unavailable" || err.message?.includes("network")) errEl.textContent = "Sin conexión. Verificá tu red e intentá de nuevo.";
        else if (err.code === "permission-denied") errEl.textContent = "Error de permisos. Contactá al administrador.";
        else errEl.textContent = "Error al conectar. Revisá tu internet.";
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
            if (user.local) { assignEl.classList.remove("hidden"); assignEl.textContent = `📍 ${user.local}`; }
            else assignEl.classList.add("hidden");
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
        limpiarCredencialesLogin();
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
    limpiarCredencialesLogin();
}

// ═══════════════ PRESENCIA ═══════════════
async function iniciarPresencia() {
    if (!state.currentUser) return;
    await marcarOnline();
    state.presenceInterval = setInterval(marcarOnline, 25000);
    if (state.unsubPresencia) state.unsubPresencia();
    state.unsubPresencia = onSnapshot(collection(db, "presencia"), snap => {
        state.onlineUsers = {};
        const ahora = Date.now();
        snap.forEach(d => {
            const data = d.data();
            const lastSeen = data.lastSeen?.toMillis?.() || 0;
            if (ahora - lastSeen < 90000) state.onlineUsers[d.id] = data;
        });
    }, err => console.warn("Presencia listener:", err));
    window.addEventListener("beforeunload", quitarPresencia);
}
async function marcarOnline() {
    if (!state.currentUser) return;
    try {
        await setDoc(doc(db, "presencia", state.currentUser.username.toLowerCase()), {
            username: state.currentUser.username, fullname: state.currentUser.fullname,
            isAdmin:  state.currentUser.isAdmin, lastSeen: serverTimestamp()
        });
    } catch (e) { console.warn("marcarOnline:", e); }
}
async function quitarPresencia() {
    if (!state.currentUser) return;
    try { await deleteDoc(doc(db, "presencia", state.currentUser.username.toLowerCase())); } catch { /**/ }
}

// ═══════════════ CARGA DE DATOS ═══════════════
async function loadPadronYEscuchar() {
    state.padron = [];
    try {
        const snap = await getDocs(collection(db, "padron_extra"));
        snap.forEach(d => {
            const v   = d.data();
            const ced = String(v.cedula || "").replace(/[\s\-]/g, "").replace(/^0+/, "");
            if (!state.padron.some(p => p.cedula === ced))
                state.padron.push({
                    id: d.id,
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
    state.unsubVotos = onSnapshot(collection(db, "votos"),
        snap => {
            state.votos = {};
            snap.forEach(d => { state.votos[d.id] = d.data(); });
            setStatus(true);
            actualizarDashboard();
            checkNotificationThresholds();
            if (document.getElementById("view-stats")?.style.display !== "none") renderStatsCharts();
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

function actualizarDashboard() { renderTablaVotantes(); }

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
    if (Notification.permission === "granted") new Notification(title, { body, icon: "https://cdn-icons-png.flaticon.com/512/2099/2099190.png" });
    else if (Notification.permission !== "denied") Notification.requestPermission().then(p => { if (p === "granted") new Notification(title, { body }); });
}

// ═══════════════ PAGINACIÓN ═══════════════
function renderPaginationControls(totalItems) {
    const totalPages = Math.ceil(totalItems / state.pagination.perPage) || 1;
    const container = document.getElementById("pagination-controls");
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ""; return; }
    const { page } = state.pagination;
    let html = `<div class="pagination-bar">`;
    html += `<span class="pagination-info">Página <strong>${page}</strong> de ${totalPages} · ${totalItems} registros</span>`;
    html += `<div class="pagination-buttons">`;
    html += `<button class="btn-page ${page === 1 ? "disabled" : ""}" onclick="cambiarPagina(${page - 1})" ${page === 1 ? "disabled" : ""}>← Ant.</button>`;
    let startPage = Math.max(1, page - 2);
    let endPage   = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);
    for (let i = startPage; i <= endPage; i++) html += `<button class="btn-page ${i === page ? "active" : ""}" onclick="cambiarPagina(${i})">${i}</button>`;
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

// ═══════════════ TABLA/TARJETAS VOTANTES ═══════════════
async function renderTablaVotantes() {
    if (state.isRendering) return;
    state.isRendering = true;
    mostrarLoadingEnTabla(true);
    await new Promise(r => setTimeout(r, 10));

    const isAdmin = !!state.currentUser?.isAdmin;
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
        lista = state.padron.filter(v => v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
        lista.sort(compararLista);
    } else if (state.currentFilter === "todos") {
        lista = [...state.padron];
        if (q) lista = lista.filter(v => v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
        lista.sort(compararLista);
    } else {
        lista = state.padron.filter(v => getVoto(v.cedula) === state.currentFilter);
        if (q) lista = lista.filter(v => v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
        lista.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
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
            const totalMatch = state.padron.filter(v => v.nombre.toLowerCase().includes(q) || v.cedula.includes(q)).length;
            const otros = totalMatch - lista.length;
            if (otros > 0) {
                searchHint.style.display = "flex";
                searchHint.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">search</span>
                    <span>Se encontraron <strong>${otros}</strong> resultado${otros>1?"s":""} en otros estados.</span>
                    <button onclick="activarBusquedaGlobal()" class="btn-hint-global">Ver todos</button>`;
            } else searchHint.style.display = "none";
        } else if (q && state.searchAllStates) {
            searchHint.style.display = "flex";
            searchHint.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">search</span>
                <span>Mostrando resultados de <strong>todos los estados</strong>.</span>
                <button onclick="desactivarBusquedaGlobal()" class="btn-hint-volver">Volver al filtro</button>`;
        } else searchHint.style.display = "none";
    }

    const barraSel = document.getElementById("barra-seleccion");
    if (barraSel && !isAdmin) { barraSel.style.display = "none"; selectedCedulas.clear(); }

    // ── Tarjetas móviles ──
    const cardsContainer = document.getElementById("cards-container");
    if (cardsContainer) {
        if (!paginatedList.length) {
            cardsContainer.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined" style="font-size:48px;opacity:.3;">inbox</span>
                    <strong>Sin resultados</strong>
                    No se encontraron registros para este criterio.
                </div>`;
        } else {
            const debeMostrarSecciones = (state.currentFilter === "todos" && !q && totalPages === 1);
            if (debeMostrarSecciones) cardsContainer.innerHTML = construirCardsConSecciones(lista, true, isAdmin);
            else cardsContainer.innerHTML = paginatedList.map((v, idx) => construirTarjeta(v, start + idx, isAdmin)).join("");
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
                const cellCheckbox = isAdmin
                    ? `<td><label class="sel-checkbox-wrap"><input type="checkbox" class="sel-checkbox" data-cedula="${v.cedula}" ${checked}></label></td>`
                    : `<td></td>`;

                const tr = document.createElement("tr");
                tr.dataset.cedula = v.cedula;
                tr.innerHTML = `
                    ${cellCheckbox}
                    <td><strong>${start + idx + 1}</strong></td>
                    <td>${escHtml(v.nombre)}</td>
                    <td style="font-family:monospace">${v.cedula}</td>
                    <td style="font-size:.82rem;">${escHtml(v.local || "—")}</td>
                    <td style="font-size:.82rem;font-family:monospace;">${escHtml(v.mesa || "—")}</td>
                    <td style="font-size:.82rem;font-family:monospace;">${escHtml(v.orden || "—")}</td>
                    <td><span class="${badgeClass}">${badgeLabel}</span></td>
                    <td>
                        <div class="action-btns action-btns-table">
                            <button class="btn-accion ${voto==='Votó'?'sel-voto':''}" data-action="voto" data-cedula="${v.cedula}" title="Marcar Votó">
                                <span class="material-symbols-outlined">check_circle</span>
                            </button>
                            <button class="btn-accion ${voto==='No Votó'?'sel-novoto':''}" data-action="novoto" data-cedula="${v.cedula}" title="Marcar No Votó">
                                <span class="material-symbols-outlined">cancel</span>
                            </button>
                        </div>
                    </td>
                    <td>
                        <button class="btn-obs ${obs ? 'has-obs' : ''}" data-action="obs" data-cedula="${v.cedula}" data-nombre="${escHtml(v.nombre)}">
                            <span class="material-symbols-outlined" style="font-size:16px;">edit</span>
                            <span class="obs-preview">${obs ? escHtml(obs) : "Agregar obs..."}</span>
                        </button>
                    </td>
                    <td><span class="log-span" title="${escHtml(log)}">${escHtml(log)}</span></td>
                    <td>
                        <div class="menu-tres-puntos">
                            <button class="btn-puntos" data-action="menu" data-cedula="${v.cedula}" title="Más opciones">
                                <span class="material-symbols-outlined">more_vert</span>
                            </button>
                            ${construirDropdownMenu(v, voto, obs, isAdmin)}
                        </div>
                    </td>`;
                tbody.appendChild(tr);
            });
        }
    }

    const master = document.getElementById("checkbox-todos");
    if (master) master.checked = paginatedList.length > 0 && paginatedList.every(v => selectedCedulas.has(v.cedula));

    renderPaginationControls(totalItems);
    actualizarBarraSeleccion();
    state.isRendering = false;
    mostrarLoadingEnTabla(false);
}

function mostrarLoadingEnTabla(show) {
    const cards = document.getElementById("cards-container");
    const tbody = document.getElementById("votantes-table-body");
    if (show) {
        if (cards && cards.children.length === 0)
            cards.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span class="loading-text">Cargando...</span></div>`;
        if (tbody && tbody.children.length === 0)
            tbody.innerHTML = `<tr><td colspan="12" class="spinner-cell"><div class="spinner"></div></td></tr>`;
    }
}

function construirCardsConSecciones(lista, mostrarSecciones, isAdmin) {
    if (!mostrarSecciones) return lista.map((v, idx) => construirTarjeta(v, idx, isAdmin)).join("");
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
                <span class="material-symbols-outlined">${iconName}</span>
                ${titulo}
                <span class="sd-count">${items.length}</span>
            </div>`;
        items.forEach(v => { contadorGlobal++; h += construirTarjeta(v, contadorGlobal - 1, isAdmin); });
        return h;
    };
    html += renderGrupo("Votaron",    grupos["Votó"],     "sd-voted",   "check_circle");
    html += renderGrupo("No Votaron", grupos["No Votó"],  "sd-novoted", "cancel");
    html += renderGrupo("Pendientes", grupos["Pendiente"], "sd-pending", "schedule");
    return html;
}

// Dropdown del menú 3 puntos — solo acciones secundarias
function construirDropdownMenu(v, voto, obs, isAdmin) {
    const id = `menu-${v.cedula}`;
    const nombreEsc = jsEscape(v.nombre);

    const menuEliminar = isAdmin
        ? `<div class="dropdown-divider"></div>
           <a href="#" class="dropdown-danger" data-action="eliminar" data-cedula="${v.cedula}"><svg class="svg-icon" aria-hidden="true"><use href="#i-delete"/></svg> Eliminar votante</a>`
        : "";

    return `
        <div class="dropdown" id="${id}">
            <div class="dropdown-header">
                <span class="dropdown-header-name">${escHtml(v.nombre)}</span>
                <span class="dropdown-header-ced">CI ${escHtml(v.cedula)}</span>
            </div>
            <a href="#" data-action="obs" data-cedula="${v.cedula}" data-nombre="${nombreEsc}" class="dropdown-primary">
                <svg class="svg-icon" aria-hidden="true" style="color:#B45309;"><use href="#i-edit"/></svg>
                <span><strong>${obs ? 'Editar observación' : 'Agregar observación'}</strong><br><small>${obs ? 'Modificar nota existente' : 'Agregar una nota a este votante'}</small></span>
            </a>
            <div class="dropdown-divider"></div>
            <a href="#" data-action="historial" data-cedula="${v.cedula}" data-nombre="${nombreEsc}">
                <svg class="svg-icon" aria-hidden="true" style="color:#1D4ED8;"><use href="#i-history"/></svg> Ver historial de cambios
            </a>
            <a href="#" data-action="copiar-ci" data-cedula="${v.cedula}"><svg class="svg-icon" aria-hidden="true" style="color:#475569;"><use href="#i-copy"/></svg> Copiar cédula</a>
            <a href="#" data-action="compartir-wa" data-cedula="${v.cedula}" data-nombre="${nombreEsc}"><svg class="svg-icon" aria-hidden="true" style="color:#15803D;"><use href="#i-whatsapp"/></svg> Compartir por WhatsApp</a>
            ${menuEliminar}
        </div>`;
}

function construirTarjeta(v, idx, isAdmin) {
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
    const checkboxHtml = isAdmin
        ? `<label class="sel-checkbox-wrap"><input type="checkbox" class="sel-checkbox" data-cedula="${v.cedula}" ${checked}></label>`
        : "";

    return `
        <div class="card-votante ${estadoClass}" data-cedula="${escHtml(v.cedula)}">
            <div class="card-top">
                <div class="card-info">
                    <div class="card-head-row">
                        ${checkboxHtml}
                        <div class="card-num">${idx+1}.</div>
                        <span class="${badgeClass} card-badge">${badgeLabel}</span>
                    </div>
                    <div class="card-nombre" title="${escHtml(v.nombre)}">${escHtml(v.nombre)}</div>
                    <div class="card-cedula">CI: ${escHtml(v.cedula)}</div>
                    ${v.local  ? `<div class="card-domicilio">📍 ${escHtml(v.local)}</div>` : ""}
                    ${v.mesa   ? `<div class="card-domicilio">🗳️ Mesa <strong>${escHtml(v.mesa)}</strong>${v.orden ? " · Orden " + escHtml(v.orden) : ""}</div>` : ""}
                </div>
                <div class="menu-tres-puntos card-menu">
                    <button class="btn-puntos" data-action="menu" data-cedula="${v.cedula}" title="Más opciones">
                        <span class="material-symbols-outlined">more_vert</span>
                    </button>
                    ${construirDropdownMenu(v, voto, obs, isAdmin)}
                </div>
            </div>
            <div class="action-btns action-btns-card">
                <button class="btn-accion btn-accion-lg ${voto==='Votó'?'sel-voto':''}" data-action="voto" data-cedula="${v.cedula}">
                    <span class="material-symbols-outlined">check_circle</span>
                    <span class="btn-accion-label">${voto === "Votó" ? "Quitar voto" : "Votó"}</span>
                </button>
                <button class="btn-accion btn-accion-lg ${voto==='No Votó'?'sel-novoto':''}" data-action="novoto" data-cedula="${v.cedula}" data-nombre="${jsEscape(v.nombre)}">
                    <span class="material-symbols-outlined">cancel</span>
                    <span class="btn-accion-label">${voto === "No Votó" ? "Quitar No Votó" : "No Votó"}</span>
                </button>
            </div>
            <button class="${obsClass}" data-action="obs" data-cedula="${v.cedula}" data-nombre="${jsEscape(v.nombre)}">
                <span class="material-symbols-outlined" style="font-size:16px;">edit</span>
                <span class="obs-preview">${obsLabel}</span>
            </button>
            ${log !== "---" ? `<div class="card-log"><span class="material-symbols-outlined">person</span> ${escHtml(log)}</div>` : ""}
        </div>`;
}

// ═══════════════ 🔑 BINDING DELEGADO (una sola vez, sin clonar) ═══════════════
let _rowEventsBound = false;

function bindRowEvents() {
    if (_rowEventsBound) return;
    _rowEventsBound = true;

    const appSection = document.getElementById("app-section");
    if (!appSection) return;

    // Función compartida para manejar acciones de datos
    function handleDataAction(e) {
        // 1) Checkbox de selección (admin)
        const cb = e.target.closest(".sel-checkbox");
        if (cb) {
            e.stopPropagation();
            const cedula = cb.dataset.cedula;
            if (!cedula) return;
            if (cb.checked) selectedCedulas.add(cedula);
            else selectedCedulas.delete(cedula);
            actualizarBarraSeleccion();
            const master = document.getElementById("checkbox-todos");
            if (master) {
                const all = document.querySelectorAll('.sel-checkbox');
                master.checked = all.length > 0 && [...all].every(c => c.checked);
            }
            return;
        }

        // 2) Botón de menú 3 puntos (toggle dropdown)
        const menuBtn = e.target.closest('.btn-puntos[data-action="menu"]');
        if (menuBtn) {
            e.preventDefault();
            e.stopPropagation();
            const cedula = menuBtn.dataset.cedula;
            openDropdownMenu(menuBtn, cedula);
            return;
        }

        // 3) Acciones de botones o dropdown items
        const target = e.target.closest("[data-action]");
        if (!target) return;
        if (target.classList.contains("sel-checkbox") || target.closest(".sel-checkbox-wrap")) return;

        const action = target.dataset.action;
        const cedula = target.dataset.cedula;
        const nombre = target.dataset.nombre || "";

        e.preventDefault();
        e.stopPropagation();

        switch (action) {
            case "voto":          accionVoto(cedula, "Votó"); break;
            case "novoto":        accionVoto(cedula, "No Votó"); break;
            case "quick-voto":    quickVoto(cedula); break;
            case "quick-novoto":  quickNoVoto(cedula, nombre); break;
            case "obs":           abrirModalObservacion(cedula, nombre); break;
            case "historial":     abrirHistorial(cedula, nombre); break;
            case "eliminar":      eliminarIndividual(cedula); break;
            case "copiar-ci":     copiarCedula(cedula); break;
            case "compartir-wa":  compartirWhatsApp(cedula, nombre); break;
        }

        // Cerrar dropdown si el click vino de adentro
        if (target.closest(".dropdown")) closeAllMenus();
        else syncMenuCardState();
    }

    // Listener principal en appSection (cards + tabla)
    appSection.addEventListener("click", handleDataAction);

    // Listener en document para dropdowns teleportados al body (desktop tabla)
    document.addEventListener("click", (e) => {
        const inTeleported = e.target.closest('.dropdown.dropdown-teleported');
        if (!inTeleported) return;
        handleDataAction(e);
    }, true); // capture para interceptar antes del cierre general
}

// ═══════════════ CHECKBOXES — funciones globales ═══════════════
window.handleCheckboxChange = function(checkbox) {
    const cedula = checkbox.dataset.cedula;
    if (!cedula) return;
    if (checkbox.checked) selectedCedulas.add(cedula);
    else selectedCedulas.delete(cedula);
    actualizarBarraSeleccion();
};

window.toggleTodosCheckbox = function() {
    if (!state.currentUser?.isAdmin) return;
    const master = document.getElementById("checkbox-todos");
    document.querySelectorAll(".sel-checkbox").forEach(cb => {
        cb.checked = master.checked;
        if (master.checked) selectedCedulas.add(cb.dataset.cedula);
        else selectedCedulas.delete(cb.dataset.cedula);
    });
    actualizarBarraSeleccion();
};
window.seleccionarTodosCheckbox = function() {
    if (!state.currentUser?.isAdmin) return;
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
    if (!state.currentUser?.isAdmin) { barra.style.display = "none"; return; }
    const count = selectedCedulas.size;
    if (count > 0) {
        barra.style.display = "flex";
        if (contador) contador.textContent = `${count} seleccionado${count>1?'s':''}`;
    } else barra.style.display = "none";
}

// ═══════════════ MENÚ 3 PUNTOS ═══════════════
function toggleMenu(event, cedula) {
    event.stopPropagation();
    event.preventDefault();
    const menuBtn = event.target.closest('.btn-puntos') || event.currentTarget;
    openDropdownMenu(menuBtn, cedula);
}
window.toggleMenu = toggleMenu;

// ═══════════════ NUEVAS ACCIONES DEL MENÚ ═══════════════
async function copiarCedula(cedula) {
    try {
        await navigator.clipboard.writeText(cedula);
        toast(`Cédula ${cedula} copiada.`, "ok");
    } catch {
        const ta = document.createElement("textarea");
        ta.value = cedula;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); toast(`Cédula ${cedula} copiada.`, "ok"); }
        catch { toast("No se pudo copiar.", "error"); }
        ta.remove();
    }
}

function compartirWhatsApp(cedula, nombre) {
    const v = state.padron.find(p => p.cedula === cedula);
    if (!v) return;
    const voto   = getVoto(cedula);
    const obs    = getObs(cedula);
    const cambiadoPor = getLog(cedula);

    // Emoji de estado según el voto
    const estadoEmoji = voto === "Votó"    ? "✅" :
                        voto === "No Votó" ? "❌" : "⏳";

    const texto = [
        '🗳️ *Control Electoral — Lista 2 Opción 3*',
        '',
        `👤 *Nombre:* ${v.nombre}`,
        `🪪 *CI:* ${v.cedula}`,
        `🏛️ *Local:* ${v.local  || "—"}`,
        `📋 *Mesa:* ${v.mesa   || "—"}${v.orden ? `  ·  Orden ${v.orden}` : ""}`,
        `${estadoEmoji} *Estado:* ${voto}`,
        obs           ? `📝 *Observación:* ${obs}` : '',
        cambiadoPor !== '---' ? `👤 *Actualizado por:* ${cambiadoPor}` : ''
    ].filter(Boolean).join('\n');

    const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    toast(`Compartiendo datos de ${nombre || v.nombre}...`, "ok");
}

function quickVoto(cedula) {
    const v = state.padron.find(p => p.cedula === cedula);
    if (!v) return;
    const actual = getVoto(cedula);
    if (actual === "Votó") {
        guardarVoto(cedula, "Pendiente", getObs(cedula), "Quitar Voto", `Quitó VOTO de ${v.nombre}`, actual, "Pendiente");
    } else {
        guardarVoto(cedula, "Votó", getObs(cedula), "Votó", `Registró a ${v.nombre} como VOTÓ`, actual, "Votó");
    }
}

function quickNoVoto(cedula, nombre) {
    const v = state.padron.find(p => p.cedula === cedula);
    if (!v) return;
    const actual = getVoto(cedula);
    if (actual === "No Votó") {
        guardarVoto(cedula, "Pendiente", getObs(cedula), "Quitar No Votó", `Quitó NO VOTÓ de ${v.nombre}`, actual, "Pendiente");
    } else {
        state.pendingNoVoto = { cedula, nombre: nombre || v.nombre };
        document.getElementById("modal-novoto-name").textContent = nombre || v.nombre;
        document.getElementById("modal-obs-input").value = getObs(cedula);
        abrirModal("modal-novoto");
    }
}

// ═══════════════ ELIMINACIÓN INDIVIDUAL (admin) ═══════════════
function eliminarIndividual(cedula) {
    if (!state.currentUser?.isAdmin) { toast("Solo el administrador puede eliminar registros.", "error"); return; }
    selectedCedulas.clear();
    selectedCedulas.add(cedula);
    actualizarBarraSeleccion();
    pedirConfirmacionEliminar();
}
window.eliminarIndividual = eliminarIndividual;

window.pedirConfirmacionEliminar = function() {
    if (selectedCedulas.size === 0) return;
    if (!state.currentUser?.isAdmin) { toast("Solo el administrador puede eliminar registros.", "error"); return; }
    const n = selectedCedulas.size;
    const txt = document.getElementById("modal-eliminar-texto");
    if (txt) {
        if (n === 1) {
            const ced = [...selectedCedulas][0];
            const v = state.padron.find(p => p.cedula === ced);
            txt.innerHTML = `¿Estás seguro que querés eliminar a <strong>${escHtml(v?.nombre || ced)}</strong> (CI: ${ced}) de la planilla?<br>Esta acción no se puede deshacer.`;
        } else {
            txt.textContent = `¿Estás seguro que querés eliminar ${n} registros de la planilla? Esta acción no se puede deshacer.`;
        }
    }
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
    await registrarBitacora("Eliminar Votantes", `Admin eliminó ${ok} votante${ok > 1 ? "s" : ""}. Cédulas: ${cedulas.join(", ")}`);
    selectedCedulas.clear();
    const master = document.getElementById("checkbox-todos");
    if (master) master.checked = false;
    actualizarBarraSeleccion();
    actualizarDashboard();
    renderTablaVotantes();
    toast(err === 0
        ? `${ok} registro${ok > 1 ? "s eliminados" : " eliminado"} correctamente.`
        : `⚠ ${ok} eliminados, ${err} con error.`,
        err === 0 ? "ok" : "warn");
};

// ═══════════════ HISTORIAL DE CAMBIOS ═══════════════
async function abrirHistorial(cedula, nombre) {
    document.getElementById("modal-hist-nombre").innerHTML = `
        <div class="hist-header-info">
            <strong>${escHtml(nombre || "Votante")}</strong>
            <span class="hist-ci-chip">CI: ${escHtml(cedula)}</span>
        </div>`;
    const list = document.getElementById("modal-hist-list");
    list.innerHTML = `<div style="text-align:center;padding:20px;"><div class="spinner" style="margin:0 auto 10px;"></div>Cargando historial...</div>`;
    abrirModal("modal-historial");

    try {
        const qRef = query(collection(db, "votos", cedula, "historial"), orderBy("timestamp", "desc"), limit(100));
        const snap = await getDocs(qRef);

        const actual = state.votos[cedula];
        const votoActual = actual?.voto || "Pendiente";
        const cambiadoPor = actual?.modificado_por || "—";

        let resumenHtml = `
            <div class="hist-summary">
                <div class="hist-summary-row">
                    <span class="hist-summary-label">Estado actual</span>
                    <span class="badge ${votoActual === "Votó" ? "badge-voted" : votoActual === "No Votó" ? "badge-novoted" : "badge-pending"}">${votoActual}</span>
                </div>
                <div class="hist-summary-row">
                    <span class="hist-summary-label">Última modificación</span>
                    <span class="hist-summary-value">${escHtml(cambiadoPor)}</span>
                </div>
                ${actual?.observaciones ? `<div class="hist-summary-row"><span class="hist-summary-label">Observación</span><span class="hist-summary-value">"${escHtml(actual.observaciones)}"</span></div>` : ""}
            </div>`;

        if (snap.empty) {
            list.innerHTML = resumenHtml + `<div class="historial-empty"><span class="material-symbols-outlined" style="font-size:42px;opacity:.3;">history_toggle_off</span><br>Sin cambios registrados.<br><span style="font-size:.78rem;color:var(--color-gray);">Cuando se realice algún cambio aparecerá aquí.</span></div>`;
            return;
        }

        const accionInfo = {
            "Votó":          { color: "#15803D", icon: "check_circle",   label: "Voto registrado" },
            "No Votó":       { color: "#B45309", icon: "cancel",         label: "Marcó No Votó" },
            "Quitar Voto":   { color: "#B91C1C", icon: "remove_circle",  label: "Quitó voto" },
            "Quitar No Votó":{ color: "#7F1D1D", icon: "remove_circle",  label: "Quitó No Votó" },
            "Observación":   { color: "#B45309", icon: "edit",           label: "Observación" }
        };

        let timelineHtml = `<div class="hist-timeline-title"><span class="material-symbols-outlined">history</span> Línea de tiempo (${snap.size} eventos)</div>`;
        let timeline = "";
        let primer = true;
        snap.forEach(d => {
            const h = d.data();
            const hora = h.hora_py || timestampAParaguay(h.timestamp);
            const info = accionInfo[h.accion] || { color: "#6B7280", icon: "info", label: h.accion || "Cambio" };

            const transicion = (h.estadoAnterior && h.estadoNuevo && h.estadoAnterior !== h.estadoNuevo)
                ? `<span class="hist-trans"><span class="hist-prev">${escHtml(h.estadoAnterior)}</span> <span class="material-symbols-outlined" style="font-size:14px;">arrow_right_alt</span> <span class="hist-next" style="color:${info.color};">${escHtml(h.estadoNuevo)}</span></span>`
                : "";

            timeline += `
                <div class="historial-item ${primer ? 'is-latest' : ''}">
                    <div class="historial-icon" style="background:${info.color}1a;color:${info.color};border-color:${info.color}55;">
                        <span class="material-symbols-outlined">${info.icon}</span>
                    </div>
                    <div class="historial-body">
                        <div class="historial-accion" style="color:${info.color};">${escHtml(info.label)}${primer ? ' <span class="hist-latest-tag">Más reciente</span>' : ''}</div>
                        ${transicion}
                        <div class="historial-meta">
                            <span class="hist-meta-chip"><span class="material-symbols-outlined">person</span> ${escHtml(h.operador || "---")}</span>
                            <span class="hist-meta-chip"><span class="material-symbols-outlined">schedule</span> ${escHtml(hora)}</span>
                        </div>
                        ${h.detalle ? `<div class="historial-detalle">${escHtml(h.detalle)}</div>` : ""}
                    </div>
                </div>`;
            primer = false;
        });

        list.innerHTML = resumenHtml + timelineHtml + timeline;
    } catch (e) {
        console.error(e);
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--color-danger);">Error al cargar historial.<br><small>${escHtml(e.message || "")}</small></div>`;
    }
}
window.abrirHistorial = abrirHistorial;

// ═══════════════ ACCIONES DE VOTO ═══════════════
function accionVoto(cedula, accion) {
    const actual = getVoto(cedula);
    const v      = state.padron.find(p => p.cedula === cedula);
    const nombre = v?.nombre || cedula;

    if (actual === "Votó" && accion === "Votó") {
        guardarVoto(cedula, "Pendiente", getObs(cedula), "Quitar Voto", `Quitó VOTO de ${nombre}`, actual, "Pendiente"); return;
    }
    if (actual === "No Votó" && accion === "No Votó") {
        guardarVoto(cedula, "Pendiente", getObs(cedula), "Quitar No Votó", `Quitó NO VOTÓ de ${nombre}`, actual, "Pendiente"); return;
    }
    if (accion === "No Votó") {
        state.pendingNoVoto = { cedula, nombre };
        document.getElementById("modal-novoto-name").textContent = nombre;
        document.getElementById("modal-obs-input").value = getObs(cedula);
        abrirModal("modal-novoto");
    } else {
        guardarVoto(cedula, "Votó", getObs(cedula), "Votó", `Registró a ${nombre} como VOTÓ`, actual, "Votó");
    }
}
window.accionVoto = accionVoto;

function confirmNoVoto() {
    if (!state.pendingNoVoto) return;
    const { cedula, nombre } = state.pendingNoVoto;
    const obs = document.getElementById("modal-obs-input").value.trim();
    guardarVoto(cedula, "No Votó", obs, "No Votó",
        `Registró a ${nombre} como NO VOTÓ${obs ? " — " + obs : ""}`, getVoto(cedula), "No Votó");
    cerrarModal("modal-novoto");
    state.pendingNoVoto = null;
}
window.confirmNoVoto = confirmNoVoto;

async function guardarVoto(cedula, voto, observaciones, accionBit, detalleBit, estadoAnterior, estadoNuevo) {
    const operador = state.currentUser.isAdmin ? "Administrador/a" : state.currentUser.username;
    const hora     = ahoraParaguay();
    const modPor   = `${operador} — ${hora}`;
    const payload = { voto, observaciones, modificado_por: modPor, timestamp: serverTimestamp() };
    const histPayload = {
        accion: accionBit, detalle: detalleBit,
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
        if      (voto === "Votó")    toast("¡Voto registrado correctamente!", "ok");
        else if (voto === "No Votó") toast("Registrado como No Votó.", "ok");
        else                         toast("Registro vuelto a Pendiente.", "warn");
        await registrarBitacora(accionBit, detalleBit);
    } catch (err) {
        console.error(err);
        toast("Error al guardar. Verificá la conexión.", "error");
    }
}

// ═══════════════ OBSERVACIONES ═══════════════
let _obsPendiente = null;
function abrirModalObservacion(cedula, nombre) {
    const obsActual = getObs(cedula);
    _obsPendiente = { cedula, nombre, anterior: obsActual };
    const textoEl  = document.getElementById("modal-obs-texto");
    const nombreEl = document.getElementById("modal-obs-nombre");
    if (nombreEl) nombreEl.textContent = `Votante: ${nombre}`;
    if (textoEl)  {
        textoEl.value = obsActual;
        setTimeout(() => { textoEl.focus(); textoEl.setSelectionRange(textoEl.value.length, textoEl.value.length); }, 150);
    }
    abrirModal("modal-obs-confirm");
}
window.abrirModalObservacion = abrirModalObservacion;

async function confirmarObservacion() {
    if (!_obsPendiente) return;
    const { cedula, nombre, anterior } = _obsPendiente;
    const texto = (document.getElementById("modal-obs-texto")?.value || "").trim();
    cerrarModal("modal-obs-confirm");
    await actualizarObservacion(cedula, texto, nombre, anterior);
    _obsPendiente = null;
}
window.confirmarObservacion = confirmarObservacion;

function cancelarObservacion() { _obsPendiente = null; cerrarModal("modal-obs-confirm"); }
window.cancelarObservacion = cancelarObservacion;

async function actualizarObservacion(cedula, texto, nombre, anterior) {
    const actual   = state.votos[cedula] || {};
    const operador = state.currentUser.isAdmin ? "Administrador/a" : state.currentUser.username;
    const hora     = ahoraParaguay();
    const v        = state.padron.find(p => p.cedula === cedula);
    try {
        await setDoc(doc(db, "votos", cedula), {
            voto: actual.voto || "Pendiente",
            observaciones: texto,
            modificado_por: `${operador} — ${hora}`,
            timestamp: serverTimestamp()
        });
        try {
            await addDoc(collection(db, "votos", cedula, "historial"), {
                accion: "Observación",
                detalle: texto ? `"${texto}"` : "Borró observación",
                operador: state.currentUser.fullname || operador,
                hora_py: hora,
                estadoAnterior: anterior || "",
                estadoNuevo: texto || "(vacío)",
                timestamp: serverTimestamp()
            });
        } catch(e) { /* historial opcional */ }
        toast("Observación guardada.", "ok");
        await registrarBitacora("Observación", `Actualizó obs. de ${v?.nombre || nombre || cedula}: "${texto.substring(0,60)}"`);
    } catch { toast("Error al guardar observación.", "error"); }
}
window.actualizarObservacion = actualizarObservacion;

// ═══════════════ ADMIN: OPERADORES ═══════════════
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
        toast(`Operador "${fullname}" creado correctamente.`);
        await registrarBitacora("Nuevo Operador", `Creó operador ${fullname} (${username})`);
        document.getElementById("register-user-form").reset();
        cargarLocalesDesdePadron();
        cargarUsuarios();
    } catch (err) { console.error(err); toast("Error al crear el usuario.", "error"); }
}

// Eliminar operador con modal elegante
window.pedirEliminarOperador = function(username) {
    const u = state.usuarios.find(x => x.username === username);
    document.getElementById("del-user-username").value = username;
    document.getElementById("del-user-label").textContent = u?.fullname ? `${u.fullname} (${username})` : username;
    abrirModal("modal-del-user");
};

window.confirmarEliminarOperador = async function() {
    const username = document.getElementById("del-user-username").value;
    if (!username) return;
    const u = state.usuarios.find(x => x.username === username);
    cerrarModal("modal-del-user");
    try {
        await deleteDoc(doc(db, "usuarios", username));
        toast(`Operador "${u?.fullname || username}" eliminado.`, "warn");
        await registrarBitacora("Eliminar Operador", `Eliminó operador ${u?.fullname || username}`);
        cargarUsuarios();
    } catch { toast("Error al eliminar el operador.", "error"); }
};
// Compatibilidad
window.deleteUser = window.pedirEliminarOperador;

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
            <td>${waLink ? `<a href="${waLink}" target="_blank" class="wa-link"><span class="material-symbols-outlined" style="font-size:16px;">phone</span> ${escHtml(u.phone)}</a>` : escHtml(u.phone || "---")}</td>
            <td><code>${escHtml(u.username)}</code></td>
            <td>${escHtml(u.local || "—")}</td>
            <td>
                <div class="btn-action-row">
                    <button class="btn-action btn-action-blue" onclick="abrirCambiarPassword('${escHtml(u.username)}')">
                        <span class="material-symbols-outlined">lock</span> Cambiar Clave
                    </button>
                    <button class="btn-action btn-action-red" onclick="pedirEliminarOperador('${escHtml(u.username)}')">
                        <span class="material-symbols-outlined">delete</span> Eliminar
                    </button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

// ═══════════════ LOCALES CONFIG ═══════════════
const LOCALES_CONFIG = {
    "GIMNASIO MUNICIPAL":                   { mesaMin: 1,  mesaMax: 20, color: "#B91C1C", colorSoft: "#FCA5A5", icon: "stadium",       labelIcon: "Polideportivo", svgId: "i-polideportivo" },
    "COLEGIO NACIONAL SEBASTIAN DE YEGROS": { mesaMin: 21, mesaMax: 40, color: "#1E40AF", colorSoft: "#93C5FD", icon: "domain",        labelIcon: "Colegio",       svgId: "i-colegio" },
    "ESC.CARLOS ANTONIO LOPEZ":             { mesaMin: 41, mesaMax: 65, color: "#15803D", colorSoft: "#86EFAC", icon: "school",        labelIcon: "Escuela",       svgId: "i-escuela-local" }
};
function getColorLocal(local) { return (LOCALES_CONFIG[local] && LOCALES_CONFIG[local].color) || "#9CA3AF"; }
function getColorLocalSoft(local) { return (LOCALES_CONFIG[local] && LOCALES_CONFIG[local].colorSoft) || "#D1D5DB"; }
function getLocalIconHtml(local, size = 18) {
    const conf = LOCALES_CONFIG[local];
    if (conf?.svgId) return `<svg class="svg-icon local-svg-icon" aria-hidden="true" style="width:${size}px;height:${size}px;color:${conf.color};"><use href="#${conf.svgId}"/></svg>`;
    return `<svg class="svg-icon local-svg-icon" aria-hidden="true" style="width:${size}px;height:${size}px;color:#64748B;"><use href="#i-ubicacion-votacion"/></svg>`;
}
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
            btn.style.setProperty("--lc-soft", conf.colorSoft);
            const iconHtml = getLocalIconHtml(loc, 20);
            btn.innerHTML = `${iconHtml}<span class="lp-name">${loc}</span><span class="lp-mesas">M${conf.mesaMin}–${conf.mesaMax}</span>`;
            btn.onclick = () => {
                picker.querySelectorAll(".local-picker-btn").forEach(b => {
                    b.classList.remove("selected");
                    b.style.background = "";
                    b.style.borderColor = "";
                });
                btn.classList.add("selected");
                if (hidden) hidden.value = loc;
            };
            picker.appendChild(btn);
        });
    }
    if (hidden) hidden.value = "";
}

// ═══════════════ ESTADÍSTICAS ═══════════════
let currentStatsView = "mesas";
let currentLocalForMesas = "GIMNASIO MUNICIPAL";

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
        const iconHtml = getLocalIconHtml(local, 26);
        const card = document.createElement("div");
        card.className = "local-card";
        card.style.setProperty("--lc", color);
        card.style.setProperty("--lc-soft", colorSoft);
        if (local === currentLocalForMesas && currentStatsView === "mesas") card.classList.add("active");

        // Etiqueta corta del tipo de local
        const tipoLabel = conf ? conf.labelIcon : "Otro";
        const mesasLabel = conf ? `Mesas ${conf.mesaMin}–${conf.mesaMax}` : "";

        card.innerHTML = `
            <div class="local-card-inner">
                <div class="local-card-top">
                    <div class="local-card-icon-wrap" style="background:${colorSoft}22;border-color:${color}33;">
                        ${iconHtml}
                    </div>
                    <div class="local-card-name">
                        <span class="local-card-label">${escHtml(local)}</span>
                        <span style="color:${color};">${tipoLabel}${mesasLabel ? ' · ' + mesasLabel : ''}</span>
                    </div>
                </div>
                <div class="local-card-num">${voted}<span class="local-card-num-total"> / ${total}</span></div>
                <div class="local-card-pct">
                    <span>${pct}% participación</span>
                    <span class="local-card-meta-badge" style="background:${color}15;color:${color};border-color:${color}30;">${voted} votaron</span>
                </div>
                <div class="local-card-bar">
                    <div class="local-card-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${color},${colorSoft})"></div>
                </div>
            </div>`;
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
    const localAMostrar = currentLocalForMesas || "GIMNASIO MUNICIPAL";
    const conf = LOCALES_CONFIG[localAMostrar];
    const colorLocal = getColorLocal(localAMostrar);

    if (titleEl) titleEl.textContent = `Votos por mesa — ${localAMostrar}`;
    if (btnVolver) btnVolver.classList.add("hidden");
    if (hintEl) hintEl.style.display = "none";
    if (mesaWrap) mesaWrap.style.display = "";

    if (conf) {
        const mesas = {};
        for (let m = conf.mesaMin; m <= conf.mesaMax; m++) mesas[m] = { voted:0, noVoted:0, pending:0, total:0 };
        state.padron.forEach(v => {
            if (determinarLocal(v) !== localAMostrar) return;
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
                data: { labels, datasets: [{ label: "Votaron", data: dataVoted,
                    backgroundColor: colorLocal + "cc", borderColor: colorLocal,
                    borderWidth: 1.5, borderRadius: 6, hoverBackgroundColor: colorLocal }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    animation: { duration: 700, easing: "easeOutQuart" },
                    plugins: { legend: { display: false },
                        tooltip: { backgroundColor: "rgba(15,23,42,0.92)", padding: 10, cornerRadius: 8, titleFont:{weight:700} } },
                    scales: { x: { grid: { display: false }, ticks: { font: { weight: 600 } } },
                        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 }, grid: { color: "rgba(15,23,42,0.06)" } } }
                }
            });
        }
    }

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
            data: { labels: ["Votaron","No Votaron","Pendientes"],
                datasets: [{ data: [voted, noVoted, pending], backgroundColor: ["#15803D","#B91C1C","#9CA3AF"], borderColor: "#fff", borderWidth: 3 }] },
            options: { responsive: true, maintainAspectRatio: false,
                animation: { animateRotate: true, duration: 800 },
                plugins: { legend: { position: "bottom", labels: { font:{weight:600}, padding:14, usePointStyle:true } } } }
        });
    }
    _renderChartHora();
}

function _renderChartHora() {
    const ctxHora = document.getElementById("chart-hora");
    if (!ctxHora) return;
    const HORAS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    const counts = new Array(HORAS.length).fill(0);
    Object.values(state.votos).forEach(v => {
        if (v?.voto !== "Votó") return;
        let h = horaEnParaguay(v.timestamp);
        if (h === null || isNaN(h)) {
            const m = String(v.modificado_por || "").match(/(\d{1,2}):(\d{2})\s*$/);
            if (m) h = parseInt(m[1], 10);
        }
        if (h === null || isNaN(h)) return;
        const idx = HORAS.indexOf(h);
        if (idx >= 0) counts[idx]++;
    });
    const acumulado = [];
    counts.reduce((acc, n, i) => { acumulado[i] = acc + n; return acumulado[i]; }, 0);
    const labels = HORAS.map(h => `${String(h).padStart(2,"0")}:00`);
    if (state.charts.hora) state.charts.hora.destroy();
    state.charts.hora = new Chart(ctxHora, {
        type: "line",
        data: {
            labels,
            datasets: [
                { label: "Votos en esa hora", data: counts,
                  backgroundColor: "rgba(180,83,9,0.18)", borderColor: "#B45309",
                  borderWidth: 2, pointBackgroundColor: "#B45309", pointRadius: 4, pointHoverRadius: 6,
                  tension: 0.35, fill: true, yAxisID: "y" },
                { label: "Acumulado", data: acumulado,
                  borderColor: "#15803D", backgroundColor: "rgba(21,128,61,0.08)",
                  borderWidth: 2, borderDash: [6, 4], pointBackgroundColor: "#15803D",
                  pointRadius: 3, tension: 0.3, fill: false, yAxisID: "y" }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false,
            animation: { duration: 800, easing: "easeOutQuart" },
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "bottom", labels: { font:{weight:600}, padding:12, usePointStyle:true } },
                tooltip: { backgroundColor: "rgba(15,23,42,0.92)", padding: 10, cornerRadius: 8 } },
            scales: { x: { grid: { display: false }, ticks: { font: { weight: 600 } } },
                y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: "rgba(15,23,42,0.06)" } } }
        }
    });
}

function volverALocales() {
    currentStatsView = "mesas";
    currentLocalForMesas = "GIMNASIO MUNICIPAL";
    renderStatsCharts();
}
window.volverALocales = volverALocales;

// ═══════════════ MODALES / TOASTS / STATUS ═══════════════
function abrirModal(id) { document.getElementById(id)?.classList.add("active"); }
function cerrarModal(id) { document.getElementById(id)?.classList.remove("active"); state.pendingNoVoto = null; }
window.closeModal = cerrarModal;

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

function setStatus(online) {
    const dot = document.getElementById("status-dot"), label = document.getElementById("status-label");
    if (dot) dot.className = "status-dot" + (online ? " online" : "");
    if (label) label.textContent = online ? "en línea" : "sin conexión";
}

function escHtml(str) { return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function jsEscape(str) { return String(str ?? "").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function debounce(fn, ms=300) { let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); }; }

window.exportarXLSX = function() {
    const filas = [["N°","Nombre","Cédula","Domicilio","Local","Mesa","Orden","Estado","Operador","Observación"]];
    state.padron.forEach((v,i)=> filas.push([i+1,v.nombre,v.cedula,v.domicilio||"",v.local||"",v.mesa||"",v.orden||"",getVoto(v.cedula),getLog(v.cedula),getObs(v.cedula)]));
    const ws = XLSX.utils.aoa_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planilla");
    XLSX.writeFile(wb, `planilla-electoral-${Date.now()}.xlsx`);
    toast("Planilla exportada.", "ok");
};

// ═══════════════ CAMBIAR CONTRASEÑA ═══════════════
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
        toast(`Contraseña de "${username}" actualizada.`, "ok");
        await registrarBitacora("Cambio Contraseña", `Cambió contraseña de ${u.fullname || username}`);
        cerrarModal("modal-chpass");
    } catch (err) { errEl.textContent = "Error al guardar."; }
};

// ═══════════════ BIND EVENTOS ═══════════════
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

    ["modal-novoto","modal-chpass","modal-obs-confirm","modal-historial","modal-eliminar-confirm","modal-del-user","modal-clear-bit"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("click", function(e) { if (e.target === this) cerrarModal(id); });
    });

    const runSearch = debounce((val) => { state.searchQuery = val; if(!val) state.searchAllStates=false; state.pagination.page=1; renderTablaVotantes(); }, 300);
    document.getElementById("search-input").addEventListener("input", e => runSearch(e.target.value.toLowerCase().trim()));
    document.getElementById("padron-anr-input")?.addEventListener("keydown", e => { if(e.key==="Enter") buscarPadronANR(); });
    document.querySelectorAll('.bottom-nav-item').forEach(btn => { btn.addEventListener('click', () => switchTab(btn.dataset.tab)); });
}

// ═══════════════ PADRÓN ANR ═══════════════
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
            error.innerHTML = `<span class="material-symbols-outlined" style="color:#B91C1C;">error_outline</span> No está en el padrón`;
            error.style.display = "block";
        }
    } catch (err) {
        loading.style.display = "none";
        error.innerHTML = `<span class="material-symbols-outlined">warning_amber</span> Error al cargar`;
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
        toast(`${nombre} agregado.`, "ok");
        await registrarBitacora("Nuevo Votante", `Agregó a ${nombre} (CI ${cedulaNorm})`);
        actualizarDashboard();
    } catch (e) {
        state.padron = state.padron.filter(p => p.cedula !== cedulaNorm);
        toast("Error al guardar.", "error");
    }
};

// ═══════════════ LIMPIAR BITÁCORA con modal ═══════════════
window.pedirLimpiarBitacora = function() {
    if (!state.currentUser?.isAdmin) return;
    abrirModal("modal-clear-bit");
};
window.confirmarLimpiarBitacora = async function() {
    if (!state.currentUser?.isAdmin) return;
    cerrarModal("modal-clear-bit");
    try {
        const snap = await getDocs(collection(db, "bitacora"));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
        toast("Bitácora limpiada.", "ok");
        await registrarBitacora("Limpiar Bitácora", `Admin limpió toda la bitácora`);
    } catch(e) {
        console.error(e);
        toast("Error al limpiar bitácora.", "error");
    }
};
// Compatibilidad
window.limpiarBitacora = window.pedirLimpiarBitacora;

// ═══════════════ FILTROS Y NAVEGACIÓN ═══════════════
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
        if (!currentLocalForMesas) currentLocalForMesas = "GIMNASIO MUNICIPAL";
        currentStatsView = "mesas";
        renderStatsCharts();
    } else if (tab === "admin") {
        document.getElementById("view-admin").style.display = "flex";
        document.getElementById("tab-admin").classList.add("active");
        document.querySelector('.bottom-nav-item[data-tab="admin"]')?.classList.add("active");
        cargarUsuarios();
        escucharBitacora();
        cargarLocalesDesdePadron();
    } else if (tab === "padron-anr") {
        document.getElementById("view-padron-anr").style.display = "";
        document.getElementById("tab-padron-anr").classList.add("active");
        document.querySelector('.bottom-nav-item[data-tab="padron-anr"]')?.classList.add("active");
    }
}

// Exponer
window.exportarXLSX = exportarXLSX;
window.exportarEstadisticasXLSX = function() { toast("Función disponible en administración.", "warn"); };
window.activarBusquedaGlobal = ()=>{ state.searchAllStates=true; state.pagination.page=1; renderTablaVotantes(); };
window.desactivarBusquedaGlobal = ()=>{ state.searchAllStates=false; state.pagination.page=1; renderTablaVotantes(); };
