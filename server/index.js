const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const app = express();
const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || 'ghostlink-secret-change-in-prod';
const PORT = process.env.PORT || 4000;

// Trust proxy so rate-limit works behind proxies/Tor — but we NEVER log the IP
app.set('trust proxy', 1);

const db = low(new FileSync(path.join(__dirname, 'ghostlink.json')));
db.defaults({ users:[], rooms:[], room_members:[], friends:[], friend_requests:[], message_requests:[], blocked:[], offline_msgs:[] }).write();

function isStrongPassword(p) {
  if (!p || p.length < 10) return 'Password must be at least 10 characters';
  if (!/[A-Z]/.test(p)) return 'Must contain an uppercase letter (A-Z)';
  if (!/[a-z]/.test(p)) return 'Must contain a lowercase letter (a-z)';
  if (!/[0-9]/.test(p)) return 'Must contain a number (0-9)';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Must contain a special character (!@#$%^&*)';
  const common = ['password','123456','qwerty','letmein','welcome','admin','ghostlink'];
  if (common.some(c => p.toLowerCase().includes(c))) return 'Password is too common';
  return null;
}

const DB = {
  getByGhostId: g => db.get('users').find(u => u.ghost_id === g).value(),
  getById: id => db.get('users').find(u => u.id === id).value(),
  createUser: u => db.get('users').push(u).write(),
  updateUser: (id, d) => db.get('users').find(u => u.id === id).assign(d).write(),
  deleteUser: id => {
    ['users','room_members','friends','friend_requests','message_requests','blocked','offline_msgs']
      .forEach(t => db.get(t).remove(x => x.id===id||x.user_id===id||x.from_id===id||x.to_id===id).write());
  },
  searchUsers: (q, exId) => db.get('users').filter(u => u.ghost_id.toLowerCase().startsWith(q.toLowerCase()) && u.id !== exId && !u.pending_delete).take(10).value(),
  getRoom: id => db.get('rooms').find(r => r.id === id).value(),
  getRoomByInvite: code => db.get('rooms').find(r => r.invite_code === code.toUpperCase()).value(),
  createRoom: r => db.get('rooms').push(r).write(),
  updateRoom: (id, d) => db.get('rooms').find(r => r.id === id).assign(d).write(),
  deleteRoom: id => { db.get('rooms').remove(r => r.id === id).write(); db.get('room_members').remove(m => m.room_id === id).write(); },
  getMembers: roomId => db.get('room_members').filter(m => m.room_id === roomId).value().map(m => {
    const u = DB.getById(m.user_id);
    return u ? { id: u.id, ghostId: u.ghost_id, avatarColor: u.avatar_color, avatarPhoto: u.avatar_photo, status: u.status, role: m.role || 'member' } : null;
  }).filter(Boolean),
  isMember: (roomId, userId) => !!db.get('room_members').find(m => m.room_id === roomId && m.user_id === userId).value(),
  getMember: (roomId, userId) => db.get('room_members').find(m => m.room_id === roomId && m.user_id === userId).value(),
  addMember: (roomId, userId, role='member') => { if (!DB.isMember(roomId, userId)) db.get('room_members').push({ room_id: roomId, user_id: userId, role, joined_at: Date.now() }).write(); },
  removeMember: (roomId, userId) => db.get('room_members').remove(m => m.room_id === roomId && m.user_id === userId).write(),
  setMemberRole: (roomId, userId, role) => db.get('room_members').find(m => m.room_id === roomId && m.user_id === userId).assign({ role }).write(),
  getUserRooms: userId => db.get('room_members').filter(m => m.user_id === userId).value().map(m => db.get('rooms').find(r => r.id === m.room_id).value()).filter(Boolean),
  getFriends: userId => db.get('friends').filter(f => f.user_id === userId).value().map(f => { const u = DB.getById(f.friend_id); return u ? { id: u.id, ghostId: u.ghost_id, avatarColor: u.avatar_color, avatarPhoto: u.avatar_photo, status: u.status } : null; }).filter(Boolean),
  isFriend: (a, b) => !!db.get('friends').find(f => f.user_id === a && f.friend_id === b).value(),
  addFriend: (a, b) => { if (!DB.isFriend(a, b)) db.get('friends').push({ id: uuidv4(), user_id: a, friend_id: b, created_at: Date.now() }).write(); },
  removeFriend: (a, b) => db.get('friends').remove(f => (f.user_id===a&&f.friend_id===b)||(f.user_id===b&&f.friend_id===a)).write(),
  getFriendRequests: userId => db.get('friend_requests').filter(f => f.to_id === userId && f.status === 'pending').value(),
  hasFriendRequest: (from, to) => !!db.get('friend_requests').find(f => f.from_id===from && f.to_id===to && f.status==='pending').value(),
  sendFriendRequest: (from, to) => db.get('friend_requests').push({ id: uuidv4(), from_id: from, to_id: to, status: 'pending', created_at: Date.now() }).write(),
  getFriendRequest: id => db.get('friend_requests').find(f => f.id === id).value(),
  updateFriendRequest: (id, status) => db.get('friend_requests').find(f => f.id === id).assign({ status }).write(),
  getMsgRequests: userId => db.get('message_requests').filter(r => r.to_id === userId && r.status === 'pending').value(),
  hasMsgRequest: (from, to) => !!db.get('message_requests').find(r => r.from_id===from && r.to_id===to).value(),
  getMsgRequest: (from, to) => db.get('message_requests').find(r => r.from_id===from && r.to_id===to).value(),
  createMsgRequest: (from, to, firstMsg) => db.get('message_requests').push({ id: uuidv4(), from_id: from, to_id: to, status: 'pending', first_message: firstMsg, created_at: Date.now() }).write(),
  updateMsgRequest: (id, status) => db.get('message_requests').find(r => r.id === id).assign({ status }).write(),
  isApproved: (from, to) => { const r = db.get('message_requests').find(r => r.from_id===from && r.to_id===to).value(); return r && r.status === 'approved'; },
  isBlocked: (blocker, blocked) => !!db.get('blocked').find(b => b.blocker_id===blocker && b.blocked_id===blocked).value(),
  blockUser: (blocker, blocked) => { if (!DB.isBlocked(blocker, blocked)) db.get('blocked').push({ id: uuidv4(), blocker_id: blocker, blocked_id: blocked, created_at: Date.now() }).write(); },
  unblockUser: (blocker, blocked) => db.get('blocked').remove(b => b.blocker_id===blocker && b.blocked_id===blocked).write(),
  getBlocked: userId => db.get('blocked').filter(b => b.blocker_id === userId).value().map(b => { const u = DB.getById(b.blocked_id); return u ? { id: u.id, ghostId: u.ghost_id } : null; }).filter(Boolean),
  queueMsg: (toId, msg) => db.get('offline_msgs').push({ id: uuidv4(), to_id: toId, msg, created_at: Date.now() }).write(),
  getOfflineMsgs: toId => db.get('offline_msgs').filter(m => m.to_id === toId).value(),
  clearOfflineMsgs: toId => db.get('offline_msgs').remove(m => m.to_id === toId).write(),
  scheduleDeletion: userId => db.get('users').find(u => u.id === userId).assign({ pending_delete: true, delete_at: Date.now()+15*86400000 }).write(),
  cancelDeletion: userId => db.get('users').find(u => u.id === userId).assign({ pending_delete: false, delete_at: null }).write(),
  processDeletions: () => { const due = db.get('users').filter(u => u.pending_delete && u.delete_at <= Date.now()).value(); due.forEach(u => DB.deleteUser(u.id)); return due.length; }
};

setInterval(() => DB.processDeletions(), 3600000);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use((req, res, next) => { res.removeHeader('X-Powered-By'); next(); });

// Rate limiting — skip IP validation warning, use socket ID instead
const limiterOpts = { windowMs: 15*60*1000, max: 30, standardHeaders: false, legacyHeaders: false, skip: () => false, keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown' };
const authLim = rateLimit({ ...limiterOpts, max: 20 });
const apiLim = rateLimit({ ...limiterOpts, windowMs: 60*1000, max: 400 });

function auth(req, res, next) {
  try { req.user = jwt.verify(req.headers.authorization?.split(' ')[1], JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Unauthorized' }); }
}
function gc(s) {
  const c = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#f97316','#14b8a6'];
  let h = 0; for (const x of s) h = (h<<5)-h+x.charCodeAt(0); return c[Math.abs(h)%c.length];
}

app.post('/api/register', authLim, async (req, res) => {
  try {
    const { ghostId, password } = req.body;
    if (!ghostId || !password) return res.status(400).json({ error: 'Required fields missing' });
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(ghostId)) return res.status(400).json({ error: 'GhostID: 3-24 chars, letters/numbers/_/-' });
    const pwErr = isStrongPassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    if (DB.getByGhostId(ghostId)) return res.status(409).json({ error: 'GhostID already taken' });
    DB.createUser({ id: uuidv4(), ghost_id: ghostId, password_hash: await bcrypt.hash(password, 10), public_key: null, avatar_color: gc(ghostId), avatar_photo: null, status: 'offline', pending_delete: false, delete_at: null, created_at: Date.now() });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/login', authLim, async (req, res) => {
  try {
    const { ghostId, password } = req.body;
    const user = DB.getByGhostId(ghostId);
    if (!user || !await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Invalid GhostID or password' });
    DB.updateUser(user.id, { status: 'online' });
    const token = jwt.sign({ id: user.id, ghostId: user.ghost_id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, ghostId: user.ghost_id, avatarColor: user.avatar_color, avatarPhoto: user.avatar_photo, pendingDelete: user.pending_delete, deleteAt: user.delete_at } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/logout', auth, (req, res) => { DB.updateUser(req.user.id, { status: 'offline' }); res.json({ success: true }); });

app.post('/api/profile', auth, async (req, res) => {
  try {
    const { avatarPhoto, newPassword, currentPassword } = req.body;
    const user = DB.getById(req.user.id); if (!user) return res.status(404).json({ error: 'Not found' });
    const upd = {};
    if (avatarPhoto !== undefined) upd.avatar_photo = avatarPhoto;
    if (newPassword) {
      if (!currentPassword || !await bcrypt.compare(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Current password incorrect' });
      const pwErr = isStrongPassword(newPassword); if (pwErr) return res.status(400).json({ error: pwErr });
      upd.password_hash = await bcrypt.hash(newPassword, 10);
    }
    DB.updateUser(req.user.id, upd);
    const u = DB.getById(req.user.id);
    res.json({ user: { id: u.id, ghostId: u.ghost_id, avatarColor: u.avatar_color, avatarPhoto: u.avatar_photo, pendingDelete: u.pending_delete, deleteAt: u.delete_at } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/account/delete', auth, async (req, res) => {
  try {
    const user = DB.getById(req.user.id);
    if (!user || !await bcrypt.compare(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'Password incorrect' });
    DB.scheduleDeletion(req.user.id); res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/account/recover', auth, (req, res) => { DB.cancelDeletion(req.user.id); res.json({ success: true }); });

app.get('/api/users/search', auth, apiLim, (req, res) => {
  const { q } = req.query; if (!q || q.length < 1) return res.json({ users: [] });
  res.json({ users: DB.searchUsers(q, req.user.id).map(u => ({ ghost_id: u.ghost_id, avatar_color: u.avatar_color, avatar_photo: u.avatar_photo, status: u.status, is_friend: DB.isFriend(req.user.id, u.id), is_blocked: DB.isBlocked(req.user.id, u.id) })) });
});
app.get('/api/users/:ghostId', auth, apiLim, (req, res) => {
  const u = DB.getByGhostId(req.params.ghostId); if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ user: { ghost_id: u.ghost_id, avatar_color: u.avatar_color, avatar_photo: u.avatar_photo, status: u.status, is_friend: DB.isFriend(req.user.id, u.id) } });
});
app.post('/api/keys', auth, (req, res) => { DB.updateUser(req.user.id, { public_key: req.body.publicKey }); res.json({ success: true }); });
app.get('/api/keys/:ghostId', auth, (req, res) => { const u = DB.getByGhostId(req.params.ghostId); if (!u?.public_key) return res.status(404).json({ error: 'No key' }); res.json({ publicKey: u.public_key }); });

app.get('/api/friends', auth, (req, res) => res.json({ friends: DB.getFriends(req.user.id) }));
app.delete('/api/friends/:ghostId', auth, (req, res) => { const u = DB.getByGhostId(req.params.ghostId); if (u) DB.removeFriend(req.user.id, u.id); res.json({ success: true }); });
app.get('/api/friends/requests', auth, (req, res) => {
  const reqs = DB.getFriendRequests(req.user.id).map(r => { const u = DB.getById(r.from_id); return u ? { id: r.id, from: { ghost_id: u.ghost_id, avatar_color: u.avatar_color, avatar_photo: u.avatar_photo }, created_at: r.created_at } : null; }).filter(Boolean);
  res.json({ requests: reqs });
});
app.post('/api/friends/request', auth, apiLim, (req, res) => {
  const target = DB.getByGhostId(req.body.ghostId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (DB.isBlocked(target.id, req.user.id)) return res.status(403).json({ error: 'Cannot send request' });
  if (DB.isFriend(req.user.id, target.id)) return res.status(400).json({ error: 'Already friends' });
  if (DB.hasFriendRequest(req.user.id, target.id)) return res.status(400).json({ error: 'Request already sent' });
  DB.sendFriendRequest(req.user.id, target.id); res.json({ success: true });
});
app.post('/api/friends/accept', auth, (req, res) => {
  const r = DB.getFriendRequest(req.body.requestId); if (!r || r.to_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  DB.updateFriendRequest(r.id, 'accepted');
  DB.addFriend(req.user.id, r.from_id); DB.addFriend(r.from_id, req.user.id);
  // Approve both directions of message requests when becoming friends
  const mr1 = DB.getMsgRequest(r.from_id, req.user.id); if (mr1) DB.updateMsgRequest(mr1.id, 'approved');
  if (!DB.hasMsgRequest(req.user.id, r.from_id)) DB.createMsgRequest(req.user.id, r.from_id, null);
  const mr2 = DB.getMsgRequest(req.user.id, r.from_id); if (mr2) DB.updateMsgRequest(mr2.id, 'approved');
  res.json({ success: true });
});
app.post('/api/friends/decline', auth, (req, res) => { const r = DB.getFriendRequest(req.body.requestId); if (r) DB.updateFriendRequest(r.id, 'declined'); res.json({ success: true }); });

app.get('/api/blocked', auth, (req, res) => res.json({ blocked: DB.getBlocked(req.user.id) }));
app.post('/api/block', auth, (req, res) => { const u = DB.getByGhostId(req.body.ghostId); if (!u) return res.status(404).json({ error: 'Not found' }); DB.blockUser(req.user.id, u.id); DB.removeFriend(req.user.id, u.id); res.json({ success: true }); });
app.post('/api/unblock', auth, (req, res) => { const u = DB.getByGhostId(req.body.ghostId); if (!u) return res.status(404).json({ error: 'Not found' }); DB.unblockUser(req.user.id, u.id); res.json({ success: true }); });

app.get('/api/msgrequests', auth, (req, res) => {
  const reqs = DB.getMsgRequests(req.user.id).map(r => { const u = DB.getById(r.from_id); return u ? { id: r.id, from: { ghost_id: u.ghost_id, avatar_color: u.avatar_color, avatar_photo: u.avatar_photo }, first_message: r.first_message, created_at: r.created_at } : null; }).filter(Boolean);
  res.json({ requests: reqs });
});
app.post('/api/msgrequests/approve', auth, (req, res) => {
  const u = DB.getByGhostId(req.body.ghostId); if (!u) return res.status(404).json({ error: 'Not found' });
  // Approve the incoming request (A→me)
  const r = DB.getMsgRequest(u.id, req.user.id); if (r) DB.updateMsgRequest(r.id, 'approved');
  // Also create a reverse approved entry so I (me→A) can message them back without a separate request
  if (!DB.hasMsgRequest(req.user.id, u.id)) {
    DB.createMsgRequest(req.user.id, u.id, null);
  }
  const myReq = DB.getMsgRequest(req.user.id, u.id);
  if (myReq) DB.updateMsgRequest(myReq.id, 'approved');
  res.json({ success: true });
});
app.post('/api/msgrequests/decline', auth, (req, res) => {
  const u = DB.getByGhostId(req.body.ghostId); if (!u) return res.status(404).json({ error: 'Not found' });
  db.get('message_requests').remove(r => r.from_id === u.id && r.to_id === req.user.id).write();
  res.json({ success: true });
});

app.post('/api/rooms', auth, apiLim, (req, res) => {
  const { name, membersCanInvite } = req.body; if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4(), inviteCode = Math.random().toString(36).substring(2,10).toUpperCase();
  DB.createRoom({ id, name: name.trim(), invite_code: inviteCode, creator_id: req.user.id, members_can_invite: membersCanInvite !== false, created_at: Date.now() });
  DB.addMember(id, req.user.id, 'admin');
  res.json({ room: { id, name: name.trim(), inviteCode, creatorId: req.user.id, membersCanInvite: membersCanInvite !== false } });
});
app.post('/api/rooms/join', auth, apiLim, (req, res) => {
  const room = DB.getRoomByInvite(req.body.inviteCode || '');
  if (!room) return res.status(404).json({ error: 'Invalid invite code' });
  if (!room.members_can_invite) return res.status(403).json({ error: 'Only admins can add members to this room' });
  if (!DB.isMember(room.id, req.user.id)) DB.addMember(room.id, req.user.id, 'member');
  res.json({ room: { id: room.id, name: room.name, inviteCode: room.invite_code, creatorId: room.creator_id, membersCanInvite: room.members_can_invite } });
});
app.get('/api/rooms', auth, (req, res) => res.json({ rooms: DB.getUserRooms(req.user.id).map(r => ({ id: r.id, name: r.name, inviteCode: r.invite_code, creatorId: r.creator_id, membersCanInvite: r.members_can_invite })) }));
app.get('/api/rooms/:id/members', auth, (req, res) => { if (!DB.isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'Not a member' }); res.json({ members: DB.getMembers(req.params.id) }); });
app.post('/api/rooms/:id/members', auth, (req, res) => {
  const room = DB.getRoom(req.params.id); if (!room) return res.status(404).json({ error: 'Not found' });
  const m = DB.getMember(req.params.id, req.user.id); if (!m || m.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const target = DB.getByGhostId(req.body.ghostId); if (!target) return res.status(404).json({ error: 'User not found' });
  DB.addMember(req.params.id, target.id, 'member'); res.json({ success: true });
});
app.delete('/api/rooms/:id/members/:ghostId', auth, (req, res) => {
  const room = DB.getRoom(req.params.id); if (!room) return res.status(404).json({ error: 'Not found' });
  const m = DB.getMember(req.params.id, req.user.id); if (!m || m.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const target = DB.getByGhostId(req.params.ghostId); if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.id === room.creator_id) return res.status(403).json({ error: 'Cannot remove creator' });
  DB.removeMember(req.params.id, target.id); res.json({ success: true });
});
app.post('/api/rooms/:id/members/:ghostId/role', auth, (req, res) => {
  const m = DB.getMember(req.params.id, req.user.id); if (!m || m.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const target = DB.getByGhostId(req.params.ghostId); if (!target) return res.status(404).json({ error: 'Not found' });
  DB.setMemberRole(req.params.id, target.id, req.body.role); res.json({ success: true });
});
app.post('/api/rooms/:id/settings', auth, (req, res) => {
  const m = DB.getMember(req.params.id, req.user.id); if (!m || m.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  DB.updateRoom(req.params.id, { members_can_invite: req.body.membersCanInvite }); res.json({ success: true });
});
app.post('/api/rooms/:id/leave', auth, (req, res) => {
  const room = DB.getRoom(req.params.id); if (!room) return res.status(404).json({ error: 'Not found' });
  if (room.creator_id === req.user.id) {
    const others = DB.getMembers(req.params.id).filter(m => m.id !== req.user.id);
    if (others.length > 0) { DB.setMemberRole(req.params.id, others[0].id, 'admin'); DB.updateRoom(req.params.id, { creator_id: others[0].id }); DB.removeMember(req.params.id, req.user.id); res.json({ success: true, transferred: true, newAdmin: others[0].ghostId }); }
    else { DB.deleteRoom(req.params.id); res.json({ success: true, deleted: true }); }
  } else { DB.removeMember(req.params.id, req.user.id); res.json({ success: true }); }
});
app.delete('/api/rooms/:id', auth, (req, res) => {
  const room = DB.getRoom(req.params.id); if (!room) return res.status(404).json({ error: 'Not found' });
  const m = DB.getMember(req.params.id, req.user.id); if (!m || m.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  DB.deleteRoom(req.params.id); res.json({ success: true });
});
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── SOCKET.IO ─────────────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket','polling'], maxHttpBufferSize: 100*1024*1024 });
const online = {}, sockets = {};

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET); next(); }
  catch { next(new Error('Unauthorized')); }
});

io.on('connection', socket => {
  const { id: userId, ghostId } = socket.user;
  const rec = DB.getById(userId);
  online[socket.id] = { userId, ghostId };
  sockets[userId] = socket.id;
  DB.updateUser(userId, { status: 'online' });
  io.emit('user-status', { ghostId, status: 'online' });

  // Deliver queued offline messages
  const offlineMsgs = DB.getOfflineMsgs(userId);
  if (offlineMsgs.length) { offlineMsgs.forEach(m => socket.emit('dm:message', m.msg)); DB.clearOfflineMsgs(userId); }

  socket.on('key:exchange', ({ toGhostId, publicKey }) => {
    const t = DB.getByGhostId(toGhostId), ts = t && sockets[t.id];
    if (ts) io.to(ts).emit('key:exchange', { fromGhostId: ghostId, publicKey });
  });

  socket.on('dm:message', ({ toGhostId, encryptedPayload, msgId, expiresIn }) => {
    const target = DB.getByGhostId(toGhostId);
    if (!target) return socket.emit('dm:error', { msgId, error: 'User not found' });
    if (DB.isBlocked(target.id, userId)) return socket.emit('dm:error', { msgId, error: 'Blocked' });

    const areFriends = DB.isFriend(userId, target.id);
    // Check BOTH directions: A approved by B, OR B approved by A (mutual — if either side accepted, both can message)
    const myRequest = DB.getMsgRequest(userId, target.id);       // A→B request
    const theirRequest = DB.getMsgRequest(target.id, userId);    // B→A request
    const approved = (myRequest && myRequest.status === 'approved') ||
                     (theirRequest && theirRequest.status === 'approved');

    if (!areFriends && !approved) {
      if (!myRequest) {
        // First message — extract plain text for preview
        const previewText = encryptedPayload?.text || '[message]';
        DB.createMsgRequest(userId, target.id, previewText);
        const ts2 = sockets[target.id];
        if (ts2) io.to(ts2).emit('new:msgrequest', { fromGhostId: ghostId, avatarColor: rec?.avatar_color, avatarPhoto: rec?.avatar_photo, firstMessage: previewText });
        socket.emit('dm:pending', { msgId, message: 'Message request sent. Waiting for approval.' });
      } else {
        socket.emit('dm:error', { msgId, error: 'Message request is still pending approval' });
      }
      return;
    }

    const msg = { msgId: msgId || uuidv4(), fromGhostId: ghostId, avatarColor: rec?.avatar_color, avatarPhoto: rec?.avatar_photo, encryptedPayload, timestamp: Date.now(), expiresIn: expiresIn || null };
    const ts = sockets[target.id];
    if (ts) { io.to(ts).emit('dm:message', msg); socket.emit('dm:delivered', { msgId: msg.msgId, timestamp: msg.timestamp }); }
    else { DB.queueMsg(target.id, msg); socket.emit('dm:sent', { msgId: msg.msgId }); }
  });

  // Notify sender when their message request is approved
  socket.on('msgrequest:approved', ({ toGhostId }) => {
    const t = DB.getByGhostId(toGhostId), ts = t&&sockets[t.id];
    if(ts) io.to(ts).emit('msgrequest:approved', { fromGhostId: ghostId });
  });

  socket.on('dm:read', ({ toGhostId, msgId }) => { const t = DB.getByGhostId(toGhostId), ts = t&&sockets[t.id]; if(ts) io.to(ts).emit('dm:read', { fromGhostId: ghostId, msgId }); });
  socket.on('dm:typing', ({ toGhostId, typing }) => { const t = DB.getByGhostId(toGhostId), ts = t&&sockets[t.id]; if(ts) io.to(ts).emit('dm:typing', { fromGhostId: ghostId, typing }); });

  socket.on('room:join', ({ roomId }) => { if (DB.isMember(roomId, userId)) socket.join(`room:${roomId}`); });
  socket.on('room:leave-socket', ({ roomId }) => { socket.leave(`room:${roomId}`); });

  socket.on('room:message', ({ roomId, encryptedPayload, msgId, type, fileName, fileSize }) => {
    if (!DB.isMember(roomId, userId)) { socket.leave(`room:${roomId}`); return; }
    const msg = { msgId: msgId||uuidv4(), fromGhostId: ghostId, avatarColor: rec?.avatar_color, avatarPhoto: rec?.avatar_photo, encryptedPayload, timestamp: Date.now(), type: type||'text', fileName, fileSize };
    io.to(`room:${roomId}`).emit('room:message', msg);
  });

  socket.on('room:typing', ({ roomId, typing }) => {
    if (!DB.isMember(roomId, userId)) return;
    socket.to(`room:${roomId}`).emit('room:typing', { fromGhostId: ghostId, typing });
  });

  socket.on('room:kick', ({ roomId, targetGhostId }) => {
    const m = DB.getMember(roomId, userId); if (!m || m.role !== 'admin') return;
    const target = DB.getByGhostId(targetGhostId); if (!target) return;
    if (target.id === DB.getRoom(roomId)?.creator_id) return;
    DB.removeMember(roomId, target.id);
    const ts = sockets[target.id];
    if (ts) { io.to(ts).emit('room:kicked', { roomId, by: ghostId }); const s = io.sockets.sockets.get(ts); if(s) s.leave(`room:${roomId}`); }
    io.to(`room:${roomId}`).emit('room:member-removed', { ghostId: targetGhostId });
  });

  socket.on('room:add-member', ({ roomId, targetGhostId }) => {
    const m = DB.getMember(roomId, userId); if (!m || m.role !== 'admin') return;
    const target = DB.getByGhostId(targetGhostId); if (!target) return;
    DB.addMember(roomId, target.id, 'member');
    const ts = sockets[target.id];
    if (ts) io.to(ts).emit('room:added', { roomId, roomName: DB.getRoom(roomId)?.name, by: ghostId });
    io.to(`room:${roomId}`).emit('room:member-added', { ghostId: targetGhostId, avatarColor: target.avatar_color });
  });

  socket.on('room:settings', ({ roomId, membersCanInvite }) => {
    const m = DB.getMember(roomId, userId); if (!m || m.role !== 'admin') return;
    DB.updateRoom(roomId, { members_can_invite: membersCanInvite });
    io.to(`room:${roomId}`).emit('room:settings-updated', { membersCanInvite });
  });

  socket.on('call:offer', ({ toGhostId, offer, callType }) => {
    const t = DB.getByGhostId(toGhostId), ts = t&&sockets[t.id];
    if (!ts) return socket.emit('call:failed', { reason: `${toGhostId} is offline` });
    if (DB.isBlocked(t.id, userId)) return socket.emit('call:failed', { reason: 'Cannot call this user' });
    const callApproved = DB.isFriend(userId, t.id) || DB.isApproved(userId, t.id) || DB.isApproved(t.id, userId);
    if (!callApproved) return socket.emit('call:failed', { reason: 'User has not accepted your message request yet' });
    io.to(ts).emit('call:offer', { fromGhostId: ghostId, offer, callType, avatarColor: rec?.avatar_color, avatarPhoto: rec?.avatar_photo });
  });
  socket.on('call:answer', ({ toGhostId, answer }) => { const t=DB.getByGhostId(toGhostId),ts=t&&sockets[t.id]; if(ts) io.to(ts).emit('call:answer',{fromGhostId:ghostId,answer}); });
  socket.on('call:ice', ({ toGhostId, candidate }) => { const t=DB.getByGhostId(toGhostId),ts=t&&sockets[t.id]; if(ts) io.to(ts).emit('call:ice',{fromGhostId:ghostId,candidate}); });
  socket.on('call:end', ({ toGhostId }) => { const t=DB.getByGhostId(toGhostId),ts=t&&sockets[t.id]; if(ts) io.to(ts).emit('call:end',{fromGhostId:ghostId}); });
  socket.on('call:reject', ({ toGhostId }) => { const t=DB.getByGhostId(toGhostId),ts=t&&sockets[t.id]; if(ts) io.to(ts).emit('call:rejected',{fromGhostId:ghostId}); });

  socket.on('disconnect', () => {
    delete online[socket.id]; delete sockets[userId];
    DB.updateUser(userId, { status: 'offline' });
    io.emit('user-status', { ghostId, status: 'offline' });
  });
});

server.listen(PORT, () => console.log(`\n👻 GhostLink → http://localhost:${PORT}\n`));
