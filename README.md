# Diablillos · Box Score

Plataforma para capturar box scores de béisbol (tradicional y categoría Chupón) y llevar las estadísticas de bateo, pitcheo y fildeo del equipo, con fichas de jugador y reportes en PDF.

## Cómo está armado

- `index.html` · toda la aplicación (pantallas, estadísticas, PDF).
- `api/data.js` · función de Vercel que guarda y lee los datos en **Postgres**.
- `package.json` · dependencia `pg` para conectarse a Postgres.

Los datos viven en tres tablas que la API crea sola la primera vez:

| Tabla | Contenido |
|---|---|
| `bs_roster` | un renglón por jugador (`id`, `data` jsonb con nombre, número, posición y foto) |
| `bs_games` | un renglón por juego (`id`, `data` jsonb con el box score completo) |
| `bs_config` | nombre del equipo |

## Variables de entorno en Vercel

| Variable | Para qué |
|---|---|
| `DIABLILLOS_DB_URL` | Cadena de conexión de Neon (base DIABLILLOS, con pooling). Tiene prioridad sobre `DATABASE_URL`. |
| `EDIT_KEY` | Clave para capturar y editar. Quien no la tenga solo puede ver. |
| `VIEW_KEY` | Opcional. Si la defines, también se pide una clave para ver los datos. |

## Cargar los datos existentes

1. Abre el sitio, toca **Ingresar clave** y escribe tu `EDIT_KEY`.
2. Ve a **Roster → Cargar respaldo** y elige el archivo `Diablillos_respaldo_*.json`.

Los archivos de respaldo están en `.gitignore` y no se suben a GitHub.
