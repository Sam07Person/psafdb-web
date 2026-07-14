import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireImportAuth } from "@/lib/importAuth";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function requireAuth(req: NextRequest) {
  const adminPassword = req.headers.get("x-admin-password");
  if (!process.env.ADMIN_IMPORT_PASSWORD) {
    return { ok: false as const, error: "Server configuration error" };
  }
  if (adminPassword !== process.env.ADMIN_IMPORT_PASSWORD) {
    return { ok: false as const, error: "Invalid admin password" };
  }

  const expected = process.env.ADMIN_IMPORT_TOKEN;
  if (!expected) return { ok: false as const, error: "Server configuration error" };

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return { ok: false as const, error: "Invalid token" };

  return { ok: true as const };
}

// GET - List all teams with their leagues
export async function GET(req: NextRequest) {
  // Staff (match-import) may read teams for name matching; mutations stay admin-only.
  const auth = requireImportAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  // Get teams with their primary league
  const { data: teamsData, error: teamsError } = await supabaseAdmin
    .from("teams")
    .select(`
      id,
      name,
      league_id,
      no_elo,
      disbanded,
      created_at,
      league:leagues!teams_league_id_fkey(id, name, season)
    `)
    .order("name", { ascending: true });

  if (teamsError) {
    console.error("Error fetching teams:", teamsError);
    return json(500, { error: teamsError.message });
  }

  // Get all team_leagues relationships
  const { data: teamLeaguesData } = await supabaseAdmin
    .from("team_leagues")
    .select(`
      team_id,
      league_id,
      group_name,
      league:leagues(id, name, season)
    `);

  // Build a map of team_id -> leagues
  const teamLeaguesMap: Record<string, any[]> = {};
  // Build a map of team_id -> { league_id -> group_name }
  const teamGroupMap: Record<string, Record<string, string | null>> = {};
  for (const tl of teamLeaguesData || []) {
    if (!teamLeaguesMap[tl.team_id]) teamLeaguesMap[tl.team_id] = [];
    if (!teamGroupMap[tl.team_id]) teamGroupMap[tl.team_id] = {};
    const league = Array.isArray(tl.league) ? tl.league[0] : tl.league;
    if (league) {
      teamLeaguesMap[tl.team_id].push(league);
      teamGroupMap[tl.team_id][tl.league_id] = tl.group_name ?? null;
    }
  }

  // Combine teams with their leagues
  const teams = (teamsData || []).map((t: any) => {
    const primaryLeague = Array.isArray(t.league) ? t.league[0] : t.league;
    const additionalLeagues = teamLeaguesMap[t.id] || [];
    
    // Combine primary league with additional leagues, removing duplicates
    const allLeagues = primaryLeague 
      ? [primaryLeague, ...additionalLeagues.filter(l => l.id !== primaryLeague.id)]
      : additionalLeagues;

    return {
      ...t,
      league: primaryLeague,
      leagues: allLeagues,
      league_ids: allLeagues.map((l: any) => l.id),
      group_assignments: teamGroupMap[t.id] ?? {},
    };
  });

  return json(200, { teams });
}

// POST - Create a new team
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const body = await req.json();
    const { name, league_id, league_ids, no_elo, group_assignments } = body;

    if (!name) {
      return json(400, { error: "Team name is required" });
    }

    // Use first league_id as primary, or from league_ids array
    const primaryLeagueId = league_id || (league_ids && league_ids[0]) || null;

    const { data: team, error } = await supabaseAdmin
      .from("teams")
      .insert({ name, league_id: primaryLeagueId, no_elo: no_elo ?? false })
      .select()
      .single();

    if (error) {
      return json(500, { error: error.message });
    }

    // Add to team_leagues junction table for all leagues
    const leaguesToAdd = league_ids || (league_id ? [league_id] : []);
    if (leaguesToAdd.length > 0) {
      const teamLeagueInserts = leaguesToAdd.map((lid: string) => ({
        team_id: team.id,
        league_id: lid,
        group_name: (group_assignments as Record<string, string> | undefined)?.[lid] || null,
      }));

      await supabaseAdmin
        .from("team_leagues")
        .upsert(teamLeagueInserts, { onConflict: "team_id,league_id" });
    }

    return json(201, { team });
  } catch (err: any) {
    return json(500, { error: err.message });
  }
}

