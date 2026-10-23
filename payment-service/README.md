# Payment Service

Microservicio encargado de calcular el importe del estacionamiento y registrar
pagos simulados. Node.js + Express, esquema de datos `payments` en Supabase
PostgreSQL. Implementa el contrato de integración del documento *Distribución de
tareas y especificación de integración* (secciones 2.5 y 3).

## Estándares aplicados (contrato sección 3)

| Elemento | Estándar |
| --- | --- |
| JSON | camelCase |
| Tablas y columnas | snake_case |
| Identificadores | UUID v4 como string, validados antes de usarlos |
| Fechas | ISO 8601 en UTC con sufijo `Z` |
| Moneda | GTQ |
| Importes | enteros en centavos (`amountMinor`: 1500 = Q15.00) |
| Respuestas | `{ data }`, colecciones `{ data, meta.total }`, errores `{ error: { code, message, details, requestId } }` |
| Códigos HTTP | 200, 201, 400, 404, 409, 422, 500, 503 |
| Estados de pago | `pending`, `succeeded`, `failed` |
| Método de pago | `simulated` (único permitido) |

## Endpoints

Rutas públicas (consumidas por el frontend a través del API Gateway) y sus
rutas internas en este servicio:

| Método | Ruta pública (Gateway) | Ruta interna | Función |
| --- | --- | --- | --- |
| POST | `/api/payments/quote` | `/payments/quote` o `/quote` | Calcular importe |
| POST | `/api/payments` | `/payments` o `/` | Registrar pago simulado (requiere `Idempotency-Key`) |
| GET | `/api/payments/:id` | `/payments/:id` o `/:id` | Consultar pago |
| GET | `/api/payments/session/:sessionId` | `/payments/session/:sessionId` o `/session/:sessionId` | Consultar pago de una sesión |
| GET | `/health` | `/health` | Estado del servicio |

El servicio monta sus rutas tanto bajo `/payments` (contrato sección 3.7) como
bajo `/` (compatibilidad con la reescritura `^/api/payments -> ''` del Gateway).

### 1. Cotización

```http
POST /api/payments/quote
Content-Type: application/json

{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

```json
{
  "data": {
    "quoteId": "550e8400-e29b-41d4-a716-446655440001",
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "durationSeconds": 3600,
    "billableHours": 1,
    "hourlyRateMinor": 1500,
    "amountMinor": 1500,
    "currency": "GTQ",
    "expiresAt": "2026-10-19T19:00:00.000Z"
  }
}
```

La sesión debe existir en el Reservation Service y estar en estado
`completed`. El servicio consulta `GET {RESERVATION_SERVICE_URL}/sessions/:sessionId`.

**Política de redondeo (única y documentada):** se cobra cada hora iniciada;
cualquier fracción positiva de hora se redondea hacia arriba, con un mínimo de
una hora para una sesión de duración positiva (`billableHours = max(1,
ceil(durationSeconds / 3600))`). Una sesión de duración 0 genera 0 horas
cobrables.

### 2. Pago simulado

```http
POST /api/payments
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440002
Content-Type: application/json

{
  "quoteId": "550e8400-e29b-41d4-a716-446655440001",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "simulated"
}
```

`201 Created` la primera vez:

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440003",
    "paymentId": "550e8400-e29b-41d4-a716-446655440003",
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "quoteId": "550e8400-e29b-41d4-a716-446655440001",
    "amountMinor": 1500,
    "currency": "GTQ",
    "method": "simulated",
    "status": "succeeded",
    "createdAt": "2026-10-19T18:35:00.000Z"
  }
}
```

- La cabecera `Idempotency-Key` es obligatoria y debe ser un UUID v4.
- Reenviar la misma operación con la misma `Idempotency-Key` devuelve `200 OK`
  con el mismo pago (no crea un segundo pago).
- Se valida que la cotización pertenezca a la sesión y que no esté vencida
  (`QUOTE_TTL_MINUTES`, por defecto 30 minutos).
- Restricciones únicas en base de datos contra duplicados: `idempotency_key`,
  `session_id` y `quote_id`. Una sesión solo puede pagarse una vez.

### 3. Consultas

```http
GET /api/payments/550e8400-e29b-41d4-a716-446655440003
GET /api/payments/session/550e8400-e29b-41d4-a716-446655440000
```

Respuesta `200 OK` con el mismo objeto de pago del punto 2. Si no existe,
`404` con el formato de error uniforme.

