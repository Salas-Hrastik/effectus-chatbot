import { tenants, type TenantId } from '@/tenants';

function getActiveTenantId(): TenantId {
  const tenantId = ((process.env.TENANT_ID || 'default').trim()) as TenantId;

  if (!tenants[tenantId]) {
    return 'default';
  }

  return tenantId;
}

export function getTenantConfig() {
  const tenantId = getActiveTenantId();
  return tenants[tenantId].config;
}

export function getTenantSources() {
  const tenantId = getActiveTenantId();
  return tenants[tenantId].sources;
}

export function getTenantId() {
  return getActiveTenantId();
}
