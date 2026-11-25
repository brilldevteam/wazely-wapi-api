import cron from 'node-cron';
import { processAssignmentQueue } from '../utils/agent-assignment.service.js';

// Safety sweep for chats waiting for an agent. Waiting chats are normally handed
// out the moment an agent comes online or becomes Available; this catches
// anything missed (for example right after a restart, once agents reconnect).
let running = false;

const sweep = async () => {
    if (running) return;
    running = true;
    try {
        await processAssignmentQueue();
    } catch (error) {
        console.error('[assignment-queue] Sweep failed:', error?.message || error);
    } finally {
        running = false;
    }
};

async function assignmentQueueCronService() {
    cron.schedule('* * * * *', sweep);
    console.log('Assignment queue sweep scheduled (every minute).');
}

export default assignmentQueueCronService;
