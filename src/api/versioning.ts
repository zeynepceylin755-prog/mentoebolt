export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

export interface VersionedRoute {
  version: string;
  path: string;
}
