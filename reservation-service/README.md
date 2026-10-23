# Reservation Service

Servicio de reservas y sesiones de estacionamiento del **Sistema Inteligente de Gestión de Parqueos**.

## Objetivo y responsabilidades

El Reservation Service administra:

- La creación, consulta, listado y cancelación de reservas.
- El registro de entradas y salidas de vehículos.
- Las sesiones de estacionamiento asociadas a una reserva.
- La coordinación HTTP con Parking Service para reservar, ocupar y liberar plazas.
- La reconciliación persistente de operaciones interrumpidas por fallos o reinicios.

El servicio es propietario del esquema `reservations` de Supabase PostgreSQL:

- `reservations.reservations`
- `reservations.parking_sessions`
- `reservations.reconciliation_operations`

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
│   ├── 001_init.sql
│   └── 002_reconciliation_operations.sql
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
│   │   ├── internal-auth.js
│   │   └── request-context.js
│   ├── repositories/
│   │   └── reservation-repository.js
│   ├── routes/
│   │   ├── reservations.routes.js
│   │   └── sessions.routes.js
│   └── services/
│       ├── reconciliation-service.js
│       └── reservation-service.js
└── test/
    ├── helpers/
    ├── auth.test.js
    ├── external-errors.test.js
    ├── parking-client.test.js
    ├── reconciliation.test.js
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
| `INTERNAL_API_TOKEN` | Compose: sí / local: opcional | — | Token compartido con Gateway y Parking Service. Si no se configura, la autenticación interna queda deshabilitada. |
| `RECONCILIATION_WORKER_ENABLED` | No | `true` | Inicia el worker periódico de reconciliación. |
| `RECONCILIATION_POLL_INTERVAL_MS` | No | `2000` | Intervalo de sondeo cuando no hay operaciones pendientes. |
| `RECONCILIATION_LEASE_SECONDS` | No | `60` | Tiempo tras el cual una operación `processing` se considera abandonada. |
| `RECONCILIATION_RETRY_BASE_MS` | No | `1000` | Base del backoff exponencial. |
| `RECONCILIATION_RETRY_MAX_MS` | No | `60000` | Límite máximo del backoff. |
| `RECONCILIATION_MAX_ATTEMPTS` | No | `10` | Intentos máximos por operación, incluido el intento síncrono. |

No agregues credenciales reales al repositorio. El archivo `.env` está ignorado por Git. En Compose, `INTERNAL_API_TOKEN` debe ser el mismo para Gateway, Parking Service y Reservation Service.

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
psql "$DATABASE_URL" -f reservation-service/migrations/002_reconciliation_operations.sql
```

En PowerShell:

```powershell
psql $env:DATABASE_URL -f parking-service/migrations/001_reservation_coordination.sql
psql $env:DATABASE_URL -f reservation-service/migrations/001_init.sql
psql $env:DATABASE_URL -f reservation-service/migrations/002_reconciliation_operations.sql
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

La migración `002_reconciliation_operations.sql` crea la bitácora persistente de reconciliación:

- Tabla `reservations.reconciliation_operations`.
- Estados `pending`, `processing`, `completed` y `failed`.
- Intentos, backoff, lease, bloqueo por worker y último error.
- Índice único parcial para impedir dos operaciones abiertas del mismo tipo sobre el mismo recurso.
- Índice de claim para seleccionar trabajo con `FOR UPDATE SKIP LOCKED`.

Las migraciones no se ejecutan automáticamente al iniciar el servicio. No las apliques sobre una base real sin autorización.

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
- Recuperación de reservas, entradas y salidas interrumpidas antes del commit local.
- Reintentos con backoff y descarte de operaciones no recuperables.
- Autenticación interna y exclusión del health check.
- Envío del token interno desde Reservation Service hacia Parking Service.

Resultado de la última ejecución local: **45 pruebas aprobadas, 0 fallidas**. Estas pruebas no sustituyen una prueba de integración contra Supabase y los servicios reales.

## Endpoints

Todas las rutas internas se exponen sin el prefijo `/v1`. `GET /health` es público; si `INTERNAL_API_TOKEN` está configurado, el resto de rutas exige `x-internal-token` y responde `401 UNAUTHORIZED` cuando falta o no coincide.

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

Si `INTERNAL_API_TOKEN` está configurado, Reservation Service envía `x-internal-token` en todas las llamadas. Parking Service valida el mismo token y deja público únicamente `/health`. El API Gateway elimina cualquier token enviado por el cliente y lo inyecta desde su propia configuración.

### Atomicidad en Parking Service

Las transiciones se ejecutan con `UPDATE ... WHERE` condicional, verificación de estado y propietario (`reserved_by_reservation_id`) y `RETURNING` en una sola sentencia. Esto hace que la coordinación de una plaza sea atómica dentro de PostgreSQL, incluso si dos reservas intentan tomarla al mismo tiempo.

