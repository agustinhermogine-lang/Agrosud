# AGROSUD Flat Price Terminal Pro v3.2 FINAL

Terminal local para seguimiento de futuros agrícolas, contratos físicos, fijaciones por contratos CBOT, spreads automáticos por FND y análisis USDA FAS PSD.

## 1. Qué incluye esta versión

### Mercado por posiciones
- Maíz (ZC), Poroto de soja (ZS), Trigo Chicago SRW (ZW), Harina de soja (ZM), Aceite de soja (ZL), Avena (ZO), más referencias manuales de Sorgo y Cebada.
- Mini-tablas por producto con Posición, Último, Variación diaria, Máximo, Mínimo, Settle y USD/MT.
- La terminal muestra todas las posiciones que devuelva la fuente CME web para cada Product ID configurado; ya no recorta la curva a 8 vencimientos.
- Actualización automática cada 30 segundos por defecto.
- CME web se usa como dato demorado/de referencia cuando el producto tiene Product ID configurado.
- Si CME deja de responder temporalmente, la terminal reutiliza el último dato CME guardado localmente.

### Contratos & Fijaciones
- Contrato físico cargado en MT.
- Fijaciones cargadas por cantidad de contratos CBOT, no por toneladas.
- MT equivalentes calculadas automáticamente según el producto.
- Producto = fuente de verdad: posición, factor, unidad y MT por contrato se sincronizan automáticamente.
- Validación también en backend para impedir mezclar una posición de otro commodity.
- Borrado de contrato desde la primera tabla de “Contratos cargados”. Al eliminarlo, se eliminan también todas sus fijaciones.
- En “Fijaciones guardadas”, cada contrato aparece como una mini-tabla independiente.
- Cada fijación puede borrarse individualmente sin eliminar el contrato ni las demás fijaciones.
- En “Nuevo contrato” muestra automáticamente los contratos equivalentes que representan las toneladas del contrato físico.
- Calcula un objetivo operativo de contratos enteros (redondeado al entero más cercano) y lo guarda con el contrato.
- A medida que se guardan fijaciones muestra contratos objetivo, fijados y pendientes.
- Los contratos objetivo son solo una referencia operativa; las fijaciones respetan los límites de tolerancia en MT.
- El contrato permanece abierto hasta que el usuario presiona `Finalizar fijaciones`.
- Los contratos finalizados aparecen en `Contratos fijados`, con sus fijaciones desplegables y el Flat final ponderado.

### Factores de conversión
- Maíz ZC: 0.393682
- Poroto de soja ZS: **0.367454**
- Trigo ZW: **0.367454**
- Harina de soja ZM: 1.10231
- Aceite de soja ZL: 22.0462
- Avena ZO: 0.688945

### FND y spreads automáticos
El Excel incluido se usa como calendario maestro:

`data/FND_CALENDARIO_ACTUAL.xlsx`

La versión incluida detecta 25 posiciones y 39 feriados CME.

Para un contrato `AT CONTRACT PREMIUM` que se fija en la posición siguiente:

1. Lee el FND de la posición contractual original.
2. Retrocede 2 días hábiles usando los feriados del Excel.
3. Detecta la posición siguiente, incluso al cambiar de año.
4. Obtiene el settlement histórico de ambas posiciones.
5. Calcula:

`Spread nativo = Settlement posición original - Settlement posición siguiente`

6. Suma el spread nativo a la prima nativa del producto.
7. Suma precio CBOT nativo + prima ajustada nativa para obtener el Flat nativo.
8. Convierte el Flat nativo a USD/MT con el factor del producto.

El backend vuelve a calcular todo al guardar la fijación. No confía solamente en lo que muestra el navegador.

#### Orden de fuentes para settlements
1. Publicación histórica web de CME.
2. CME DataMine, si hay credenciales y entitlement.
3. Fallback manual desde la propia pantalla de fijaciones.

### USDA / WASDE estructurado
La pestaña está separada en:
- Poroto de soja
- Harina de soja
- Aceite de soja
- Maíz
- Trigo

Top 5 exportadores y variables por producto. En cada país, las variables aparecen verticalmente (filas) y los últimos 3 informes guardados aparecen horizontalmente (columnas), para comparar su evolución. Los snapshots oficiales que va descargando se guardan en `data/db.json`.

