import { tenantConfig as defaultConfig } from '@/tenants/default/config';
import defaultSources from '@/tenants/default/sources.json';

import { tenantConfig as baltazarConfig } from '@/tenants/baltazar/config';
import baltazarSources from '@/tenants/baltazar/sources.json';

import { tenantConfig as effectusConfig } from '@/tenants/effectus/config';
import effectusSources from '@/tenants/effectus/sources.json';

export const tenants = {
  default: {
    config: defaultConfig,
    sources: defaultSources,
  },
  baltazar: {
    config: baltazarConfig,
    sources: baltazarSources,
  },
  effectus: {
    config: effectusConfig,
    sources: effectusSources,
  },
};

export type TenantId = keyof typeof tenants;
