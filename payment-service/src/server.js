const express = require('express');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'payment-service',
        status: 'ok'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Payment Service ejecutándose en el puerto ${PORT}`);
});
