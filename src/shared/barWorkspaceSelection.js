import { join } from 'node:path'
import { LOCAL_BAR_WORKSPACE_DIR } from './barLocalWorkspace.js'

export const BAR_WORKSPACE_SELECTION_FILE = 'bar-local/workspace-choice.json'
export const BAR_WORKSPACE_CHOICES = Object.freeze(['cloud', 'local_bar'])

/** @param {unknown} value */
export function parseBarWorkspaceSelection(value) {
  if (typeof value !== 'string') return null
  try {
    const record = JSON.parse(value)
    return record?.version === 1 && BAR_WORKSPACE_CHOICES.includes(record.workspace)
      ? record.workspace
      : null
  } catch {
    return null
  }
}

/** @param {unknown} workspace */
export function makeBarWorkspaceSelection(workspace) {
  if (!BAR_WORKSPACE_CHOICES.includes(workspace)) throw new TypeError('A supported workspace must be selected.')
  return JSON.stringify({ version: 1, workspace })
}

/** @param {string} baseUserDataPath @param {unknown} workspace */
export function selectedWorkspaceUserDataPath(baseUserDataPath, workspace) {
  return workspace === 'local_bar' ? join(baseUserDataPath, LOCAL_BAR_WORKSPACE_DIR) : baseUserDataPath
}
