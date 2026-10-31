import type { SubshellApi } from '@shared/api';

declare global {
  interface Window {
    subshell: SubshellApi;
  }
}

export {};
