import { updateRoomHousekeeping as updateHousekeepingAction } from './api'

export async function updateRoomHousekeeping(roomId, lodgeId, status, notes) {
  return updateHousekeepingAction(lodgeId, roomId, status, notes)
}
