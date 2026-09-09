import { createClient } from "@supabase/supabase-js";

export interface TeamMember {
  id: string;
  displayName: string;
}

export interface TeamInvitation {
  id: string;
  teamName: string;
}

export interface PendingTeamInvitation {
  id: string;
  displayName: string;
}

export interface TeamOverview {
  team?: {
    id: string;
    name: string;
    members: TeamMember[];
    pendingInvitations: PendingTeamInvitation[];
  };
  invitations: TeamInvitation[];
}

export interface TeamListItem {
  id: string;
  name: string;
  memberCount: number;
}

export interface TeamDetails {
  id: string;
  name: string;
  members: TeamMember[];
}

export interface TeamRepository {
  getOverview(userId: string): Promise<TeamOverview>;
  listAll(): Promise<TeamListItem[]>;
  findById(teamId: string): Promise<TeamDetails | undefined>;
  create(userId: string, name: string): Promise<void>;
  invite(userId: string, displayName: string): Promise<void>;
  respondToInvitation(userId: string, invitationId: string, accept: boolean): Promise<void>;
  leave(userId: string): Promise<void>;
  disband(userId: string): Promise<void>;
}

export class TeamOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamOperationError";
  }
}

class NoopTeamRepository implements TeamRepository {
  async getOverview(): Promise<TeamOverview> { return { invitations: [] }; }
  async listAll(): Promise<TeamListItem[]> { return []; }
  async findById(): Promise<TeamDetails | undefined> { return undefined; }
  async create(): Promise<void> { throw new TeamOperationError("Teams are not configured"); }
  async invite(): Promise<void> { throw new TeamOperationError("Teams are not configured"); }
  async respondToInvitation(): Promise<void> { throw new TeamOperationError("Teams are not configured"); }
  async leave(): Promise<void> { throw new TeamOperationError("Teams are not configured"); }
  async disband(): Promise<void> { throw new TeamOperationError("Teams are not configured"); }
}

class SupabaseTeamRepository implements TeamRepository {
  private readonly client;

  constructor(url: string, secretKey: string) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  async getOverview(userId: string): Promise<TeamOverview> {
    const membership = await this.client
      .from("team_members")
      .select("team_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (membership.error) throw new Error(`Could not load team: ${membership.error.message}`);

    const incoming = await this.client
      .from("team_invitations")
      .select("id, team_id")
      .eq("invited_user_id", userId);
    if (incoming.error) throw new Error(`Could not load team invitations: ${incoming.error.message}`);

    const incomingRows = (incoming.data ?? []) as Array<{ id: string; team_id: string }>;
    const incomingTeams = await this.loadTeams(incomingRows.map(({ team_id }) => team_id));
    const invitations = incomingRows.map((invitation) => ({
      id: invitation.id,
      teamName: incomingTeams.get(invitation.team_id) ?? "Team"
    }));

    const teamId = membership.data?.team_id as string | undefined;
    if (!teamId) return { invitations };

    const teamResponse = await this.client.from("teams").select("id, name").eq("id", teamId).single();
    if (teamResponse.error) throw new Error(`Could not load team: ${teamResponse.error.message}`);

    const membersResponse = await this.client
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .order("joined_at", { ascending: true });
    if (membersResponse.error) throw new Error(`Could not load team members: ${membersResponse.error.message}`);

    const pendingResponse = await this.client
      .from("team_invitations")
      .select("id, invited_user_id")
      .eq("team_id", teamId)
      .order("created_at", { ascending: true });
    if (pendingResponse.error) throw new Error(`Could not load team invitations: ${pendingResponse.error.message}`);

    const memberRows = (membersResponse.data ?? []) as Array<{ user_id: string }>;
    const pendingRows = (pendingResponse.data ?? []) as Array<{ id: string; invited_user_id: string }>;
    const profiles = await this.loadProfiles([
      ...memberRows.map(({ user_id }) => user_id),
      ...pendingRows.map(({ invited_user_id }) => invited_user_id)
    ]);

    return {
      team: {
        id: String(teamResponse.data.id),
        name: String(teamResponse.data.name),
        members: memberRows.map(({ user_id }) => ({
          id: user_id,
          displayName: profiles.get(user_id) ?? "Member"
        })),
        pendingInvitations: pendingRows.map(({ id, invited_user_id }) => ({
          id,
          displayName: profiles.get(invited_user_id) ?? "Invited user"
        }))
      },
      invitations
    };
  }

  async listAll(): Promise<TeamListItem[]> {
    const teamsResponse = await this.client
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true });
    if (teamsResponse.error) throw new Error(`Could not load teams: ${teamsResponse.error.message}`);

