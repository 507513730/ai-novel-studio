export const APP_VERSION = process.env.AI_NOVEL_APP_VERSION ?? '0.1.0'

export function isUtilityProcess(): boolean {
  return typeof process.parentPort !== 'undefined'
}
