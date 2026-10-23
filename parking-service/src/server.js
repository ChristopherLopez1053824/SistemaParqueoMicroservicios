require('dotenv').config();

const express = require('express');
const { createInternalAuth } = require('./middleware/internal-auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'parking-service',
        status: 'ok'
    });
});

app.use(createInternalAuth(process.env.INTERNAL_API_TOKEN));

app.use('/', require('./routes/parking.routes'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Parking Service ejecutándose en el puerto ${PORT}`);
});
