# Sistema Inteligente de Gestión de Parqueos

Prototipo académico desarrollado mediante una arquitectura de microservicios.

## Componentes

- frontend: interfaz web del sistema.
- api-gateway: punto de entrada para las solicitudes del frontend.
- parking-service: administración de espacios y disponibilidad.
- reservation-service: reservas y registro de entradas y salidas.
- payment-service: cálculo de tarifas y registro de pagos simulados.

## Tecnologías

- React
- Node.js
- Express
- PostgreSQL
- Podman
- Podman Compose
- Git y GitHub

## Estado del proyecto

Estructura inicial del repositorio. Los servicios todavía están pendientes de implementación.

## Frontend

Interfaz en React + Vite. Consume el backend únicamente a través del API Gateway.

### Ejecución

```bash
cd frontend
npm install
npm run dev
```

### Pantallas

| Ruta | Pantalla |
|---|---|
| `/` | Panel de plazas: totales por estado y cuadrícula por nivel |
| `/reservations` | Crear, listar y cancelar reservas |
| `/sessions` | Registrar entrada y salida; duración de la sesión |
| `/payments` | Calcular importe y registrar pago simulado |
| `/admin/spaces` | Registrar plazas y cambiar su estado |
