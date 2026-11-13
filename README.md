# BoxScore MX

Plataforma para capturar box scores de béisbol (tradicional y categoría Chupón) y llevar las estadísticas de bateo, pitcheo y fildeo del equipo, con indicadores sabermétricos, proyecciones, MVP por juego, tarjetas para compartir, fichas de jugador y reportes en PDF. Se puede instalar en el celular y capturar sin señal.

## Cómo está armado

- `index.html` · la aplicación: pantallas, PDF, tarjetas, inicio de sesión y panel de administración.
- `js/calc.js` · los cálculos sin pantalla: estadísticas, wOBA, MVP, turno por turno, reglas de lanzamientos y descanso, lectura de jugadas, cumpleaños. Lo usan la app y las pruebas.
- `api/data.js` · función de Vercel que guarda y lee los datos en **Postgres** y controla usuarios y permisos.
- `sw.js`, `manifest.webmanifest`, `icon*.png`, `icon.svg` · app instalable y disponible sin señal.
- `tests/` · pruebas automáticas (ver abajo).
- `package.json` · dependencia `pg` para Postgres; `@electric-sql/pglite` solo para las pruebas.

## Navegación

Cuatro grupos arriba y sus secciones abajo:

| Grupo | Secciones |
|---|---|
| Juego | Box score (captura) · Juegos (lista, resumen, MVP y **contra cada rival**) |
| Estadísticas | Bateo · Pitcheo (con **¿quién puede lanzar hoy?**) · Fildeo (con **reparto del tiempo de juego**) |
| Análisis | Indicadores · Proyección |
| Equipo | Roster · Admin |

El selector **Temporada** del encabezado filtra todos los módulos por año (o "Carrera completa"). La Proyección siempre usa todas las temporadas.

## Módulos

- **Box score**: hoja de anotación por turno (en cada turno se puede **tocar el campo donde cayó la bola**; la app sugiere la jugada), lanzadores (incluye **LZ**, lanzamientos), defensiva y validaciones. El juego en curso se guarda en el teléfono en cada cambio; si se cierra la página, al volver se ofrece continuarlo. Avisa si un pitcher pasa el máximo de lanzamientos de su edad o no ha cumplido su descanso.
- **Juego en vivo**: botón **En vivo** en el Box score. El coach crea un enlace del equipo (`/?v=…`) y marca **Transmitir este juego**; mientras captura, los papás ven sin usuario: una barra fija con el marcador, la entrada, los outs y los corredores; el campo con nuestra defensiva (cuando el rival batea) o los corredores y el bateador (cuando batea el equipo); un cartel con el último batazo grande (home run, el que nos pone al frente o empata, triple o de 2+ carreras); quién está al bat y quién sigue; **Mi jugador** (cada papá elige a su hijo una vez, se guarda en su teléfono, y la página le avisa cuando está en espera o al bat); las jugadas turno por turno con filtro de "Carreras"; el marcador por entrada y los lanzamientos de nuestro pitcher. La página se actualiza sola cada 8 segundos y, al guardar el juego, queda como final. Los niños aparecen con su nombre y la inicial del apellido. Si no se lleva la hoja del rival, sus entradas salen como "N carreras en la entrada".
- **Juegos**: lista con MVP, resumen del juego, **Compartir resumen** (texto listo para WhatsApp), tarjeta MVP y reporte por rival.
- **Indicadores**: récord esperado, valor del primer turno de la entrada, OBP por outs, eficiencia para anotar, carreras por entrada, wOBA/wRAA, alertas de BABIP, ERA contra FIP, DER, **hacia dónde batean**, **producción por lugar en el orden**, lineup sugerido y alertas para el coach. Cada indicador tiene su botón **?** con qué mide, cómo se mide y cómo leerlo.
- **Proyección**: al elegir un jugador, su rendimiento más probable y su **mapa de batazos** (un punto por batazo, color y forma por resultado) con la **distribución por jardín** sobre el campo y en barras. También va en el PDF de proyección.
- **Ficha del jugador**: números, **evolución** (últimos 3 juegos), **metas**, **por situación**, **mapa de batazos**, juego por juego, tarjetas y **enlace para papás**.
- **Tarjetas**: cumpleaños (jugador, papás, redes) y MVP (portada, marcador, medalla), en imagen o PDF.