### Ejemplo de error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Los datos enviados no son válidos.",
    "details": [
      { "field": "sessionId", "message": "El campo sessionId es obligatorio." }
    ],
    "requestId": "550e8400-e29b-41d4-a716-446655440004"
  }
}
```

Cada respuesta lleva además la cabecera `x-request-id`.

## Códigos de error utilizados

| Código | HTTP | Uso |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 / 422 | Cuerpo o cabeceras inválidos; cotización no corresponde a la sesión o expirada |
| `INVALID_ID` | 400 | UUID inválido en el path |
| `RESOURCE_NOT_FOUND` | 404 | Pago, cotización o sesión inexistente |
| `INVALID_STATE_TRANSITION` | 409 | La sesión no está finalizada |
| `PAYMENT_ALREADY_PROCESSED` | 409 | Pago duplicado o Idempotency-Key reutilizada con otra operación |
| `DATABASE_ERROR` | 500 | Error de PostgreSQL (sin exponer detalles internos) |
| `INTERNAL_ERROR` | 500 | Error inesperado o tarifa no configurada |
| `SERVICE_UNAVAILABLE` | 503 | Reservation Service inaccesible o con respuesta inválida |

## Esquema de datos

Archivo: [`sql/01_payments_schema.sql`](sql/01_payments_schema.sql)

| Tabla | Contenido |
| --- | --- |
| `payments.tariffs` | Tarifas por hora en centavos (GTQ); la activa es la de mayor `effective_from` |
| `payments.payment_quotes` | Cotizaciones con `expires_at` |
| `payments.payments` | Pagos simulados con `method = 'simulated'` |

La primera ejecución inserta una tarifa inicial de 1500 centavos (Q15.00),
valor ilustrativo del documento. Para cambiarla:

```sql
UPDATE payments.tariffs SET is_active = FALSE WHERE is_active = TRUE;
INSERT INTO payments.tariffs (hourly_rate_minor, effective_from) VALUES (1800, now());
```

Cada microservicio modifica únicamente sus propias tablas; las referencias a
recursos de otros servicios (por ejemplo `sessionId`) se hacen mediante UUID e
interfaces HTTP.

## Variables de entorno

El servicio carga primero `payment-service/.env` (si existe) y luego el
**`.env` de la raíz** (ver [`.env.example`](../.env.example)) para completar
variables; el archivo del servicio tiene prioridad. La variable más importante
es `DATABASE_URL`
(credencial de Supabase, nunca se sube al repositorio). Variables de
integración:

| Variable | Uso |
| --- | --- |
| `RESERVATION_SERVICE_URL` | URL interna de Reservation (por defecto `http://localhost:3002`; en Compose `http://reservation-service:3002`) |
| `RESERVATION_SERVICE_TIMEOUT_MS` | Timeout de la consulta de sesión (por defecto `5000`) |
| `INTERNAL_API_TOKEN` | Token exigido en `x-internal-token` (si se configura) y enviado a Reservation |
| `QUOTE_TTL_MINUTES` | Vigencia de cotizaciones (por defecto `30`) |
| `BODY_LIMIT` | Límite del cuerpo JSON (por defecto `100kb`) |

## Ejecución

```bash
# desde la RAÍZ del repositorio
cp .env.example .env        # completar DATABASE_URL (solo la primera vez)

cd payment-service
npm install
npm run migrate             # crea el esquema payments y la tarifa inicial
npm run dev                 # o: npm start
```

Verificar:

```bash
curl http://localhost:3003/health
```

Prueba rápida de validación (no requiere base de datos):

```bash
curl -i -X POST http://localhost:3003/quote -H "Content-Type: application/json" -d "{}"
# 400 VALIDATION_ERROR con details apuntando a sessionId
```

Prueba del flujo completo (requiere Reservation Service y base de datos):

```bash
curl -i -X POST http://localhost:3003/quote \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<sessionId-completado>"}'

curl -i -X POST http://localhost:3003/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(node -e "console.log(crypto.randomUUID())")" \
  -d '{"quoteId":"<quoteId>","sessionId":"<sessionId>","method":"simulated"}'
```

Repetir el último comando con la misma `Idempotency-Key` debe devolver `200`
con el mismo `paymentId`.

## Pruebas

```bash
cd payment-service
npm test
```

Las pruebas usan `node:test`, no requieren Supabase y cubren health,
validaciones de cotización, pago e `Idempotency-Key`, formato uniforme de
errores y cálculo de horas facturables.

## Limitaciones del prototipo

- No se procesa dinero real; `succeeded` solo indica simulación confirmada.
- El aislamiento entre esquemas es lógico: todos los servicios comparten la
  misma credencial PostgreSQL (limitación documentada del prototipo).
