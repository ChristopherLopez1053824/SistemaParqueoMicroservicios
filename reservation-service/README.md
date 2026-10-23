# Reservation Service

Servicio de reservas y sesiones de estacionamiento del **Sistema Inteligente de Gestión de Parqueos**.

## Objetivo y responsabilidades

El Reservation Service administra:

- La creación, consulta, listado y cancelación de reservas.
- El registro de entradas y salidas de vehículos.
- Las sesiones de estacionamiento asociadas a una reserva.
- La coordinación HTTP con Parking Service para reservar, ocupar y liberar plazas.

El servicio es propietario del esquema `reservations` de Supabase PostgreSQL:

- `reservations.reservations`
- `reservations.parking_sessions`

No modifica directamente las tablas de `parking` ni de `payments`. No calcula tarifas, no determina `amountMinor` y no registra pagos. Después de una salida, el frontend puede solicitar la cotización a Payment Service usando el `sessionId`.

## Arquitectura

```text
Frontend
   |
   v
API Gateway (Node.js + Express)
   |
   +--> Parking Service (HTTP/JSON)
   |
   +--> Reservation Service (HTTP/JSON) --HTTP--> Parking Service
   |
   +--> Payment Service (HTTP/JSON)
```

- Node.js + Express.
- PostgreSQL de Supabase con esquemas separados.
- `pg` para acceso a datos y transacciones locales.
- `fetch` nativo de Node.js para llamadas HTTP a Parking Service.
- Comunicación HTTP con JSON en `camelCase`.
- Fechas en ISO 8601 UTC con sufijo `Z`.
- Identificadores públicos UUID.

## Estructura del servicio

```text
reservation-service/
├── migrations/
│   └── 001_init.sql
├── src/
│   ├── app.js
│   ├── config.js
│   ├── db.js
│   ├── server.js
│   ├── http/
│   │   └── parking-client.js
│   ├── lib/
│   │   ├── errors.js
│   │   ├── serializers.js
│   │   ├── uuid.js
│   │   └── validation.js
│   ├── middleware/
│   │   ├── common.js
│   │   └── request-context.js
│   ├── repositories/
│   │   └── reservation-repository.js
│   ├── routes/
│   │   ├── reservations.routes.js
│   │   └── sessions.routes.js
│   └── services/
│       └── reservation-service.js
└── test/
    ├── helpers/
    ├── external-errors.test.js
    ├── parking-client.test.js
    ├── reservations.test.js
    └── sessions.test.js
```

## Requisitos

- Node.js 20 o superior.
- Acceso a una base PostgreSQL de Supabase.
- Parking Service disponible por HTTP.
- El certificado CA de Supabase en `reservation-service/certs/supabase-ca.crt` (ya incluido en el repositorio).

## Instalación

```bash
cd reservation-service
npm install
```

## Variables de entorno

Copia `reservation-service/.env.example` como `reservation-service/.env` y completa los valores. También existe un `.env.example` en la raíz del monorepo.

| Variable | Obligatoria | Valor por defecto | Descripción |
|---|---|---|---|
| `DATABASE_URL` | Sí | — | Cadena de conexión PostgreSQL de Supabase. |
| `PORT` | No | `3002` | Puerto HTTP del servicio. |
| `PARKING_SERVICE_URL` | No | `http://localhost:3001` | URL interna de Parking Service. |
| `PARKING_SERVICE_TIMEOUT_MS` | No | `3000` | Tiempo máximo de espera por llamada a Parking Service. |
| `BODY_LIMIT` | No | `100kb` | Límite del cuerpo JSON aceptado. |

No agregues credenciales reales al repositorio. El archivo `.env` está ignorado por Git.

## Configuración de Supabase

El servicio usa `DATABASE_URL` y SSL con el certificado incluido. Para Supabase, utiliza la cadena de conexión PostgreSQL del proyecto y el usuario con permisos sobre los esquemas `reservations` y, para las migraciones de coordinación, `parking`.

El proyecto utiliza un único proyecto Supabase con esquemas separados:

