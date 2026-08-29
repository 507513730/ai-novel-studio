// LLM 域错误（重构计划 R6.2 / spec §4.3）：
// ConfigError 兼容映射（R5）——即 ConfigurationError，instanceof 双向成立。
import { ConfigurationError } from '../shared/errors'

export class ConfigError extends ConfigurationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ConfigError'
  }
}
