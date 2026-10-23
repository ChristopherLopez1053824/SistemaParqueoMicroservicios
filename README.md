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

Reservation Service implementado: reservas, entradas, salidas, sesiones y coordinación HTTP con Parking Service. Consulta `reservation-service/README.md` para la configuración, migraciones, endpoints y pruebas.

Los demás servicios continúan en desarrollo.