## Reglas de lanzamientos (Little League / Pitch Smart)

Máximo por día: 7-8 años 50 · 9-10 años 75 · 11-12 años 85 · 13-16 años 95 · 17-18 años 105.
Descanso (14 años o menos): 66+ lanzamientos 4 días · 51-65 3 · 36-50 2 · 21-35 1. De 15 a 18 años: 76+ 4 · 61-75 3 · 46-60 2 · 31-45 1.
La edad sale de la fecha de nacimiento del Roster. Están en `js/calc.js` (`PITCH_MAX`, `restDays`) por si la liga usa otra tabla.

## Paquetes por equipo (Básico, Gold, Pro)

Cada equipo tiene un paquete y una vigencia, según el análisis de pricing de Dugout Digital. El administrador los asigna en **Admin › Equipos › Editar › Datos**. Los roles de abajo dicen *quién* hace qué; el paquete dice *qué módulos* tiene el equipo.

| Módulo | Básico | Gold | Pro |
|---|---|---|---|
| Box score, lista de juegos, resumen y Compartir resumen | Sí | Sí | Sí |
| MVP por juego y tarjeta MVP | Sí | Sí | Sí |
| Roster y tarjetas de cumpleaños | Sí | Sí | Sí |
| Bateo, Pitcheo (¿quién puede lanzar hoy?), Fildeo | — | Sí | Sí |
| Ficha del jugador, metas y enlace para papás | — | Sí | Sí |
| Juego en vivo para papás | — | Sí | Sí |
| Contra cada rival y reporte de temporada PDF | — | Sí | Sí |
| Indicadores, mapa de batazos, wOBA/FIP en la ficha, Proyección | — | — | Sí |

- Un equipo nuevo empieza en **Gold** con seis meses de vigencia. Los equipos que ya existían antes de los paquetes quedaron en **Pro** y sin vencimiento.
- Los módulos fuera del paquete se ven en las pestañas con su etiqueta (GOLD o PRO) y muestran qué incluyen y cómo activarlos. Los juegos capturados siempre cuentan: al subir de paquete aparecen las estadísticas de toda la temporada.
- **Vigencia**: la licencia vale hasta la fecha indicada. Desde 15 días antes se avisa en el equipo. Al vencer, el equipo queda en solo lectura (Captura y Supervisor ya no guardan; el administrador sí) y los datos se conservan. El botón **+6 meses** renueva desde el vencimiento actual, o desde hoy si ya venció.
- El servidor bloquea el enlace para papás y el juego en vivo en Básico, y las escrituras con la licencia vencida.

## Usuarios y roles

| Rol | Alcance |
|---|---|
| Administrador | Ve, corrige y administra todo: crea equipos y usuarios y asigna roles. |
| Supervisor | Ve y corrige todos los equipos (captura y roster), pero no da de alta usuarios ni equipos. |
| Captura | Por equipo: captura box scores y edita el roster de ese equipo. |
| Lectura | Por equipo: solo ve estadísticas y PDF. |
| Papás (enlace) | Sin usuario: con el enlace de la ficha ven solo a su hijo. El coach lo crea y lo desactiva desde la ficha. |
| Papás (en vivo) | Sin usuario: con el enlace en vivo del equipo siguen el juego que se está capturando. Captura y Supervisor lo crean y lo desactivan desde el Box score. |

Un usuario puede tener acceso a varios equipos, con un rol distinto en cada uno. A un Supervisor o Administrador también se le pueden marcar **sus equipos**: no cambia sus permisos, pero se le abren primero y salen arriba en su selector. Los permisos se revisan en el servidor en cada consulta.

## Datos, sincronización y seguridad

- **Edición simultánea**: cada juego y jugador tiene una versión. Si otra persona guardó mientras editabas, la app muestra las dos versiones y deja elegir "Guardar la mía" o "Usar su versión".
- **Sin señal**: la app abre con la última copia descargada; lo que se guarda queda en cola en el teléfono y se sube solo al volver la conexión.
- **Sincronización ligera**: después de la primera carga, cada 45 segundos solo se descargan los registros que cambiaron.
- **Inicio de sesión**: 5 intentos fallidos por correo (o 20 por dirección IP) en 15 minutos bloquean 15 minutos.
- **Enlace para papás**: solo viajan los datos de ese niño; de los demás no van nombres ni líneas.
- **Juego en vivo**: el teléfono del coach sube un resumen del juego (máximo 96 KB) unos segundos después de cada cambio en la hoja. Solo viajan nombres cortos y números; no van ids, fechas de nacimiento ni datos de otros juegos. Desactivar el enlace lo borra y el siguiente es distinto.

