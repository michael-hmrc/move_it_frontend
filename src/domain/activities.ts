export const activities = [
  {
    id: "cycling",
    name: "Cycling",
    stepsPerMinute: { light: 100, moderate: 150, vigorous: 200 }
  },
  {
    id: "swimming",
    name: "Swimming",
    stepsPerMinute: { light: 110, moderate: 160, vigorous: 210 }
  },
  {
    id: "rowing",
    name: "Rowing",
    stepsPerMinute: { light: 100, moderate: 150, vigorous: 200 }
  },
  {
    id: "yoga",
    name: "Yoga",
    stepsPerMinute: { light: 50, moderate: 75, vigorous: 100 }
  }
] as const;

export const intensities = ["light", "moderate", "vigorous"] as const;

export type ActivityId = (typeof activities)[number]["id"];
export type Intensity = (typeof intensities)[number];

export function isActivityId(value: string): value is ActivityId {
  return activities.some((activity) => activity.id === value);
}

export function isIntensity(value: string): value is Intensity {
  return intensities.includes(value as Intensity);
}

export function getActivity(id: ActivityId) {
  return activities.find((activity) => activity.id === id)!;
}
