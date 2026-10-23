# Sistema Inteligente de Gestión de Parqueos

Prototipo académico con arquitectura de microservicios. El frontend habla
únicamente con el API Gateway; el Gateway enruta hacia Parking, Reservation y
Payment. Cada servicio es dueño de su lógica y de su esquema lógico en Supabase
PostgreSQL.

## Arquitectura

```text
React + Vite (5173)
        |
        v
API Gateway (3000)
   |        |        |
   v        v        v
Parking   Reservation   Payment
 (3001)     (3002)      (3003)
   |           |            |
   +-----------+------------+
               |
        Supabase PostgreSQL
        esquemas: parking, reservations, payments
```

Responsabilidades:

- **API Gateway**: punto de entrada único, CORS, `requestId`, proxy HTTP,
  timeouts y normalización de errores de transporte. No contiene lógica de
  negocio.
- **Parking Service**: plazas, tipos, estados y transiciones atómicas.
  `reserved`/`occupied` solo se alcanzan a través de los endpoints de reserva
  (dueño de reservación); el endpoint administrativo genérico de estado solo
  administra `available ↔ maintenance`.
- **Reservation Service**: reservas (inmediatas o programadas con franja
  horaria), entradas, salidas, sesiones de parqueo (con ticket legible
  `PAR-000123`), reconciliación de operaciones con Parking, y expiración
  automática de reservas por no-show.
- **Payment Service**: cotización por duración, tarifa congelada por
  cotización y registro de pagos simulados. Consulta la sesión finalizada en
  Reservation.
- **Frontend**: panel de plazas, reservas (inmediatas o programadas),
  entrada/salida (con búsqueda de sesión por placa o ticket), pagos y
  administración de plazas.

## Servicios y puertos

| Componente | Directorio | Puerto local | Red Compose |
| --- | --- | --- | --- |
| Frontend (Vite) | `frontend/` | `5173` | `frontend:5173` |
| API Gateway | `api-gateway/` | `3000` | `api-gateway:3000` |
| Parking Service | `parking-service/` | `3001` | `parking-service:3001` |
| Reservation Service | `reservation-service/` | `3002` | `reservation-service:3002` |
| Payment Service | `payment-service/` | `3003` | `payment-service:3003` |
| Supabase PostgreSQL | externo | `5432` | externo |

En Compose, el Gateway y el Frontend publican puerto al host; los
microservicios backend quedan solo en la red interna `parqueo-internal`.

## Rutas públicas del Gateway

| Método | Ruta pública | Servicio destino | Ruta interna recibida |
| --- | --- | --- | --- |
| GET | `/api/parking/spaces` | Parking | `/spaces` |
| GET | `/api/parking/spaces/:id` | Parking | `/spaces/:id` |
| POST | `/api/parking/spaces` | Parking | `/spaces` |
| PATCH | `/api/parking/spaces/:id/status` | Parking | `/spaces/:id/status` (solo `available`/`maintenance`) |
| POST | `/api/reservations` | Reservation | `/reservations` |
| GET | `/api/reservations` | Reservation | `/reservations` |
| GET | `/api/reservations/:id` | Reservation | `/reservations/:id` |
| PATCH | `/api/reservations/:id/cancel` | Reservation | `/reservations/:id/cancel` |
| GET | `/api/reservations/sessions` | Reservation | `/sessions` (lista/busca por `status`, `vehiclePlate`, `ticketNumber`) |
| POST | `/api/reservations/sessions/:reservationId/entry` | Reservation | `/sessions/:reservationId/entry` |
| POST | `/api/reservations/sessions/:sessionId/exit` | Reservation | `/sessions/:sessionId/exit` |
| GET | `/api/reservations/sessions/:sessionId` | Reservation | `/sessions/:sessionId` |
| POST | `/api/payments/quote` | Payment | `/quote` |
| POST | `/api/payments` | Payment | `/` |
| GET | `/api/payments/:id` | Payment | `/:id` |
| GET | `/api/payments/session/:sessionId` | Payment | `/session/:sessionId` |
| GET | `/health` | Gateway | liveness |
| GET | `/health/dependencies` | Gateway | disponibilidad de los tres servicios backend |