- `parking` es propiedad de Parking Service.
- `reservations` es propiedad de Reservation Service.
- `payments` es propiedad de Payment Service.

### Migraciones

Ejecuta las migraciones antes de iniciar los servicios. Puedes usar el editor SQL de Supabase o `psql`.

```bash
psql "$DATABASE_URL" -f parking-service/migrations/001_reservation_coordination.sql
psql "$DATABASE_URL" -f reservation-service/migrations/001_init.sql
```

En PowerShell:

```powershell
psql $env:DATABASE_URL -f parking-service/migrations/001_reservation_coordination.sql
psql $env:DATABASE_URL -f reservation-service/migrations/001_init.sql
```

La migración de Parking Service agrega de forma idempotente:

- `parking.parking_spaces.reserved_by_reservation_id`
- `parking.parking_spaces.updated_at`
- Índices de apoyo para estado y reserva.

La migración del Reservation Service crea:

- Esquema `reservations`.
- Tabla `reservations.reservations`.
- Tabla `reservations.parking_sessions`.
- Restricciones de estados y duración.
- Índice único parcial que impide más de una reserva `confirmed` por plaza.
- Índice único parcial que impide más de una sesión `active` por reserva.

Las migraciones no se ejecutan automáticamente al iniciar el servicio.

## Inicio del servicio

```bash
cd reservation-service
npm start
```

Modo desarrollo:

```bash
npm run dev
```

Verificación de salud:

```bash
curl http://localhost:3002/health
```

Respuesta:

```json
{
  "service": "reservation-service",
  "status": "ok"
}
```

## Pruebas

```bash
cd reservation-service
npm test
```

Las pruebas usan el runner nativo de Node.js y dobles de prueba para repositorio y Parking Service. No requieren una base de datos real ni servicios externos.

Cobertura funcional actual:

- Creación válida de reservas.
- Cuerpos incompletos, UUID inválidos y JSON mal formado.
- Plaza inexistente, ocupada, reservada o en mantenimiento.
- Listado y consulta de reservas.
- Cancelación válida y transiciones inválidas.
- Entradas válidas, duplicadas e incompatibles con el estado.
- Salidas válidas, cálculo de `durationSeconds` y cierre doble.
- Consulta de sesiones existentes e inexistentes.
- Errores, timeouts y respuestas inválidas de Parking Service.
- Estructura uniforme de errores y propagación de `requestId`.
- Reservas concurrentes sobre la misma plaza.
- Compensación ante fallos parciales locales y externos.

Resultado de la última ejecución local: **38 pruebas aprobadas, 0 fallidas**. Estas pruebas no sustituyen una prueba de integración contra Supabase y los servicios reales.

## Endpoints

Todas las rutas internas se exponen sin el prefijo `/v1`.

| Método | Ruta interna | Ruta pública mediante Gateway | Propósito | Éxitos | Errores habituales |
|---|---|---|---|---|---|
| `POST` | `/reservations` | `/api/reservations` | Crear reserva | `201` | `400`, `404`, `409`, `503`, `504` |
| `GET` | `/reservations` | `/api/reservations` | Listar reservas | `200` | `500` |
| `GET` | `/reservations/:id` | `/api/reservations/:id` | Consultar reserva | `200` | `400`, `404` |
| `PATCH` | `/reservations/:id/cancel` | `/api/reservations/:id/cancel` | Cancelar reserva | `200` | `400`, `404`, `409`, `503` |
| `POST` | `/sessions/:reservationId/entry` | `/api/reservations/sessions/:reservationId/entry` | Registrar entrada | `201` | `400`, `404`, `409`, `503` |
| `POST` | `/sessions/:sessionId/exit` | `/api/reservations/sessions/:sessionId/exit` | Registrar salida | `200` | `400`, `404`, `409`, `503`, `504` |
| `GET` | `/sessions/:sessionId` | `/api/reservations/sessions/:sessionId` | Consultar sesión | `200` | `400`, `404` |

