import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User, Session } from '../models/index.js';

/**
 * Socket.IO privacy.
 *
 * Before: any client could connect without logging in, and every event
 * (WhatsApp messages, statuses, imports, reminders) was sent to every
 * connected client. Browsers only hid other businesses' data.
 *
 * Now:
 *  - A client must send a valid, active login token (handshake auth.token,
 *    which the CRM frontend already sends). It then joins only its own rooms:
 *    its user room and, for agents, its business owner's room.
 *  - io.emit() no longer broadcasts to everyone: an event is delivered only to
 *    the room of the user in its payload (user_id / userId). An event that
 *    names no user is dropped and logged instead of being sent to everyone.
 */

const idOf = (v) => {
  if (!v) return null;
  const raw = v._id ?? v;
  const s = String(raw);
  return s && s !== 'undefined' && s !== 'null' && s !== '[object Object]' ? s : null;
};

const roomsFor = (id) => (id ? [`user_${id}`, id] : []);

export const getEventOwnerId = (payload) =>
  idOf(payload?.user_id) || idOf(payload?.userId) || idOf(payload?.owner_id) || idOf(payload?.ownerId);

const authenticateSocket = async (socket) => {
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== 'string') return null;

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id).populate('role_id').lean();
  if (!user || user.deleted_at) return null;

  const session = await Session.findOne({
    user_id: new mongoose.Types.ObjectId(user._id),
    session_token: token,
    status: 'active'
  }).lean();
  if (!session) return null;

  const role = user.role_id?.name || null;
  const userId = String(user._id);
  const ownerId = role === 'agent' && user.created_by ? String(user.created_by) : userId;
  return { userId, ownerId, role };
};

export const setupSocketSecurity = (io) => {
  // 1. Deliver every io.emit() only to the user it belongs to.
  const broadcastToAll = io.emit.bind(io);
  io.emit = (event, payload, ...rest) => {
    // Socket.IO's own reserved events (none are emitted by the app today).
    if (event === 'connect' || event === 'disconnect') return broadcastToAll(event, payload, ...rest);

    const ownerId = getEventOwnerId(payload);
    if (!ownerId) {
      console.warn(`[socket-security] Dropped '${event}' event with no user_id (would have gone to every client).`);
      return true;
    }
    return io.to(roomsFor(ownerId)).emit(event, payload, ...rest);
  };

  // 2. Only logged-in clients join rooms.
  io.use(async (socket, next) => {
    try {
      socket.data.auth = await authenticateSocket(socket);
    } catch {
      socket.data.auth = null;
    }
    // Unauthenticated clients may stay connected but join no room, so they receive nothing.
    next();
  });
};

/** Rooms the socket's own login allows it to be in. */
export const joinOwnRooms = (socket) => {
  const auth = socket.data.auth;
  if (!auth) return;
  socket.join([...roomsFor(auth.userId), ...roomsFor(auth.ownerId)]);
};

/** Clients may only (re)join rooms that belong to their own login. */
export const canJoinRoom = (socket, room) => {
  const auth = socket.data.auth;
  if (!auth || !room) return false;
  const allowed = new Set([...roomsFor(auth.userId), ...roomsFor(auth.ownerId)]);
  return allowed.has(String(room)) || allowed.has(`user_${room}`);
};
