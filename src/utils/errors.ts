/**
 * BSP 自定义错误体系
 *
 * 所有协议违规、校验失败、状态转换错误均使用这些错误类
 */

/** 协议基础错误 */
export class BSPError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        name: this.name,
      },
    };
  }
}

/** 协议违规错误 — 违反 BSP 协议约束 */
export class ProtocolViolationError extends BSPError {
  constructor(message: string) {
    super(message, 'PROTOCOL_VIOLATION', 400);
  }
}

/** 校验错误 — 字段缺失、类型错误、枚举值非法 */
export class ValidationError extends BSPError {
  constructor(
    message: string,
    public fields?: string[],
  ) {
    super(message, 'VALIDATION_ERROR', 422);
  }
}

/** 状态转换错误 — 非法状态流转 */
export class StateTransitionError extends BSPError {
  constructor(
    message: string,
    public fromState?: string,
    public toState?: string,
  ) {
    super(message, 'STATE_TRANSITION_ERROR', 409);
  }
}

/** 不可变性错误 — 尝试修改不可变字段 */
export class ImmutabilityError extends BSPError {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message, 'IMMUTABILITY_ERROR', 409);
  }
}

/** 未找到错误 */
export class NotFoundError extends BSPError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
  }
}

/** 禁止操作错误 — 物理删除等 */
export class ForbiddenError extends BSPError {
  constructor(message: string) {
    super(message, 'FORBIDDEN', 403);
  }
}
