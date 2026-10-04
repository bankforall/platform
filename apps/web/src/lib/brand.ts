/**
 * User-visible product name, set at build time (VITE_APP_NAME / VITE_APP_SHORT_NAME). The name is
 * pending legal review ("Bank" may be restricted in Thailand); code identifiers keep "bankforall".
 */
export const DEFAULT_APP_NAME = "Bank For All";
export const APP_NAME = import.meta.env.VITE_APP_NAME?.trim() || DEFAULT_APP_NAME;
export const APP_SHORT_NAME = import.meta.env.VITE_APP_SHORT_NAME?.trim() || APP_NAME;
