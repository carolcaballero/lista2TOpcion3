# Mgtr. Carolina Caballero — Sistema de Votantes
## Concejal 2026–2031 | Lista 2T | Opción 3

Sistema web de registro y control de votantes para uso interno del equipo de campaña.

---

## 🗂️ Estructura del Proyecto

```
votantes/
├── index.html          ← Página principal (login + app)
├── css/
│   └── styles.css      ← Estilos (rojo, blanco, negro)
├── js/
│   └── app.js          ← Lógica principal
├── assets/
│   └── icons.svg       ← Íconos SVG sprite
├── data/
│   └── votantes.csv    ← Padrón base de votantes
└── README.md
```

---

## 🚀 Publicar en GitHub Pages

1. Subir toda la carpeta a un repositorio GitHub
2. Ir a **Settings → Pages**
3. En "Source" seleccionar **Deploy from a branch → main → / (root)**
4. El sitio estará disponible en `https://TU_USUARIO.github.io/NOMBRE_REPO/`

---

## 🔐 Acceso por defecto

| Usuario | Contraseña |
|---------|------------|
| `Admin` | `CAROL2T3` |

El administrador puede crear nuevos operadores desde el **Panel de Usuarios**.

---

## 📋 Formato del CSV

El archivo `data/votantes.csv` debe tener este formato:

```csv
nro,nombre,apellido,cedula,voto,domicilio,observaciones
1,María,González,1234567,no,Barrio San Pedro,
2,Juan,Pérez,2345678,si,Centro,Ya confirmado
```

**Columnas:**
- `nro` — Número de padrón
- `nombre` — Nombre del votante
- `apellido` — Apellido del votante
- `cedula` — Número de cédula de identidad
- `voto` — `si` o `no`
- `domicilio` — Barrio o dirección
- `observaciones` — Notas adicionales (opcional)

---

## 💡 Funcionalidades

- ✅ Login con usuario y contraseña
- ✅ Panel de control para el administrador
- ✅ Registro y eliminación de operadores
- ✅ Carga de padrón desde CSV (archivo o URL de GitHub)
- ✅ Marcar/desmarcar votos con registro de quién lo hizo
- ✅ Búsqueda por nombre o CI
- ✅ Filtros: todos / votaron / no votaron
- ✅ Observaciones opcionales por votante
- ✅ Estadísticas en tiempo real
- ✅ Exportar CSV actualizado
- ✅ Datos persistentes en localStorage

---

## 🎨 Diseño

Colores institucionales: **Rojo · Blanco · Negro**
