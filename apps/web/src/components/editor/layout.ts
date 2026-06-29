import type { Step, NodeCatalogEntry } from "@tool-chain/core";

export const CARD_WIDTH = 220;
export const CARD_H_GAP = 120;
export const TRIGGER_WIDTH = 140;
export const TRIGGER_HEIGHT = 80;
export const CANVAS_PADDING = 60;
export const NODE_Y = CANVAS_PADDING;
export const CARD_HEADER_HEIGHT = 48;
export const FIELD_ROW_HEIGHT = 28;
export const CARD_PADDING_BOTTOM = 8;

export interface PortPosition {
  x: number;
  y: number;
}

export interface NodeLayout {
  id: string; // "trigger" | stepId
  x: number;
  y: number;
  width: number;
  height: number;
  outputPort: PortPosition;
  inputPort: PortPosition;
}

export function getCardHeight(fieldsCount: number): number {
  return Math.max(80, CARD_HEADER_HEIGHT + fieldsCount * FIELD_ROW_HEIGHT + CARD_PADDING_BOTTOM);
}

export function computeLayout(steps: Step[], catalog: NodeCatalogEntry[]): NodeLayout[] {
  const layouts: NodeLayout[] = [];

  const triggerX = CANVAS_PADDING;
  const triggerY = NODE_Y;
  layouts.push({
    id: "trigger",
    x: triggerX,
    y: triggerY,
    width: TRIGGER_WIDTH,
    height: TRIGGER_HEIGHT,
    outputPort: { x: triggerX + TRIGGER_WIDTH, y: triggerY + TRIGGER_HEIGHT / 2 },
    inputPort: { x: triggerX, y: triggerY + TRIGGER_HEIGHT / 2 },
  });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const catalogEntry = catalog.find((c) => c.id === step.nodeId);
    const fieldsCount = catalogEntry?.inputFields.length ?? 0;
    const height = getCardHeight(fieldsCount);

    const x =
      CANVAS_PADDING + TRIGGER_WIDTH + CARD_H_GAP + i * (CARD_WIDTH + CARD_H_GAP);
    const y = NODE_Y;
    layouts.push({
      id: step.stepId,
      x,
      y,
      width: CARD_WIDTH,
      height,
      outputPort: { x: x + CARD_WIDTH, y: y + height / 2 },
      inputPort: { x, y: y + height / 2 },
    });
  }

  return layouts;
}
