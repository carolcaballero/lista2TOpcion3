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

// Set profesional ampliado (estilo Lucide/Phosphor). Estos SVGs se usan como
// fallback cuando Material Symbols Rounded no está disponible. Contiene solo
// el contenido interior (paths) — buildMaterialSymbolSvg() los envuelve en
// <svg viewBox="0 0 24 24" class="ms-fallback-icon" ...>.
const MATERIAL_SYMBOLS_FALLBACK = {
    more_vert:         '<circle cx="12" cy="5"  r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/>',
    check_circle:      '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="m22 4-10 10.01-3-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    cancel:            '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m15 9-6 6M9 9l6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    edit:              '<path d="M12 20h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    person:            '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="2"/>',
    history:           '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7v5l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    schedule:          '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    history_toggle_off:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    arrow_right_alt:   '<path d="M5 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    remove_circle:     '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    delete_forever:    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    info:              '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 16v-4M12 8h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    warning:           '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4M12 17h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    delete_sweep:      '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 6h-6m6 4h-6m6 4h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    lock:              '<rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2"/>',
    person_add:        '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 8v6M23 11h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    download:          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    people:            '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    phone:             '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    search:            '<circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="m21 21-4.35-4.35" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    inbox:             '<path d="M22 12h-6l-2 3h-4l-2-3H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    grid_view:         '<rect x="3" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>',
    error_outline:     '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    warning_amber:     '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4M12 17h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    delete:            '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    logout:            '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m16 17 5-5-5-5M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    shield:            '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    chart:             '<path d="M3 3v18h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 14l4-4 4 4 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    list:              '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    copy:              '<rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    doc:               '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    urna:              '<path d="M9 4h6l1 2h4v2H4V6h4l1-2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><rect x="6" y="8" width="12" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="m10 12 4 3M14 12l-4 3M12 11v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    admin:             '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="m17 11 2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    wifi_off:          '<path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    whatsapp:          '<path d="M17.5 14.4c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.66.15-.2.3-.76.97-.93 1.17-.17.2-.34.22-.63.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.76-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.36-.02-.51-.07-.15-.66-1.6-.91-2.2-.24-.58-.49-.5-.66-.5l-.56-.01a1.07 1.07 0 0 0-.78.36c-.27.3-1.02 1-1.02 2.43 0 1.43 1.04 2.81 1.19 3 .15.2 2.05 3.13 4.97 4.39.7.3 1.24.48 1.66.61.7.22 1.33.19 1.83.12.56-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.43-.07-.13-.27-.2-.57-.36Z" fill="currentColor"/><path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.16 1.6 5.97L0 24l6.16-1.61A11.93 11.93 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.19-3.48-8.52ZM12 21.82a9.82 9.82 0 0 1-5-1.36l-.36-.21-3.66.96.97-3.57-.23-.37A9.86 9.86 0 0 1 2.18 12 9.83 9.83 0 0 1 12 2.18 9.83 9.83 0 0 1 21.82 12 9.83 9.83 0 0 1 12 21.82Z" fill="currentColor"/>',
    trash_sweep:       '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 6h-6m6 4h-6m6 4h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    arrow_back:        '<path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    clock:             '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    user:              '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="2"/>',
    check:             '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
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
    try {
        if (!document.fonts?.load) {
            activateMaterialSymbolsFallback('API document.fonts no disponible');
            return;
        }
        const ok = await Promise.race([
            (async () => {
                await document.fonts.load('16px "Material Symbols Rounded"', 'more_vert');
                if (document.fonts.ready) await document.fonts.ready;
                return document.fonts.check ? document.fonts.check('16px "Material Symbols Rounded"', 'more_vert') : true;
            })(),
            new Promise(resolve => setTimeout(() => resolve(false), 1800))
        ]);
        if (!ok) activateMaterialSymbolsFallback('fuente no disponible o ligaduras no activas');
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
    if (ok > 0) { toast(`✔ ${ok} acciones offline sincronizadas.`, "ok"); actualizarDashboard(); }
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
        if (!e.target.closest('.menu-tres-puntos')) closeAllMenus();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeAllMenus();
    });
    document.getElementById('menu-backdrop')?.addEventListener('click', () => closeAllMenus());
    window.addEventListener('resize', () => closeAllMenus());
    window.addEventListener('scroll', () => {
        if (window.innerWidth > 768) closeAllMenus();
    }, true);
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