    const membersResponse = await this.client.from("team_members").select("team_id");
    if (membersResponse.error) {
      throw new Error(`Could not load team member counts: ${membersResponse.error.message}`);
    }

    const counts = new Map<string, number>();
    for (const member of membersResponse.data ?? []) {
      const teamId = String(member.team_id);
      counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
    }

    return (teamsResponse.data ?? []).map((team) => ({
      id: String(team.id),
      name: String(team.name),
      memberCount: counts.get(String(team.id)) ?? 0
    }));
  }

  async findById(teamId: string): Promise<TeamDetails | undefined> {
    const teamResponse = await this.client
      .from("teams")
      .select("id, name")
      .eq("id", teamId)
      .maybeSingle();
    if (teamResponse.error) throw new Error(`Could not load team: ${teamResponse.error.message}`);
    if (!teamResponse.data) return undefined;

    const membersResponse = await this.client
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .order("joined_at", { ascending: true });
    if (membersResponse.error) throw new Error(`Could not load team members: ${membersResponse.error.message}`);

    const memberRows = (membersResponse.data ?? []) as Array<{ user_id: string }>;
    const profiles = await this.loadProfiles(memberRows.map(({ user_id }) => user_id));

    return {
      id: String(teamResponse.data.id),
      name: String(teamResponse.data.name),
      members: memberRows.map(({ user_id }) => ({
        id: user_id,
        displayName: profiles.get(user_id) ?? "Member"
      }))
    };
  }

  async create(userId: string, name: string): Promise<void> {
    await this.call("create_move_it_team", { requesting_user_id: userId, requested_name: name });
  }

  async invite(userId: string, displayName: string): Promise<void> {
    await this.call("invite_move_it_team_member", {
      requesting_user_id: userId,
      requested_display_name: displayName
    });
  }

  async respondToInvitation(userId: string, invitationId: string, accept: boolean): Promise<void> {
    await this.call("respond_to_move_it_team_invitation", {
      requesting_user_id: userId,
      requested_invitation_id: invitationId,
      accept_invitation: accept
    });
  }

  async leave(userId: string): Promise<void> {
    await this.call("leave_move_it_team", { requesting_user_id: userId });
  }

  async disband(userId: string): Promise<void> {
    await this.call("disband_move_it_team", { requesting_user_id: userId });
  }

  private async call(functionName: string, parameters: Record<string, unknown>) {
    const { error } = await this.client.rpc(functionName, parameters);
    if (!error) return;

    const messages = [
      "Choose a different team name",
      "You are already in a team",
      "You must be in a team to invite someone",
      "This team already has 5 members or pending invitations",
      "This team already has 5 members",
      "Enter the display name of an approved user",
      "You are already in this team",
      "This user is already in a team",
      "This user already has a pending team invitation",
      "This team invitation is no longer available",
      "You are not in a team"
    ];
    const safeMessage = messages.find((message) => error.message.includes(message));
    throw new TeamOperationError(safeMessage ?? "Could not update the team. Try again.");
  }

  private async loadTeams(ids: string[]) {
    const teams = new Map<string, string>();
    if (ids.length === 0) return teams;
    const response = await this.client.from("teams").select("id, name").in("id", ids);
    if (response.error) throw new Error(`Could not load teams: ${response.error.message}`);
    for (const team of response.data ?? []) teams.set(String(team.id), String(team.name));
    return teams;
  }

  private async loadProfiles(ids: string[]) {
    const profiles = new Map<string, string>();
    if (ids.length === 0) return profiles;
    const response = await this.client.from("app_users").select("id, display_name").in("id", ids);
    if (response.error) throw new Error(`Could not load team members: ${response.error.message}`);
    for (const profile of response.data ?? []) {
      profiles.set(String(profile.id), String(profile.display_name));
    }
    return profiles;
  }
}

export function createTeamRepository(environment: NodeJS.ProcessEnv = process.env): TeamRepository {
  const url = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;
  return url && secretKey ? new SupabaseTeamRepository(url, secretKey) : new NoopTeamRepository();
}
