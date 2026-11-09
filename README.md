# Motor web de Aura — Render

Este paquete contiene el servidor. No se sube a Netlify.

1. Crea una cuenta en Render y un repositorio en GitHub.
2. Sube EL CONTENIDO de esta carpeta al repositorio: Dockerfile, render.yaml, bridge.js, online-bridge.js, server-runtime.js y package.json deben estar en la raiz.
3. En Render, elige New > Web Service, conecta ese repositorio y selecciona Docker como runtime. Tambien puedes usar New > Blueprint con render.yaml.
4. En las variables de entorno, configura ALLOWED_ORIGINS con la direccion exacta de tu web de Netlify, por ejemplo https://mi-aura.netlify.app (sin rutas). Si usas varios dominios, separalos con comas. No uses el asterisco.
5. Para una prueba puedes elegir Free. Comprueba el precio y las condiciones actuales en el panel antes de contratar otro plan. No se ha contratado ni publicado ningun servicio desde este chat.
6. Publica el servicio. Render asignara una URL HTTPS, por ejemplo https://aura-motor-xxxx.onrender.com. Es solo un ejemplo: usa tu URL real.
7. Abre TU_URL/status: debe mostrar cloud:true, onlineAvailable:true, ytDlpAvailable:true y mp3Available:true. Render proporciona RENDER_EXTERNAL_URL automaticamente; para otro alojamiento configura PUBLIC_BASE_URL con la URL HTTPS real.
8. En Aura-Netlify/config.js, pon esa URL en apiBaseUrl. Sube Aura-Netlify a Netlify Drop para actualizar el sitio. Eso configura el motor para todos los visitantes.
9. El boton Servidor de Aura permite comprobar la conexion o elegir otra direccion en ese navegador; ese ajuste individual no reemplaza config.js para otros visitantes.

## Como funciona

El servidor ejecuta Node.js, yt-dlp para Linux y FFmpeg. Escucha el PORT de Render en 0.0.0.0. La busqueda y el audio online no se guardan como biblioteca del servidor. Los MP3 de importacion se convierten en /tmp, se entregan al navegador y se eliminan; la biblioteca permanece en IndexedDB de cada visitante.

La version de escritorio sigue usando el motor local de Windows. El flotante nativo esta desactivado en la web.

Hay un maximo de dos descargas y dos consultas/resoluciones simultaneas, un limite global de solicitudes y, en la nube, limite de 30 minutos y 100 MB por descarga. Las listas se importan de una en una por cancion; los videos que fallen se informan en Aura.

## Verificaciones y limites

Se comprobaron la sintaxis, la configuracion, los origenes permitidos y las URLs publicas mediante pruebas locales. No se pudo construir la imagen Docker en este equipo porque Docker no esta instalado. La reproduccion y las descargas desde la IP de Render requieren una prueba despues del despliegue.

YouTube puede rechazar conexiones desde centros de datos o pedir inicio de sesion. Por eso un motor que funciona en tu PC no garantiza acceso a todos los videos desde Render. No se incluye ninguna cuenta, cookie personal ni un servicio externo compartido en este paquete. No publiques contrasenas en config.js.

En el plan gratuito, Render puede apagar el servicio por inactividad y el primer arranque puede tardar alrededor de un minuto. La transmision y las descargas consumen ancho de banda sujeto a los limites y precios del proveedor.

Documentacion oficial: https://render.com/docs/web-services | https://render.com/docs/docker | https://render.com/docs/free
