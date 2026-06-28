export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 100;
export const CARD_H_GAP = 120;
export const TRIGGER_WIDTH = 140;
export const TRIGGER_HEIGHT = 80;
export const CANVAS_PADDING = 60;
export const NODE_Y = CANVAS_PADDING;

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

export function computeLayout(stepIds: string[]): NodeLayout[] {
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

  for (let i = 0; i < stepIds.length; i++) {
    const x =
      CANVAS_PADDING + TRIGGER_WIDTH + CARD_H_GAP + i * (CARD_WIDTH + CARD_H_GAP);
    const y = NODE_Y;
    layouts.push({
      id: stepIds[i]!,
      x,
      y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      outputPort: { x: x + CARD_WIDTH, y: y + CARD_HEIGHT / 2 },
      inputPort: { x, y: y + CARD_HEIGHT / 2 },
    });
  }

  return layouts;
}
