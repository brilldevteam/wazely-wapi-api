import 'dotenv/config';
// Must stay near the top: hides WhatsApp encryption keys that the QR library logs.
import './utils/redact-signal-logs.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import { connectDB } from './models/index.js';
import Setting from './models/setting.model.js';
import campaignScheduler from './utils/campaign-scheduler.js';
import automatedResponseWorker from './utils/automated-response-worker.js';
import { fixSettingsData } from './utils/fix-settings-data.js';
import { fixPlatformData } from './utils/fix-platform-data.js';
import { setContactImportSocketIo } from './queues/contact-import-queue.js';
import './utils/system-settings.js';
import { getSequenceQueue } from './queues/sequence-queue.js';
import statusCronService from './cronjob/status.cronService.js';
import trialPeriodCronService from './cronjob/trialPeriod.cronService.js';
import snoozeCronService from './cronjob/snooze.cronService.js';
// import twitterPollCronService from './cronjob/twitter-poll.cronService.js'; // DISABLED: Twitter not working
import scheduledPostsCronService from './cronjob/scheduled-posts.cronService.js';
import whatsappStatusSyncCronService from './cronjob/whatsapp-status-sync.cronService.js';
import currencyRatesCronService from './cronjob/currency-rates.cronService.js';
import assignmentQueueCronService from './cronjob/assignment-queue.cronService.js';
import { processAssignmentQueue } from './utils/agent-assignment.service.js';
import { AssignmentQueue } from './models/index.js';
import { startCampaignRecoveryCron } from './cronjob/campaign-recovery.cronService.js';
import EmailTemplateService from './services/email-template.service.js';
import { setupSocketSecurity, joinOwnRooms, canJoinRoom } from './utils/socket-security.js';
import { initAgentPresence, trackSocketConnect, trackSocketDisconnect, resetPresenceOnStartup, setOnUserCameOnline } from './utils/agent-presence.js';

async function loadStripeKeysFromSettings() {
  try {
    const setting = await Setting.findOne().select('stripe_secret_key stripe_publishable_key stripe_webhook_secret').lean();
    if (setting?.stripe_secret_key) {
      process.env.STRIPE_SECRET_KEY = setting.stripe_secret_key;
    }
    if (setting?.stripe_publishable_key) {
      process.env.STRIPE_PUBLISHABLE_KEY = setting.stripe_publishable_key;
    }
    if (setting?.stripe_webhook_secret) {
      process.env.STRIPE_WEBHOOK_SECRET = setting.stripe_webhook_secret;
    }
  } catch (err) {
    console.warn('Could not load Stripe keys from settings:', err.message);
  }
}

async function loadRazorpayKeysFromSettings() {
  try {
    const setting = await Setting.findOne().select('razorpay_key_id razorpay_key_secret razorpay_webhook_secret').lean();
    if (setting?.razorpay_key_id) {
      process.env.RAZORPAY_KEY_ID = setting.razorpay_key_id;
    }
    if (setting?.razorpay_key_secret) {
      process.env.RAZORPAY_KEY_SECRET = setting.razorpay_key_secret;
    }
    if (setting?.razorpay_webhook_secret) {
      process.env.RAZORPAY_WEBHOOK_SECRET = setting.razorpay_webhook_secret;
    }
  } catch (err) {
    console.warn('Could not load Razorpay keys from settings:', err.message);
  }
}

const PORT = process.env.PORT || 5000;
const httpServer = createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  path: '/socket.io',
});

// Must run before anything emits: login check + per-business delivery.
setupSocketSecurity(io);
// Who is online (used by auto-assignment and the Agents page).
initAgentPresence(io);
// Someone came online: give them chats that are waiting for an agent. Wait a few
// seconds so their screen has finished loading and shows the "New chat assigned" alert.
const HAND_OUT_AFTER_LOGIN_MS = 3000;
setOnUserCameOnline(({ ownerId }) => {
  setTimeout(() => {
    processAssignmentQueue({ ownerId }).catch((error) => console.error('[assignment-queue] Hand-out after login failed:', error.message));
  }, HAND_OUT_AFTER_LOGIN_MS);
});

app.set('io', io);
setContactImportSocketIo(io);

import('./services/whatsapp/unified-whatsapp.service.js').then(module => {
  module.default.setIO(io);
}).catch(err => console.error('Error setting IO in unifiedWhatsAppService:', err));

io.on('connection', (socket) => {
  console.log('WebSocket client connected:', socket.id);
  // Rooms come from the verified login only, never from an id the client sends.
  joinOwnRooms(socket);
  trackSocketConnect(socket);

  socket.on('join_room', (room) => {
    if (canJoinRoom(socket, room)) socket.join(String(room));
  });

  socket.on('join_user', (uId) => {
    if (canJoinRoom(socket, uId)) {
      socket.join(`user_${uId}`);
      socket.join(String(uId));
    }
  });

  socket.on('disconnect', () => {
    trackSocketDisconnect(socket);
  });
});

(async () => {
  try {
    await connectDB();
    try {
      await AssignmentQueue.collection.dropIndex('expires_at_1');
      console.log('[assignment-queue] Removed legacy expiry index; waiting chats are now persistent');
    } catch (error) {
      if (error?.codeName !== 'IndexNotFound' && error?.code !== 27) console.warn('[assignment-queue] Could not remove legacy expiry index:', error.message);
    }
    await AssignmentQueue.updateMany({ expires_at: { $exists: true } }, { $unset: { expires_at: '' } });
    // Nobody is connected before the server starts listening below.
    await resetPresenceOnStartup();
    await loadStripeKeysFromSettings();
    await loadRazorpayKeysFromSettings();
    await fixSettingsData();
    await fixPlatformData();
    await statusCronService();
    await trialPeriodCronService();
    await snoozeCronService(app);
    await scheduledPostsCronService();
    await whatsappStatusSyncCronService();
    await currencyRatesCronService();
    await assignmentQueueCronService();
    startCampaignRecoveryCron();
    // await twitterPollCronService(app); // DISABLED: Twitter not working
    await EmailTemplateService.init();


    import('./services/whatsapp/unified-whatsapp.service.js').then(module => {
      module.default.initializeAllConnections();
    }).catch(err => console.error('Error importing unifiedWhatsAppService for initialization:', err));

    httpServer.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log('WebSocket (Socket.IO) enabled at path /socket.io');

      campaignScheduler.start();
      console.log('Campaign scheduler started');

      automatedResponseWorker.start();
      console.log('Automated response worker started');

      setInterval(async () => {
        try {
          const { default: appointmentService } = await import('./services/appointment.service.js');
          await appointmentService.processPendingReminders();
        } catch (err) {
          console.error('[ReminderInterval] Error:', err.message);
        }
      }, 60 * 60 * 1000);
      console.log('Appointment reminder service started (1h interval)');

      getSequenceQueue().catch(err => console.error('Error starting sequence queue worker', err));
    });
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
})();
