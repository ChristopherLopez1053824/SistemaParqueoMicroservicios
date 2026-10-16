const express = require('express');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'parking-service',
        status: 'ok'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Parking Service ejecutándose en el puerto ${PORT}`);
});