La ruta de reserva solo acepta plazas en `available`. Si dos solicitudes compiten, una actualiza la fila y la otra recibe `409`. El Reservation Service no realiza un `SELECT` seguido de un `INSERT` para decidir la plaza; Parking Service es la autoridad de esa transición.

## Concurrencia, fallos parciales y recuperación

### Bitácora persistente

Antes de cada llamada externa se registra una fila en `reservations.reconciliation_operations` con estado `processing`, un lease y un propietario. La operación se completa dentro de la misma transacción local que confirma el cambio de reserva o sesión. Si el proceso falla antes del commit, la operación queda abierta y el worker la retoma cuando vence el lease.

Tipos de operación:

- `reserve_space`: reserva externa y creación local de la reserva.
- `cancel_reservation`: liberación externa y cambio local a `cancelled`.
- `occupy_space`: ocupación externa y creación local de la sesión.
- `checkout_space`: liberación externa y cierre local de sesión y reserva.
- `release_space`: compensación de una reserva creada localmente que falló.
- `restore_space`: compensación de una entrada que falló después de ocupar la plaza.

Cada operación guarda `payload`, `attempts`, `max_attempts`, `next_attempt_at`, `locked_by`, `locked_at`, `last_error` y `result`. Un índice único parcial impide dos operaciones abiertas del mismo tipo sobre el mismo recurso.

### Worker de reconciliación

El worker se inicia con el servicio salvo que `RECONCILIATION_WORKER_ENABLED=false`. Su ciclo es:

1. Reclama una operación con `FOR UPDATE SKIP LOCKED`.
2. La marca como `processing` con un lease.
3. Consulta el estado real local y externo antes de actuar.
4. Completa la operación o aplica la transición pendiente.
5. Si el error es transitorio, reprograma con backoff exponencial.
6. Si el error es de negocio o se agotan los intentos, la marca como `failed`.

Las operaciones `processing` con lease vencido se consideran abandonadas por un proceso caído y pueden ser reclamadas por otro worker. Los workers no comparten memoria; la coordinación se realiza en PostgreSQL.

### Creación de reserva

1. Se consulta la plaza en Parking Service.
2. Se registra `reserve_space`.
3. Se reserva la plaza de forma atómica con el UUID de la reserva.
4. Se inserta la reserva local y se completa la operación en la misma transacción.
5. Si la inserción local falla, se registra `release_space` y se libera la plaza.

Si el proceso cae después de reservar la plaza pero antes del commit local, el worker ve la plaza reservada por el mismo `reservationId` y crea la reserva local con el `payload`. Si falla la creación local de forma definitiva, la compensación libera la plaza. El índice único parcial `reservations_one_confirmed_per_space_idx` refuerza la regla de una reserva confirmada por plaza.

### Cancelación

1. Se bloquea la reserva local con `SELECT ... FOR UPDATE`.
2. Se verifica que no exista una sesión activa.
3. Se registra `cancel_reservation`.
4. Se libera la plaza en Parking Service.
5. Se actualiza la reserva a `cancelled` y se completa la operación en la misma transacción.

Si el proceso cae después de liberar la plaza, el worker vuelve a verificar el estado, libera de forma idempotente si hace falta y confirma la cancelación local.

### Entrada

1. Se bloquea la reserva local y se verifica que no exista una sesión activa.
2. Se registra `occupy_space` con el `sessionId` y `entryAt`.
3. Se pasa la plaza a `occupied` en Parking Service.
4. Se inserta la sesión local y se completa la operación en la misma transacción.

Si la inserción o el commit local fallan después de ocupar la plaza, se registra `restore_space` y se devuelve la plaza a `reserved`. Si la restauración falla, el worker la reintenta. Si el proceso cae después de ocupar la plaza, el worker crea la sesión faltante con el `payload` y completa la operación. La restricción única parcial impide sesiones activas duplicadas.

### Salida

1. Se bloquean la reserva y la sesión en un orden de bloqueo consistente.
2. Se calcula `exitAt` y `durationSeconds`.
3. Se registra `checkout_space`.
4. Se libera la plaza en Parking Service.
5. Se completa la sesión y la reserva, y se cierra la operación en la misma transacción.

Si el proceso cae después de liberar la plaza, el worker completa localmente la sesión y la reserva usando `exitAt` y `durationSeconds` del `payload`. No se devuelve un cierre exitoso si Parking Service no pudo liberar la plaza.

### Respuestas inciertas y reintentos

Si una operación de Parking Service falla por timeout, error de red o respuesta inválida, el servicio consulta el estado real de la plaza antes de reintentar. Si no puede confirmar el resultado, deja la operación para el worker y responde `503` o `504`. El worker vuelve a consultar el estado antes de repetir una transición.

Los errores de negocio (`404`, `409`) y los estados locales incompatibles no se reintentan indefinidamente: se marcan como `failed` con `last_error`. Los errores transitorios usan backoff exponencial hasta `RECONCILIATION_MAX_ATTEMPTS`.

