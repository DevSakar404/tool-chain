import { ChainSchema, type Chain } from "../../contracts/dtos.js";
import type { IChainRepository } from "../../contracts/IRepositories.js";
import { ChainError } from "../../errors/index.js";
import type { SupabaseDb } from "./SupabaseTypes.js";

export class SupabaseChainRepository implements IChainRepository {
  constructor(private readonly db: SupabaseDb) {}

  async findById(id: string): Promise<Chain | null> {
    const { data, error } = await this.db
      .from("chains")
      .select("id, name, trigger_schema_name, steps, schema_version, created_at")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // not found
      throw new ChainError(`Chain lookup failed: ${error.message}`, "DB_ERROR");
    }
    if (!data) return null;

    const parsed = ChainSchema.safeParse({
      id: data["id"],
      name: data["name"],
      triggerSchemaName: data["trigger_schema_name"] ?? undefined,
      steps: data["steps"],
      schemaVersion: data["schema_version"],
    });

    if (!parsed.success) {
      throw new ChainError(`Chain ${id} failed schema validation`, "SCHEMA_VALIDATION_ERROR");
    }
    return parsed.data;
  }

  async save(chain: Chain): Promise<void> {
    const { error } = await this.db.from("chains").upsert({
      id: chain.id,
      name: chain.name,
      trigger_schema_name: chain.triggerSchemaName ?? null,
      steps: chain.steps,
      schema_version: chain.schemaVersion,
    });
    if (error) {
      throw new ChainError(`Chain save failed: ${error.message}`, "DB_ERROR");
    }
  }
}
