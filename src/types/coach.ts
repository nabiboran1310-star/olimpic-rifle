export type CoachMessageType = "telemetry" | "tactical" | "warning" | "success";

export interface CoachMessage {
  id: string;
  text: string;
  type: CoachMessageType;
  timestamp: number;
}

export interface CoachShotTelemetry {
  id: number;
  score: number;
  deltaX: number;
  deltaY: number;
  clickX: number;
  clickY: number;
  isSightingMode: boolean;
  holdBreathTime: number;
  levelId: number | null;
}

export type TelemetryFeedbackInput = Omit<CoachShotTelemetry, "id"> & {
  id?: number;
  recentMessages?: readonly string[];
};
