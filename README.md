# 🗳️ Sistema de Registro de Votantes
## Mgtr. Carolina Caballero · Concejal 2026–2031 · Lista 2T · Opción 3

Sistema web de registro y seguimiento de votantes, diseñado para funcionar completamente en GitHub Pages (sin servidor).

---

## 📁 Estructura de carpetas

```
votantes/
├── index.html          ← Página principal (login + app)
├── css/
│   └── styles.css      ← Estilos (colores rojo, blanco, negro)
├── js/
│   └── app.js          ← Lógica principal
├── assets/
│   └── icons.svg       ← Íconos SVG sprite
├── data/
│   └── votantes.csv    ← Padrón base de votantes
└── README.md
```

---

## 🚀 Cómo publicar en GitHub Pages

1. Crear un repositorio en GitHub (puede ser privado o público)
2. Subir todos los archivos manteniendo la estructura de carpetas
3. Ir a **Settings → Pages**
4. En *Source*, seleccionar **Deploy from a branch → main → / (root)**
5. Guardar. En unos minutos estará en: `https://TU_USUARIO.github.io/NOMBRE_REPO/`

---

## 📋 Formato del archivo CSV

El archivo `data/votantes.csv` tiene este encabezado:

```
nro,nombre,apellido,cedula,voto,domicilio,observaciones,marcadoPor,fechaMarca
```

Ejemplo:
```
1,Juan,Pérez,1234567,no,Barrio Central,,
2,María,González,2345678,si,,,"Admin","2024-10-15T10:00:00.000Z"
```

**Para cargar un CSV desde GitHub:**
1. Subir el CSV al repositorio
2. Copiar la URL raw: `https://raw.githubusercontent.com/usuario/repo/main/data/votantes.csv`
3. En el sistema → pestaña **Configuración** → pegar URL y guardar

---

## 🔐 Acceso por defecto

| Usuario | Contraseña | Rol         |
|---------|-----------|-------------|
| Admin   | CAROL2T3  | Administrador |

El administrador puede crear, editar y eliminar usuarios adicionales.

---

## 👥 Roles

| Rol           | Permisos                                                     |
|---------------|--------------------------------------------------------------|
| **Admin**     | Todo: ver, agregar, editar, eliminar votantes y usuarios     |
| **Usuario**   | Ver planilla, buscar, marcar/desmarcar votos con observación |

---

## ✅ Funcionalidades

- [x] Login seguro con usuario/contraseña
- [x] Planilla con N°, Nombre, Apellido, Cédula, Estado de voto, Barrio, Observaciones
- [x] Botón "Votó / Desmarcar" por votante — registra quién marcó y cuándo
- [x] Búsqueda por nombre o número de cédula
- [x] Filtro por estado (todos / votaron / no votaron)
- [x] Dashboard con estadísticas y barra de progreso
- [x] Panel admin para gestión de usuarios (agregar / editar / eliminar)
- [x] Observación opcional al desmarcar voto
- [x] Carga de datos desde CSV en GitHub
- [x] Exportar planilla como CSV
- [x] Paginación de la tabla
- [x] Diseño rojo / blanco / negro — íconos SVG
- [x] Funciona offline con localStorage

---

## 💾 Almacenamiento de datos

Los datos se guardan en el **localStorage** del navegador para persistencia entre sesiones.  
Al cargar la página por primera vez (o al hacer "Recargar CSV"), se importan los datos del CSV.  
Los cambios (marcado de votos, nuevos registros) se guardan localmente de forma automática.

---

## 📱 Compatible con

- ✅ Google Chrome / Chromium
- ✅ Mozilla Firefox
- ✅ Microsoft Edge
- ✅ Safari (iOS y macOS)
- ✅ Dispositivos móviles

---

*Desarrollado para uso interno del equipo de campaña. 2026.*