### Formato de éxito con un recurso

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "confirmed"
  }
}
```

### Formato de éxito con una colección

```json
{
  "data": [],
  "meta": {
    "total": 0
  }
}
```

### Formato de error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Los datos enviados no son válidos.",
    "details": [
      {
        "field": "vehiclePlate",
        "message": "La matrícula es obligatoria."
      }
    ],
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

`details` puede ser `null`. Cada solicitud genera o propaga un `requestId` UUID. Se devuelve en el encabezado `x-request-id` y se propaga a Parking Service.

## Ejemplos

### Crear una reserva

```http
POST /reservations
Content-Type: application/json

{
  "spaceId": "550e8400-e29b-41d4-a716-446655440000",
  "vehiclePlate": "P123ABC"
}
```

```json
{
  "data": {
    "id": "4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17",
    "spaceId": "550e8400-e29b-41d4-a716-446655440000",
    "vehiclePlate": "P123ABC",
    "status": "confirmed",
    "createdAt": "2026-01-01T10:00:00.000Z",
    "updatedAt": "2026-01-01T10:00:00.000Z"
  }
}
```

### Listar reservas

```http
GET /reservations
```

```json
{
  "data": [],
  "meta": {
    "total": 0
  }
}
```

### Consultar una reserva

```http
GET /reservations/4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17
```

### Cancelar una reserva

```http
PATCH /reservations/4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17/cancel
```

```json
{
  "data": {
    "id": "4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17",
    "spaceId": "550e8400-e29b-41d4-a716-446655440000",
    "vehiclePlate": "P123ABC",
    "status": "cancelled",
    "createdAt": "2026-01-01T10:00:00.000Z",
    "updatedAt": "2026-01-01T10:05:00.000Z"
  }
}
```

### Registrar entrada

```http
POST /sessions/4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17/entry
```

```json
{
  "data": {
    "sessionId": "b45fcf1c-1f07-4b5f-b28a-1f93f9d8f5b2",
    "reservationId": "4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17",
    "spaceId": "550e8400-e29b-41d4-a716-446655440000",
    "vehiclePlate": "P123ABC",
    "status": "active",
    "entryAt": "2026-01-01T10:10:00.000Z",
    "exitAt": null,
    "durationSeconds": null
  }
}
```

### Registrar salida

```http
POST /sessions/b45fcf1c-1f07-4b5f-b28a-1f93f9d8f5b2/exit
```

```json
{
  "data": {
    "sessionId": "b45fcf1c-1f07-4b5f-b28a-1f93f9d8f5b2",
    "reservationId": "4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17",
    "spaceId": "550e8400-e29b-41d4-a716-446655440000",
    "vehiclePlate": "P123ABC",
    "status": "completed",
    "entryAt": "2026-01-01T10:10:00.000Z",
    "exitAt": "2026-01-01T10:12:30.000Z",
    "durationSeconds": 150
  }
}
```

### Consultar una sesión

```http
GET /sessions/b45fcf1c-1f07-4b5f-b28a-1f93f9d8f5b2
```

## Estados oficiales

### Plazas

- `available`
- `reserved`
- `occupied`
- `maintenance`

Flujo normal: `available → reserved → occupied → available`.

### Reservas

- `confirmed`
- `cancelled`
- `completed`

Una reserva se crea como `confirmed`. No existen estados `pending`, `active` u `occupied` para reservas.

### Sesiones

- `active`
- `completed`
- `cancelled`

Una sesión comienza como `active` con `entryAt` informado, `exitAt` en `null` y `durationSeconds` en `null`. Al finalizar pasa a `completed`, registra `exitAt` y calcula `durationSeconds` como entero no negativo.

### Transiciones implementadas

| Recurso | Desde | Hacia | Condición |
|---|---|---|---|
| Plaza | `available` | `reserved` | Creación de reserva. |
| Plaza | `reserved` | `occupied` | Entrada de la reserva propietaria. |
| Plaza | `reserved` | `available` | Cancelación o compensación. |
| Plaza | `occupied` | `available` | Salida completada. |
| Plaza | `occupied` | `reserved` | Compensación si falla la creación local de la sesión. |
| Reserva | `confirmed` | `cancelled` | Cancelación sin sesión activa. |
| Reserva | `confirmed` | `completed` | Salida de la sesión. |
| Sesión | `active` | `completed` | Salida válida. |
| Sesión | `active` | `cancelled` | Reservado para anulación previa a completarse; no hay endpoint público en esta entrega. |

No se permite reservar ni ocupar una plaza en `maintenance`. Una plaza `occupied` no puede reservarse. Una plaza `reserved` no puede asignarse a otra reserva activa. No se permite una segunda entrada para una reserva con sesión activa ni cerrar dos veces una sesión finalizada.

## Comunicación con Parking Service

Parking Service expone las rutas internas utilizadas por este servicio:

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/spaces/:id` | Consultar una plaza. |
| `POST` | `/spaces/:id/reserve` | Pasar de `available` a `reserved`. |
| `POST` | `/spaces/:id/occupy` | Pasar de `reserved` a `occupied`. |
| `POST` | `/spaces/:id/release` | Liberar una plaza reservada. |
| `POST` | `/spaces/:id/checkout` | Liberar una plaza ocupada al registrar salida. |
| `POST` | `/spaces/:id/restore` | Volver de `occupied` a `reserved` como compensación. |