`POST /api/reservations` acepta `spaceId` y `vehiclePlate` siempre; `startsAt`
(ISO 8601) y `durationMinutes` son opcionales — si se omiten, la reserva es
inmediata (reclama la plaza al instante, como antes). Rutas internas
adicionales de Parking usadas por Reservation (no pensadas para el frontend):
`POST /spaces/:id/reserve`, `/occupy`, `/release`, `/checkout` y `/restore`,
con cuerpo `{ "reservationId": "UUID" }`.

## Contrato HTTP

Respuesta de colección:

```json
{
  "data": [],
  "meta": { "total": 0 }
}
```

Respuesta de recurso:

```json
{
  "data": { "id": "550e8400-e29b-41d4-a716-446655440000" }
}
```

Respuesta de error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Los datos enviados no son válidos.",
    "details": null,
    "requestId": "550e8400-e29b-41d4-a716-446655440001"
  }
}
```

Convenciones: JSON en `camelCase`, tablas/columnas en `snake_case`, UUID v4,
fechas ISO 8601 UTC con sufijo `Z`, importes enteros en centavos (`amountMinor`),
moneda GTQ. El número de ticket de una sesión se expone como `ticketNumber`
(`PAR-000123`) de solo presentación; el identificador real sigue siendo
`sessionId` (UUID). Las respuestas incluyen `x-request-id`; el Gateway propaga
el UUID válido enviado por el cliente o genera uno nuevo y lo reenvía a los
servicios.

Códigos usados:

| HTTP | Uso |
| --- | --- |
| `200` | Consulta o actualización exitosa |
| `201` | Recurso creado |
| `400` | Cuerpo, parámetros o UUID inválidos |
| `401` | Token interno ausente o incorrecto |
| `404` | Recurso o ruta inexistente |
| `409` | Conflicto de estado, reserva duplicada u horario superpuesto |
| `422` | Regla de negocio incumplida (por ejemplo, cotización expirada) |
| `500` | Error interno del servicio |
| `502` | Respuesta inválida o conexión cerrada por el microservicio |
| `503` | Microservicio o base de datos no disponible |
| `504` | Timeout del microservicio |

## Dependencias

Tiempo de ejecución: Node.js 18+ (recomendado 20+) en todos los servicios, y
PostgreSQL (Supabase) con la extensión `btree_gist` habilitada (la usa la
restricción de no-solapamiento de reservas). Para contenedores: Podman +
Podman Compose.

| Paquete | Usado en | Para qué |
| --- | --- | --- |
| `express` | los 4 servicios backend | servidor HTTP |
| `pg` | parking, reservation, payment | cliente PostgreSQL |
| `dotenv` | los 4 servicios backend | carga de `.env` |
| `http-proxy-middleware` | api-gateway | proxy hacia los microservicios |
| `react`, `react-dom` | frontend | interfaz |
| `react-router-dom` | frontend | enrutamiento de páginas |
| `vite`, `@vitejs/plugin-react` | frontend (dev) | servidor de desarrollo y build |
| `nodemon` | los 4 servicios backend (dev) | recarga en desarrollo |

Ninguna dependencia de prueba adicional: los 4 servicios backend usan
`node:test` (incluido en Node.js).

## Variables de entorno

Usar `.env.example` como plantilla. Nunca versionar `.env` ni credenciales.

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Cadena PostgreSQL de Supabase (externa a Compose) |
| `INTERNAL_API_TOKEN` | Sí en Compose | Token compartido Gateway ↔ microservicios |
| `API_GATEWAY_PORT` | No | Puerto público del Gateway (por defecto `3000`) |
| `FRONTEND_PORT` | No | Puerto público del Frontend (por defecto `5173`) |
| `PARKING_SERVICE_URL` | No | URL de Parking (`http://localhost:3001` local; `http://parking-service:3001` en Compose) |
| `RESERVATION_SERVICE_URL` | No | URL de Reservation (`http://localhost:3002` local; `http://reservation-service:3002` en Compose) |
| `PAYMENT_SERVICE_URL` | No | URL de Payment (`http://localhost:3003` local; `http://payment-service:3003` en Compose) |
| `PARKING_SERVICE_TIMEOUT_MS` | No | Timeout de Reservation hacia Parking (por defecto `3000`) |
| `RESERVATION_SERVICE_TIMEOUT_MS` | No | Timeout de Payment hacia Reservation (por defecto `5000`) |
| `PROXY_TIMEOUT_MS` | No | Timeout del Gateway hacia microservicios (por defecto `10000`) |
| `HEALTH_TIMEOUT_MS` | No | Timeout de `/health/dependencies` (por defecto `2000`) |
| `CORS_ORIGINS` | No | Orígenes permitidos separados por coma (por defecto `http://localhost:5173`) |
| `BODY_LIMIT` | No | Tamaño máximo de JSON (por defecto `100kb`) |
| `QUOTE_TTL_MINUTES` | No | Vigencia de cotizaciones de pago (por defecto `30`) |
| `RECONCILIATION_*` | No | Worker de reconciliación de Reservation (intervalo, lease, reintentos) |
| `RESERVATION_MAX_ADVANCE_MINUTES` | No | Anticipación máxima al programar una reserva (por defecto `120`) |
| `RESERVATION_DEFAULT_DURATION_MINUTES` | No | Duración estimada si no se indica (por defecto `240`) |
| `RESERVATION_MIN_DURATION_MINUTES` / `_MAX_DURATION_MINUTES` | No | Límites de `durationMinutes` (por defecto `15` / `480`) |
| `RESERVATION_EXPIRATION_ENABLED` | No | Activa el worker de expiración por no-show (por defecto `true`) |
| `RESERVATION_EXPIRATION_POLL_INTERVAL_MS` | No | Intervalo de sondeo del worker de expiración (por defecto `60000`) |
| `RESERVATION_NO_SHOW_GRACE_MINUTES` | No | Minutos de gracia tras `startsAt` antes de cancelar por no-show (por defecto `30`) |
| `RESERVATION_EXPIRATION_BATCH_SIZE` | No | Reservas procesadas por ciclo del worker de expiración (por defecto `20`) |

Las variables `RESERVATION_MAX_ADVANCE_MINUTES` y las demás de programación/
expiración usan sus valores por defecto en Compose (no están listadas en
`docker-compose.yml`); para cambiarlas en contenedores hay que agregarlas al
bloque `environment` de `reservation-service`. Fuera de Compose (`npm start`
directo), cada servicio carga primero su `.env` local (si existe) y luego el
`.env` de la raíz para completar variables; el `.env` del servicio tiene
prioridad.

## Ejecución local

```bash
cp .env.example .env
# Editar DATABASE_URL e INTERNAL_API_TOKEN
```

Aplicar migraciones existentes antes del primer arranque (cada servicio tiene
`npm run migrate`, que ejecuta sus archivos SQL de forma idempotente):

```bash
cd parking-service && npm install && npm run migrate       # 001_reservation_coordination.sql
cd reservation-service && npm install && npm run migrate   # 001_init.sql .. 004_scheduled_reservations.sql
cd payment-service && npm install && npm run migrate       # 01_payments_schema.sql, 02_payments_retry_after_failure.sql
```

Luego, cada servicio:

```bash
cd parking-service && npm start
cd reservation-service && npm start
cd payment-service && npm start
cd api-gateway && npm install && npm start
```

Frontend (Vite reenvía `/api` y `/health` al Gateway):

```bash
cd frontend
npm install
npm run dev
```

Si el navegador llama al Gateway desde otro origen, definir
`VITE_API_BASE_URL` en el frontend o ajustar `CORS_ORIGINS` en el Gateway.

## Podman Compose

```bash
cp .env.example .env
# Editar DATABASE_URL e INTERNAL_API_TOKEN
podman compose up --build -d
# alternativa: podman-compose up --build -d
```

Esto levanta los 5 servicios (frontend incluido) en un solo comando. Las
migraciones no se ejecutan automáticamente al iniciar los contenedores; antes
de usar el sistema por primera vez hay que aplicarlas una vez:

