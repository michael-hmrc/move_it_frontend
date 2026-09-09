import { getActivity, type ActivityId, type Intensity } from "./activities.js";

export interface ConversionInput {
  displayName: string;
  activity: ActivityId;
  otherActivity?: string;
  intensity: Intensity;
  durationMinutes: number;
}

export interface ConversionResult extends ConversionInput {
  activityName: string;
  estimatedSteps: number;
}

export function convertActivityToSteps(input: ConversionInput): ConversionResult {
  const activity = getActivity(input.activity);
  const stepsPerMinute = activity.stepsPerMinute[input.intensity];

  return {
    ...input,
    activityName: input.activity === "other" && input.otherActivity
      ? input.otherActivity
      : activity.name,
    estimatedSteps: Math.round(input.durationMinutes * stepsPerMinute)
  };
}
