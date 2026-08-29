// 统一错误模型（重构计划 R5 / spec §4.3）：
// 配置、取消、暂时性供应商错误、输出校验、持久化、内部不变量各自成类，
// 由 services/apiError 映射为语义化 HTTP 状态；不再全部伪装成 500。
// 兼容：现有 ConfigError（llm.ts）继承 ConfigurationError——instanceof 双向成立，公共行为不变。
export class ConfigurationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ConfigurationError'
  }
}

export class CancellationError extends Error {
  constructor(message = '操作已取消', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CancellationError'
  }
}

// 超时/限流/临时网络错误——允许 fallback 或限次重试（重试由调用方策略决定）
export class TransientProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TransientProviderError'
  }
}

// 空内容 / JSON 非法 / 截断 / 结构不完整——上游模型产出问题
export class OutputValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OutputValidationError'
  }
}

// 事务或数据库约束失败——不得继续后续阶段
export class PersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PersistenceError'
  }
}

// 状态或产物违反内部不变量——立即停止并保留诊断信息
export class InvariantError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'InvariantError'
  }
}
