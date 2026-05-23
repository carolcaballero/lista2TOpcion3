// --- CONFIGURACIÓN DE DATOS INICIALES ---
const DEFAULT_ADMIN = { username: "Admin", password: "CAROL2T3", fullname: "Administrador/a", phone: "N/A", isAdmin: true };
const CSV_PATH = 'data/votantes.csv';
const SVG_PATH = 'assets/icons.svg';

let state = {
    currentUser: null,
    users: [],
    votantes: [],
    searchQuery: ""
};

// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", () => {
    loadSvgSprite();
    initStorage();
    setupEventListeners();
    checkSession();
});

function loadSvgSprite() {
    fetch(SVG_PATH)
        .then(response => response.text())
        .then(data => {
            document.getElementById('svg-container').innerHTML = data;
        }).catch(err => console.error("Error cargando SVG sprites:", err));
}

function initStorage() {
    const localUsers = localStorage.getItem("elecciones_users");
    if (!localUsers) {
        state.users = [DEFAULT_ADMIN];
        localStorage.setItem("elecciones_users", JSON.stringify(state.users));
    } else {
        state.users = JSON.parse(localUsers);
    }

    const localVotantes = localStorage.getItem("elecciones_votantes");
    if (!localVotantes) {
        fetchCSVAndParse();
    } else {
        state.votantes = JSON.parse(localVotantes);
        updateDashboard();
    }
}

function fetchCSVAndParse() {
    fetch(CSV_PATH)
        .then(res => res.text())
        .then(text => {
            const lines = text.split("\n");
            const result = [];
            
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                
                const cols = lines[i].split(",");
                result.push({
                    id: cols[0]?.trim(),
                    nombre: cols[1]?.trim(),
                    cedula: cols[2]?.trim(),
                    voto: cols[3]?.trim() || "Pendiente", // Todos inician en Pendiente por defecto
                    domicilio: cols[4]?.trim() || "---",
                    observaciones: cols[5]?.trim() || "", // Vacío por defecto
                    modificado_por: cols[6]?.trim() || "---"
                });
            }
            state.votantes = result;
            saveVotantes();
            updateDashboard();
        })
        .catch(err => {
            console.error("Error leyendo padrón base.", err);
            state.votantes = [];
        });
}

function saveVotantes() {
    localStorage.setItem("elecciones_votantes", JSON.stringify(state.votantes));
}

function saveUsers() {
    localStorage.setItem("elecciones_users", JSON.stringify(state.users));
}

function setupEventListeners() {
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("logout-btn").addEventListener("click", handleLogout);
    document.getElementById("search-input").addEventListener("input", (e) => {
        state.searchQuery = e.target.value.toLowerCase();
        renderVotantesTable();
    });
    document.getElementById("tab-planilla").addEventListener("click", () => switchTab('planilla'));
    document.getElementById("tab-admin").addEventListener("click", () => switchTab('admin'));
    document.getElementById("register-user-form").addEventListener("submit", handleRegisterUser);
}

function checkSession() {
    const session = sessionStorage.getItem("active_user");
    if (session) {
        const user = state.users.find(u => u.username === session);
        if (user) {
            loginSuccess(user);
            return;
        }
    }
    switchView('login');
}

function handleLogin(e) {
    e.preventDefault();
    const userIn = document.getElementById("username").value.trim();
    const passIn = document.getElementById("password").value;
    const errorEl = document.getElementById("login-error");

    const foundUser = state.users.find(u => u.username.toLowerCase() === userIn.toLowerCase() && u.password === passIn);

    if (foundUser) {
        errorEl.textContent = "";
        sessionStorage.setItem("active_user", foundUser.username);
        loginSuccess(foundUser);
    } else {
        errorEl.textContent = "Usuario o contraseña incorrectos.";
    }
}

