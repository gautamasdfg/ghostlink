// Auto-detect API base URL — works without .env file
const BASE = process.env.REACT_APP_API_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '');

async function req(path, opts = {}) {
  const token = localStorage.getItem('gl_token');
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  register: (ghostId, password) => req('/register', { method: 'POST', body: JSON.stringify({ ghostId, password }) }),
  login: (ghostId, password) => req('/login', { method: 'POST', body: JSON.stringify({ ghostId, password }) }),
  logout: () => req('/logout', { method: 'POST' }),
  updateProfile: (data) => req('/profile', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccount: (password) => req('/account/delete', { method: 'POST', body: JSON.stringify({ password }) }),
  recoverAccount: () => req('/account/recover', { method: 'POST' }),
  searchUsers: (q) => req(`/users/search?q=${encodeURIComponent(q)}`),
  getUser: (ghostId) => req(`/users/${ghostId}`),
  uploadKey: (publicKey) => req('/keys', { method: 'POST', body: JSON.stringify({ publicKey }) }),
  getKey: (ghostId) => req(`/keys/${ghostId}`),
  getFriends: () => req('/friends'),
  removeFriend: (ghostId) => req(`/friends/${ghostId}`, { method: 'DELETE' }),
  getFriendRequests: () => req('/friends/requests'),
  sendFriendRequest: (ghostId) => req('/friends/request', { method: 'POST', body: JSON.stringify({ ghostId }) }),
  acceptFriendRequest: (requestId) => req('/friends/accept', { method: 'POST', body: JSON.stringify({ requestId }) }),
  declineFriendRequest: (requestId) => req('/friends/decline', { method: 'POST', body: JSON.stringify({ requestId }) }),
  getBlocked: () => req('/blocked'),
  blockUser: (ghostId) => req('/block', { method: 'POST', body: JSON.stringify({ ghostId }) }),
  unblockUser: (ghostId) => req('/unblock', { method: 'POST', body: JSON.stringify({ ghostId }) }),
  getMsgRequests: () => req('/msgrequests'),
  approveMsgRequest: (ghostId) => req('/msgrequests/approve', { method: 'POST', body: JSON.stringify({ ghostId }) }),
  declineMsgRequest: (ghostId) => req('/msgrequests/decline', { method: 'POST', body: JSON.stringify({ ghostId }) }),
  createRoom: (name, membersCanInvite) => req('/rooms', { method: 'POST', body: JSON.stringify({ name, membersCanInvite }) }),
  joinRoom: (inviteCode) => req('/rooms/join', { method: 'POST', body: JSON.stringify({ inviteCode }) }),
  getRooms: () => req('/rooms'),
  getRoomMembers: (id) => req(`/rooms/${id}/members`),
  addRoomMember: (id, ghostId) => req(`/rooms/${id}/members`, { method: 'POST', body: JSON.stringify({ ghostId }) }),
  removeRoomMember: (id, ghostId) => req(`/rooms/${id}/members/${ghostId}`, { method: 'DELETE' }),
  setRoomMemberRole: (id, ghostId, role) => req(`/rooms/${id}/members/${ghostId}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  updateRoomSettings: (id, settings) => req(`/rooms/${id}/settings`, { method: 'POST', body: JSON.stringify(settings) }),
  leaveRoom: (id) => req(`/rooms/${id}/leave`, { method: 'POST' }),
  deleteRoom: (id) => req(`/rooms/${id}`, { method: 'DELETE' }),
};
