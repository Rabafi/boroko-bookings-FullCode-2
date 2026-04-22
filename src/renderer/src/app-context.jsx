import { createContext, useContext } from 'react'

export const AuthContext = createContext({
  user: null,
  login: async () => null,
  logout: async () => null
})

export const SettingsContext = createContext({
  settings: null,
  setSettings: () => {}
})

export const ProfilesContext = createContext({
  profiles: [],
  activeProfile: null,
  loading: false,
  profilesLoading: false,
  reloadProfiles: async () => [],
  selectProfile: async () => null,
  createDraftProfile: async () => null,
  removeDraftProfile: async () => null
})

export const FeaturesContext = createContext({})

export const AccessContext = createContext({})

export const OnlineRequestsContext = createContext({
  count: 0,
  requests: [],
  refresh: () => {}
})

export function useAuth() {
  return useContext(AuthContext)
}

export function useSettings() {
  return useContext(SettingsContext)
}

export function useProfiles() {
  return useContext(ProfilesContext)
}

export function useFeatures() {
  return useContext(FeaturesContext)
}

export function useAccess() {
  return useContext(AccessContext)
}

export function useOnlineRequests() {
  return useContext(OnlineRequestsContext)
}