// PUT - Update a team
export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const body = await req.json();
    const { id, name, league_id, league_ids, no_elo, group_assignments } = body;

    if (!id) {
      return json(400, { error: "Team ID is required" });
    }

    // Use first league_id as primary
    const primaryLeagueId = league_id || (league_ids && league_ids[0]) || null;

    const disbanded = body.disbanded ?? false;

    // Fetch the team's current state to detect disband toggle
    const { data: oldTeam } = await supabaseAdmin
      .from("teams").select("name,disbanded").eq("id", id).single();

    const { data: team, error } = await supabaseAdmin
      .from("teams")
      .update({ name, league_id: primaryLeagueId, no_elo: no_elo ?? false, disbanded })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return json(500, { error: error.message });
    }

    // Handle disband/undisband score changes
    const disbandChanged = oldTeam && (!!oldTeam.disbanded !== !!disbanded);
    let disbandResults: { forfeited: number; restored: number } | null = null;

    // Even if disband didn't change, if the team IS disbanded, fix any matches
    // against other disbanded teams that still have single-team forfeits
    if (!disbandChanged && disbanded && oldTeam) {
      const teamName = oldTeam.name;
      const { data: endedLeagues } = await supabaseAdmin
        .from("leagues").select("id").eq("ended", true);
      const endedIds = new Set((endedLeagues || []).map((l: any) => l.id));

      const { data: disbandedTeams } = await supabaseAdmin
        .from("teams").select("name").eq("disbanded", true);
      const disbandedNames = new Set((disbandedTeams || []).map((t: any) => t.name));

      const { data: homeMatches } = await supabaseAdmin
        .from("matches").select("id,home_team,away_team,home_score,away_score,league_id,forfeited_by")
        .eq("home_team", teamName);
      const { data: awayMatches } = await supabaseAdmin
        .from("matches").select("id,home_team,away_team,home_score,away_score,league_id,forfeited_by")
        .eq("away_team", teamName);

      const allMatches = [...(homeMatches || []), ...(awayMatches || [])];
      let fixed = 0;

      for (const m of allMatches) {
        if (!m.league_id || endedIds.has(m.league_id)) continue;
        const opponent = m.home_team === teamName ? m.away_team : m.home_team;
        // If opponent is disbanded but match isn't "both", fix it
        if (disbandedNames.has(opponent) && m.forfeited_by !== "both") {
          await supabaseAdmin.from("matches").update({
            home_score: 0,
            away_score: 0,
            forfeited_by: "both",
          }).eq("id", m.id);
          fixed++;
        }
      }

      if (fixed > 0) {
        disbandResults = { forfeited: fixed, restored: 0 };
      }
    }

    if (disbandChanged && oldTeam) {
      const teamName = oldTeam.name;

      // Get all non-ended leagues this team participates in
      const { data: endedLeagues } = await supabaseAdmin
        .from("leagues").select("id").eq("ended", true);
      const endedIds = new Set((endedLeagues || []).map((l: any) => l.id));

      // Get all matches involving this team
      const { data: homeMatches } = await supabaseAdmin
        .from("matches").select("id,home_team,away_team,home_score,away_score,league_id,forfeited_by")
        .eq("home_team", teamName);
      const { data: awayMatches } = await supabaseAdmin
        .from("matches").select("id,home_team,away_team,home_score,away_score,league_id,forfeited_by")
        .eq("away_team", teamName);

      const allMatches = [...(homeMatches || []), ...(awayMatches || [])];
      let forfeited = 0, restored = 0;

      if (disbanded) {
        // Backup original scores before overwriting, so undisband can restore them
        const backup: { match_id: string; home_score: number | null; away_score: number | null; forfeited_by: string | null }[] = [];

        // Get all disbanded teams to detect double-forfeit scenarios
        const { data: disbandedTeams } = await supabaseAdmin
          .from("teams").select("name").eq("disbanded", true);
        const disbandedNames = new Set((disbandedTeams || []).map((t: any) => t.name));
        disbandedNames.add(teamName); // Include the team being disbanded now

        // Disband: set all existing matches in non-ended leagues to 3-0 forfeit
        for (const m of allMatches) {
          if (!m.league_id || endedIds.has(m.league_id)) continue;
          const isHome = m.home_team === teamName;
          const opponent = isHome ? m.away_team : m.home_team;

          backup.push({ match_id: m.id, home_score: m.home_score, away_score: m.away_score, forfeited_by: m.forfeited_by });

          // Check if opponent is also disbanded — double forfeit
          if (disbandedNames.has(opponent)) {
            await supabaseAdmin.from("matches").update({
              home_score: 0,
              away_score: 0,
              forfeited_by: "both",
            }).eq("id", m.id);
          } else {
            const newHomeScore = isHome ? 0 : 3;
            const newAwayScore = isHome ? 3 : 0;
            const forfeitSide = isHome ? "home" : "away";
            await supabaseAdmin.from("matches").update({
              home_score: newHomeScore,
              away_score: newAwayScore,
              forfeited_by: forfeitSide,
            }).eq("id", m.id);
          }
          forfeited++;
        }

        // Create missing fixtures for league-format leagues:
        // Find all opponents in each active league that don't have a fixture yet
        const { data: teamLeaguesData } = await supabaseAdmin
          .from("team_leagues").select("league_id").eq("team_id", id);
        const teamLeagueIds = (teamLeaguesData || []).map((tl: any) => tl.league_id);

        const { data: activeLeagues } = await supabaseAdmin
          .from("leagues").select("id,format")
          .in("id", teamLeagueIds.length > 0 ? teamLeagueIds : ["__none__"])
          .eq("ended", false);

        for (const league of activeLeagues || []) {
          if (league.format !== "league") continue;

          // Get all teams in this league
          const { data: leagueTeams } = await supabaseAdmin
            .from("team_leagues").select("team_id,teams(name)")
            .eq("league_id", league.id);

          const otherTeams = (leagueTeams || [])
            .filter((lt: any) => lt.team_id !== id)
            .map((lt: any) => {
              const t = Array.isArray(lt.teams) ? lt.teams[0] : lt.teams;
              return t?.name;
            })
            .filter(Boolean) as string[];

          // Find which opponents already have a fixture
          const playedOpponents = new Set<string>();
          for (const m of allMatches) {
            if (m.league_id !== league.id) continue;
            const opp = m.home_team === teamName ? m.away_team : m.home_team;
            playedOpponents.add(opp);
          }

          // Create missing fixtures as forfeit (double forfeit if opponent also disbanded)
          const now = new Date().toISOString();
          for (const opp of otherTeams) {
            if (playedOpponents.has(opp)) continue;
            const isDoubleForfeit = disbandedNames.has(opp);
            await supabaseAdmin.from("matches").insert({
              home_team: teamName,
              away_team: opp,
              home_score: isDoubleForfeit ? 0 : 0,
              away_score: isDoubleForfeit ? 0 : 3,
              forfeited_by: isDoubleForfeit ? "both" : "home",
              league_id: league.id,
              played_at: now,
            });
            forfeited++;
          }
        }

        // Save backup so undisband can restore original scores
        await supabaseAdmin.from("teams").update({ disband_backup: backup }).eq("id", id);
      } else {
        // Undisband: restore original scores from backup, delete auto-created fixtures
        let backupMap = new Map<string, { home_score: number | null; away_score: number | null; forfeited_by: string | null }>();
        try {
          const { data: teamWithBackup } = await supabaseAdmin
            .from("teams").select("disband_backup").eq("id", id).single();
          const backupList = (teamWithBackup?.disband_backup as any[]) || [];
          backupMap = new Map(backupList.map((b: any) => [b.match_id, b]));
        } catch { /* disband_backup column may not exist yet */ }

        for (const m of allMatches) {
          if (!m.league_id || endedIds.has(m.league_id)) continue;
          const isHome = m.home_team === teamName;
          const expectedForfeit = isHome ? "home" : "away";
          // Match must be forfeited by this team's side, or be a double forfeit
          if (m.forfeited_by !== expectedForfeit && m.forfeited_by !== "both") continue;

          const original = backupMap.get(m.id);
          if (original) {
            // Restore to original score from backup
            await supabaseAdmin.from("matches").update({
              home_score: original.home_score,
              away_score: original.away_score,
              forfeited_by: original.forfeited_by,
            }).eq("id", m.id);
            restored++;
          } else {
            // No backup entry — check if match has player stats (real match vs auto-created)
            const { data: stats } = await supabaseAdmin
              .from("match_player_stats").select("match_id").eq("match_id", m.id).limit(1);
            if (stats && stats.length > 0) {
              // Real match with stats — restore to null so admin can re-enter correct score
              await supabaseAdmin.from("matches").update({
                home_score: null,
                away_score: null,
                forfeited_by: null,
              }).eq("id", m.id);
            } else {
              // Auto-created fixture with no stats — delete it
              await supabaseAdmin.from("matches").delete().eq("id", m.id);
            }
            restored++;
          }
        }

        // Clear backup if column exists
        try {
          await supabaseAdmin.from("teams").update({ disband_backup: null }).eq("id", id);
        } catch { /* column may not exist */ }
      }

      disbandResults = { forfeited, restored };
    }

    // Update team_leagues: delete old, insert new
    if (league_ids !== undefined) {
      // Delete existing relationships
      await supabaseAdmin
        .from("team_leagues")
        .delete()
        .eq("team_id", id);

      // Insert new relationships
      if (league_ids.length > 0) {
        const teamLeagueInserts = league_ids.map((lid: string) => ({
          team_id: id,
          league_id: lid,
          group_name: (group_assignments as Record<string, string> | undefined)?.[lid] || null,
        }));

        await supabaseAdmin
          .from("team_leagues")
          .insert(teamLeagueInserts);
      }
    }

    // Cascade a name change onto historical matches. The matches table stores
    // team names as plain strings (home_team/away_team), so renaming a team must
    // also rewrite those strings — otherwise games played under the old name keep
    // it and appear as a separate phantom row in the league standings.
    let matchesRenamed = 0;
    if (oldTeam && name && oldTeam.name !== name) {
      const { count: homeCount } = await supabaseAdmin
        .from("matches")
        .update({ home_team: name }, { count: "exact" })
        .eq("home_team", oldTeam.name);
      const { count: awayCount } = await supabaseAdmin
        .from("matches")
        .update({ away_team: name }, { count: "exact" })
        .eq("away_team", oldTeam.name);
      matchesRenamed = (homeCount || 0) + (awayCount || 0);
    }

    return json(200, { team, disbandResults, matchesRenamed });
  } catch (err: any) {
    return json(500, { error: err.message });
  }
}

