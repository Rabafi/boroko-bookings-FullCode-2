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

function normalizeConfig(config = {}) {
  const templateRows = Array.isArray(config.templates)
    ? config.templates
    : Array.isArray(config.day_use_templates)
      ? config.day_use_templates
      : DEFAULT_DAY_USE_TEMPLATES;
  const resourceRows = Array.isArray(config.resources)
    ? config.resources
    : Array.isArray(config.day_use_resources)
      ? config.day_use_resources
      : DEFAULT_DAY_USE_RESOURCES;
  return {
    lodge_id: state.lodgeId || config.lodge_id || null,
    templates: resolveDayUseTemplates({ day_use_templates: templateRows }),
    resources: resolveDayUseResources({ day_use_resources: resourceRows }),
    updated_at: config.updated_at || null
  };
}

function readLocalDayUseConfig() {
  const cached = readCache(CACHE_KEY);
  if (cached[0]) return normalizeConfig(cached[0]);

  const legacySettings = readCache('settings')?.[0] || {};
  return normalizeConfig({
    lodge_id: state.lodgeId,
    templates: legacySettings.day_use_templates,
    resources: legacySettings.day_use_resources
  });
}

async function getRemoteDayUseConfig() {
  const result = await state.supabase
    .from('day_use_config')
    .select('*')
    .eq('lodge_id', state.lodgeId)
    .maybeSingle();

  if (!result.error) return result.data ? normalizeConfig(result.data) : null;

  const message = result.error.message || '';
  if (/relation .*day_use_config|could not find .*day_use_config|schema cache/i.test(message)) {
    return null;
  }
  throw new Error(message);
}

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
      console.error('[DAY_USE_CONFIG] load failed:', error.message);
    }
  }

  const local = readLocalDayUseConfig();
  writeCache(CACHE_KEY, [local]);
  return local;
}

export async function saveDayUseConfig(data = {}, options = {}) {
  if (!state.lodgeId) throw new Error('Choose a lodge profile on this computer before saving Day Use setup.');

  const config = normalizeConfig({
    lodge_id: state.lodgeId,
    templates: (data.templates || data.day_use_templates || []).map((template) => normalizeDayUseTemplate(template)),
    resources: (data.resources || data.day_use_resources || []).map((resource) => normalizeDayUseResource(resource)),
    updated_at: new Date().toISOString()
  });

  writeCache(CACHE_KEY, [config]);

  // Offline (or missing-table) saves previously looked like success while the
  // server never learned. Report device-only persistence so callers warn.
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

  const result = await state.supabase
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

  const message = result.error.message || '';
  if (/relation .*day_use_config|could not find .*day_use_config|schema cache/i.test(message)) {
    return deviceOnly('Day Use setup was saved here only; the server table is unavailable.');
  }
  throw new Error(message);
}
