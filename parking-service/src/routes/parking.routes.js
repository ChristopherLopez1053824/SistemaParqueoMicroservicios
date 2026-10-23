const express = require('express');
const controller = require('../controllers/parking.controller');

const router = express.Router();

router.get('/spaces', controller.listSpaces);
router.get('/spaces/:id', controller.getSpace);
router.post('/spaces', controller.createSpace);
router.patch('/spaces/:id/status', controller.updateSpaceStatus);

module.exports = router;
