# Parking Service

Microservicio responsable de administrar las plazas de estacionamiento y su
estado. Node.js + Express sobre Supabase PostgreSQL, esquema `parking`.
Implementa el contrato de integración del documento *Distribución de tareas y
especificación de integración* (secciones 2.3, 3 y 3.7).

Este servicio **no** gestiona reservas, sesiones ni pagos. Reservation Service
coordina esos recursos y utiliza las operaciones de este servicio para mantener
coherente el estado de las plazas.

## Estándares aplicados

| Elemento | Estándar |
| --- | --- |
| JSON | camelCase |
| Tablas y columnas | snake_case |
| Identificadores | UUID v4 como string, validados antes de consultar la base |
| Fechas | ISO 8601 en UTC con sufijo `Z` |
| Respuestas exitosas | `{ data }` y colecciones `{ data, meta: { total } }` |
| Errores | `{ error: { code, message, details, requestId } }` |
| Moneda | GTQ (este servicio no calcula importes) |

## Estructura

```text
parking-service/
├── certs/supabase-ca.crt
├── src/
│   ├── config.js
│   ├── db.js
│   ├── server.js
│   ├── controllers/parking.controller.js
│   ├── lib/
│   │   ├── constants.js
│   │   ├── errors.js
│   │   ├── query.js
│   │   └── validate.js
│   ├── routes/parking.routes.js
│   ├── services/parking.service.js
│   └── test-db.js
└── test/parking.test.js
```

## Requisitos

- Node.js 18 o superior.
- Acceso a la base PostgreSQL de Supabase con el esquema `parking`.
- El certificado `certs/supabase-ca.crt` incluido en el repositorio.

## Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Cadena de conexión PostgreSQL de Supabase. Nunca se sube al repositorio. |
| `PORT` | No | Puerto HTTP del servicio. Valor por defecto: `3001`. |

El archivo canónico del proyecto es `.env` en la raíz del repositorio (ver
[`.env.example`](../.env.example)). Por compatibilidad para desarrollo local,
el servicio también carga `parking-service/.env` si existe, sin sobrescribir
las variables definidas en la raíz o en el entorno.

No se deben definir secretos reales en archivos versionados. `PORT` no debería
declararse en el `.env` raíz compartido por los tres microservicios; se puede
pasar por variable de entorno o en el `.env` local del servicio.

## Instalación y ejecución

```bash
# desde la raíz del repositorio, solo la primera vez
cp .env.example .env
# completar DATABASE_URL

cd parking-service
npm install
npm start        # o: npm run dev
```

Verificar el arranque:

```bash
curl -i http://localhost:3001/health
```

Comprobar la conexión a PostgreSQL (solo lectura):

```bash
node src/test-db.js
```

## Endpoints

Rutas internas del microservicio y su equivalente público a través del API
Gateway:

| Método | Ruta interna | Ruta pública (Gateway) | Función |
| --- | --- | --- | --- |
| GET | `/spaces` | `/api/parking/spaces` | Listar plazas |
| GET | `/spaces/:id` | `/api/parking/spaces/:id` | Consultar plaza por UUID |
| POST | `/spaces` | `/api/parking/spaces` | Registrar plaza |
| PATCH | `/spaces/:id/status` | `/api/parking/spaces/:id/status` | Actualizar estado |
| GET | `/health` | `/health` | Estado del servicio |

El Gateway elimina el prefijo `/api/parking` antes de reenviar la solicitud, de
modo que el servicio recibe la ruta interna (`/spaces`, `/spaces/:id`, etc.).

### Rutas internas de coordinación con Reservation Service

Estas rutas no forman parte de la API pública del frontend. El Gateway también
las enruta, pero requieren el token interno cuando `INTERNAL_API_TOKEN` está
configurado.

| Método | Ruta | Transición | `reservationId` |
| --- | --- | --- | --- |
| POST | `/spaces/:id/reserve` | `available → reserved` | Obligatorio (UUID v4) |
| POST | `/spaces/:id/occupy` | `reserved → occupied` | Obligatorio y dueño de la plaza |
| POST | `/spaces/:id/release` | `reserved → available` | Obligatorio y dueño de la plaza |
| POST | `/spaces/:id/checkout` | `occupied → available` | Obligatorio y dueño de la plaza |
| POST | `/spaces/:id/restore` | `occupied → reserved` | Obligatorio y dueño de la plaza |

