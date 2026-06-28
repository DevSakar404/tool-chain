export class ChainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ChainError";
  }
}

export class NodeNotFoundError extends ChainError {
  constructor(nodeId: string) {
    super(`Node not found: ${nodeId}`, "NODE_NOT_FOUND");
    this.name = "NodeNotFoundError";
  }
}

export class SchemaValidationError extends ChainError {
  constructor(
    context: string,
    public readonly issues: unknown[],
  ) {
    super(`Schema validation failed: ${context}`, "SCHEMA_VALIDATION_ERROR");
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

export class StepExecutionError extends ChainError {
  constructor(
    public readonly stepId: string,
    public readonly nodeId: string,
    cause: unknown,
  ) {
    super(`Step execution failed: stepId=${stepId} nodeId=${nodeId}`, "STEP_EXECUTION_ERROR", cause);
    this.name = "StepExecutionError";
  }
}
