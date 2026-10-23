const path = require('path');
const dotenv = require('dotenv');

const rootEnvPath = path.join(__dirname, '../../.env');
const serviceEnvPath = path.join(__dirname, '../.env');

dotenv.config({ path: rootEnvPath, quiet: true });
dotenv.config({ path: serviceEnvPath, override: false, quiet: true });

module.exports = {};
