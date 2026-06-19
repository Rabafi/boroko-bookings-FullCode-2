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

export async function saveDayUseConfig(data = {}) {
  if (!state.lodgeId) throw new Error('Choose a lodge profile on this computer before saving Day Use setup.');

  const config = normalizeConfig({
    lodge_id: state.lodgeId,
    templates: (data.templates || data.day_use_templates || []).map((template) => normalizeDayUseTemplate(template)),
    resources: (data.resources || data.day_use_resources || []).map((resource) => normalizeDayUseResource(resource)),
    updated_at: new Date().toISOString()
  });

  writeCache(CACHE_KEY, [config]);

  if (!state.isOnline) return config;

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
    return saved;
  }

  const message = result.error.message || '';
  if (/relation .*day_use_config|could not find .*day_use_config|schema cache/i.test(message)) {
    return config;
  }
  throw new Error(message);
}
