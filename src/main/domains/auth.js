import { state } from '../state.js'

import {
  buildSupabaseAuthClient,
  checkOnline,
  getAuthRedirectUrl,
  getUserById,
  logActivity,
  normalizeEmail,
  requireAdmin,
  upsertCachedUser
} from './infrastructure.js'

export async function sendPasswordResetEmail(email) {
  const emailLower = normalizeEmail(email)
  if (!emailLower) throw new Error('Enter the email address for this account.')
  await checkOnline()
  if (!state.isOnline) throw new Error('Internet connection required to send a password reset email.')

  const authClient = buildSupabaseAuthClient()
  const options = getAuthRedirectUrl() ? { redirectTo: getAuthRedirectUrl() } : undefined
  const { error } = await authClient.auth.resetPasswordForEmail(emailLower, options)
  if (error) throw new Error(error.message || 'Could not send password reset email.')
  return {
    success: true,
    email: emailLower,
    redirect_url_configured: Boolean(getAuthRedirectUrl())
  }
}

export async function sendUserInviteOrReset(id) {
  const user = await getUserById(id)
  if (!user) throw new Error('Staff account not found.')
  const emailLower = normalizeEmail(user.email)
  if (!emailLower) throw new Error('Staff account is missing an email address.')
  await checkOnline()
  if (!state.isOnline) throw new Error('Internet connection required to send staff invites.')

  if (!user.auth_user_id) {
    const admin = requireAdmin()
    const { data, error } = await admin.auth.admin.inviteUserByEmail(emailLower, {
      data: {
        lodge_id: state.lodgeId,
        app_user_id: user.id,
        app: 'boroko-bookings'
      },
      redirectTo: getAuthRedirectUrl()
    })
    if (error) throw new Error(error.message || 'Could not send staff invite.')
    const authUserId = data?.user?.id || null
    if (authUserId) {
      const { error: linkError } = await admin
        .from('users')
        .update({ auth_user_id: authUserId })
        .eq('id', user.id)
        .eq('lodge_id', state.lodgeId)
      if (linkError) throw new Error(linkError.message || 'Invite sent, but the staff account could not be linked.')
      upsertCachedUser({ ...user, auth_user_id: authUserId })
    }
    logActivity('staff_invite_sent', `${user.name || emailLower} · Supabase Auth invite sent`)
    return {
      success: true,
      mode: 'invite',
      email: emailLower,
      auth_user_id: authUserId,
      redirect_url_configured: Boolean(getAuthRedirectUrl())
    }
  }

  const result = await sendPasswordResetEmail(emailLower)
  logActivity('staff_password_reset_sent', `${user.name || emailLower} · password reset email sent`)
  return {
    ...result,
    mode: 'reset'
  }
}

export {
  clearBackendSession,
  getUserPosOutletFilter,
  setCurrentUser,
  getCurrentUser,
  logoutCurrentUser,
  restoreUserSession,
  restoreSavedTrustedSession,
  validateCurrentSession,
  createSessionNonce,
  loginUser,
  getAllUsers,
  getUsers,
  getUserById,
  runAuthHealthCheck,
  createUser,
  updateUser,
  resetUserPassword,
  getAuthStatus,
  deleteUser
} from './infrastructure.js'
