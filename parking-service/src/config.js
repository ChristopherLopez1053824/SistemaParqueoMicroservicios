const path = require('path');
const dotenv = require('dotenv');

const rootEnvPath = path.join(__dirname, '../../.env');
const serviceEnvPath = path.join(__dirname, '../.env');

dotenv.config({ path: serviceEnvPath, quiet: true });
dotenv.config({ path: rootEnvPath, override: false, quiet: true });

module.exports = {};
