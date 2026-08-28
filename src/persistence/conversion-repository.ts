import { createClient } from "@supabase/supabase-js";
import type { ConversionResult } from "../domain/conversion.js";

export interface ConversionRepository {
  save(result: ConversionResult): Promise<void>;
  listMonthly(monthStart: string): Promise<ScoreboardEntry[]>;
}

export interface ScoreboardEntry {
  rank: number;
  displayName: string;
  totalSteps: number;
  activityCount: number;
}

class NoopConversionRepository implements ConversionRepository {
  async save(): Promise<void> {}

  async listMonthly(): Promise<ScoreboardEntry[]> {
    return [];
  }
}

class SupabaseConversionRepository implements ConversionRepository {
  private readonly client;

  constructor(url: string, secretKey: string) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  async save(result: ConversionResult): Promise<void> {
    const { error } = await this.client.from("conversion_records").insert({
      display_name: result.displayName,
      activity: result.activity,
      intensity: result.intensity,
      duration_minutes: result.durationMinutes,
      estimated_steps: result.estimatedSteps
    });

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
