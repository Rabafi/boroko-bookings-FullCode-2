// @ts-check

/** @typedef {Record<string, unknown>} DayUseConfigRecord */
/** @typedef {{templates?: unknown, day_use_templates?: unknown, resources?: unknown, day_use_resources?: unknown, updated_at?: unknown, lodge_id?: unknown}} DayUseConfigInput */
/** @typedef {{includeMeta?: unknown}} DayUseConfigOptions */

import { state } from '../state.js';
import { readCache, writeCache } from './infrastructure.js';
import {
  DEFAULT_DAY_USE_RESOURCES,
  DEFAULT_DAY_USE_TEMPLATES,
  normalizeDayUseResource,
  normalizeDayUseTemplate,
  resolveDayUseResources,
  resolveDayUseTemplates
} from '../../shared/dayUseConfig.js';

const CACHE_KEY = 'day_use_config';

/** @param {unknown} config @returns {DayUseConfigRecord} */
function normalizeConfig(config = {}) {
  // This is a type-only view of existing property reads; malformed cache
  // values retain their original property-access behavior.
  const value = /** @type {DayUseConfigInput} */ (config);
  const templateRows = Array.isArray(value.templates)
    ? value.templates
    : Array.isArray(value.day_use_templates)
      ? value.day_use_templates
      : DEFAULT_DAY_USE_TEMPLATES;
  const resourceRows = Array.isArray(value.resources)
    ? value.resources
    : Array.isArray(value.day_use_resources)
      ? value.day_use_resources
      : DEFAULT_DAY_USE_RESOURCES;
  return {
    lodge_id: state.lodgeId || value.lodge_id || null,
    templates: resolveDayUseTemplates({ day_use_templates: templateRows }),
    resources: resolveDayUseResources({ day_use_resources: resourceRows }),
    updated_at: value.updated_at || null
  };
}

/** @returns {DayUseConfigRecord} */
function readLocalDayUseConfig() {
  const cached = /** @type {unknown} */ (readCache(CACHE_KEY));
  // JSON cache contents are not validated here; this assertion only permits
  // the original numeric property read and does not establish an array shape.
  const cachedFirst = /** @type {unknown[]} */ (cached)[0];
  if (cachedFirst) return normalizeConfig(cachedFirst);

  const legacySettingsValue = /** @type {unknown[]} */ (readCache('settings'))?.[0] || {};
  const legacySettings = /** @type {DayUseConfigInput} */ (legacySettingsValue);
  return normalizeConfig({
    lodge_id: state.lodgeId,
    templates: legacySettings.day_use_templates,
    resources: legacySettings.day_use_resources
  });
}

/** @returns {Promise<DayUseConfigRecord | null>} */
async function getRemoteDayUseConfig() {
  const result = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
    .from('day_use_config')
    .select('*')
    .eq('lodge_id', state.lodgeId)
    .maybeSingle();

  if (!result.error) return result.data ? normalizeConfig(result.data) : null;

  const message = /** @type {string} */ (/** @type {{message?: unknown}} */ (result.error).message || '');
  if (/relation .*day_use_config|could not find .*day_use_config|schema cache/i.test(message)) {
    return null;
  }
  throw new Error(/** @type {string} */ (message));
}

/** @returns {Promise<DayUseConfigRecord>} */
export async function getDayUseConfig() {
  if (!state.lodgeId) return normalizeConfig();

  if (state.isOnline) {
    try {
      const remote = await getRemoteDayUseConfig();
      if (remote) {
        writeCache(CACHE_KEY, [remote]);
        return remote;
      }
    } catch (error) {
      console.error('[DAY_USE_CONFIG] load failed:', /** @type {{message?: unknown}} */ (error).message);
    }
  }

  const local = readLocalDayUseConfig();
  writeCache(CACHE_KEY, [local]);
  return local;
}

/** @param {unknown} data @param {DayUseConfigOptions} [options] @returns {Promise<unknown>} */
export async function saveDayUseConfig(data = {}, options = {}) {
  const value = /** @type {DayUseConfigInput} */ (data);
  if (!state.lodgeId) throw new Error('Choose a lodge profile on this computer before saving Day Use setup.');

  const config = normalizeConfig({
    lodge_id: state.lodgeId,
    templates: /** @type {unknown[]} */ (value.templates || value.day_use_templates || []).map((template) => normalizeDayUseTemplate(template)),
    resources: /** @type {unknown[]} */ (value.resources || value.day_use_resources || []).map((resource) => normalizeDayUseResource(resource)),
    updated_at: new Date().toISOString()
  });

  writeCache(CACHE_KEY, [config]);

  // Offline (or missing-table) saves previously looked like success while the
  // server never learned. Report device-only persistence so callers warn.
  /** @param {unknown} [reason] */
  const deviceOnly = (reason) => options?.includeMeta === true
    ? {
      data: config,
      meta: {
        persistence: 'device_only',
        online: false,
        pending: true,
        retryRequired: true,
        warnings: [reason || 'This computer is offline. Day Use setup was saved here only and was not sent to the server.']
      }
    }
    : config;

  if (!state.isOnline) return deviceOnly();

  const result = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
    .from('day_use_config')
    .upsert({
      lodge_id: state.lodgeId,
      templates: config.templates,
      resources: config.resources,
      updated_at: config.updated_at
    }, { onConflict: 'lodge_id' })
    .select()
    .maybeSingle();

  if (!result.error) {
    const saved = normalizeConfig(result.data || config);
    writeCache(CACHE_KEY, [saved]);
    return options?.includeMeta === true
      ? { data: saved, meta: { persistence: 'remote', online: true, pending: false } }
      : saved;
  }

  const message = /** @type {string} */ (/** @type {{message?: unknown}} */ (result.error).message || '');
  if (/relation .*day_use_config|could not find .*day_use_config|schema cache/i.test(message)) {
    return deviceOnly('Day Use setup was saved here only; the server table is unavailable.');
  }
  throw new Error(/** @type {string} */ (message));
}