Cuerpo:

```json
{
  "reservationId": "4f6f1f34-73f5-4ea8-8f10-56f4c24b2d17"
}
```

Las operaciones usan un `UPDATE` condicional por estado y dueño, por lo que son
atómicas. Repetir una operación ya aplicada para la misma reserva es
idempotente; intentar operar una plaza de otra reserva devuelve
`409 RESERVATION_CONFLICT`. `GET /spaces/:id` y estas rutas incluyen
`reservedByReservationId`.

### GET `/spaces`

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "code": "A-01",
      "level": "Nivel 1",
      "spaceType": "standard",
      "status": "available",
      "createdAt": "2026-10-19T18:30:00.000Z",
      "updatedAt": "2026-10-19T18:30:00.000Z"
    }
  ],
  "meta": {
    "total": 1
  }
}
```

### GET `/spaces/:id`

Devuelve `200 OK` con `{ "data": { ...plaza } }`.

- UUID inválido: `400` con código `INVALID_ID`, sin consultar la base.
- UUID válido inexistente: `404` con código `RESOURCE_NOT_FOUND`.

### POST `/spaces`

```http
POST /api/parking/spaces
Content-Type: application/json

{
  "code": "A-01",
  "level": "Nivel 1",
  "spaceType": "standard"
}
```

Respuesta `201 Created`:

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "code": "A-01",
    "level": "Nivel 1",
    "spaceType": "standard",
    "status": "available",
    "createdAt": "2026-10-19T18:30:00.000Z",
    "updatedAt": "2026-10-19T18:30:00.000Z"
  }
}
```

Validaciones:

- `code` y `level` son obligatorios y no pueden ser cadenas vacías.
- `spaceType` debe ser `standard`, `accessible` o `electric`; si se omite se
  usa `standard`.
- El `id` lo genera PostgreSQL y el estado inicial siempre es `available`.
  Los campos `id` o `status` enviados por el cliente se ignoran.
- Un código duplicado devuelve `409 Conflict` con código `VALIDATION_ERROR`.

### PATCH `/spaces/:id/status`

```http
PATCH /api/parking/spaces/550e8400-e29b-41d4-a716-446655440000/status
Content-Type: application/json

{
  "status": "maintenance"
}
```

Respuesta `200 OK` con la plaza actualizada. El campo `updatedAt` se actualiza
en la misma sentencia SQL.

Estados permitidos: `available`, `reserved`, `occupied`, `maintenance`.

Transiciones aceptadas:

| Estado actual | Estados destino permitidos |
| --- | --- |
| `available` | `reserved`, `occupied`, `maintenance` |
| `reserved` | `occupied`, `available` |
| `occupied` | `available` |
| `maintenance` | `available` |

No se aceptan estados desconocidos ni transiciones no listadas. La
actualización usa `UPDATE ... WHERE id = $1 AND status = ANY(...)`, por lo que
la comprobación y el cambio de estado son atómicos y dos reservas concurrentes
no pueden ganar sobre la misma plaza.

Reglas aplicadas:

- Una plaza en `maintenance` no puede pasar a `reserved` ni a `occupied`.
- Una plaza `occupied` no puede pasar a `reserved`.
- Una plaza `reserved` no puede reservarse de nuevo; una segunda reserva recibe
  conflicto.
- Al cancelar una reserva o cerrar una sesión, Reservation Service puede
  devolver la plaza a `available`.

