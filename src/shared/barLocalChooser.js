// @ts-check

/**
 * Keep an explicitly linked company-setup draft from appearing beside the
 * local Bar card that continued it. Unknown/unlinked drafts are preserved.
 * @param {unknown[]} profiles
 * @param {{status?: unknown, origin_profile_id?: unknown}|null|undefined} entry
 */
export function projectBarChooserProfiles(profiles, entry) {
  const linkedDraftId = entry?.status !== 'none' && typeof entry?.origin_profile_id === 'string'
    ? entry.origin_profile_id
    : null
  const hiddenDraft = linkedDraftId && profiles.some((profile) => {
    return profile && typeof profile === 'object' && profile.status === 'draft' && profile.lodge_id === linkedDraftId
  }) ? linkedDraftId : null
  return {
    profiles: hiddenDraft ? profiles.filter((profile) => profile?.lodge_id !== hiddenDraft) : profiles,
    hiddenDraftId: hiddenDraft
  }
}