Si el worker completa una operación antes de que el cliente reintente, la API puede responder `409` por estado ya avanzado; el estado local y externo permanece consistente.

### Límite de consistencia distribuida

No existe una transacción distribuida entre Reservation Service y Parking Service. Una transacción local de PostgreSQL no hace atómica una llamada HTTP. El sistema usa:

- Transiciones atómicas en Parking Service.
- Restricciones únicas locales.
- Bloqueos de fila.
- Bitácora persistente de operaciones.
- Leases, claims con `SKIP LOCKED` y recuperación tras reinicios.
- Compensaciones explícitas.
- Reintentos idempotentes con verificación de estado.

Puede existir una ventana breve en la que Reservation Service responda error y el worker complete la operación después. La reconciliación garantiza convergencia eventual, no atomicidad distribuida.

## Integración con el API Gateway

El Gateway enruta `/api/reservations` hacia Reservation Service. Se verificó localmente la traducción de rutas:

| Ruta pública | Ruta recibida por Reservation Service |
|---|---|
| `/api/reservations` | `/reservations` |
| `/api/reservations/:id` | `/reservations/:id` |
| `/api/reservations/:id/cancel` | `/reservations/:id/cancel` |
| `/api/reservations/sessions/:reservationId/entry` | `/sessions/:reservationId/entry` |
| `/api/reservations/sessions/:sessionId/exit` | `/sessions/:sessionId/exit` |
| `/api/reservations/sessions/:sessionId` | `/sessions/:sessionId` |

Las rutas públicas de reservas se reescriben al prefijo interno `/reservations`.
Las rutas públicas de sesiones incluyen el segmento `sessions`, y las rutas
internas comienzan por `/sessions`, por lo que la traducción es directa.

Para llamadas internas entre servicios, el Gateway inyecta `x-internal-token` desde `INTERNAL_API_TOKEN` y elimina cualquier token recibido del cliente. Reservation Service envía el mismo token a Parking Service.

## Podman Compose

Se agregó un `docker-compose.yml` funcional en la raíz con:

- `api-gateway` expuesto al host (`${API_GATEWAY_PORT:-3000}`).
- `parking-service`, `reservation-service` y `payment-service` solo en la red interna `parqueo-internal`.
- Healthchecks por servicio y `depends_on` con condición `service_healthy`.
- Build con los Dockerfiles creados por servicio.
- Variables sensibles pasadas desde el entorno (`DATABASE_URL`, `INTERNAL_API_TOKEN`).

Requisitos:

- Podman o Docker con Compose.
- `INTERNAL_API_TOKEN` definido (mismo valor en todos los servicios).
- `DATABASE_URL` válido para Supabase.
- Ejecutar las migraciones antes del primer arranque o desde el cliente SQL.

Ejemplo:

```bash
cp .env.example .env
# Editar .env con credenciales reales
podman compose up --build
```

Reservation Service necesita, entre otras variables, `PARKING_SERVICE_URL` apuntando al nombre del servicio (`http://parking-service:3001`), `INTERNAL_API_TOKEN`, `DATABASE_URL` y las variables de reconciliación. El worker de reconciliación se inicia automáticamente salvo que se deshabilite.

## Seguridad y calidad

- Validación de UUID antes de consultar PostgreSQL.
- Validación de cuerpo JSON, campos obligatorios y matrícula no vacía.
- Consultas parametrizadas con `pg`.
- Manejo centralizado de errores.
- Respuestas sin trazas, SQL, credenciales ni cadenas de conexión.
- `requestId` UUID por solicitud, devuelto en encabezado y cuerpo de error.
- Límite de tamaño del cuerpo JSON.
- Cierre ordenado del servidor ante `SIGINT` y `SIGTERM` (incluye detención del worker de reconciliación).
- Restricciones de base de datos para estados, duración y duplicados.
- Autenticación interna entre servicios con `x-internal-token` (el Gateway inyecta el token y rechaza tokens provenientes del cliente).
- Secretos únicamente mediante variables de entorno.

## Limitaciones conocidas

- No hay transacción distribuida entre microservicios; la reconciliación provee convergencia eventual.
- Las migraciones deben ejecutarse manualmente. No las apliques sobre una base real sin autorización explícita.
- La autenticación interna protege rutas de servicio; la autenticación de usuarios finales no está implementada en este entregable.
- Si no se configura `INTERNAL_API_TOKEN`, la autenticación interna queda deshabilitada (útil solo para pruebas locales).
- No se implementó endpoint para cancelar una sesión `active`; el estado `cancelled` está previsto en el modelo.
- `GET /spaces` de Parking Service conserva el formato heredado; las rutas nuevas usan el contrato uniforme.
- Las pruebas automatizadas usan dobles de prueba y no validan contra una instancia real de Supabase.
- No se implementó lógica de pagos ni cálculo de tarifas.
- No hay `psql`, `docker` ni `podman` garantizados en todos los entornos; la validación con contenedores o migraciones reales queda pendiente si no están instalados.