Los cuerpos de las operaciones de transición son:

```json
{
  "reservationId": "4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17"
}
```

Parking Service devuelve `{ "data": { ... } }` con `id`, `code`, `level`, `spaceType`, `status` y `reservedByReservationId`. La ruta heredada `GET /spaces` se conserva con su formato anterior para no romper consumidores existentes.

### Atomicidad en Parking Service

Las transiciones se ejecutan con `UPDATE ... WHERE` condicional, verificación de estado y propietario (`reserved_by_reservation_id`) y `RETURNING` en una sola sentencia. Esto hace que la coordinación de una plaza sea atómica dentro de PostgreSQL, incluso si dos reservas intentan tomarla al mismo tiempo.

La ruta de reserva solo acepta plazas en `available`. Si dos solicitudes compiten, una actualiza la fila y la otra recibe `409`. El Reservation Service no realiza un `SELECT` seguido de un `INSERT` para decidir la plaza; Parking Service es la autoridad de esa transición.

## Concurrencia, fallos parciales y recuperación

### Creación de reserva

1. Se consulta la plaza en Parking Service.
2. Se reserva la plaza de forma atómica con el UUID de la reserva.
3. Se inserta la reserva local.
4. Si la inserción local falla, se intenta liberar la plaza con el mismo `reservationId`.

El índice único parcial `reservations_one_confirmed_per_space_idx` refuerza la regla de una reserva confirmada por plaza.

### Cancelación

1. Se bloquea la reserva local con `SELECT ... FOR UPDATE`.
2. Se verifica que no exista una sesión activa.
3. Se libera la plaza en Parking Service.
4. Se actualiza la reserva a `cancelled` y se confirma la transacción.

La liberación externa ocurre antes de confirmar la actualización local. Si la actualización local falla, la reserva permanece `confirmed` y la plaza queda disponible; reintentar la cancelación es seguro porque la liberación es idempotente.

### Entrada

1. Se bloquea la reserva local.
2. Se verifica que no exista una sesión activa.
3. Se pasa la plaza a `occupied` en Parking Service.
4. Se inserta la sesión local y se confirma.

Si la inserción o el commit local fallan después de ocupar la plaza, se intenta devolver la plaza a `reserved` mediante `/spaces/:id/restore`. La restricción única parcial impide sesiones activas duplicadas.

### Salida

1. Se bloquean la reserva y la sesión en un orden de bloqueo consistente.
2. Se libera la plaza en Parking Service.
3. Se completa la sesión y la reserva en la transacción local.

Si la actualización local falla después de liberar la plaza, la sesión permanece `active`, la plaza queda `available` y la reserva sigue `confirmed`. Reintentar la salida es seguro porque la liberación es idempotente. No se devuelve un cierre exitoso si Parking Service no pudo liberar la plaza.

