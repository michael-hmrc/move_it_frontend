export const activities = [
  {
    id: "badminton",
    name: "Badminton",
    stepsPerMinute: { light: 90, moderate: 135, vigorous: 180 }
  },
  {
    id: "cycling",
    name: "Cycling",
    stepsPerMinute: { light: 100, moderate: 150, vigorous: 200 }
  },
  {
    id: "dancing",
    name: "Dancing",
    stepsPerMinute: { light: 70, moderate: 110, vigorous: 160 }
  },
  {
    id: "football",
    name: "Football",
    stepsPerMinute: { light: 100, moderate: 150, vigorous: 200 }
  },
  {
    id: "hiking",
    name: "Hiking",
    stepsPerMinute: { light: 90, moderate: 130, vigorous: 170 }
  },
  {
    id: "rowing",
    name: "Rowing",
    stepsPerMinute: { light: 100, moderate: 150, vigorous: 200 }
  },
  {
    id: "running",
    name: "Running",
    stepsPerMinute: { light: 130, moderate: 180, vigorous: 230 }
  },
  {
    id: "strength-training",
    name: "Strength training",
    stepsPerMinute: { light: 50, moderate: 80, vigorous: 120 }
  },
  {
    id: "swimming",
    name: "Swimming",
    stepsPerMinute: { light: 110, moderate: 160, vigorous: 210 }
  },
  {
    id: "tennis",
    name: "Tennis",
    stepsPerMinute: { light: 90, moderate: 140, vigorous: 190 }
  },
  {
    id: "walking",
    name: "Walking",
    stepsPerMinute: { light: 80, moderate: 110, vigorous: 140 }
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
