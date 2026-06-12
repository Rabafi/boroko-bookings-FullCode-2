export const LOW_RESOURCE = {
  enabled: true,

  // Polling intervals (ms)
  onlineCheckMs: 30000,
  syncPollMs: 20000,
  displayPollMs: 15000,
  clockUpdateMs: 60000,

  // Query limits
  menuLimit: 250,
  ordersLimit: 100,
  ticketsLimit: 50,
  cashupsLimit: 30,
  configLimit: 100,
  exportMaxRows: 500,

  // Feature flags
  autoOpenDisplays: false,
  lazyLoadScreens: true,
  stageTerminalData: true
};

export function getLowResourceConfig(overrides = {}) {
  return { ...LOW_RESOURCE, ...overrides };
}
