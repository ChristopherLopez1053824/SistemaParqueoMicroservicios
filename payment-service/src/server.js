require('./config');
const { createApp } = require('./app');
const { ensureSchema } = require('./schema');

const app = createApp();
const PORT = process.env.PORT || 3003;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Payment Service ejecutándose en el puerto ${PORT}`);

    ensureSchema()
        .then(() => console.log('Esquema payments verificado.'))
        .catch((error) => console.warn(`No se pudo verificar el esquema payments: ${error.message}`));
});