function loginSuccess(user) {
    state.currentUser = user;
    
    const userInfoSpan = document.querySelector(".user-info span");
    if (userInfoSpan) {
        if (user.username === "Admin") {
            userInfoSpan.innerHTML = `<strong id="current-user-display">Administrador/a</strong>`;
        } else {
            userInfoSpan.innerHTML = `Usuario: <strong id="current-user-display">${user.fullname}</strong>`;
        }
    }

    document.getElementById("login-form").reset();

    const adminTab = document.getElementById("tab-admin");
    if (user.username === "Admin") {
        adminTab.classList.remove("hidden");
    } else {
        adminTab.classList.add("hidden");
    }

    switchView('app');
    switchTab('planilla');
    updateDashboard();
}

function handleLogout() {
    sessionStorage.removeItem("active_user");
    state.currentUser = null;
    switchView('login');
}

// --- MANEJO DE VISTAS ---
function switchView(view) {
    if (view === 'login') {
        document.getElementById("login-section").classList.remove("hidden");
        document.getElementById("app-section").classList.add("hidden");
    } else {
        document.getElementById("login-section").classList.add("hidden");
        document.getElementById("app-section").classList.remove("hidden");
    }
}

function switchTab(tab) {
    const btnPlanilla = document.getElementById("tab-planilla");
    const btnAdmin = document.getElementById("tab-admin");
    const viewPlanilla = document.getElementById("view-planilla");
    const viewAdmin = document.getElementById("view-admin");

    if (tab === 'planilla') {
        btnPlanilla.classList.add("active");
        btnAdmin.classList.remove("active");
        viewPlanilla.classList.remove("hidden");
        viewAdmin.classList.add("hidden");
        renderVotantesTable();
    } else {
        btnPlanilla.classList.remove("active");
        btnAdmin.classList.add("active");
        viewPlanilla.classList.add("hidden");
        viewAdmin.classList.remove("hidden");
        renderUsersTable();
    }
}

function updateDashboard() {
    renderVotantesTable();
    calculateMetrics();
}

function calculateMetrics() {
    const total = state.votantes.length;
    const voted = state.votantes.filter(v => v.voto === "Votó").length;
    const noVoted = state.votantes.filter(v => v.voto === "No Votó").length;
    const pending = state.votantes.filter(v => v.voto === "Pendiente").length;

    document.getElementById("metric-total").textContent = total;
    document.getElementById("metric-voted").textContent = voted;
    document.getElementById("metric-pending").innerHTML = `${pending} <span style="font-size:0.85rem; color:#aaa; display:block; margin-top:5px;">(${noVoted} No Votaron)</span>`;
}

