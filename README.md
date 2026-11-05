# Diablillos · Box Score

Plataforma para capturar box scores de béisbol (tradicional y categoría Chupón) y llevar las estadísticas de bateo, pitcheo y fildeo del equipo, con fichas de jugador y reportes en PDF.

## Cómo está armado

- `index.html` · toda la aplicación (pantallas, estadísticas, PDF, inicio de sesión y panel de administración).
- `api/data.js` · función de Vercel que guarda y lee los datos en **Postgres** y controla usuarios y permisos.
- `package.json` · dependencia `pg` para conectarse a Postgres.

## Usuarios y roles

| Rol | Alcance |
|---|---|
| Administrador | Ve, corrige y administra todo: crea equipos y usuarios y asigna roles. |
| Supervisor | Ve y corrige todos los equipos (captura y roster), pero no da de alta usuarios ni equipos. |
| Captura | Por equipo: captura box scores y edita el roster de ese equipo. |
| Lectura | Por equipo: solo ve estadísticas y PDF. |

Un usuario puede tener acceso a varios equipos, con un rol distinto en cada uno. Los permisos se revisan en el servidor en cada consulta.

## Tablas (las crea la API sola)

| Tabla | Contenido |
|---|---|
| `bs_teams` | equipos (nombre, categoría, logo) |
| `bs_users` | usuarios (correo, nombre, contraseña cifrada con scrypt, administrador, supervisor, activo) |
| `bs_members` | acceso de cada usuario a cada equipo (`editor` o `viewer`) |
| `bs_roster` | jugadores (`team_id`, `data` jsonb) |
| `bs_games` | juegos (`team_id`, `data` jsonb con el box score completo) |

## Variables de entorno en Vercel

| Variable | Para qué |
|---|---|
| `DIABLILLOS_DB_URL` | Cadena de conexión de Neon (con pooling). Tiene prioridad sobre `DATABASE_URL`. |
| `EDIT_KEY` | Clave de instalación: solo se pide al crear el primer administrador. |
| `AUTH_SECRET` | Opcional: secreto para firmar las sesiones. Si falta, se deriva de la cadena de conexión. |

## Primer uso

1. Abre el sitio: aparece **Configurar administrador**. Escribe tu nombre, correo, contraseña y la `EDIT_KEY`.
2. Los jugadores y juegos que ya existían quedan en un primer equipo.
3. En la pestaña **Admin** crea más equipos y usuarios.

Los archivos `*respaldo*.json` están en `.gitignore` y no se suben a GitHub.
