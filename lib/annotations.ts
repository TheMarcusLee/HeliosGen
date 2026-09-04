export type AnnotationTool = "rectangle" | "ellipse" | "arrow" | "freehand" | "text";

export interface AnnotationShape {
  id: string;
  tool: AnnotationTool;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
  text?: string;
}

export function annotationBounds(points: AnnotationShape["points"]): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function annotationPath(points: AnnotationShape["points"]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}