## Pestaña Admin

- **Resumen**: totales, últimos juegos de toda la liga (con quién los capturó) y pendientes (contraseñas temporales, equipos sin nadie asignado, equipos sin juegos).
- **Equipos**: tarjetas con el estilo de cada equipo. Cada equipo se identifica como **Nombre · Categoría**; no se permiten dos equipos con el mismo nombre y categoría. La ventana de equipo tiene pestañas Datos (incluye modalidad por defecto: Tradicional o Chupón), Identidad, Letras, Colores y Acceso.
- **Inicio de la plataforma**: `boxscoremx.vercel.app` sin equipo abre el inicio de **BoxScore MX** en azul marino, con el logo (home plate con las casillas BOX), los totales y una tarjeta por cada equipo del usuario. Al tocar una tarjeta se abre el equipo con sus colores; el botón **Equipos** del encabezado regresa al inicio. El inicio de sesión siempre usa la marca de la plataforma.
- **Dirección de cada equipo**: cada equipo se abre en `boxscoremx.vercel.app/<dirección>` (por ejemplo `/diablillos` o `/aguilas`). Se arma sola con el nombre (sin acentos; si el nombre se repite en otra categoría, `nombre-categoría`) y el administrador la puede cambiar en Datos. Renombrar el equipo no cambia su dirección, para que los enlaces guardados sigan sirviendo. Si alguien abre la dirección de un equipo al que no tiene acceso, se le avisa y se abre el suyo. La regla de rutas está en `vercel.json`.
- **Usuarios**: buscador y filtros, menú ⋯ (editar, restablecer contraseña, activar/desactivar, eliminar) y asistente de alta en 3 pasos que genera la contraseña temporal y un mensaje listo para WhatsApp.

## Tablas (las crea la API sola)

| Tabla | Contenido |
|---|---|
| `bs_teams` | equipos (nombre, categoría, dirección `slug`, logo) |
| `bs_users` | usuarios (correo, nombre, contraseña cifrada con scrypt, administrador, supervisor, activo) |
| `bs_members` | acceso de cada usuario a cada equipo (`editor` o `viewer`) |
| `bs_roster` | jugadores (`team_id`, `data` jsonb: incluye fecha de nacimiento y metas) |
| `bs_games` | juegos (`team_id`, `data` jsonb con el box score completo) |
| `bs_login_fail` | intentos fallidos de inicio de sesión por correo e IP |
| `bs_shares` | enlaces de solo lectura para papás (se pueden desactivar) |
| `bs_live` | enlace en vivo de cada equipo y el último resumen del juego que se transmite |

## Variables de entorno en Vercel

| Variable | Para qué |
|---|---|
| `DIABLILLOS_DB_URL` | Cadena de conexión de Neon (con pooling). Tiene prioridad sobre `DATABASE_URL`. |
| `EDIT_KEY` | Clave de instalación: solo se pide al crear el primer administrador. |
| `AUTH_SECRET` | **Recomendada**: secreto largo y aleatorio para firmar las sesiones. Si falta, se deriva de la cadena de conexión. |

## Pruebas

```
npm install
npm test
```

- `tests/calc.test.mjs` revisa los cálculos con 9 juegos reales sin nombres (`tests/fixture.json`): wOBA, récord esperado, primer turno de la entrada, MVP, reglas de lanzamientos, jugadas, tendencias, edades y en qué va el juego en vivo (entrada, outs, corredores y quién sigue).
- `tests/api.test.mjs` corre la API contra un Postgres real en memoria (PGlite): versiones y conflicto, sincronización por cambios, enlaces para papás, juego en vivo y límite de intentos.

## Primer uso

1. Abre el sitio: aparece **Configurar administrador**. Escribe tu nombre, correo, contraseña y la `EDIT_KEY`.
2. Los jugadores y juegos que ya existían quedan en un primer equipo.
3. En la pestaña **Admin** crea más equipos y usuarios.

Los archivos `*respaldo*.json` están en `.gitignore` y no se suben a GitHub.
