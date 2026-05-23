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
                    voto: cols[3]?.trim() || "Pendiente", 
                    domicilio: cols[4]?.trim() || "---",
                    observaciones: cols[5]?.trim() || "", 
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

// --- MANEJO DE VISTAS Y PESTAÑAS ---
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
    const searchWrapper = document.getElementById("search-wrapper");

    if (tab === 'planilla') {
        btnPlanilla.classList.add("active");
        btnAdmin.classList.remove("active");
        viewPlanilla.classList.remove("hidden");
        viewAdmin.classList.add("hidden");
        
        if(searchWrapper) searchWrapper.classList.remove("hidden"); 
        
        renderVotantesTable();
    } else {
        btnPlanilla.classList.remove("active");
        btnAdmin.classList.add("active");
        viewPlanilla.classList.add("hidden");
        viewAdmin.classList.remove("hidden");
        
        if(searchWrapper) searchWrapper.classList.add("hidden"); 
        
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

    // 1. Filtrar por búsqueda
    let filtered = state.votantes.filter(v => 
        v.nombre.toLowerCase().includes(state.searchQuery) || 
        v.cedula.includes(state.searchQuery)
    );

    // 2. ORDENAMIENTO (Agrupación): Votó -> No Votó -> Pendiente
    const ordenEstados = {
        "Votó": 1,
        "No Votó": 2,
        "Pendiente": 3
    };

    filtered.sort((a, b) => {
        const pesoA = ordenEstados[a.voto] || 3;
        const pesoB = ordenEstados[b.voto] || 3;

        // Si son de grupos distintos, los ordena por peso (1, 2, 3)
        if (pesoA !== pesoB) {
            return pesoA - pesoB;
        }
        // Si están en el mismo grupo (ej. los dos son "Pendiente"), ordena alfabéticamente
        return a.nombre.localeCompare(b.nombre);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No se encontraron registros.</td></tr>`;
        return;
    }

    // 3. Renderizar filas ya ordenadas
    filtered.forEach((v, index) => {
        const tr = document.createElement("tr");
        
        let badgeStyle = "padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; font-weight:
