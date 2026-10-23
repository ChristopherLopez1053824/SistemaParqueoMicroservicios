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
- **Parking Service**: plazas, tipos, estados y transiciones atómicas. Expone
  una interfaz HTTP para que Reservation coordine la ocupación.
- **Reservation Service**: reservas, entradas, salidas, sesiones y
  reconciliación de operaciones con Parking.
- **Payment Service**: cotización por duración, tarifa y registro de pagos
  simulados. Consulta la sesión finalizada en Reservation.
- **Frontend**: pantallas de plazas, reservas, sesiones y pagos.

## Servicios y puertos

| Componente | Directorio | Puerto local | Red Compose |
| --- | --- | --- | --- |
| Frontend (Vite) | `frontend/` | `5173` | fuera de Compose |
| API Gateway | `api-gateway/` | `3000` | `api-gateway:3000` |
| Parking Service | `parking-service/` | `3001` | `parking-service:3001` |
| Reservation Service | `reservation-service/` | `3002` | `reservation-service:3002` |
| Payment Service | `payment-service/` | `3003` | `payment-service:3003` |
| Supabase PostgreSQL | externo | `5432` | externo |

En Compose solo el Gateway publica puerto al host; los microservicios quedan en
la red interna `parqueo-internal`.

## Rutas públicas del Gateway

| Método | Ruta pública | Servicio destino | Ruta interna recibida |
| --- | --- | --- | --- |
| GET | `/api/parking/spaces` | Parking | `/spaces` |
| GET | `/api/parking/spaces/:id` | Parking | `/spaces/:id` |
| POST | `/api/parking/spaces` | Parking | `/spaces` |
| PATCH | `/api/parking/spaces/:id/status` | Parking | `/spaces/:id/status` |
| POST | `/api/reservations` | Reservation | `/reservations` |
| GET | `/api/reservations` | Reservation | `/reservations` |
| GET | `/api/reservations/:id` | Reservation | `/reservations/:id` |
| PATCH | `/api/reservations/:id/cancel` | Reservation | `/reservations/:id/cancel` |
| POST | `/api/reservations/sessions/:reservationId/entry` | Reservation | `/sessions/:reservationId/entry` |
| POST | `/api/reservations/sessions/:sessionId/exit` | Reservation | `/sessions/:sessionId/exit` |
| GET | `/api/reservations/sessions/:sessionId` | Reservation | `/sessions/:sessionId` |
| POST | `/api/payments/quote` | Payment | `/quote` |
| POST | `/api/payments` | Payment | `/` |
| GET | `/api/payments/:id` | Payment | `/:id` |
| GET | `/api/payments/session/:sessionId` | Payment | `/session/:sessionId` |
| GET | `/health` | Gateway | liveness |
| GET | `/health/dependencies` | Gateway | disponibilidad de los tres servicios |

Rutas internas adicionales de Parking usadas por Reservation (no pensadas para
el frontend): `POST /spaces/:id/reserve`, `/occupy`, `/release`, `/checkout` y
`/restore`, con cuerpo `{ "reservationId": "UUID" }`.

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
moneda GTQ. Las respuestas incluyen `x-request-id`; el Gateway propaga el UUID
válido enviado por el cliente o genera uno nuevo y lo reenvía a los servicios.

Códigos usados:

| HTTP | Uso |
| --- | --- |
| `200` | Consulta o actualización exitosa |
| `201` | Recurso creado |
| `400` | Cuerpo, parámetros o UUID inválidos |
| `401` | Token interno ausente o incorrecto |
| `404` | Recurso o ruta inexistente |
| `409` | Conflicto de estado o reserva duplicada |
| `422` | Regla de negocio incumplida (por ejemplo, cotización expirada) |
| `500` | Error interno del servicio |
| `502` | Respuesta inválida o conexión cerrada por el microservicio |
| `503` | Microservicio o base de datos no disponible |
| `504` | Timeout del microservicio |

## Variables de entorno

Usar `.env.example` como plantilla. Nunca versionar `.env` ni credenciales.

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Cadena PostgreSQL de Supabase (externa a Compose) |
| `INTERNAL_API_TOKEN` | Sí en Compose | Token compartido Gateway ↔ microservicios |
| `API_GATEWAY_PORT` | No | Puerto público del Gateway (por defecto `3000`) |
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
| `RECONCILIATION_*` | No | Worker de reconciliación de Reservation |

