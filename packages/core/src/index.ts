// Contracts
export * from "./contracts/index.js";

// Errors
export * from "./errors/index.js";

// Node abstractions
export { BaseNode, toSafeError } from "./node/BaseNode.js";
export { ToolNode } from "./node/ToolNode.js";
export { SkillNode } from "./node/SkillNode.js";

// Registry + engine
export { NodeRegistry } from "./registry/NodeRegistry.js";
export { InputResolver } from "./engine/InputResolver.js";
export { ChainEngine } from "./engine/ChainEngine.js";
export type { RunResult, StepProgressEvent } from "./engine/ChainEngine.js";
export { UsageAccumulator } from "./engine/UsageAccumulator.js";
export { LLMCallTrace } from "./engine/LLMCallTrace.js";

// Nodes
export { registerAll } from "./nodes/index.js";
export { ResumeDTOSchema, type ResumeDTO } from "./nodes/skills/resume.parse_fields.js";

// DI
export { buildEngine, type BuildEngineOptions, type EngineBundle } from "./di/buildEngine.js";

// Registry helpers
export { describeNode } from "./registry/describeNode.js";
export type { NodeCatalogEntry, NodeFieldDescriptor } from "./registry/describeNode.js";

// Infra (re-exported for use in apps/web — supabase dep lives in app, not core)
export { ConsoleLogger } from "./infra/logging/ConsoleLogger.js";
