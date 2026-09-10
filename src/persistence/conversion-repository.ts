import { createClient } from "@supabase/supabase-js";
import { getActivity, isActivityId, type Intensity } from "../domain/activities.js";
import type { ConversionResult } from "../domain/conversion.js";

export interface ConversionRepository {
  save(result: ConversionResult, userId: string): Promise<void>;
  listMonthly(monthStart: string): Promise<ScoreboardEntry[]>;
  listForUser(userId: string): Promise<SubmittedActivity[]>;
  listForDisplayName(displayName: string): Promise<SubmittedActivity[]>;
  findUserProfile(displayName: string): Promise<UserProfile | undefined>;
}

export interface ScoreboardEntry {
  rank: number;
  displayName: string;
  totalSteps: number;
  activityCount: number;
}

export interface SubmittedActivity {
  id: string;
  activityName: string;
  intensity: Intensity;
  durationMinutes: number;
  estimatedSteps: number;
  createdAt: string;
}

export interface UserProfile {
  displayName: string;
  totalDurationMinutes: number;
  totalSteps: number;
  mostFrequentActivity?: string;
  team?: {
    id: string;
    name: string;
  };
}

class NoopConversionRepository implements ConversionRepository {
  async save(): Promise<void> {}

  async listMonthly(): Promise<ScoreboardEntry[]> {
    return [];
  }

  async listForUser(): Promise<SubmittedActivity[]> {
    return [];
  }

  async listForDisplayName(): Promise<SubmittedActivity[]> {
    return [];
  }

  async findUserProfile(): Promise<UserProfile | undefined> {
    return undefined;
  }
}

class SupabaseConversionRepository implements ConversionRepository {
  private readonly client;

  constructor(url: string, secretKey: string) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  async save(result: ConversionResult, userId: string): Promise<void> {
    const record = {
      user_id: userId,
      display_name: result.displayName,
      activity: result.activity,
      other_activity: result.otherActivity ?? null,
      intensity: result.intensity,
      duration_minutes: result.durationMinutes,
      estimated_steps: result.estimatedSteps
    };
    let { error } = await this.client.from("conversion_records").insert(record);

    // Keep submissions working while deployments roll out the optional
    // other_activity column. The existing activity column accepts free text.
    if (error?.message.includes("'other_activity' column")) {
      const { other_activity: _otherActivity, ...legacyRecord } = record;
      const fallback = await this.client.from("conversion_records").insert({
        ...legacyRecord,
        activity: result.otherActivity ?? result.activity
      });
      error = fallback.error;
    }

    if (error) {
      throw new Error(`Could not save conversion: ${error.message}`);
    }
  }

  async listMonthly(monthStart: string): Promise<ScoreboardEntry[]> {
    const { data, error } = await this.client.rpc("monthly_scoreboard", {
      requested_month: monthStart
    });

    if (error) {
      throw new Error(`Could not load scoreboard: ${error.message}`);
    }

    return (data ?? []).map((entry: Record<string, unknown>) => ({
      rank: Number(entry.rank),
      displayName: String(entry.display_name),
      totalSteps: Number(entry.total_steps),
      activityCount: Number(entry.activity_count)
    }));
  }

  async listForUser(userId: string): Promise<SubmittedActivity[]> {
    return this.listWhere("user_id", userId);
  }

  async listForDisplayName(displayName: string): Promise<SubmittedActivity[]> {
    return this.listWhere("display_name", displayName);
  }

  async findUserProfile(displayName: string): Promise<UserProfile | undefined> {
    const { data, error } = await this.client.rpc("move_it_user_profile", {
      requested_display_name: displayName
    });
    if (error) throw new Error(`Could not load user profile: ${error.message}`);

    const entry = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!entry) return undefined;

    const activity = typeof entry.most_frequent_activity === "string"
      ? entry.most_frequent_activity
      : undefined;
    const teamId = typeof entry.team_id === "string" ? entry.team_id : undefined;
    const teamName = typeof entry.team_name === "string" ? entry.team_name : undefined;

    return {
      displayName: String(entry.display_name),
      totalDurationMinutes: Number(entry.total_duration_minutes),
      totalSteps: Number(entry.total_steps),
      mostFrequentActivity: activity
        ? isActivityId(activity) ? getActivity(activity).name : activity
        : undefined,
      team: teamId && teamName ? { id: teamId, name: teamName } : undefined
    };
  }

  private async listWhere(
    field: "user_id" | "display_name",
    value: string
  ): Promise<SubmittedActivity[]> {
    const primary = await this.client
      .from("conversion_records")
      .select("id, activity, other_activity, intensity, duration_minutes, estimated_steps, created_at")
      .eq(field, value)
      .order("created_at", { ascending: false })
      .limit(50);
    let data = primary.data as Array<Record<string, unknown>> | null;
    let error = primary.error;

    if (error?.message.includes("'other_activity' column")) {
      const fallback = await this.client
        .from("conversion_records")
        .select("id, activity, intensity, duration_minutes, estimated_steps, created_at")
        .eq(field, value)
        .order("created_at", { ascending: false })
        .limit(50);
      data = fallback.data as Array<Record<string, unknown>> | null;
      error = fallback.error;
    }

    if (error) throw new Error(`Could not load submitted activities: ${error.message}`);

    return (data ?? []).map((entry: Record<string, unknown>) => {
      const activity = String(entry.activity);
      const configuredName = isActivityId(activity) ? getActivity(activity).name : activity;
      return {
        id: String(entry.id),
        activityName: typeof entry.other_activity === "string"
          ? entry.other_activity
          : configuredName,
        intensity: entry.intensity as Intensity,
        durationMinutes: Number(entry.duration_minutes),
        estimatedSteps: Number(entry.estimated_steps),
        createdAt: String(entry.created_at)
      };
    });
  }
}

export function createConversionRepository(
  environment: NodeJS.ProcessEnv = process.env
): ConversionRepository {
  const url = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    return new NoopConversionRepository();
  }

  return new SupabaseConversionRepository(url, secretKey);
}
