import type { INode } from "../contracts/INode.js";
import { NodeNotFoundError } from "../errors/index.js";

export class NodeRegistry {
  private readonly nodes = new Map<string, INode>();

  register(node: INode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node already registered: ${node.id}`);
    }
    this.nodes.set(node.id, node);
  }

  get(id: string): INode {
    const node = this.nodes.get(id);
    if (!node) throw new NodeNotFoundError(id);
    return node;
  }

  list(): INode[] {
    return Array.from(this.nodes.values());
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }
}