### Respuestas inciertas

Si una operación de Parking Service falla por timeout, error de red o respuesta inválida, el servicio consulta el estado real de la plaza antes de reintentar. Solo repite operaciones que son idempotentes y cuando el estado observado lo justifica.

### Límite de consistencia distribuida

No existe una transacción distribuida entre Reservation Service y Parking Service. Una transacción local de PostgreSQL no hace atómica una llamada HTTP. El sistema usa:

- Transiciones atómicas en Parking Service.
- Restricciones únicas locales.
- Bloqueos de fila.
- Compensaciones explícitas.
- Reintentos idempotentes y verificación de estado.

Quedan ventanas residuales si un proceso se cae entre una llamada HTTP y el commit local. En esos casos el estado puede requerir reconciliación manual o un proceso de reconciliación periódico. Este proceso no está implementado en esta entrega.

## Integración con el API Gateway

El Gateway actual ya enruta `/api/reservations` hacia Reservation Service. Se verificó localmente la traducción de rutas:

| Ruta pública | Ruta recibida por Reservation Service |
|---|---|
| `/api/reservations` | `/` |
| `/api/reservations/:id` | `/:id` |
| `/api/reservations/:id/cancel` | `/:id/cancel` |
| `/api/reservations/sessions/:reservationId/entry` | `/sessions/:reservationId/entry` |
| `/api/reservations/sessions/:sessionId/exit` | `/sessions/:sessionId/exit` |
| `/api/reservations/sessions/:sessionId` | `/sessions/:sessionId` |

Por lo tanto, no fue necesario modificar el Gateway. Las rutas públicas de sesiones incluyen el segmento `sessions`, y las rutas internas comienzan por `/sessions`, por lo que la traducción es directa.

## Podman Compose

El archivo `docker-compose.yml` de la raíz está actualmente vacío y el repositorio no incluye Dockerfiles para los servicios. Por eso no hay una configuración funcional de Podman Compose que ejecutar todavía.

Mientras esa infraestructura no exista, ejecuta Parking Service y Reservation Service con Node.js:

```bash
cd parking-service
npm install
npm start
```

```bash
cd reservation-service
npm install
npm start
```

Si se agrega Podman Compose, Reservation Service necesita al menos:

- `DATABASE_URL`
- `PORT`
- `PARKING_SERVICE_URL` apuntando al nombre del servicio de Parking en la red de Compose
- `PARKING_SERVICE_TIMEOUT_MS`

## Seguridad y calidad

- Validación de UUID antes de consultar PostgreSQL.
- Validación de cuerpo JSON, campos obligatorios y matrícula no vacía.
- Consultas parametrizadas con `pg`.
- Manejo centralizado de errores.
- Respuestas sin trazas, SQL, credenciales ni cadenas de conexión.
- `requestId` UUID por solicitud, devuelto en encabezado y cuerpo de error.
- Límite de tamaño del cuerpo JSON.
- Cierre ordenado del servidor ante `SIGINT` y `SIGTERM`.
- Restricciones de base de datos para estados, duración y duplicados.
- Secretos únicamente mediante variables de entorno.

## Limitaciones conocidas

- No hay transacción distribuida entre microservicios.
- No existe un job automático de reconciliación para procesos que fallen entre una llamada HTTP y el commit local.
- Las migraciones deben ejecutarse manualmente.
- No se implementó autenticación ni autorización dentro del servicio; se asume que el API Gateway o una capa superior las gestiona.
- No se implementó endpoint para cancelar una sesión `active`; el estado `cancelled` está previsto en el modelo.
- `GET /spaces` de Parking Service conserva el formato heredado; las rutas nuevas usan el contrato uniforme.
- Las pruebas automatizadas usan dobles de prueba y no validan contra una instancia real de Supabase.
- No se implementó lógica de pagos ni cálculo de tarifas.
- No se agregó configuración funcional de Podman Compose porque el repositorio no contiene Dockerfiles ni un compose funcional.