Poroto: Producción, Exportaciones, Consumo interno, Crushing, Stocks finales.
Harina: Producción, Exportaciones, Consumo interno, Feed use, Stocks finales.
Aceite: Producción, Exportaciones, Consumo interno, Uso industrial/biodiésel, Stocks finales.
Maíz/Trigo: Producción, Exportaciones, Consumo interno, Stocks finales.

**Importante sobre los 3 informes:** la API oficial PSD documentada entrega el forecast vigente de un market year y no ofrece un parámetro de release histórico mensual. Por eso la terminal archiva automáticamente cada release nuevo que consulta. La tabla muestra hasta los últimos 3 snapshots reales que existan en `data/db.json`. En una instalación nueva habrá primero 1; luego se irán acumulando los siguientes releases.

---

# 2. Instalación en Windows

## Requisito
Instalar Node.js LTS 18 o superior.

Página oficial:
https://nodejs.org/

Durante la instalación, dejar activada la opción para agregar Node al PATH.

## Instalación automática
1. Descomprimir la carpeta de AGROSUD. Ejemplo:

`C:\AGROSUD\FlatPriceTerminal`

2. Hacer doble clic en:

`INSTALAR_WINDOWS.bat`

Este archivo ejecuta `npm install` y luego valida la estructura del programa.

3. Una vez finalizado, hacer doble clic en:

`INICIAR_WINDOWS.bat`

La terminal se abrirá en:

http://localhost:3000

A partir de la segunda ejecución, normalmente alcanza con ejecutar `INICIAR_WINDOWS.bat`.

---

# 3. Configurar USDA

USDA FAS Open Data requiere una API key gratuita de API.Data.Gov.

Abrir:
https://api.data.gov/signup/

Cuando llegue la clave, hacer doble clic en:

`ABRIR_CONFIGURACION.bat`

Y completar:

`USDA_API_KEY=TU_CLAVE`

Guardar el archivo y reiniciar la terminal.

El año de mercado inicial se configura con:

`USDA_MARKET_YEAR=2026`

## 3.1 Archivo mensual de informes WASDE publicados

La terminal consulta el archivo oficial USDA ESMIS y detecta automáticamente el último informe mensual publicado. Descarga y conserva en `data/usda/` el PDF oficial y su archivo de texto acompañante, y guarda hasta 24 releases en `data/db.json`. La comprobación se ejecuta al iniciar el servidor, al consultar WASDE y cada 6 horas mientras la aplicación permanece abierta; si aparece un nuevo informe mensual, se archiva sin borrar los anteriores.

La pestaña `WASDE + gráficos` muestra los tres enlaces directos a los PDFs oficiales archivados. Las tablas comparativas por país se alimentan de las tablas del texto acompañante de esos PDFs y muestran una columna `Variación mensual` calculada como último informe menos el anterior. Si el texto oficial no contiene una tabla compatible, se intenta USDA FAS PSD y, como último recurso, se mantiene el fallback local claramente identificado.

---

# 4. Configurar CME DataMine (opcional pero recomendado)

La terminal puede intentar settlements mediante la publicación web de CME sin DataMine. Para una fuente histórica contractual más estable, se recomienda CME DataMine.

Si AGROSUD cuenta con API ID, password y entitlement al dataset EOD correspondiente, completar en `.env`:

`CME_DATAMINE_API_ID=...`
`CME_DATAMINE_API_PASSWORD=...`

Luego reiniciar el programa.

---

# 5. Actualizar el Excel de FND

No es necesario tocar archivos manualmente. Desde “Contratos & Fijaciones” se puede seleccionar un nuevo Excel y presionar “Importar Excel FND”.

El archivo debe conservar las hojas:
- `FND Calendario Dinámico`
- `Feriados CME`

La importación reemplaza el calendario FND, pero NO borra contratos ni fijaciones existentes.

---

# 6. Datos guardados y backup

Los contratos, fijaciones, settlements manuales/cacheados, último mercado obtenido y snapshots USDA se guardan en:

`data/db.json`

Para hacer un backup de la terminal, copiar:
- `data/db.json`
- `data/FND_CALENDARIO_ACTUAL.xlsx`
- `data/fnd-calendar.json`

No borrar `data/db.json` si existen operaciones reales guardadas.

---

# 7. Fuentes y limitaciones importantes

