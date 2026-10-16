const express = require('express');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'reservation-service',
        status: 'ok'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Reservation Service ejecutándose en el puerto ${PORT}`);
});
