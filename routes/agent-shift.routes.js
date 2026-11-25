import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { requireSubscription } from '../middlewares/plan-permission.js';
import controller from '../controllers/agent-shift.controller.js';

const router = express.Router();
router.use(authenticate);
router.use(requireSubscription);
router.use((req, res, next) => req.user?.role === 'agent' ? res.status(403).json({ success: false, message: 'Only the business owner can manage shifts' }) : next());
router.get('/', controller.listShifts);
router.post('/', controller.createShift);
router.get('/:id', controller.getShift);
router.put('/:id', controller.updateShift);
router.delete('/:id', controller.deleteShift);
export default router;
