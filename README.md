# Diablillos · Box Score

Plataforma para capturar box scores de béisbol y llevar las estadísticas de bateo, pitcheo y fildeo del equipo, con fichas de jugador y reportes en PDF.

Es un sitio estático: todo vive en `index.html`. No necesita instalar nada ni compilar.

## Dónde se guardan los datos

En esta versión, los datos se guardan en el navegador de cada persona (localStorage). Eso significa:

- Cada computadora o celular tiene sus propios datos.
- Si borras los datos del navegador, se pierden.

Por eso, en la pestaña **Roster** hay **Descargar respaldo** y **Cargar respaldo**. Descarga un respaldo después de cada juego.

## Publicar en Vercel

1. Sube esta carpeta a un repositorio de GitHub.
2. En vercel.com, entra con tu cuenta de GitHub y elige **Add New → Project**.
3. Importa el repositorio, deja **Framework Preset: Other** y presiona **Deploy**.

Cada vez que cambies `index.html` en GitHub, Vercel publica la nueva versión sola.
