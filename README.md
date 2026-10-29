# Neón Duelo 🏍️⚡

Juego multijugador para móvil de **motos de luz** (estilo Tron). Cada moto deja un muro de luz detrás:
si chocas contra un muro o contra el borde, quedas fuera. El último en pie gana la ronda y **el primero
en llegar a 5 puntos gana la partida**.

- 1 a 4 jugadores online, desde cualquier móvil o PC con navegador.
- Modo contra bots (1–3 bots).
- Controles: deslizar el dedo sobre el tablero, botones en pantalla o flechas/WASD en teclado.
- Si un jugador se desconecta a mitad de partida, un bot toma su lugar.
- Se puede “Añadir a pantalla de inicio” y se abre como una app.

## Cómo jugar online

1. Un jugador pulsa **Crear sala** → aparece un código de 5 letras.
2. Pulsa **Invitar amigos** para enviar el enlace (WhatsApp, etc.), o dicta el código.
3. Los demás abren el enlace (o escriben el código) y pulsan **Unirse**.
4. El anfitrión (👑) puede añadir bots y pulsa **¡Empezar!**

> El anfitrión mantiene la partida: debe tener la pantalla encendida y el juego abierto.

## Publicarlo con GitHub Pages

El juego es una página estática (`index.html`), así que GitHub Pages lo sirve gratis:

1. **Settings → Pages** del repositorio.
2. En *Build and deployment*: Source = **Deploy from a branch**, rama `main` (o esta rama), carpeta `/ (root)`.
3. En 1–2 minutos estará en `https://<usuario>.github.io/<repositorio>/`.

GitHub Pages gratuito requiere que el repositorio sea **público** (en repos privados necesita GitHub Pro).

## Cómo funciona el multijugador

GitHub Pages solo sirve archivos estáticos, así que la conexión entre jugadores se hace **de navegador a
navegador (WebRTC)** con la librería [PeerJS](https://peerjs.com/). Su servidor público gratuito solo se
usa para que los móviles se encuentren con el código de sala; después, los datos de la partida van
directamente entre jugadores. El navegador del anfitrión ejecuta la lógica del juego y envía el estado a
los demás.

## Archivos

- `index.html` — todo el juego (HTML, CSS y JavaScript).
- `manifest.json`, `icon.svg` — para instalarlo como app en el móvil.
