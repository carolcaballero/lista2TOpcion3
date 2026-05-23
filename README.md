# Sistema de Registro de Votantes
## MGTR. Carolina Caballero - Concejal 2026-2031
### Lista 2T - Opción 3

---

## Estructura de archivos para subir a GitHub

```
votantes/
├── index.html          ← Página principal (login + app en una sola página)
├── css/
│   └── styles.css      ← Estilos completos (rojo, blanco, negro)
├── js/
│   └── app.js          ← Toda la lógica: auth, datos, UI
├── data/
│   └── votantes.csv    ← Ejemplo de padrón (tu archivo CSV real)
└── README.md           ← Este archivo
```

## Credenciales por defecto

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| Admin   | CAROL2T3  | Administrador |

## Cómo subir a GitHub Pages

1. Crea un repositorio nuevo en GitHub
2. Sube todos estos archivos (arrastra la carpeta `votantes/`)
3. Ve a **Settings → Pages**
4. Source: Deploy from a branch → Branch: `main` → Folder: `/ (root)`
5. Guarda y espera 1-2 minutos
6. Tu sitio estará en: `https://TUUSUARIO.github.io/nombre-repo/`

## Funcionalidades

- ✅ Login con usuario/contraseña
- ✅ Planilla de votantes (N°, nombre, cédula, estado, barrio, observaciones)
- ✅ Marcar "Ya votó" / "No votó" con registro de quién marcó
- ✅ Buscar por CI o nombre
- ✅ Importar CSV de votantes
- ✅ Admin puede registrar nuevos usuarios
- ✅ Estadísticas y gráficos
- ✅ Registro de actividad/auditoría
- ✅ Diseño responsive (móvil/desktop)
- ✅ Colores: Rojo, Blanco, Negro

## Formato CSV para importar

```csv
N°;Nombre y Apellido;Cédula;Estado;Domicilio/Barrio;Observaciones
```

---
**Desarrollado para la campaña MGTR. Carolina Caballero**
