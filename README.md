# Neón Arena ⚡🤖

Shooter de arena en 3D para ordenador. Robots armados con cañones de energía se enfrentan en una arena de neón.
Gana quien llegue antes al número de bajas elegido (10, 15 o 25), o quien tenga más bajas cuando acaben los 5 minutos.

- **Online de 2 a 8 jugadores**: uno crea una sala y los demás se unen con un código de 5 letras.
- **Bots con IA** en tres dificultades: apuntan, esquivan, buscan cobertura y recogen objetos.
- **Objetos**: vida, disparo triple, velocidad y escudo.
- Gráficos 3D con Three.js: modelos animados, sombras, efecto de brillo (bloom) y partículas.
- Música y efectos de sonido sintetizados en el navegador.

## Controles

| Tecla | Acción |
|---|---|
| W A S D / flechas | Moverse |
| Ratón | Apuntar |
| Clic izquierdo | Disparar (mantén pulsado) |
| Espacio / Shift | Impulso (esquiva rápida) |
| Tab | Clasificación |
| Esc | Pausa y opciones |

## Jugar online

1. Pulsa **Crear sala online**. Aparece un código como `K7MXQ`.
2. Pulsa **Copiar invitación** y mándala a tus amigos (WhatsApp, Discord…).
3. Ellos abren el enlace (o escriben el código) y pulsan **Unirse**.
4. Si quieres, añade bots y pulsa **Empezar partida**. También se puede entrar con la partida empezada.

El anfitrión ejecuta la partida en su navegador. Debe mantener la pestaña del juego abierta y en primer plano.

## Publicarlo con GitHub Pages

1. El repositorio tiene que ser **público** (GitHub Pages gratis no funciona con repos privados).
2. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, elige la rama y la carpeta `/ (root)`.
3. En 1–2 minutos estará en `https://<usuario>.github.io/<repositorio>/`.

Para probarlo en tu PC sin publicarlo: `python -m http.server` en la carpeta del proyecto y abre `http://localhost:8000`.
(Abrir `index.html` con doble clic no funciona, porque el navegador bloquea la carga de modelos desde archivos locales.)

## Cómo funciona el multijugador

GitHub Pages solo sirve archivos, así que los navegadores se conectan **directamente entre sí** (WebRTC) con
[PeerJS](https://peerjs.com/). El servidor gratuito de PeerJS solo sirve para que se encuentren usando el código de sala.
El anfitrión simula la partida a 60 Hz y manda el estado a los demás 20 veces por segundo. Cada invitado predice su
propio movimiento para que los controles respondan al instante.

## Añadir personajes (modelos 3D)

Los personajes son archivos **.glb** (glTF) con animaciones. Para añadir uno:

1. Copia el archivo en `assets/models/`.
2. Añade una entrada en `CHARACTERS` dentro de `src/config.js`:
   ```js
   {
     id: 'soldado', name: 'Soldado', url: 'assets/models/soldado.glb',
     height: 1.9,            // altura en el juego (se escala solo)
     tint: 'NombreMaterial', // material que se pinta con el color del jugador
     anims: { idle: 'Idle', run: 'Run', death: 'Death', victory: 'Dance', hit: 'Hit' },
   }
   ```
   Los nombres de `anims` deben coincidir con los de las animaciones del archivo. Puedes verlos arrastrando el
   .glb a https://gltf-viewer.donmccurdy.com/

Dónde conseguir modelos animados gratis y con licencia libre (CC0):
- **Quaternius** (https://quaternius.com): packs de personajes animados de estilo low-poly (el robot actual es suyo).
- **Kenney** (https://kenney.nl/assets): personajes y objetos.
- **Mixamo** (https://www.mixamo.com): anima cualquier personaje humanoide de forma automática.
- Generadores de 3D por IA, como **Meshy** o **Tripo**: crean el modelo a partir de un texto o una imagen
  (por ejemplo, un dibujo hecho con ChatGPT). Después se anima en Mixamo.

## Estructura

- `index.html`: interfaz (menús, sala, HUD).
- `src/config.js`: ajustes del juego, mapa, personajes.
- `src/sim.js`: reglas y simulación (movimiento, disparos, IA de los bots).
- `src/render.js`: gráficos 3D.
- `src/main.js`: menús, red, controles y bucle principal.
- `src/audio.js`: sonido y música.
- `vendor/`: Three.js y PeerJS (incluidos para no depender de CDNs).
- `assets/`: modelos e icono.

## Créditos

- Modelo *RobotExpressive*: Tomás Laulhé (Quaternius), CC0 1.0. Modificaciones de Don McCurdy.
- [Three.js](https://threejs.org) (MIT) y [PeerJS](https://peerjs.com) (MIT).
