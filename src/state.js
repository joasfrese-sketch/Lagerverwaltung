export const state = {
  user: null,     // auth user
  profile: null,  // Zeile aus profiles
  rooms: [],
};

export const isAdmin = () => state.profile?.role === 'admin';
export const isManager = () => ['admin', 'raum_manager'].includes(state.profile?.role);
export const canManageRoom = (room) =>
  isAdmin() || (state.profile?.role === 'raum_manager' && (!state.profile.managed_room || state.profile.managed_room === room));
