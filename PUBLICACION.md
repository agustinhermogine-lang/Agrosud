# AGROSUD público y A3

Versión pública de prueba: https://agrosud-terminal.agustinhermogine.chatgpt.site

El sitio funciona sin que la computadora local permanezca encendida. La adaptación para Cloudflare Workers y D1 se conserva en `hosting/`. La versión Node.js original continúa en la raíz del repositorio.

Los contratos de la versión pública se guardan en sesiones separadas por navegador. No se importan los contratos ni las claves del proyecto local. Borrar las cookies pierde el acceso a esa sesión. No se ofrece todavía inicio de sesión, recuperación ni trabajo compartido entre dispositivos.

A3 está disponible en una pestaña propia, con enlace al visor oficial y un conector de consulta REST. Para recibir cotizaciones dentro de AGROSUD se requiere acceso autorizado de A3/Primary mediante un agente o proveedor. Configurar A3_API_BASE_URL y A3_AUTH_TOKEN, o A3_USERNAME/A3_PASSWORD, únicamente en el servidor. A3_SYMBOLS permite seleccionar instrumentos exactos. El entorno reMarkets es de pruebas y no debe presentarse como mercado real. No se envían órdenes.

Las fuentes externas pueden fallar o limitar el acceso. Esta publicación no contiene las claves USDA ni CME DataMine del equipo local. La interfaz informa cuando usa archivos de referencia o no dispone de una fuente.

Correcciones: se eliminó la curva de cotizaciones generada a partir de un único precio Yahoo; esa fuente ahora muestra una referencia continua identificada. Se rechazan posiciones de otro producto, toneladas negativas y primas o precios inválidos. Se corrigió el cálculo de la posición siguiente al extender el calendario.

Validación: sintaxis del servidor y JavaScript del navegador, archivos y Excel FND; pruebas de contratos, fijaciones, tolerancias, cierre/reapertura, borrado, importación, aislamiento de sesiones, escrituras concurrentes y el adaptador A3 mediante respuestas de prueba. La API real de A3 no se verificó porque no hay credenciales.

Para construir el sitio: desde `hosting/`, instalar dependencias, ejecutar `npm run build` y `npm test`. Los cambios de esquema se generan con `npm run db:generate` y se conservan en `hosting/drizzle/`. La publicación en Sites usa `hosting/.openai/hosting.json` y el flujo de publicación del plugin.
