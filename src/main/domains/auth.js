// @ts-check
import { state } from '../state.js'
import { upsertCachedUser } from './authCache.js'
import {
  buildSupabaseAuthClient,
  clearBackendSession,
  getAuthRedirectUrl
} from './authClients.js'
import { normalizeEmail } from './shared.js'
import { checkOnline } from './connectivity.js'
import { getAllUsers, getUserById, getUserPosOutletFilter, getUsers } from './users.js'
import { assertStarterUsersAccessLite } from './authUsers.js'

/** @typedef {Record<string, unknown>} AuthUserPropertyView */

import {
  logActivity,
  requireAdmin
} from './infrastructure.js'

/** @param {unknown} email @returns {Promise<{success: true, email: string, redirect_url_configured: boolean}>} */
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

/** @param {unknown} id @returns {Promise<Record<string, unknown>>} */
export async function sendUserInviteOrReset(id) {
  const user = await getUserById(id)
  if (!user) throw new Error('Staff account not found.')
  await assertStarterUsersAccessLite({ data: {}, existingUser: user })
  const userView = /** @type {AuthUserPropertyView} */ (user)
  const emailLower = normalizeEmail(userView.email)
  if (!emailLower) throw new Error('Staff account is missing an email address.')
  await checkOnline()
  if (!state.isOnline) throw new Error('Internet connection required to send staff invites.')
  const inviteSentAt = new Date().toISOString()

  if (!userView.auth_user_id) {
    const admin = requireAdmin()
    // The Supabase admin SDK types its invitation result as any; keep the returned JSON untrusted.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(emailLower, {
      data: {
        lodge_id: state.lodgeId,
        app_user_id: userView.id,
        app: 'boroko-bookings'
      },
      redirectTo: getAuthRedirectUrl()
    })
    if (error) throw new Error(error.message || 'Could not send staff invite.')
    const inviteResponse = /** @type {AuthUserPropertyView | null | undefined} */ (data)
    const invitedUser = /** @type {AuthUserPropertyView | null | undefined} */ (inviteResponse?.user)
    const authUserId = invitedUser?.id || null
    if (authUserId) {
      const { error: linkError } = await admin
        .from('users')
        .update({ auth_user_id: authUserId })
        .eq('id', userView.id)
        .eq('lodge_id', state.lodgeId)
      if (linkError) throw new Error(linkError.message || 'Invite sent, but the staff account could not be linked.')
      upsertCachedUser({ ...userView, auth_user_id: authUserId, invite_sent_at: inviteSentAt })
    }
    await admin
      .from('users')
      .update({ invite_sent_at: inviteSentAt })
      .eq('id', userView.id)
      .eq('lodge_id', state.lodgeId)
    logActivity('staff_invite_sent', `${String(userView.name || emailLower)} · Supabase Auth invite sent`)
    return {
      success: true,
      mode: 'invite',
      email: emailLower,
      auth_user_id: authUserId,
      redirect_url_configured: Boolean(getAuthRedirectUrl())
    }
  }

  const result = await sendPasswordResetEmail(emailLower)
  upsertCachedUser({ ...userView, invite_sent_at: inviteSentAt })
  logActivity('staff_password_reset_sent', `${String(userView.name || emailLower)} · password reset email sent`)
  return {
    ...result,
    mode: 'reset'
  }
}

export { readSessionNonce } from './authSession.js'

export {
  setCurrentUser,
  getCurrentUser,
  logoutCurrentUser,
  restoreCurrentTrustedSession,
  restoreUserSession,
  restoreSavedTrustedSession,
  validateCurrentSession,
  createSessionNonce,
  loginUser,
  runAuthHealthCheck,
  createUser,
  updateUser,
  resetUserPassword,
  changeOwnStaffPin,
  getStaffAccessAudit,
  getAuthStatus,
  deleteUser
} from './infrastructure.js'
export { clearBackendSession } from './authClients.js'

export { getAllUsers, getUsers, getUserById, getUserPosOutletFilter } from './users.js'
