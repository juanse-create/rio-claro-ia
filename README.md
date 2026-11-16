# Distribuidora Río Claro IA

**Sistema web inteligente para la consulta de información empresarial y el análisis automatizado de facturas mediante Microsoft Azure.**

Proyecto académico desarrollado a partir de una plantilla de Node.js y Microsoft Foundry, adaptada para una empresa ficticia dedicada a la distribución de productos de limpieza e higiene.

## 1. Descripción del proyecto

Distribuidora Río Claro IA es una aplicación web que integra inteligencia artificial generativa y procesamiento inteligente de documentos para apoyar actividades administrativas de una empresa distribuidora.

El sistema permite consultar información sobre productos, precios, inventarios y pedidos mediante un asistente virtual. También permite cargar facturas PDF para extraer sus datos, detectar posibles duplicados e identificar inconsistencias en los importes.

Toda la información empresarial y las facturas utilizadas corresponden a datos ficticios creados con fines académicos.

## 2. Objetivo general

Desarrollar una aplicación web que integre servicios de inteligencia artificial de Microsoft Azure para facilitar consultas empresariales y automatizar la revisión preliminar de facturas.

### Objetivos específicos

- Implementar un chatbot conectado a Microsoft Foundry.
- Consultar información de productos, inventarios y pedidos.
- Extraer información de facturas PDF mediante Azure Document Intelligence.
- Detectar posibles facturas duplicadas.
- Identificar diferencias entre subtotales, impuestos y totales.
- Implementar autenticación básica para restringir el acceso.
- Aplicar principios de uso responsable de inteligencia artificial.
- Publicar la aplicación en un servicio de alojamiento web de Azure.

## 3. Tecnologías utilizadas

| Tecnología | Función |
|---|---|
| Node.js | Ejecución del servidor |
| Express.js | API y servidor web |
| JavaScript | Lógica del frontend y backend |
| HTML5 y CSS3 | Interfaz de usuario |
| Microsoft Foundry | Agente de inteligencia artificial |
| Azure AI Projects SDK | Comunicación con el agente |
| Azure Identity | Autenticación del servidor con Azure |
| Azure Document Intelligence | Extracción de información de facturas |
| Multer | Recepción de archivos PDF |
| Express Session | Administración de sesiones |
| Memorystore | Almacenamiento temporal de sesiones |
| Express Rate Limit | Limitación de solicitudes |
| Git y GitHub | Control de versiones |

## 4. Funcionalidades

### 4.1. Asistente virtual empresarial

El chatbot permite realizar consultas relacionadas con la información de Distribuidora Río Claro.

Ejemplos de preguntas:

- ¿Qué productos vende la empresa?
- ¿Cuánto cuesta el cloro de un litro?
- ¿Cuántas unidades de cloro hay en León?
- ¿Cuál es el estado del pedido PED001?
- ¿Qué políticas de facturación tiene la empresa?

El servidor proporciona al agente información empresarial ficticia para generar respuestas contextualizadas.

### 4.2. Análisis inteligente de facturas

El usuario puede cargar una factura PDF desde la interfaz web.

El servidor envía el documento a Azure Document Intelligence utilizando el modelo `prebuilt-invoice`.

El sistema obtiene, cuando están disponibles, los siguientes campos:

- Nombre del proveedor.
- Nombre del cliente.
- Folio de factura.
- Fecha de emisión.
- Subtotal.
- Impuestos.
- Total.

Posteriormente, el servidor realiza comprobaciones adicionales mediante JavaScript y compara la información extraída con los registros de demostración.

### 4.3. Detección de posibles duplicados

El sistema compara el proveedor y el folio de la factura con los registros existentes.

Cuando encuentra coincidencias, muestra una advertencia de posible duplicado para revisión administrativa.

### 4.4. Detección de inconsistencias

El sistema comprueba si los importes son coherentes y señala posibles diferencias.

Por ejemplo, una factura con subtotal de $1,500 MXN e IVA de $240 MXN debería tener un total de $1,740 MXN.

Si el registro contiene $1,900 MXN, existe una diferencia de $160 MXN que debe revisarse.

### 4.5. Control de acceso

La aplicación dispone de un formulario de inicio de sesión mediante una contraseña de demostración.

Incluye:

- Validación de acceso en el servidor.
- Sesiones mediante `express-session` y `memor