```bash
podman compose run --rm parking-service npm run migrate
podman compose run --rm reservation-service npm run migrate
podman compose run --rm payment-service npm run migrate
```

Comandos útiles:

```bash
podman compose ps
podman compose logs -f api-gateway
curl http://localhost:3000/health
curl http://localhost:3000/health/dependencies
curl http://localhost:5173/
```

`depends_on` con `service_healthy` ordena el arranque, pero no garantiza
disponibilidad permanente. El Gateway responde `502/503/504` si un servicio
falla después del arranque.

## Ejemplos de uso

Crear una plaza:

```bash
curl -i -X POST http://localhost:3000/api/parking/spaces \
  -H "Content-Type: application/json" \
  -d '{"code":"A-01","level":"Nivel 1","spaceType":"standard"}'
```

Listar plazas:

```bash
curl http://localhost:3000/api/parking/spaces
```

Crear una reserva inmediata (usar el `id` de una plaza `available`):

```bash
curl -i -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -d '{"spaceId":"<uuid-plaza>","vehiclePlate":"P123ABC"}'
```

Programar una reserva para dentro de una hora, sin reclamar la plaza todavía:

```bash
curl -i -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -d '{"spaceId":"<uuid-plaza>","vehiclePlate":"P123ABC","startsAt":"2026-01-01T15:00:00.000Z","durationMinutes":60}'
```

Registrar entrada y salida (la entrada reclama la plaza si la reserva era
programada y aún no se había reclamado):

```bash
curl -i -X POST http://localhost:3000/api/reservations/sessions/<reservationId>/entry
curl -i -X POST http://localhost:3000/api/reservations/sessions/<sessionId>/exit
```

Buscar una sesión por placa o ticket, sin conocer su UUID:

```bash
curl "http://localhost:3000/api/reservations/sessions?vehiclePlate=P123"
curl "http://localhost:3000/api/reservations/sessions?ticketNumber=PAR-000001"
```

Cotizar y pagar una sesión finalizada:

```bash
curl -i -X POST http://localhost:3000/api/payments/quote \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<sessionId-completed>"}'

curl -i -X POST http://localhost:3000/api/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <uuid-v4>" \
  -d '{"quoteId":"<quoteId>","sessionId":"<sessionId>","method":"simulated"}'
```

El pago es simulado: `succeeded` no implica dinero real ni modifica la reserva
ni la plaza (la plaza ya se liberó al registrar la salida).

## Pruebas

```bash
cd api-gateway && npm test           # 16 pruebas
cd parking-service && npm test       # 32 pruebas
cd reservation-service && npm test   # 60 pruebas
cd payment-service && npm test       # 20 pruebas
```

Todas usan `node:test` y corren contra una base de datos simulada en memoria
(no requieren Supabase ni contenedores):

- **Gateway**: arranque, health, CORS, `requestId`, enrutamiento a los tres
  servicios backend, propagación de método/query/body/cabeceras, errores del
  upstream, `404`, `503`, timeout `504`, health de dependencias.
- **Parking**: contrato de plazas, transiciones válidas/ inválidas del
  endpoint administrativo (`available ↔ maintenance` solamente), rutas de
  coordinación (`reserve`/`occupy`/`release`/`checkout`/`restore`),
  idempotencia, conflictos y errores de BD simulados.
- **Reservation**: reservas inmediatas y programadas (anticipación,
  solapamiento de horarios, reclamo de plaza en el check-in, expiración por
  no-show), sesiones, tickets, búsqueda de sesiones, compensaciones,
  reconciliación y cliente HTTP de Parking.
- **Payment**: health, validaciones de cotización/pago/Idempotency-Key,
  cálculo de horas facturables, prevención de doble pago, reintento tras un
  pago no exitoso, y errores uniformes.

Las migraciones y la integración end-to-end se validan manualmente contra la
instancia real de Supabase antes de desplegar, sin alterar datos existentes
del prototipo.

## Documentación por servicio

- `parking-service/README.md`
- `reservation-service/README.md`
- `payment-service/README.md`
