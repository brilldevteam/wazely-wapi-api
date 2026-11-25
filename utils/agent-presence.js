import { User } from '../models/index.js';

/**
 * Who is online right now.
 *
 * A user is online while at least one of their browser tabs has a live,
 * logged-in socket connection (the identity comes from the verified login in
 * socket-security.js, never from anything the browser claims).
 *
 * When the last tab closes we wait OFFLINE_GRACE_MS before marking the user
 * offline, so a page refresh or a short network drop doesn't flip them.
 *
 * The live state is kept in memory (the API runs as one process) and copied to
 * User.is_online / User.last_seen so the rest of the app can read it.
 * If the API is ever run as several processes, this map must move to Redis.
 */

export const OFFLINE_GRACE_MS = 30 * 1000;
export const PRESENCE_EVENT = 'agent:presence';

const socketsByUser = new Map(); // userId -> Set<socketId>
const offlineTimers = new Map(); // userId -> Timeout
let ioRef = null;

export const initAgentPresence = (io) => {
  ioRef = io;
};

export const getIO = () => ioRef;

/** Online = has an open tab, or closed the last one less than OFFLINE_GRACE_MS ago. */
export const isUserOnline = (userId) => {
  const id = String(userId);
  return (socketsByUser.get(id)?.size || 0) > 0 || offlineTimers.has(id);
};

/** Sends the change to the business owner and their agents (socket-security routes by user_id). */
export const emitPresence = ({ userId, ownerId, isOnline, availabilityStatus, lastSeen }) => {
  if (!ioRef || !ownerId) return;
  ioRef.emit(PRESENCE_EVENT, {
    user_id: String(ownerId),
    agent_id: String(userId),
    is_online: isOnline,
    availability_status: availabilityStatus,
    last_seen: lastSeen || new Date()
  });
};

const saveAndBroadcast = async (auth, isOnline) => {
  const lastSeen = new Date();
  try {
    const user = await User.findByIdAndUpdate(
      auth.userId,
      { $set: { is_online: isOnline, last_seen: lastSeen } },
      { returnDocument: 'after', projection: { availability_status: 1 } }
    ).lean();
    emitPresence({
      userId: auth.userId,
      ownerId: auth.ownerId,
      isOnline,
      availabilityStatus: user?.availability_status || 'available',
      lastSeen
    });
  } catch (error) {
    console.error('[presence] Could not save online status:', error.message);
  }
};

export const trackSocketConnect = (socket) => {
  const auth = socket.data?.auth;
  if (!auth?.userId) return;

  const id = auth.userId;
  const sockets = socketsByUser.get(id) || new Set();
  sockets.add(socket.id);
  socketsByUser.set(id, sockets);

  // Came back within the grace period: still online, nothing to announce.
  if (offlineTimers.has(id)) {
    clearTimeout(offlineTimers.get(id));
    offlineTimers.delete(id);
    return;
  }

  if (sockets.size === 1) saveAndBroadcast(auth, true);
};

export const trackSocketDisconnect = (socket) => {
  const auth = socket.data?.auth;
  if (!auth?.userId) return;

  const id = auth.userId;
  const sockets = socketsByUser.get(id);
  if (!sockets) return;
  sockets.delete(socket.id);
  if (sockets.size > 0) return;

  socketsByUser.delete(id);
  if (offlineTimers.has(id)) clearTimeout(offlineTimers.get(id));
  offlineTimers.set(
    id,
    setTimeout(() => {
      offlineTimers.delete(id);
      if ((socketsByUser.get(id)?.size || 0) === 0) saveAndBroadcast(auth, false);
    }, OFFLINE_GRACE_MS)
  );
};

/**
 * On logout: closes the sockets opened with that login token and, if the user
 * has no other open tab, marks them offline at once (no grace period).
 */
export const disconnectSocketsForToken = (userId, token) => {
  if (!ioRef || !token) return;
  const id = String(userId);
  const ids = socketsByUser.get(id);
  if (!ids) return;

  let auth = null;
  for (const socketId of [...ids]) {
    const socket = ioRef.sockets.sockets.get(socketId);
    if (!socket) {
      ids.delete(socketId);
      continue;
    }
    if (socket.handshake?.auth?.token === token) {
      auth = auth || socket.data?.auth;
      ids.delete(socketId);
      socket.disconnect(true);
    }
  }

  if (ids.size === 0 && auth) {
    socketsByUser.delete(id);
    if (offlineTimers.has(id)) {
      clearTimeout(offlineTimers.get(id));
      offlineTimers.delete(id);
    }
    saveAndBroadcast(auth, false);
  }
};

/** After an API restart nobody is connected yet; clients reconnect within seconds. */
export const resetPresenceOnStartup = async () => {
  try {
    const result = await User.updateMany({ is_online: true }, { $set: { is_online: false } });
    if (result.modifiedCount) console.log(`[presence] Reset ${result.modifiedCount} users to offline after restart`);
  } catch (error) {
    console.error('[presence] Could not reset online status:', error.message);
  }
};
