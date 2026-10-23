// Expira por no-show las reservas confirmadas cuyo vehículo nunca llegó
// dentro del plazo de gracia configurado. Reutiliza ReservationService.cancelReservation,
// que ya sabe liberar la plaza (si fue reclamada) o simplemente cambiar el
// estado (si todavía era una franja futura sin reclamar).
class ExpirationService {
    constructor({
        repository,
        reservationService,
        logger = console,
        pollIntervalMs = 60000,
        graceMinutes = 30,
        batchSize = 20
    }) {
        this.repository = repository;
        this.reservationService = reservationService;
        this.logger = logger;
        this.pollIntervalMs = pollIntervalMs;
        this.graceMinutes = graceMinutes;
        this.batchSize = batchSize;
        this.running = false;
        this.loopPromise = null;
        this.sleepTimer = null;
        this.wakeUp = null;
    }

    async runOnce() {
        const expired = await this.repository.findExpiredNoShowReservations({
            graceMinutes: this.graceMinutes,
            limit: this.batchSize
        });

        for (const reservation of expired) {
            try {
                await this.reservationService.cancelReservation(reservation.id, {
                    requestId: `expiration:${reservation.id}`
                });
                this.logger.log(`Reserva ${reservation.id} expiró por no-show y fue cancelada.`);
            } catch (error) {
                // Carrera benigna: pudo haberse cancelado, registrado una entrada,
                // o cambiado de estado entre el escaneo y este intento.
                this.logger.error(`No se pudo expirar la reserva ${reservation.id}: ${error.message}`);
            }
        }

        return expired.length > 0;
    }

    async start() {
        if (this.running) {
            return;
        }

        this.running = true;
        this.loopPromise = this._runLoop();
    }

    async stop() {
        this.running = false;
        this._wake();
        await this.loopPromise;
        this.loopPromise = null;
    }

    async _runLoop() {
        while (this.running) {
            try {
                const processed = await this.runOnce();
                if (!processed) {
                    await this._sleep(this.pollIntervalMs);
                }
            } catch (error) {
                this.logger.error(`Error inesperado en el worker de expiración de reservas: ${error.message}`);
                await this._sleep(this.pollIntervalMs);
            }
        }
    }

    _sleep(milliseconds) {
        return new Promise((resolve) => {
            this.wakeUp = resolve;
            this.sleepTimer = setTimeout(() => {
                this.sleepTimer = null;
                this.wakeUp = null;
                resolve();
            }, milliseconds);
        });
    }

    _wake() {
        if (this.sleepTimer) {
            clearTimeout(this.sleepTimer);
            this.sleepTimer = null;
        }
        if (this.wakeUp) {
            const resolve = this.wakeUp;
            this.wakeUp = null;
            resolve();
        }
    }
}

module.exports = { ExpirationService };
