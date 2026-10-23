const express = require('express');
const { randomUUID } = require('crypto');
const controller = require('../controllers/parking.controller');

const router = express.Router();

router.get('/spaces', controller.listSpaces);
router.get('/spaces/:id', controller.getSpace);
router.post('/spaces', controller.createSpace);
router.patch('/spaces/:id/status', controller.updateSpaceStatus);

router.post('/spaces/:id/reserve', controller.reserveSpace);
router.post('/spaces/:id/occupy', controller.occupySpace);
router.post('/spaces/:id/release', controller.releaseSpace);
router.post('/spaces/:id/checkout', controller.checkoutSpace);
router.post('/spaces/:id/restore', controller.restoreSpace);

module.exports = router;