// --- RENDERIZADO DE TABLA PLANILLA ---
function renderVotantesTable() {
    const tbody = document.getElementById("votantes-table-body");
    tbody.innerHTML = "";

    const filtered = state.votantes.filter(v => 
        v.nombre.toLowerCase().includes(state.searchQuery) || 
        v.cedula.includes(state.searchQuery)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No se encontraron registros.</td></tr>`;
        return;
    }

    filtered.forEach((v, index) => {
        const tr = document.createElement("tr");
        
        // Estilos visuales del Estado Actual (Badge informativo)
        let badgeStyle = "padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; display: inline-block; text-transform: uppercase; text-align: center; min-width: 95px;";
        if (v.voto === "Votó") {
            badgeStyle += "background-color: #00CC44; color: #FFFFFF;"; // Verde si ya votó
        } else if (v.voto === "No Votó") {
            badgeStyle += "background-color: #E50000; color: #FFFFFF;"; // Rojo si marcó No Votó
        } else {
            badgeStyle += "background-color: #333333; color: #DDDDDD;"; // Gris para Pendiente
        }

        // Estilos de botones de acción en base a la selección activa
        const activeVotoStyle = v.voto === "Votó" 
            ? "background-color: #00CC44; color: white; border: none; font-weight: bold;" 
            : "background-color: #222; color: #888; border: 1px solid #444;";
            
        const activeNoVotoStyle = v.voto === "No Votó" 
            ? "background-color: #E50000; color: white; border: none; font-weight: bold;" 
            : "background-color: #222; color: #888; border: 1px solid #444;";

        tr.innerHTML = `
            <td><strong>${index + 1}</strong></td>
            <td>${v.nombre}</td>
            <td>${v.cedula}</td>
            <td>${v.domicilio}</td>
            
            <td>
                <span style="${badgeStyle}">${v.voto}</span>
            </td>
            
            <td>
                <div style="display: flex; gap: 6px; min-width: 140px;">
                    <button style="${activeVotoStyle} padding: 8px 10px; font-size: 0.75rem; border-radius: 4px; cursor: pointer; flex: 1; text-transform: uppercase;" 
                            onclick="ejecutarAccionVoto('${v.id}', 'Votó')">
                        Votó
                    </button>
                    <button style="${activeNoVotoStyle} padding: 8px 10px; font-size: 0.75rem; border-radius: 4px; cursor: pointer; flex: 1; text-transform: uppercase;" 
                            onclick="ejecutarAccionVoto('${v.id}', 'No Votó')">
                        No Votó
                    </button>
                </div>
            </td>
            
            <td>
                <input type="text" class="obs-input" id="obs-${v.id}" value="${v.observaciones}" 
                    placeholder="Añadir motivo..." 
                    onchange="updateObservacion('${v.id}', this.value)">
            </td>
            <td>
                <span class="log-span">${v.modificado_por}</span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- MANEJO DE ACCIONES DIRECTAS POR BOTÓN ---
window.ejecutarAccionVoto = function(id, accionSolicitada) {
    const target = state.votantes.find(v => v.id == id);
    if (!target) return;

    // Si vuelve a presionar el botón activo, se limpia y regresa a Pendiente
    if (target.voto === accionSolicitada) {
        target.voto = "Pendiente";
        if(accionSolicitada === "No Votó") target.observaciones = "";
    } else {
        target.voto = accionSolicitada;

        // Dispara cuadro de diálogo interactivo solo si la opción elegida es No Votó
        if (accionSolicitada === "No Votó") {
            const justificacion = prompt(`Justificación de inasistencia para:\n${target.nombre}\n\n¿Por qué NO votó?`);
            if (justificacion !== null && justificacion.trim() !== "") {
                target.observaciones = justificacion.trim();
            } else {
                target.observaciones = "No asistió (Sin motivo especificado)";
            }
        } else {
            // Si cambia a Votó, limpiamos observaciones automáticas previas por coherencia
            target.observaciones = "";
        }
    }

    // Auditoría de modificaciones en pantalla
    target.modificado_por = `Por: ${state.currentUser.username === "Admin" ? "Administrador/a" : state.currentUser.username}`;
    
    saveVotantes();
    updateDashboard();
};

window.updateObservacion = function(id, text) {
    const target = state.votantes.find(v => v.id == id);
    if (target) {
        target.observaciones = text.trim();
        target.modificado_por = `Por: ${state.currentUser.username === "Admin" ? "Administrador/a" : state.currentUser.username}`;
        saveVotantes();
        renderVotantesTable();
    }
};

// --- GESTIÓN DE USUARIOS ---
function handleRegisterUser(e) {
    e.preventDefault();
    const fullname = document.getElementById("reg-fullname").value.trim();
    const phone = document.getElementById("reg-phone").value.trim();
    const username = document.getElementById("reg-username").value.trim();
    const password = document.getElementById("reg-password").value;

    if (state.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        alert("El nombre de usuario ya existe.");
        return;
    }

    state.users.push({ username, password, fullname, phone, isAdmin: false });
    saveUsers();
    document.getElementById("register-user-form").reset();
    renderUsersTable();
    alert("Usuario creado correctamente.");
}

function renderUsersTable() {
    const tbody = document.getElementById("users-table-body");
    tbody.innerHTML = "";

    const externalUsers = state.users.filter(u => u.username !== "Admin");

    if (externalUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#aaa;">No hay usuarios externos registrados.</td></tr>`;
        return;
    }

    externalUsers.forEach(u => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${u.fullname}</td>
            <td>${u.phone}</td>
            <td><code>${u.username}</code></td>
            <td>
                <button class="btn-danger" onclick="deleteUser('${u.username}')">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.deleteUser = function(username) {
    if (confirm(`¿Eliminar al usuario ${username}?`)) {
        state.users = state.users.filter(u => u.username !== username);
        saveUsers();
        renderUsersTable();
    }
};