- CME indica que las cotizaciones de su web son demoradas al menos 10 minutos y deben considerarse datos de referencia. Para tiempo real profesional se necesita un feed licenciado.
- El endpoint interno utilizado por la web de CME no es un contrato de API pública garantizado y CME puede cambiarlo. Por eso la terminal guarda el último dato exitoso y separa la arquitectura de fuentes.
- Para settlements históricos contractuales estables, CME DataMine es la opción recomendada.
- USDA FAS PSD requiere una API key gratuita de API.Data.Gov para la API oficial moderna.
- El análisis “WASDE” de la terminal utiliza datos estructurados USDA FAS PSD. No es una extracción textual del PDF WASDE.
- La base JSON es adecuada para uso local/single-user. Para varios usuarios simultáneos de AGROSUD conviene migrar la persistencia a PostgreSQL/SQL Server y agregar usuarios/permisos.

---

# 8. Solución rápida de problemas

### Se abre la ventana y dice que Node no existe
Instalar Node.js y volver a abrir `INICIAR_WINDOWS.bat`.

### `npm install` falla
Revisar conexión a Internet, proxy/firewall de la empresa y ejecutar en CMD dentro de la carpeta:

`npm install`

### USDA dice “sin key”
Completar `USDA_API_KEY` en `.env` y reiniciar.

### El spread rolado no puede obtener settlements
La terminal intentará CME web y luego DataMine. Si ambos fallan, abrir el fallback manual dentro de “Nueva fijación”, cargar ambos settlements para la fecha FND-2 y presionar “Guardar y recalcular”.

### Una posición no aparece
Las posiciones se filtran por producto. Si se necesita un FND automático que no existe en el Excel, importar un calendario actualizado que incluya esa posición.

---

AGROSUD Flat Price Terminal Pro v3.2 FINAL

## Cambios y fuentes verificables en v3.2

- El mercado intenta CME Group web como fuente demorada. La aplicación no la presenta como tiempo real.
- Si CME falla, intenta `MARKET_API_URL` si está configurada; después conserva el último dato real persistido y, como último recurso, una carga manual marcada como `MANUAL`.
- Cada producto informa fuente, estado (`DEMORADO`, `ULTIMO DATO`, `MANUAL` o `SIN FUENTE DISPONIBLE`), fecha/hora y error de conexión cuando corresponde.
- Sorgo (`SOR`) y cebada (`BAR`) no se reemplazan silenciosamente por otro commodity. Sin un Product ID CME o una API compatible muestran `SIN FUENTE DISPONIBLE`.
- `MARKET_REFRESH_MS` controla la actualización automática; `MARKET_CACHE_MS` evita consultas duplicadas. El botón `Actualizar ahora` fuerza una consulta respetando las mismas validaciones.
- `MARKET_API_URL` es opcional y debe apuntar a una API real autorizada. Puede usar `{symbol}` y recibe `MARKET_API_KEY` como `X-API-Key` y `apikey`. La respuesta debe contener contratos con `symbol` o `ticker`, `expirationMonth`, `last`, `change`, `high`, `low` y `settlement` o `priorSettle`.
- USDA FAS PSD solo archiva snapshots con release oficial informado por la API y conserva los últimos tres. Sin `USDA_API_KEY` muestra el instructivo de configuración y no muestra estimaciones inventadas.
- La conversión de mercado se mantiene en USD/MT con los factores del producto; los valores internos no se redondean.

### Fuentes por producto

`ZC`, `ZS`, `ZW` y `ZL` tienen Product ID CME predeterminado y usan CME web demorado cuando responde. `ZM` y `ZO` requieren completar `CME_PRODUCT_ZM` o `CME_PRODUCT_ZO`, o configurar la API externa. `SOR` y `BAR` requieren una fuente compatible configurada y no tienen reemplazo automático.

### Pruebas de instalación

Desde la carpeta raíz ejecutar `npm install`, `npm run verify` y `npm run check`. Luego iniciar con `INICIAR_WINDOWS.bat`, abrir `http://localhost:3000`, y comprobar `http://localhost:3000/api/health` y `http://localhost:3000/api/market`. Las respuestas de fuentes externas pueden fallar por red, permisos o cambios del proveedor; en esos casos la interfaz conserva el último dato real o informa que no hay fuente.