## Formato de error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Los datos enviados no son válidos.",
    "details": [
      { "field": "spaceType", "message": "El tipo debe ser \"standard\", \"accessible\" o \"electric\"." }
    ],
    "requestId": "550e8400-e29b-41d4-a716-446655440004"
  }
}
```

Cada respuesta incluye la cabecera `x-request-id`; el mismo UUID aparece en
`error.requestId` y en los logs del servicio.

Códigos técnicos utilizados:

| Código | HTTP | Uso |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 / 409 / 422 | Cuerpo inválido, JSON mal formado o código duplicado |
| `INVALID_ID` | 400 | UUID inválido en el path |
| `RESOURCE_NOT_FOUND` | 404 | Plaza inexistente o ruta no encontrada |
| `SPACE_NOT_AVAILABLE` | 409 | La plaza no admite la operación solicitada |
| `INVALID_STATE_TRANSITION` | 409 | Transición de estado no permitida |
| `DATABASE_ERROR` | 500 | Error de PostgreSQL sin exponer detalles internos |
| `SERVICE_UNAVAILABLE` | 503 | Base de datos inaccesible temporalmente |
| `INTERNAL_ERROR` | 500 | Error inesperado |

Los mensajes de PostgreSQL, credenciales, cadenas de conexión y trazas internas
no se devuelven al cliente.

## Esquema de datos

La tabla existente se reutiliza sin cambios:

`parking.parking_spaces`

| Columna | Tipo | Restricciones |
| --- | --- | --- |
| `id` | UUID | PK, `DEFAULT gen_random_uuid()` |
| `code` | VARCHAR | `NOT NULL`, `UNIQUE` |
| `level` | VARCHAR | `NOT NULL` |
| `space_type` | VARCHAR | `NOT NULL`, CHECK en `standard`, `accessible`, `electric` |
| `status` | VARCHAR | `NOT NULL`, CHECK en `available`, `reserved`, `occupied`, `maintenance` |
| `reserved_by_reservation_id` | UUID | Reserva dueña del estado `reserved`/`occupied` |
| `created_at` | TIMESTAMPTZ | `NOT NULL`, `DEFAULT now()` |
| `updated_at` | TIMESTAMPTZ | `NOT NULL`, `DEFAULT now()` |

El mapeo a JSON es `space_type → spaceType`, `created_at → createdAt`,
`updated_at → updatedAt` y
`reserved_by_reservation_id → reservedByReservationId`. La columna nueva la
agrega de forma idempotente `migrations/001_reservation_coordination.sql`.

## Pruebas

```bash
cd parking-service
npm test
```

Las pruebas usan `node:test`, levantan la app en un puerto efímero y sustituyen
`pool.query` por mocks. No escriben ni borran datos en Supabase. Cubren:

1. Listado con `data` y `meta.total`.
2. Consulta por UUID válido.
3. Rechazo de UUID inválido.
4. `404` para plaza inexistente.
5. Registro correcto de plaza.
6. Campos obligatorios ausentes.
7. `spaceType` inválido.
8. Código duplicado.
9. Actualización válida de estado.
10. Estados desconocidos.
11. Transiciones incompatibles.
12. Errores de base de datos sin filtrar información sensible.
13. Formato JSON y campos camelCase compatibles con el contrato.
14. JSON mal formado y errores de conexión (`503`).
15. Rutas de coordinación `reserve`, `occupy`, `release`, `checkout` y
    `restore`, incluida la idempotencia y el rechazo de plazas de otra reserva.

## Integración con Reservation Service

Reservation Service es el propietario del esquema `reservations`; Parking
Service no consulta ni modifica esas tablas. La coordinación se realiza por
HTTP usando las rutas internas `reserve`, `occupy`, `release`, `checkout` y
`restore`:

1. Reservation Service consulta la plaza con `GET /spaces/:id`.
2. Para reservar, enviar una entrada o liberar la plaza, llama a la ruta de
   transición correspondiente con `{ "reservationId": "..." }`.
3. Un `409 SPACE_NOT_AVAILABLE`, `409 RESERVATION_CONFLICT` o
   `409 INVALID_STATE_TRANSITION` indica que la plaza ya no admite la
   operación.
4. Si una reserva se cancela o una sesión termina, Reservation Service solicita
   la liberación de la plaza.

Los reintentos son seguros: las transiciones ya aplicadas para la misma
reserva devuelven la plaza actual sin repetir el cambio. Si una llamada HTTP
falla de forma incierta, Reservation Service vuelve a consultar el estado antes
de reintentar.

## Limitaciones conocidas

- El servicio no implementa reservas, sesiones ni pagos.
- La coherencia de una reserva frente a una sesión se coordina fuera de este
  servicio; Parking Service solo garantiza transiciones válidas y atómicas de
  la plaza.
- Los tres microservicios comparten la misma credencial PostgreSQL del
  prototipo; el aislamiento por esquema es lógico, no de permisos.
- El `Dockerfile` y la configuración de Podman Compose viven en esta carpeta y
  en la raíz del repositorio, respectivamente.