Cada servicio carga primero su `.env` local (si existe) y luego el `.env` de la
raíz para completar variables; el `.env` del servicio tiene prioridad.

## Ejecución local

Requisitos: Node.js 18+ (recomendado 20+), acceso a Supabase y, para
contenedores, Podman + Podman Compose.

```bash
cp .env.example .env
# Editar DATABASE_URL e INTERNAL_API_TOKEN
```

Aplicar migraciones existentes (no las ejecuta ningún servicio automáticamente,
excepto `payment-service` que verifica su esquema al arrancar):

- `parking-service/migrations/001_reservation_coordination.sql`
- `reservation-service/migrations/001_init.sql` y `002_reconciliation_operations.sql`
- `payment-service/sql/01_payments_schema.sql` (o `npm run migrate`)

Cada servicio:

```bash
cd parking-service && npm install && npm start
cd reservation-service && npm install && npm start
cd payment-service && npm install && npm start
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
podman compose up --build
# alternativa: podman-compose up --build
```

Comandos útiles:

```bash
podman compose ps
podman compose logs -f api-gateway
curl http://localhost:3000/health
curl http://localhost:3000/health/dependencies
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

Crear una reserva (usar el `id` de una plaza `available`):

```bash
curl -i -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -d '{"spaceId":"<uuid-plaza>","vehiclePlate":"P123ABC"}'
```

Registrar entrada y salida:

```bash
curl -i -X POST http://localhost:3000/api/reservations/sessions/<reservationId>/entry
curl -i -X POST http://localhost:3000/api/reservations/sessions/<sessionId>/exit
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

El pago es simulado: `succeeded` no implica dinero real ni modifica la reserva.

## Pruebas

```bash
cd api-gateway && npm test
cd parking-service && npm test
cd reservation-service && npm test
cd payment-service && npm test
```

Las pruebas usan `node:test`. No requieren Supabase ni contenedores:

- Gateway: arranque, health, CORS, `requestId`, enrutamiento a los tres
  servicios, propagación de método/query/body/cabeceras, errores del upstream,
  `404`, `503`, timeout `504`, health de dependencias.
- Parking: contrato de plazas y rutas de coordinación, validaciones,
  idempotencia, conflictos y errores de BD simulados.
- Reservation: reservas, sesiones, compensaciones, reconciliación y cliente HTTP
  de Parking (46 pruebas).
- Payment: health, validaciones de cotización/pago/Idempotency-Key, errores
  uniformes y cálculo de horas facturables.

No se ejecutaron pruebas contra una instancia real de Supabase para no modificar
datos reales. La validación de Compose se hizo con `podman-compose config`; el
arranque completo requiere credenciales válidas.

## Problemas encontrados y decisiones de integración

- `parking-service/src/server.js` no arrancaba por imports faltantes. Se
  corrigió y se agregó propagación de `requestId`.
- Reservation ya consumía rutas de coordinación de Parking que no existían. Se
  implementaron con `UPDATE` condicional atómico, dueño de plaza e idempotencia.
- `GET /spaces` de Parking conserva el formato heredado; `GET /spaces/:id` y las
  transiciones incluyen `reservedByReservationId`, que Reservation necesita.
- Payment no enviaba `INTERNAL_API_TOKEN` ni `x-request-id` a Reservation. Se
  corrigió, junto con el mapeo de errores de conexión a `503`.
- El Gateway no propagaba `requestId`, no tenía CORS, no normalizaba timeouts y
  parseaba JSON antes del proxy. Se reemplazó por un proxy sin consumir el
  cuerpo, con errores `502/503/504` y health de dependencias.
- Compose no pasaba a Payment la URL ni el token de Reservation. Se corrigió y
  se mantienen los puertos internos existentes.
- El frontend no se containeriza en este repositorio; se ejecuta con Vite y
  apunta al Gateway. No hay autenticación de usuarios finales.

## Documentación por servicio

- `parking-service/README.md`
- `reservation-service/README.md`
- `payment-service/README.md`
