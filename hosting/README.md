# AGROSUD público

Adaptación de AGROSUD a Cloudflare Workers con persistencia D1. Conserva los flujos de contratos, fijaciones, tolerancias, calendarios FND, mercado y WASDE. La interfaz incorpora A3 / Primary REST y un enlace al visor oficial.

Cada navegador recibe una cookie segura y una sesión independiente en D1. Los datos del proyecto local no se copian al sitio. No existe recuperación de sesión ni acceso desde otros dispositivos: borrar las cookies pierde el acceso. Esta es una versión pública de prueba, no un sistema compartido de producción.

No se incluyen claves de proveedores. A3 requiere acceso autorizado: configurar A3_API_BASE_URL y A3_AUTH_TOKEN o A3_USERNAME/A3_PASSWORD en el servidor. reMarkets es un entorno de simulación, no el mercado real. USDA_API_KEY y las credenciales opcionales CME DataMine también se configuran como secretos del servidor.

El mercado consulta Yahoo Finance por contrato individual (por ejemplo ZCZ26.CBT), explora meses contractuales hasta cinco años y muestra únicamente posiciones con respuesta válida. Se usa el precio y la hora más recientes disponibles del instrumento. Los contratos inexistentes se redescubren cada seis horas. Una caché D1 compartida por producto y una exclusión de actualizaciones duplicadas evitan repetir las consultas para cada visitante. La página consulta cada 15 segundos mientras está visible; un límite HTTP 429 aplica una pausa de 60 segundos y conserva cotizaciones anteriores. Yahoo ofrece datos demorados: la frecuencia de consulta no elimina la demora del proveedor. La columna de antigüedad distingue contratos poco operados de problemas de conexión. El cierre anterior de Yahoo no se presenta como settlement oficial.

Comandos: `npm install`, `npm run db:generate`, `npm run build`, `npm test`. Las migraciones D1 están en drizzle/. La adaptación usa un contexto de archivos por solicitud y guarda sus cambios con control de revisión para impedir sobrescrituras entre pestañas. Los PDF descargados son temporales; textos WASDE y calendarios modificados se conservan con la sesión.

Edit `worker/index.js`, then publish through the Sites hosting workflow with this starter's build and validation in `commands`.

The build copies only `worker/index.js` and `.openai/hosting.json`. Do not add standalone asset files. Embed any essential raster bytes in `worker/index.js` and serve or reference them as a data URL.

Pass these argument arrays as `commands`:

```json
[
  ["bash", "scripts/build.sh"],
  ["node", "scripts/validate-artifact.mjs"]
]
```

The deterministic build produces:

```text
dist/
├── .openai/
│   └── hosting.json
└── server/
    └── index.js
```

`dist/server/index.js` is an ES module with a default export containing `fetch(request, env, ctx)`. Edit `worker/index.js`, not the generated file under `dist/`.
