# Cómo funciona Neón Arena por dentro

Este documento explica la parte técnica del juego para quien quiera entenderlo o modificarlo.

## 1. Una web sin servidor

Todo el juego son archivos estáticos (HTML, CSS, JavaScript y un modelo 3D). GitHub Pages los sirve tal cual,
sin ningún programa ejecutándose en un servidor. Por eso es gratis y no hay que mantener nada.

Las librerías (Three.js y PeerJS) están copiadas en la carpeta `vendor/`, así el juego no depende de que otra
web externa esté funcionando.

## 2. El anfitrión manda

En una partida online, el navegador de quien crea la sala (el **anfitrión**) es el único que decide lo que pasa:

1. Cada invitado envía sus controles al anfitrión unas 30 veces por segundo: hacia dónde se mueve, hacia dónde
   apunta, si dispara y si usa el impulso.
2. El anfitrión simula la partida 60 veces por segundo (`src/sim.js`): mueve a todos, calcula los choques con
   los obstáculos, mueve los proyectiles, aplica el daño, controla a los bots y gestiona los objetos.
3. 20 veces por segundo envía a cada invitado una **foto** del estado: posiciones, vida, puntos, proyectiles,
   objetos disponibles y lo que ha pasado (disparos, impactos, bajas).

Así nadie puede hacer trampas cambiando su propia copia del juego: el daño y las bajas siempre los calcula el anfitrión.

## 3. Que no se note el retraso

Los mensajes tardan un poco en viajar por internet. Para que el juego se sienta fluido:

- **Interpolación:** cada invitado dibuja a los demás jugadores con 100 ms de retraso, deslizándolos suavemente
  entre dos fotos recibidas. Así no se ven saltos aunque lleguen 20 fotos por segundo.
- **Predicción:** tu propio robot se mueve en tu pantalla al instante, sin esperar al anfitrión. Cuando llega
  la foto del anfitrión, se compara con lo que habías predicho y se corrige poco a poco cualquier diferencia.
- **Disparos locales:** tus proyectiles salen al instante en tu pantalla. El impacto real lo confirma el anfitrión.

## 4. La conexión entre jugadores

Los navegadores se conectan directamente entre sí con **WebRTC**, a través de la librería PeerJS:

1. El anfitrión se registra en el servidor gratuito de PeerJS con un nombre que incluye el código de sala.
2. El invitado pide a ese servidor que le ponga en contacto con ese código.
3. A partir de ahí los dos navegadores se hablan directamente. El servidor de PeerJS ya no participa.

Si la red de algún jugador bloquea las conexiones directas, PeerJS intenta pasar por un servidor de reenvío
público. En redes muy restrictivas puede no funcionar.

## 5. Los bots

Cada bot (`botThink` en `src/sim.js`) decide varias veces por segundo:

- **A quién atacar:** al enemigo visible más cercano o, si no ve a nadie, al más cercano en general.
  Si alguien le dispara, va a por él.
- **Cómo moverse:** mantiene unos 9 metros de distancia y se mueve de lado para ser difícil de acertar.
  Si tiene poca vida, va a por un objeto de vida.
- **Cómo apuntar:** calcula dónde estará su objetivo cuando llegue el disparo y añade un error según la dificultad.
- **Esquivar obstáculos:** prueba 16 direcciones y elige la que más le acerca a su meta sin chocar.
  Si se queda atascado, se mueve en una dirección al azar durante un momento.

La dificultad (`DIFFICULTY` en `src/config.js`) cambia la puntería, el tiempo de reacción, cuánto disparan
y cuánto usan el impulso.

## 6. Los gráficos

`src/render.js` usa **Three.js**:

- La arena es un suelo con una rejilla dibujada por código, muros y obstáculos con bordes de neón.
- Cada robot es una copia del mismo modelo 3D, pintado del color de su jugador, con sus animaciones
  (parado, correr, morir y bailar al ganar).
- El efecto de brillo se consigue con un filtro llamado *bloom*, que hace que las partes más luminosas resplandezcan.
- Las explosiones y chispas son miles de pequeños puntos que se mueven con gravedad y se apagan.
- La cámara sigue a tu robot y se adelanta un poco hacia donde apuntas.

## 7. Cambiar el juego

Casi todo lo que afecta a la jugabilidad está en `src/config.js`:

| Ajuste | Qué cambia |
|---|---|
| `SPEED` | Velocidad de los robots |
| `FIRE_CD` | Tiempo entre disparos |
| `BULLET_DMG` | Daño de cada disparo |
| `DASH_CD` | Tiempo de recarga del impulso |
| `RESPAWN_TIME` | Segundos hasta reaparecer |
| `BOXES` | Obstáculos del mapa (se colocan de forma simétrica) |
| `PICKUP_SPOTS` | Dónde aparecen los objetos |
| `CHARACTERS` | Modelos de personajes |