// PATCH - Merge two teams (source -> target)
export async function PATCH(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { sourceId, targetId } = body;
  if (!sourceId || !targetId) return json(400, { error: "sourceId and targetId are required" });
  if (sourceId === targetId) return json(400, { error: "Source and target teams must be different" });

  // Fetch both teams
  const { data: sourceTeam, error: sourceError } = await supabaseAdmin
    .from("teams").select("id,name").eq("id", sourceId).single();
  if (sourceError || !sourceTeam) return json(404, { error: "Source team not found" });

  const { data: targetTeam, error: targetError } = await supabaseAdmin
    .from("teams").select("id,name").eq("id", targetId).single();
  if (targetError || !targetTeam) return json(404, { error: "Target team not found" });

  const sourceName = sourceTeam.name;
  const targetName = targetTeam.name;
  let updatedMatches = 0;

  // Update matches where source team is home_team
  const { data: homeMatches } = await supabaseAdmin
    .from("matches").select("id").eq("home_team", sourceName);
  if (homeMatches && homeMatches.length > 0) {
    const { error } = await supabaseAdmin
      .from("matches").update({ home_team: targetName }).eq("home_team", sourceName);
    if (error) return json(500, { error: `Failed to update home matches: ${error.message}` });
    updatedMatches += homeMatches.length;
  }

  // Update matches where source team is away_team
  const { data: awayMatches } = await supabaseAdmin
    .from("matches").select("id").eq("away_team", sourceName);
  if (awayMatches && awayMatches.length > 0) {
    const { error } = await supabaseAdmin
      .from("matches").update({ away_team: targetName }).eq("away_team", sourceName);
    if (error) return json(500, { error: `Failed to update away matches: ${error.message}` });
    updatedMatches += awayMatches.length;
  }

  // Update match_team_stats team_name references
  await supabaseAdmin
    .from("match_team_stats").update({ team_name: targetName }).eq("team_name", sourceName);

  // Transfer team_leagues from source to target (skip duplicates)
  const { data: sourceLeagues } = await supabaseAdmin
    .from("team_leagues").select("league_id").eq("team_id", sourceId);
  const { data: targetLeagues } = await supabaseAdmin
    .from("team_leagues").select("league_id").eq("team_id", targetId);

  const targetLeagueIds = new Set((targetLeagues || []).map((tl: any) => tl.league_id));
  const newLeagues = (sourceLeagues || []).filter((sl: any) => !targetLeagueIds.has(sl.league_id));

  if (newLeagues.length > 0) {
    await supabaseAdmin.from("team_leagues").insert(
      newLeagues.map((sl: any) => ({ team_id: targetId, league_id: sl.league_id }))
    );
  }

  // Delete source team (team_leagues cascade)
  const { error: deleteError } = await supabaseAdmin
    .from("teams").delete().eq("id", sourceId);
  if (deleteError) return json(500, { error: `Failed to delete source team: ${deleteError.message}` });

  return json(200, {
    ok: true,
    updatedMatches,
    message: `Successfully merged "${sourceName}" into "${targetName}". ${updatedMatches} match(es) updated.`,
  });
}

// DELETE - Delete a team
export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return json(400, { error: "Team ID is required" });
    }

    // team_leagues will be deleted automatically due to CASCADE
    const { error } = await supabaseAdmin
      .from("teams")
      .delete()
      .eq("id", id);

    if (error) {
      return json(500, { error: error.message });
    }

    return json(200, { success: true });
  } catch (err: any) {
    return json(500, { error: err.message });
  }
}