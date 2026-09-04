export interface WaveSpeedRequestProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: Record<string, unknown>;
  disabled?: boolean;
  "x-ui-component"?: string;
  [key: string]: unknown;
}

export interface WaveSpeedRequestSchema {
  type?: string;
  properties?: Record<string, WaveSpeedRequestProperty>;
  required?: string[];
  "x-order-properties"?: string[];
  [key: string]: unknown;
}

export interface WaveSpeedModel {
  modelId: string;
  name: string;
  description: string;
  type: string;
  basePrice?: number;
  requestSchema?: WaveSpeedRequestSchema;
}

export type WaveSpeedMediaFamily = "image" | "video";