function closeAllMenus(exceptCedula = null) {
    document.querySelectorAll('.menu-tres-puntos .dropdown.show').forEach(d => {
        if (!exceptCedula || d.id !== `menu-${exceptCedula}`) {
            d.classList.remove('show', 'dropdown-mobile-sheet');
            d.style.left = '';
            d.style.right = '';
            d.style.top = '';
            d.style.bottom = '';
            d.style.minWidth = '';
        }
    });
    document.querySelectorAll('.card-votante.menu-open').forEach(card => {
        if (!exceptCedula || card.dataset.cedula !== exceptCedula) card.classList.remove('menu-open');
    });
    document.body.classList.remove('menu-sheet-open');
    const backdrop = document.getElementById('menu-backdrop');
    if (backdrop && !exceptCedula) backdrop.classList.remove('show');
}

function syncMenuCardState() {
    document.querySelectorAll('.card-votante').forEach(card => {
        const open = !!card.querySelector('.menu-tres-puntos .dropdown.show');
        card.classList.toggle('menu-open', open);
    });
}

function positionDropdown(menuBtn, menu) {
    if (!menuBtn || !menu) return;
    menu.classList.remove('dropdown-mobile-sheet');
    menu.style.left = '';
    menu.style.right = '0';
    menu.style.top = 'calc(100% + 6px)';
    menu.style.bottom = '';
    menu.style.minWidth = '';

    if (window.innerWidth <= 768) {
        menu.classList.add('dropdown-mobile-sheet');
        document.body.classList.add('menu-sheet-open');
        const backdrop = document.getElementById('menu-backdrop');
        if (backdrop) backdrop.classList.add('show');
        return;
    }

    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (rect.right > vw - 12) {
            menu.style.right = 'auto';
            menu.style.left = `${Math.max(12, menuBtn.offsetWidth - rect.width)}px`;
        }
        if (rect.bottom > vh - 12) {
            menu.style.top = 'auto';
            menu.style.bottom = 'calc(100% + 6px)';
        }
    });
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

// Dropdown del menú 3 puntos: opciones ampliadas
function construirDropdownMenu(v, voto, obs, isAdmin) {
    const id = `menu-${v.cedula}`;
    const nombreEsc = jsEscape(v.nombre);

    let accionesVoto = "";
    if (voto === "Pendiente") {
        accionesVoto += `
            <a href="#" data-action="quick-voto"   data-cedula="${v.cedula}"><svg class="svg-icon" aria-hidden="true" style="color:#15803D;"><use href="#i-check"/></svg> Marcar como <strong>Votó</strong></a>
            <a href="#" data-action="quick-novoto" data-cedula="${v.cedula}" data-nombre="${nombreEsc}"><svg class="svg-icon" aria-hidden="true" style="color:#B45309;"><use href="#i-cancel"/></svg> Marcar como <strong>No Votó</strong></a>`;
    } else if (voto === "Votó") {
        accionesVoto += `
            <a href="#" data-action="quick-novoto" data-cedula="${v.cedula}" data-nombre="${nombreEsc}"><svg class="svg-icon" aria-hidden="true" style="color:#B45309;"><use href="#i-cancel"/></svg> Cambiar a <strong>No Votó</strong></a>
            <a href="#" data-action="quick-voto"   data-cedula="${v.cedula}"><svg class="svg-icon" aria-hidden="true" style="color:#B91C1C;"><use href="#i-arrow-back"/></svg> Quitar voto (Pendiente)</a>`;
    } else {
        accionesVoto += `
            <a href="#" data-action="quick-voto"   data-cedula="${v.cedula}"><svg class="svg-icon" aria-hidden="true" style="color:#15803D;"><use href="#i-check"/></svg> Cambiar a <strong>Votó</strong></a>
            <a href="#" data-action="quick-novoto" data-cedula="${v.cedula}" data-nombre="${nombreEsc}"><svg class="svg-icon" aria-hidden="true" style="color:#B91C1C;"><use href="#i-arrow-back"/></svg> Quitar No Votó (Pendiente)</a>`;
    }

    const menuObs = obs
        ? `<a href="#" data-action="obs" data-cedula="${v.cedula}" data-nombre="${nombreEsc}"><svg class="svg-icon" aria-hidden="true" style="color:#B45309;"><use href="#i-edit"/></svg> Editar observación</a>`
        : `<a href="#" data-action="obs" data-cedula="${v.cedula}" data-nombre="${nombreEsc}"><svg class="svg-icon" aria-hidden="true" style="color:#B45309;"><use href="#i-edit"/></svg> Agregar observación</a>`;

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
            <a href="#" data-action="historial" data-cedula="${v.cedula}" data-nombre="${nombreEsc}" class="dropdown-primary">
                <svg class="svg-icon" aria-hidden="true" style="color:#1D4ED8;"><use href="#i-history"/></svg>
                <span><strong>Ver historial completo</strong><br><small>Todos los cambios y "Cambiado por"</small></span>
            </a>
            <div class="dropdown-divider"></div>
            ${accionesVoto}
            <div class="dropdown-divider"></div>
            ${menuObs}
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

