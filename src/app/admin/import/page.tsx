"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

type League = {
  id: string;
  name: string;
  season: string | null;
  format: string | null;
};

type Team = {
  id: string;
  name: string;
  league_id: string | null;
  league?: { name: string } | null;
  leagues?: { id: string; name: string; season: string | null }[];
  league_ids?: string[];
};

type Player = {
  id: string;
  name: string | null;
  handle: string | null;
  game_user_id: string | null;
};

type Fixture = {
  id: string;
  league_id: string | null;
  played_at: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  stage: string | null;
  group_name: string | null;
  day: number | null;
  league?: { name: string } | null;
};

type PlayerStatsRow = {
  match_id: string;
  player_id: string;
  team_side: "home" | "away";
  position: string | null;
  score: number;
  passes: number;
  key_passes: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  goals: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  gk_saves: number;
  gk_catches: number;
  is_starter: boolean;
  sub_number: number | null;
  benched: boolean;
  stats_incomplete: boolean;
  player?: { id: string; name: string | null; handle: string | null; game_user_id: string | null } | null;
};

type MatchStatsData = {
  team_stats: { home: Record<string, any> | null; away: Record<string, any> | null };
  player_stats: PlayerStatsRow[];
};

type PlayerMatchResult = {
  playerId: string | null;
  confidence: number;
  matchMethod: string;
  needsUserReview: boolean;
  suggestions: Array<{
    id: string;
    name: string | null;
    game_user_id: string | null;
    confidence: number;
    matchReasons: string[];
  }>;
};

type MatchGroupStatus = "idle" | "uploading" | "extracting" | "extracted" | "validating" | "validated" | "importing" | "imported" | "error";

type MatchGroup = {
  id: string;
  images: string[];
  previews: string[];
  leagueId: string;
  extractedData: any | null;
  editedData: any | null;
  status: MatchGroupStatus;
  importResult: any | null;
  error: string | null;
  teamRosters: {
    home: Player[];
    away: Player[];
  } | null;
  validationStats: {
    playersNeedingReview: number;
    totalPlayers: number;
  } | null;
};

const TEAM_STAT_FIELDS = [
  { label: "Possession (%)", key: "possession" },
  { label: "Passes", key: "passes" },
  { label: "Key Passes", key: "key_passes" },
  { label: "Assists", key: "assists" },
  { label: "Shots", key: "shots" },
  { label: "Shots on Target", key: "shots_on_target" },
  { label: "Goals", key: "goals" },
  { label: "Tackles", key: "tackles" },
  { label: "Key Tackles", key: "key_tackles" },
  { label: "Interceptions", key: "interceptions" },
  { label: "Key Interceptions", key: "key_interceptions" },
  { label: "Poss. Lost", key: "possessions_lost" },
  { label: "Goal Kicks", key: "goal_kicks" },
  { label: "Corner Kicks", key: "corner_kicks" },
  { label: "Throw-ins", key: "throw_ins" },
  { label: "Free Kicks", key: "free_kicks" },
  { label: "Penalties", key: "penalties" },
  { label: "Fouls", key: "fouls" },
  { label: "Offsides", key: "offsides" },
  { label: "Yellow Cards", key: "yellow_cards" },
  { label: "Red Cards", key: "red_cards" },
];

const PLAYER_STAT_FIELDS = [
  { label: "Score", key: "score" },
  { label: "Goals", key: "goals" },
  { label: "Assists", key: "assists" },
  { label: "Passes", key: "passes" },
  { label: "Key Passes", key: "key_passes" },
  { label: "Shots", key: "shots" },
  { label: "SOT", key: "shots_on_target" },
  { label: "Tackles", key: "tackles" },
  { label: "Key Tackles", key: "key_tackles" },
  { label: "Ints", key: "interceptions" },
  { label: "Key Ints", key: "key_interceptions" },
  { label: "Poss Lost", key: "possessions_lost" },
  { label: "GK Saves", key: "gk_saves" },
  { label: "GK Catches", key: "gk_catches" },
];

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function generateGroupId(): string {
  return `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Confidence badge component
function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 90) {
    return <span className="px-1.5 py-0.5 text-xs rounded bg-emerald-500/30 text-emerald-300">✓ {confidence}%</span>;
  } else if (confidence >= 70) {
    return <span className="px-1.5 py-0.5 text-xs rounded bg-amber-500/30 text-amber-300">? {confidence}%</span>;
  } else if (confidence > 0) {
    return <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/30 text-red-300">⚠ {confidence}%</span>;
  }
  return <span className="px-1.5 py-0.5 text-xs rounded bg-gray-500/30 text-gray-400">New</span>;
}

export default function AdminDashboardPage() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");

  // Match Groups State
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>([
    { id: generateGroupId(), images: [], previews: [], leagueId: "auto", extractedData: null, editedData: null, status: "idle", importResult: null, error: null, teamRosters: null, validationStats: null }
  ]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Team import state
  const [teamImportImage, setTeamImportImage] = useState<string | null>(null);
  const [teamImportPreview, setTeamImportPreview] = useState<string | null>(null);
  const [teamImportLeagueId, setTeamImportLeagueId] = useState("");
  const [teamImportResult, setTeamImportResult] = useState<any>(null);

  // Fixture import state
  const [fixtureImportImage, setFixtureImportImage] = useState<string | null>(null);
  const [fixtureImportPreview, setFixtureImportPreview] = useState<string | null>(null);
  const [fixtureImportResult, setFixtureImportResult] = useState<any>(null);

  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<"import" | "leagues" | "teams" | "players" | "fixtures">("leagues");

  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [jsonData, setJsonData] = useState("");

  const [leagueForm, setLeagueForm] = useState({ id: "", name: "", season: "", format: "league" });
  const [editingLeague, setEditingLeague] = useState<string | null>(null);

  const [teamForm, setTeamForm] = useState({ id: "", name: "", league_ids: [] as string[] });
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [mergingTeams, setMergingTeams] = useState<{ source: string | null; target: string | null }>({ source: null, target: null });

  const [playerForm, setPlayerForm] = useState({ id: "", name: "", handle: "", game_user_id: "" });
  const [editingPlayer, setEditingPlayer] = useState<string | null>(null);
  const [mergingPlayers, setMergingPlayers] = useState<{ source: string | null; target: string | null }>({ source: null, target: null });

  const [fixtureForm, setFixtureForm] = useState({
    id: "",
    league_id: "",
    played_at: "",
    home_team: "",
    away_team: "",
    home_score: "",
    away_score: "",
    stage: "",
    group_name: "",
    day: "",
  });
  const [editingFixture, setEditingFixture] = useState<string | null>(null);

  // Match stats editing state
  const [expandedFixtureStats, setExpandedFixtureStats] = useState<string | null>(null);
  const [matchStatsCache, setMatchStatsCache] = useState<Record<string, MatchStatsData>>({});
  const [editingMatchStats, setEditingMatchStats] = useState<MatchStatsData | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsTab, setStatsTab] = useState<"team" | "players">("team");

  const authHeaders = {
    "Content-Type": "application/json",
    "x-admin-password": password,
    Authorization: `Bearer ${token}`,
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/import", {
        method: "GET",
        headers: { "x-admin-password": password, Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setAuthenticated(true);
        loadAllData();
      } else {
        setLoginError("Invalid admin password or Invalid Token");
      }
    } catch (err: any) {
      setLoginError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  const loadAllData = async () => {
    await Promise.all([loadLeagues(), loadTeams(), loadPlayers(), loadFixtures()]);
  };

  const loadLeagues = async () => {
    try {
      const res = await fetch("/api/admin/leagues", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setLeagues(data.leagues || []);
      }
    } catch (err) {
      console.error("Failed to load leagues:", err);
    }
  };

  const loadTeams = async () => {
    try {
      const res = await fetch("/api/admin/teams", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams || []);
      }
    } catch (err) {
      console.error("Failed to load teams:", err);
    }
  };

  const loadPlayers = async () => {
    try {
      const res = await fetch("/api/admin/players", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.players || []);
      }
    } catch (err) {
      console.error("Failed to load players:", err);
    }
  };

  const loadFixtures = async () => {
    try {
      const res = await fetch("/api/admin/fixtures", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setFixtures(data.fixtures || []);
      }
    } catch (err) {
      console.error("Failed to load fixtures:", err);
    }
  };

  const handleImport = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(jsonData);
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Import successful!" });
        setJsonData("");
        loadAllData();
      } else {
        setMessage({ type: "error", text: data.error || "Import failed" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLeague = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const method = editingLeague ? "PUT" : "POST";
      const res = await fetch("/api/admin/leagues", {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          id: editingLeague || undefined,
          name: leagueForm.name,
          season: leagueForm.season || null,
          format: leagueForm.format,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: editingLeague ? "League updated!" : "League created!" });
        setLeagueForm({ id: "", name: "", season: "", format: "league" });
        setEditingLeague(null);
        loadLeagues();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save league" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEditLeague = (league: League) => {
    setLeagueForm({ id: league.id, name: league.name, season: league.season || "", format: league.format || "league" });
    setEditingLeague(league.id);
  };

  const handleDeleteLeague = async (id: string) => {
    if (!confirm("Are you sure you want to delete this league?")) return;
    try {
      const res = await fetch("/api/admin/leagues", {
        method: "DELETE",
        headers: authHeaders,
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "League deleted!" });
        loadLeagues();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to delete league" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const handleSaveTeam = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const method = editingTeam ? "PUT" : "POST";
      const res = await fetch("/api/admin/teams", {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          id: editingTeam || undefined,
          name: teamForm.name,
          league_ids: teamForm.league_ids,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: editingTeam ? "Team updated!" : "Team created!" });
        setTeamForm({ id: "", name: "", league_ids: [] });
        setEditingTeam(null);
        loadTeams();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save team" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEditTeam = (team: Team) => {
    setTeamForm({
      id: team.id,
      name: team.name,
      league_ids: team.league_ids || (team.league_id ? [team.league_id] : []),
    });
    setEditingTeam(team.id);
  };

  const handleDeleteTeam = async (id: string) => {
    if (!confirm("Are you sure you want to delete this team?")) return;
    try {
      const res = await fetch("/api/admin/teams", {
        method: "DELETE",
        headers: authHeaders,
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Team deleted!" });
        loadTeams();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to delete team" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const handleMergeTeams = async () => {
    if (!mergingTeams.source || !mergingTeams.target) {
      setMessage({ type: "error", text: "Please select both source and target teams" });
      return;
    }
    if (mergingTeams.source === mergingTeams.target) {
      setMessage({ type: "error", text: "Source and target teams must be different" });
      return;
    }
    const sourceTeam = teams.find(t => t.id === mergingTeams.source);
    const targetTeam = teams.find(t => t.id === mergingTeams.target);
    if (!confirm(`Are you sure you want to merge "${sourceTeam?.name}" into "${targetTeam?.name}"? All matches will be updated and the source team will be deleted.`)) return;

    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          sourceId: mergingTeams.source,
          targetId: mergingTeams.target,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Teams merged successfully!" });
        setMergingTeams({ source: null, target: null });
        loadTeams();
        loadFixtures();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to merge teams" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePlayer = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const method = editingPlayer ? "PUT" : "POST";
      const res = await fetch("/api/admin/players", {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          id: editingPlayer || undefined,
          name: playerForm.name || null,
          handle: playerForm.handle || null,
          game_user_id: playerForm.game_user_id || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: editingPlayer ? "Player updated!" : "Player created!" });
        setPlayerForm({ id: "", name: "", handle: "", game_user_id: "" });
        setEditingPlayer(null);
        loadPlayers();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save player" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEditPlayer = (player: Player) => {
    setPlayerForm({ id: player.id, name: player.name || "", handle: player.handle || "", game_user_id: player.game_user_id || "" });
    setEditingPlayer(player.id);
  };

  const handleDeletePlayer = async (id: string) => {
    if (!confirm("Are you sure you want to delete this player?")) return;
    try {
      const res = await fetch("/api/admin/players", {
        method: "DELETE",
        headers: authHeaders,
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Player deleted!" });
        loadPlayers();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to delete player" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const handleMergePlayers = async () => {
    if (!mergingPlayers.source || !mergingPlayers.target) {
      setMessage({ type: "error", text: "Please select both source and target players" });
      return;
    }
    if (mergingPlayers.source === mergingPlayers.target) {
      setMessage({ type: "error", text: "Source and target players must be different" });
      return;
    }
    const sourcePlayer = players.find(p => p.id === mergingPlayers.source);
    const targetPlayer = players.find(p => p.id === mergingPlayers.target);
    if (!confirm(`Are you sure you want to merge "${sourcePlayer?.name || sourcePlayer?.handle || sourcePlayer?.game_user_id}" into "${targetPlayer?.name || targetPlayer?.handle || targetPlayer?.game_user_id}"? This will transfer all match results and delete the source player.`)) return;

    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/players", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          sourceId: mergingPlayers.source,
          targetId: mergingPlayers.target
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Players merged successfully! ${data.transferredStats || 0} match results transferred.` });
        setMergingPlayers({ source: null, target: null });
        loadPlayers();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to merge players" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFixture = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const method = editingFixture ? "PUT" : "POST";
      const res = await fetch("/api/admin/fixtures", {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          id: editingFixture || undefined,
          league_id: fixtureForm.league_id || null,
          played_at: fixtureForm.played_at,
          home_team: fixtureForm.home_team,
          away_team: fixtureForm.away_team,
          home_score: fixtureForm.home_score !== "" ? parseInt(fixtureForm.home_score) : null,
          away_score: fixtureForm.away_score !== "" ? parseInt(fixtureForm.away_score) : null,
          stage: fixtureForm.stage || null,
          group_name: fixtureForm.group_name || null,
          day: fixtureForm.day !== "" ? parseInt(fixtureForm.day) : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: editingFixture ? "Fixture updated!" : "Fixture created!" });
        setFixtureForm({ id: "", league_id: "", played_at: "", home_team: "", away_team: "", home_score: "", away_score: "", stage: "", group_name: "", day: "" });
        setEditingFixture(null);
        loadFixtures();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save fixture" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEditFixture = (fixture: Fixture) => {
    setFixtureForm({
      id: fixture.id,
      league_id: fixture.league_id || "",
      played_at: fixture.played_at ? fixture.played_at.slice(0, 16) : "",
      home_team: fixture.home_team,
      away_team: fixture.away_team,
      home_score: fixture.home_score !== null ? String(fixture.home_score) : "",
      away_score: fixture.away_score !== null ? String(fixture.away_score) : "",
      stage: fixture.stage || "",
      group_name: fixture.group_name || "",
      day: fixture.day !== null ? String(fixture.day) : "",
    });
    setEditingFixture(fixture.id);
  };

  const handleDeleteFixture = async (id: string) => {
    if (!confirm("Are you sure you want to delete this fixture?")) return;
    try {
      const res = await fetch("/api/admin/fixtures", {
        method: "DELETE",
        headers: authHeaders,
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Fixture deleted!" });
        loadFixtures();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to delete fixture" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    }
  };

  // ==================== MATCH STATS FUNCTIONS ====================

  const loadMatchStats = async (matchId: string) => {
    if (matchStatsCache[matchId]) {
      setEditingMatchStats(JSON.parse(JSON.stringify(matchStatsCache[matchId])));
      return;
    }
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/admin/match-stats?match_id=${matchId}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const statsData: MatchStatsData = {
          team_stats: data.team_stats,
          player_stats: data.player_stats,
        };
        setMatchStatsCache((prev) => ({ ...prev, [matchId]: statsData }));
        setEditingMatchStats(JSON.parse(JSON.stringify(statsData)));
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to load stats" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoadingStats(false);
    }
  };

  const toggleFixtureStats = (matchId: string) => {
    if (expandedFixtureStats === matchId) {
      setExpandedFixtureStats(null);
      setEditingMatchStats(null);
    } else {
      setExpandedFixtureStats(matchId);
      setStatsTab("team");
      loadMatchStats(matchId);
    }
  };

  const handleSaveMatchStats = async () => {
    if (!expandedFixtureStats || !editingMatchStats) return;
    setLoadingStats(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/match-stats", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          match_id: expandedFixtureStats,
          team_stats: editingMatchStats.team_stats,
          player_stats: editingMatchStats.player_stats,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Match stats updated!" });
        setMatchStatsCache((prev) => ({
          ...prev,
          [expandedFixtureStats]: JSON.parse(JSON.stringify(editingMatchStats)),
        }));
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save stats" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoadingStats(false);
    }
  };

  const updateTeamStat = (side: "home" | "away", field: string, value: string) => {
    if (!editingMatchStats) return;
    setEditingMatchStats((prev) => {
      if (!prev) return prev;
      const current = prev.team_stats[side] || {
        match_id: expandedFixtureStats!,
        team_side: side,
        possession: 0, passes: 0, key_passes: 0, assists: 0, shots: 0, shots_on_target: 0,
        goals: 0, tackles: 0, key_tackles: 0, interceptions: 0, key_interceptions: 0,
        possessions_lost: 0, goal_kicks: 0, corner_kicks: 0, throw_ins: 0, free_kicks: 0,
        penalties: 0, fouls: 0, offsides: 0, yellow_cards: 0, red_cards: 0,
      };
      return {
        ...prev,
        team_stats: {
          ...prev.team_stats,
          [side]: { ...current, [field]: field === "possession" ? (parseFloat(value) || 0) : (parseInt(value) || 0) },
        },
      };
    });
  };

  const updatePlayerStat = (playerIdx: number, field: string, value: string) => {
    if (!editingMatchStats) return;
    setEditingMatchStats((prev) => {
      if (!prev) return prev;
      const updated = [...prev.player_stats];
      updated[playerIdx] = {
        ...updated[playerIdx],
        [field]: field === "position" ? (value || null) : (parseInt(value) || 0),
      };
      return { ...prev, player_stats: updated };
    });
  };

  const cancelEdit = () => {
    setEditingLeague(null);
    setEditingTeam(null);
    setEditingPlayer(null);
    setEditingFixture(null);
    setLeagueForm({ id: "", name: "", season: "", format: "league" });
    setTeamForm({ id: "", name: "", league_ids: [] });
    setMergingTeams({ source: null, target: null });
    setPlayerForm({ id: "", name: "", handle: "", game_user_id: "" });
    setFixtureForm({ id: "", league_id: "", played_at: "", home_team: "", away_team: "", home_score: "", away_score: "", stage: "", group_name: "", day: "" });
    setExpandedFixtureStats(null);
    setEditingMatchStats(null);
  };

  const allTeamNames = Array.from(
    new Set([...teams.map((t) => t.name), ...fixtures.flatMap((f) => [f.home_team, f.away_team])])
  ).sort();

  // ==================== MATCH GROUP FUNCTIONS ====================

  const updateGroup = (groupId: string, updates: Partial<MatchGroup>) => {
    setMatchGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...updates } : g));
  };

  const addMatchGroup = () => {
    setMatchGroups(prev => [...prev, {
      id: generateGroupId(),
      images: [],
      previews: [],
      leagueId: "auto",
      extractedData: null,
      editedData: null,
      status: "idle",
      importResult: null,
      error: null,
      teamRosters: null,
      validationStats: null,
    }]);
  };

  const removeMatchGroup = (groupId: string) => {
    if (matchGroups.length === 1) {
      updateGroup(groupId, {
        images: [],
        previews: [],
        leagueId: "auto",
        extractedData: null,
        editedData: null,
        status: "idle",
        importResult: null,
        error: null,
        teamRosters: null,
        validationStats: null,
      });
    } else {
      setMatchGroups(prev => prev.filter(g => g.id !== groupId));
    }
  };

  const handleGroupImageChange = (groupId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setMatchGroups(prev => prev.map(g => {
          if (g.id === groupId) {
            return { ...g, images: [...g.images, base64], previews: [...g.previews, base64] };
          }
          return g;
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const removeGroupImage = (groupId: string, index: number) => {
    setMatchGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        return {
          ...g,
          images: g.images.filter((_, i) => i !== index),
          previews: g.previews.filter((_, i) => i !== index),
        };
      }
      return g;
    }));
  };

  const handlePasteGroupImages = (groupId: string, e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            setMatchGroups(prev => prev.map(g => {
              if (g.id === groupId) {
                return { ...g, images: [...g.images, base64], previews: [...g.previews, base64] };
              }
              return g;
            }));
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const pasteGroupImageFromClipboard = async (groupId: string) => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            setMatchGroups(prev => prev.map(g => {
              if (g.id === groupId) {
                return { ...g, images: [...g.images, base64], previews: [...g.previews, base64] };
              }
              return g;
            }));
          };
          reader.readAsDataURL(blob);
          setMessage({ type: "success", text: "Image pasted successfully!" });
          return;
        }
      }
      setMessage({ type: "error", text: "No image found in clipboard" });
    } catch (err: any) {
      setMessage({ type: "error", text: "Clipboard access denied. Try Ctrl+V instead." });
    }
  };

  // Extract and then validate players
  const handleExtractGroup = async (groupId: string) => {
    const group = matchGroups.find(g => g.id === groupId);
    if (!group || group.images.length === 0) {
      setMessage({ type: "error", text: "Please upload at least one image" });
      return;
    }

    updateGroup(groupId, { status: "extracting", error: null });

    try {
      // Step 1: Extract data from images
      const extractRes = await fetch("/api/admin/extract-match", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ images: group.images }),
      });
      const extractData = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractData.error || "Extraction failed");

      updateGroup(groupId, { status: "validating" });

      // Step 2: Validate players and get suggestions
      const validateRes = await fetch("/api/admin/validate-players", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ extractedData: extractData.extracted }),
      });
      const validateData = await validateRes.json();
      if (!validateRes.ok) throw new Error(validateData.error || "Validation failed");

      updateGroup(groupId, {
        extractedData: extractData.extracted,
        editedData: JSON.parse(JSON.stringify(validateData.validatedData)),
        status: "validated",
        teamRosters: validateData.teamRosters,
        validationStats: validateData.stats,
      });

      const reviewCount = validateData.stats?.playersNeedingReview || 0;
      if (reviewCount > 0) {
        setMessage({ type: "success", text: `Data extracted! ${reviewCount} player(s) need review.` });
      } else {
        setMessage({ type: "success", text: "Data extracted! All players matched with high confidence." });
      }
    } catch (err: any) {
      updateGroup(groupId, { status: "error", error: err.message });
      setMessage({ type: "error", text: err.message });
    }
  };

  const handleImportGroup = async (groupId: string) => {
    const group = matchGroups.find(g => g.id === groupId);
    if (!group || !group.editedData) return;

    updateGroup(groupId, { status: "importing", error: null });

    try {
      const res = await fetch("/api/admin/import-images", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          images: [],
          league_id: group.leagueId || "auto",
          extractedData: group.editedData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");

      updateGroup(groupId, {
        status: "imported",
        importResult: data,
      });
      setMessage({ type: "success", text: data.fixtureUpdated ? "Fixture updated!" : "Match imported!" });
      loadFixtures();
      loadPlayers();
    } catch (err: any) {
      updateGroup(groupId, { status: "error", error: err.message });
      setMessage({ type: "error", text: err.message });
    }
  };

  const handleDirectImportGroup = async (groupId: string) => {
    const group = matchGroups.find(g => g.id === groupId);
    if (!group || group.images.length === 0) {
      setMessage({ type: "error", text: "Please upload at least one image" });
      return;
    }

    updateGroup(groupId, { status: "importing", error: null });

    try {
      const res = await fetch("/api/admin/import-images", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ images: group.images, league_id: group.leagueId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");

      updateGroup(groupId, {
        status: "imported",
        importResult: data,
        images: [],
        previews: [],
      });
      setMessage({ type: "success", text: "Match imported successfully!" });
      loadFixtures();
      loadPlayers();
    } catch (err: any) {
      updateGroup(groupId, { status: "error", error: err.message });
      setMessage({ type: "error", text: err.message });
    }
  };

  // Update player in preview
  const updateGroupPreviewPlayer = (groupId: string, teamSide: "home" | "away", playerIndex: number, field: string, value: any) => {
    setMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team] };
        updated[team].players = [...updated[team].players];
        const currentPlayer = { ...updated[team].players[playerIndex], [field]: value };

        // Auto-match when user_id changes
        if (field === "user_id" && typeof value === "string" && value.length >= 2) {
          const val = value.trim().toLowerCase();
          const exact = players.find(p => p.game_user_id?.toLowerCase() === val);
          if (exact) {
            currentPlayer.matchResult = {
              playerId: exact.id,
              confidence: 100,
              matchMethod: "user_id_exact",
              needsUserReview: false,
              suggestions: [],
            };
          } else {
            const partials = players.filter(p =>
              p.game_user_id?.toLowerCase().includes(val) ||
              p.name?.toLowerCase().includes(val) ||
              p.handle?.toLowerCase().includes(val)
            ).slice(0, 5);
            currentPlayer.matchResult = {
              playerId: null,
              confidence: 0,
              matchMethod: "user_id_search",
              needsUserReview: true,
              suggestions: partials.map(p => ({
                id: p.id,
                name: p.name,
                game_user_id: p.game_user_id,
                confidence: p.game_user_id?.toLowerCase().includes(val) ? 80 : 50,
                matchReasons: [p.game_user_id?.toLowerCase().includes(val) ? "ID partial match" : "Name/handle match"],
              })),
            };
          }
        } else if (field === "user_id" && (typeof value !== "string" || value.length < 2)) {
          currentPlayer.matchResult = {
            playerId: null,
            confidence: 0,
            matchMethod: "none",
            needsUserReview: true,
            suggestions: [],
          };
        }

        updated[team].players[playerIndex] = currentPlayer;
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  // Select player from suggestions or roster
  const selectPlayerForMatch = (groupId: string, teamSide: "home" | "away", playerIndex: number, selectedPlayer: Player) => {
    setMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team] };
        updated[team].players = [...updated[team].players];
        updated[team].players[playerIndex] = {
          ...updated[team].players[playerIndex],
          matchResult: {
            ...updated[team].players[playerIndex].matchResult,
            playerId: selectedPlayer.id,
            confidence: 100,
            matchMethod: "user_selected",
            needsUserReview: false,
          }
        };
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  // Update team stats
  const updateGroupPreviewTeam = (groupId: string, teamSide: "home" | "away", field: string, value: any) => {
    setMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team], [field]: value };
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  // Remove player
  const removeGroupPreviewPlayer = (groupId: string, teamSide: "home" | "away", playerIndex: number) => {
    setMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team] };
        updated[team].players = updated[team].players.filter((_: any, i: number) => i !== playerIndex);
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  // Add player
  const addGroupPreviewPlayer = (groupId: string, teamSide: "home" | "away") => {
    setMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team] };
        updated[team].players = [
          ...updated[team].players,
          {
            name: "New Player",
            user_id: "",
            position: "CM",
            score: 0,
            goals: 0,
            assists: 0,
            shots: 0,
            shots_on_target: 0,
            passes: 0,
            key_passes: 0,
            tackles: 0,
            key_tackles: 0,
            interceptions: 0,
            key_interceptions: 0,
            possessions_lost: 0,
            gk_saves: 0,
            gk_catches: 0,
            is_starter: false,
            sub_number: updated[team].players.filter((p: any) => !p.is_starter).length + 1,
            matchResult: {
              playerId: null,
              confidence: 0,
              matchMethod: "new",
              needsUserReview: true,
              suggestions: [],
            }
          }
        ];
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  // ==================== TEAM & FIXTURE IMAGE HANDLERS ====================

  const handleTeamImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setTeamImportImage(base64);
      setTeamImportPreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const removeTeamImage = () => {
    setTeamImportImage(null);
    setTeamImportPreview(null);
  };

  const handleTeamImageImport = async () => {
    if (!teamImportImage) {
      setMessage({ type: "error", text: "Please upload an image" });
      return;
    }
    setLoading(true);
    setMessage(null);
    setTeamImportResult(null);
    try {
      const res = await fetch("/api/admin/import-teams-image", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ image: teamImportImage, league_id: teamImportLeagueId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setTeamImportResult(data);
      setMessage({ type: "success", text: `Imported ${data.stats?.created || 0} new teams!` });
      setTeamImportImage(null);
      setTeamImportPreview(null);
      loadTeams();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleFixtureImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setFixtureImportImage(base64);
      setFixtureImportPreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const removeFixtureImage = () => {
    setFixtureImportImage(null);
    setFixtureImportPreview(null);
  };

  const handleFixtureImageImport = async () => {
    if (!fixtureImportImage) {
      setMessage({ type: "error", text: "Please upload an image" });
      return;
    }
    setLoading(true);
    setMessage(null);
    setFixtureImportResult(null);
    try {
      const res = await fetch("/api/admin/import-fixtures-image", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ image: fixtureImportImage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setFixtureImportResult(data);
      setMessage({ type: "success", text: `Imported ${data.stats?.created || 0} fixtures!` });
      setFixtureImportImage(null);
      setFixtureImportPreview(null);
      loadFixtures();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handlePasteFixtureImage = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            setFixtureImportImage(base64);
            setFixtureImportPreview(base64);
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  };

  const handlePasteTeamImage = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            setTeamImportImage(base64);
            setTeamImportPreview(base64);
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  };

  const pasteFixtureImageFromClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            setFixtureImportImage(base64);
            setFixtureImportPreview(base64);
          };
          reader.readAsDataURL(blob);
          setMessage({ type: "success", text: "Image pasted successfully!" });
          return;
        }
      }
      setMessage({ type: "error", text: "No image found in clipboard" });
    } catch (err: any) {
      setMessage({ type: "error", text: "Clipboard access denied. Try Ctrl+V instead." });
    }
  };

  const pasteTeamImageFromClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            setTeamImportImage(base64);
            setTeamImportPreview(base64);
          };
          reader.readAsDataURL(blob);
          setMessage({ type: "success", text: "Image pasted successfully!" });
          return;
        }
      }
      setMessage({ type: "error", text: "No image found in clipboard" });
    } catch (err: any) {
      setMessage({ type: "error", text: "Clipboard access denied. Try Ctrl+V instead." });
    }
  };

  // Get the currently editing group
  const editingGroup = editingGroupId ? matchGroups.find(g => g.id === editingGroupId) : null;

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md">
          <h1 className="text-2xl font-bold text-white mb-6">Admin Login</h1>
          {loginError && (
            <div className="mb-4 p-3 rounded bg-red-500/20 border border-red-500/30 text-red-200 text-sm">{loginError}</div>
          )}
          <div className="mb-4">
            <label className="block text-gray-300 mb-2">Admin Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="ADMIN_IMPORT_PASSWORD" required />
          </div>
          <div className="mb-6">
            <label className="block text-gray-300 mb-2">Import Token</label>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="ADMIN_IMPORT_TOKEN" required />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded transition">
            {loading ? "Verifying..." : "Login"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <Link href="/" className="text-sm text-gray-400 hover:text-white transition">← Back to Site</Link>
            <h1 className="text-2xl font-bold text-white mt-2">Admin Dashboard</h1>
          </div>
          <button onClick={() => { setAuthenticated(false); setPassword(""); setToken(""); }} className="text-gray-400 hover:text-white text-sm">Logout</button>
        </div>

        {message && (
          <div className={cx("mb-6 p-4 rounded-lg", message.type === "success" ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-200" : "bg-red-500/20 border border-red-500/30 text-red-200")}>
            {message.text}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          {(["leagues", "teams", "players", "fixtures", "import"] as const).map((tab) => (
            <button key={tab} onClick={() => { setActiveTab(tab); cancelEdit(); setMessage(null); }} className={cx("px-4 py-2 rounded-lg text-sm font-medium transition capitalize", activeTab === tab ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white")}>
              {tab}
            </button>
          ))}
        </div>

        {/* IMPORT TAB */}
        {activeTab === "import" && (
          <div className="space-y-6">
            {/* Match Screenshot Import */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">📷 Import Match Results from Screenshots (AI)</h2>
                  <p className="text-gray-400 text-sm mt-1">Upload screenshots for multiple matches. Each group represents one match.</p>
                </div>
                <button
                  onClick={addMatchGroup}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition flex items-center gap-2"
                >
                  <span className="text-lg">+</span> Add Match Group
                </button>
              </div>

              {/* Match Groups */}
              <div className="space-y-4">
                {matchGroups.map((group, groupIndex) => (
                  <div
                    key={group.id}
                    className={cx(
                      "border-2 rounded-lg p-4 transition",
                      group.status === "imported" ? "border-emerald-500/50 bg-emerald-500/5" :
                        group.status === "validated" ? "border-amber-500/50 bg-amber-500/5" :
                          group.status === "error" ? "border-red-500/50 bg-red-500/5" :
                            "border-gray-700 bg-gray-900/50"
                    )}
                  >
                    {/* Group Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="bg-gray-700 text-white font-bold px-3 py-1 rounded-full text-sm">
                          Match {groupIndex + 1}
                        </span>
                        {group.status === "extracting" && (
                          <span className="text-amber-400 text-sm flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Extracting...
                          </span>
                        )}
                        {group.status === "validating" && (
                          <span className="text-purple-400 text-sm flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Validating players...
                          </span>
                        )}
                        {group.status === "importing" && (
                          <span className="text-blue-400 text-sm flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Importing...
                          </span>
                        )}
                        {group.status === "validated" && group.validationStats && (
                          <span className="text-amber-400 text-sm">
                            ✓ Extracted - {group.validationStats.playersNeedingReview > 0
                              ? <span className="text-red-400">{group.validationStats.playersNeedingReview} player(s) need review</span>
                              : "All players matched"}
                          </span>
                        )}
                        {group.status === "imported" && (
                          <span className="text-emerald-400 text-sm">✓ Imported successfully</span>
                        )}
                        {group.status === "error" && (
                          <span className="text-red-400 text-sm">⚠ Error: {group.error}</span>
                        )}
                      </div>
                      <button
                        onClick={() => removeMatchGroup(group.id)}
                        className="text-gray-500 hover:text-red-400 transition p-1"
                        title="Remove group"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    {/* Import Result Display */}
                    {group.status === "imported" && group.importResult && (
                      <div className={`mb-4 p-4 rounded-lg ${group.importResult.fixtureUpdated ? "bg-purple-500/20 border border-purple-500/30" : "bg-emerald-500/20 border border-emerald-500/30"}`}>
                        <h4 className={`${group.importResult.fixtureUpdated ? "text-purple-300" : "text-emerald-300"} font-semibold mb-2`}>
                          {group.importResult.fixtureUpdated ? "✅ Fixture Updated!" : "✅ Match Imported!"}
                        </h4>
                        <p className="text-white text-lg font-medium">
                          {group.importResult.match?.home_team} {group.importResult.match?.home_score} - {group.importResult.match?.away_score} {group.importResult.match?.away_team}
                        </p>
                        {group.importResult.league && (
                          <p className="text-blue-300 text-sm mt-1">League: {group.importResult.league.name}</p>
                        )}
                        <p className="text-gray-400 text-sm mt-1">
                          Players: {group.importResult.stats?.playerStatsCount || 0} •
                          Matched: {group.importResult.stats?.playersMatched?.length || 0} •
                          Created: {group.importResult.stats?.playersCreated?.length || 0}
                        </p>
                        {group.importResult.stats?.playersNeedingReview?.length > 0 && (
                          <p className="text-amber-400 text-sm mt-1">
                            ⚠️ Players that were auto-matched with low confidence: {group.importResult.stats.playersNeedingReview.join(", ")}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Group Content */}
                    {group.status !== "imported" && (
                      <>
                        {/* League Selector */}
                        <div className="mb-4">
                          <label className="block text-gray-300 mb-2 text-sm">League</label>
                          <select
                            value={group.leagueId}
                            onChange={(e) => updateGroup(group.id, { leagueId: e.target.value })}
                            className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="auto">🔍 Auto (find fixture)</option>
                            <option value="">No league (create new match)</option>
                            {leagues.map((l) => (
                              <option key={l.id} value={l.id}>{l.name} {l.season ? `(${l.season})` : ""}</option>
                            ))}
                          </select>
                        </div>

                        {/* Image Upload */}
                        <div className="mb-4">
                          <label className="block text-gray-300 mb-2 text-sm">Match Screenshots</label>
                          <button
                            type="button"
                            onClick={() => pasteGroupImageFromClipboard(group.id)}
                            className="mb-3 w-full flex items-center justify-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 font-medium py-3 px-4 rounded-lg transition"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            Paste Image from Clipboard
                          </button>

                          <div
                            className="rounded-lg border-2 border-dashed border-gray-600 p-6 text-center hover:border-gray-500 focus-within:border-blue-500 transition cursor-pointer"
                            onPaste={(e) => handlePasteGroupImages(group.id, e)}
                            tabIndex={0}
                          >
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) => handleGroupImageChange(group.id, e)}
                              className="hidden"
                              id={`match-image-upload-${group.id}`}
                            />
                            <label htmlFor={`match-image-upload-${group.id}`} className="cursor-pointer">
                              <div className="text-3xl mb-2">📸</div>
                              <p className="text-gray-400">Click to browse files</p>
                              <p className="text-xs text-gray-500 mt-1">Or focus here and press Ctrl+V</p>
                            </label>
                          </div>
                        </div>

                        {/* Image Previews */}
                        {group.previews.length > 0 && (
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm text-gray-400">{group.previews.length} image(s) ready</span>
                              <button
                                onClick={() => updateGroup(group.id, { images: [], previews: [] })}
                                className="text-xs text-red-400 hover:text-red-300"
                              >
                                Clear all
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {group.previews.map((preview, index) => (
                                <div key={index} className="relative inline-block">
                                  <img src={preview} alt={`Preview ${index + 1}`} className="h-20 rounded-lg border border-gray-600" />
                                  <button
                                    onClick={() => removeGroupImage(group.id, index)}
                                    className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-2 flex-wrap">
                          {(group.status === "idle" || group.status === "error") && (
                            <>
                              <button
                                onClick={() => handleExtractGroup(group.id)}
                                disabled={group.images.length === 0}
                                className="flex-1 min-w-[150px] bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded transition"
                              >
                                Extract & Validate
                              </button>
                              <button
                                onClick={() => handleDirectImportGroup(group.id)}
                                disabled={group.images.length === 0}
                                className="flex-1 min-w-[150px] bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded transition"
                              >
                                Direct Import
                              </button>
                            </>
                          )}
                          {group.status === "validated" && (
                            <>
                              <button
                                onClick={() => setEditingGroupId(group.id)}
                                className="flex-1 min-w-[150px] bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 px-4 rounded transition flex items-center justify-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                Review & Edit
                              </button>
                              <button
                                onClick={() => handleImportGroup(group.id)}
                                className="flex-1 min-w-[150px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded transition"
                              >
                                Import Match
                              </button>
                              <button
                                onClick={() => updateGroup(group.id, { status: "idle", extractedData: null, editedData: null, teamRosters: null, validationStats: null })}
                                className="bg-gray-700 hover:bg-gray-600 text-gray-300 py-2.5 px-4 rounded transition"
                              >
                                Reset
                              </button>
                            </>
                          )}
                        </div>

                        {/* Quick Preview */}
                        {group.status === "validated" && group.editedData && (
                          <div className="mt-4 p-3 bg-gray-800 rounded-lg">
                            <div className="flex items-center justify-center gap-4 text-lg font-bold">
                              <span className="text-blue-400">{group.editedData.home_team?.team_name}</span>
                              <span className="text-white">
                                {group.editedData.home_team?.goals ?? 0} - {group.editedData.away_team?.goals ?? 0}
                              </span>
                              <span className="text-red-400">{group.editedData.away_team?.team_name}</span>
                            </div>
                            <div className="text-center text-gray-500 text-sm mt-1">
                              {group.editedData.home_team?.players?.length || 0} + {group.editedData.away_team?.players?.length || 0} players extracted
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Edit Modal with Player Selection */}
            {editingGroupId && editingGroup && editingGroup.editedData && (
              <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-y-auto">
                <div className="bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-y-auto">
                  <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between z-10">
                    <div>
                      <h3 className="text-lg font-semibold text-amber-400">📝 Review & Edit Players</h3>
                      {editingGroup.validationStats && editingGroup.validationStats.playersNeedingReview > 0 && (
                        <p className="text-sm text-red-400 mt-1">
                          ⚠️ {editingGroup.validationStats.playersNeedingReview} player(s) need manual selection
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setEditingGroupId(null)}
                      className="text-gray-400 hover:text-white p-2"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="p-4 space-y-6">
                    {/* Match Score Overview */}
                    <div className="bg-gray-900 p-4 rounded-lg">
                      <div className="flex items-center justify-center gap-4 text-2xl font-bold">
                        <div className="text-right flex-1">
                          <input
                            type="text"
                            value={editingGroup.editedData.home_team?.team_name || ""}
                            onChange={(e) => updateGroupPreviewTeam(editingGroupId, "home", "team_name", e.target.value)}
                            className="bg-transparent border-b border-gray-600 text-white text-right w-full focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={editingGroup.editedData.home_team?.goals ?? 0}
                            onChange={(e) => updateGroupPreviewTeam(editingGroupId, "home", "goals", parseInt(e.target.value) || 0)}
                            className="w-12 bg-gray-700 text-white text-center rounded p-1"
                          />
                          <span className="text-gray-400">-</span>
                          <input
                            type="number"
                            value={editingGroup.editedData.away_team?.goals ?? 0}
                            onChange={(e) => updateGroupPreviewTeam(editingGroupId, "away", "goals", parseInt(e.target.value) || 0)}
                            className="w-12 bg-gray-700 text-white text-center rounded p-1"
                          />
                        </div>
                        <div className="text-left flex-1">
                          <input
                            type="text"
                            value={editingGroup.editedData.away_team?.team_name || ""}
                            onChange={(e) => updateGroupPreviewTeam(editingGroupId, "away", "team_name", e.target.value)}
                            className="bg-transparent border-b border-gray-600 text-white w-full focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Players with Selection */}
                    <div className="grid md:grid-cols-2 gap-4">
                      {(["home", "away"] as const).map((side) => {
                        const team = side === "home" ? editingGroup.editedData.home_team : editingGroup.editedData.away_team;
                        const players = team?.players || [];
                        const roster = side === "home" ? editingGroup.teamRosters?.home : editingGroup.teamRosters?.away;

                        return (
                          <div key={side} className="bg-gray-900 p-4 rounded-lg">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className={`font-semibold ${side === "home" ? "text-blue-400" : "text-red-400"}`}>
                                {team?.team_name || (side === "home" ? "Home" : "Away")} Players ({players.length})
                              </h4>
                              <button
                                onClick={() => addGroupPreviewPlayer(editingGroupId, side)}
                                className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded"
                              >
                                + Add
                              </button>
                            </div>

                            <div className="space-y-3 max-h-[500px] overflow-y-auto">
                              {players.map((player: any, idx: number) => {
                                const matchResult = player.matchResult;
                                const needsReview = matchResult?.needsUserReview;
                                const suggestions = matchResult?.suggestions || [];
                                const isBenched = !player.is_starter && player.sub_number !== null && (player.score === 0 || player.score === undefined);

                                return (
                                  <div
                                    key={idx}
                                    className={cx(
                                      "p-3 rounded-lg border",
                                      needsReview ? "bg-red-900/20 border-red-500/50" :
                                        isBenched ? "bg-gray-800/50 border-gray-700" :
                                          "bg-gray-800 border-gray-700"
                                    )}
                                  >
                                    {/* Player Header */}
                                    <div className="flex items-center gap-2 mb-2">
                                      <select
                                        value={player.position || ""}
                                        onChange={(e) => updateGroupPreviewPlayer(editingGroupId, side, idx, "position", e.target.value)}
                                        className="bg-gray-700 text-white text-xs rounded px-2 py-1 w-16"
                                      >
                                        {["GK", "LB", "CB", "RB", "LWB", "RWB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "LF", "RF", "CF", "ST"].map(pos => (
                                          <option key={pos} value={pos}>{pos}</option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        value={player.name || ""}
                                        onChange={(e) => updateGroupPreviewPlayer(editingGroupId, side, idx, "name", e.target.value)}
                                        className="bg-gray-700 text-white text-sm rounded px-2 py-1 flex-1"
                                        placeholder="Player name"
                                      />
                                      <ConfidenceBadge confidence={matchResult?.confidence || 0} />
                                      <button
                                        onClick={() => removeGroupPreviewPlayer(editingGroupId, side, idx)}
                                        className="text-red-400 hover:text-red-300 text-sm px-2"
                                      >
                                        ✕
                                      </button>
                                    </div>

                                    {/* Player ID */}
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="text-xs text-gray-500">ID:</span>
                                      <input
                                        type="text"
                                        value={player.user_id || ""}
                                        onChange={(e) => updateGroupPreviewPlayer(editingGroupId, side, idx, "user_id", e.target.value)}
                                        className="bg-gray-700 text-white text-xs rounded px-2 py-1 flex-1 font-mono"
                                        placeholder="Player ID (8 chars)"
                                      />
                                      {matchResult?.matchMethod && (
                                        <span className="text-xs text-gray-500">
                                          {matchResult.matchMethod}
                                        </span>
                                      )}
                                    </div>

                                    {/* Player Selection (when needs review or has suggestions) */}
                                    {(needsReview || suggestions.length > 0) && (
                                      <div className="mb-2 p-2 bg-gray-900 rounded">
                                        <label className="block text-xs text-amber-400 mb-1">
                                          {needsReview ? "⚠️ Select correct player:" : "Suggestions:"}
                                        </label>
                                        <select
                                          value={matchResult?.playerId || ""}
                                          onChange={(e) => {
                                            const selectedId = e.target.value;
                                            if (selectedId === "__new__") {
                                              // Mark as new player
                                              updateGroupPreviewPlayer(editingGroupId, side, idx, "matchResult", {
                                                ...matchResult,
                                                playerId: null,
                                                confidence: 0,
                                                matchMethod: "create_new",
                                                needsUserReview: false,
                                              });
                                            } else if (selectedId) {
                                              // Find selected player in suggestions or roster
                                              const allOptions = [...suggestions, ...(roster || [])];
                                              const selected = allOptions.find((p: any) => (p.id || p.player?.id) === selectedId);
                                              if (selected) {
                                                selectPlayerForMatch(editingGroupId, side, idx, selected.player || selected);
                                              }
                                            }
                                          }}
                                          className="w-full bg-gray-700 text-white text-xs rounded p-2"
                                        >
                                          <option value="">-- Select player --</option>
                                          {suggestions.length > 0 && (
                                            <optgroup label="Suggestions">
                                              {suggestions.map((s: any) => (
                                                <option key={s.id} value={s.id}>
                                                  {s.name || 'Unknown'} ({s.game_user_id}) - {s.confidence}%
                                                </option>
                                              ))}
                                            </optgroup>
                                          )}
                                          {roster && roster.length > 0 && (
                                            <optgroup label="Team Roster">
                                              {roster.filter((p: Player) => !suggestions.some((s: any) => s.id === p.id)).map((p: Player) => (
                                                <option key={p.id} value={p.id}>
                                                  {p.name || 'Unknown'} ({p.game_user_id})
                                                </option>
                                              ))}
                                            </optgroup>
                                          )}
                                          <optgroup label="Other">
                                            <option value="__new__">➕ Create new player</option>
                                          </optgroup>
                                        </select>
                                      </div>
                                    )}

                                    {/* Starter/Sub toggle */}
                                    <div className="flex items-center gap-2 mb-2">
                                      <label className="flex items-center gap-1 text-xs text-gray-400">
                                        <input
                                          type="checkbox"
                                          checked={player.is_starter ?? true}
                                          onChange={(e) => {
                                            updateGroupPreviewPlayer(editingGroupId, side, idx, "is_starter", e.target.checked);
                                            if (e.target.checked) {
                                              updateGroupPreviewPlayer(editingGroupId, side, idx, "sub_number", null);
                                            }
                                          }}
                                          className="rounded bg-gray-600"
                                        />
                                        Starter
                                      </label>
                                      {!player.is_starter && (
                                        <input
                                          type="number"
                                          value={player.sub_number || ""}
                                          onChange={(e) => updateGroupPreviewPlayer(editingGroupId, side, idx, "sub_number", parseInt(e.target.value) || null)}
                                          className="bg-gray-700 text-white text-xs rounded px-2 py-1 w-16"
                                          placeholder="Sub#"
                                        />
                                      )}
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-4 gap-1 text-xs">
                                      {[
                                        { key: "score", label: "Score", color: "text-amber-400" },
                                        { key: "goals", label: "Goals", color: "text-emerald-400" },
                                        { key: "assists", label: "Assists", color: "text-sky-400" },
                                        { key: "shots", label: "Shots", color: "" },
                                        { key: "passes", label: "Passes", color: "" },
                                        { key: "tackles", label: "Tackles", color: "" },
                                        { key: "interceptions", label: "Int.", color: "" },
                                        { key: "gk_saves", label: "Saves", color: "text-yellow-400" },
                                      ].map(({ key, label, color }) => (
                                        <div key={key} className="flex flex-col">
                                          <span className={`text-gray-500 ${color}`}>{label}</span>
                                          <input
                                            type="number"
                                            value={player[key] ?? 0}
                                            onChange={(e) => updateGroupPreviewPlayer(editingGroupId, side, idx, key, parseInt(e.target.value) || 0)}
                                            className="bg-gray-700 text-white rounded px-1 py-0.5 text-xs w-full"
                                          />
                                        </div>
                                      ))}
                                    </div>

                                    {isBenched && (
                                      <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                                        <span className="bg-gray-700 px-2 py-0.5 rounded">Benched</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="sticky bottom-0 bg-gray-800 border-t border-gray-700 p-4 flex gap-3">
                    <button
                      onClick={() => setEditingGroupId(null)}
                      className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-4 rounded transition"
                    >
                      Save & Close
                    </button>
                    <button
                      onClick={() => {
                        handleImportGroup(editingGroupId);
                        setEditingGroupId(null);
                      }}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded transition"
                    >
                      ✓ Save & Import
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Fixture Screenshot Import */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">📅 Import Fixtures from Screenshot (AI)</h2>
              <p className="text-gray-400 text-sm mb-4">Upload a Discord fixture announcement screenshot.</p>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2 text-sm">Fixture Screenshot</label>
                <button
                  type="button"
                  onClick={pasteFixtureImageFromClipboard}
                  className="mb-3 w-full flex items-center justify-center gap-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 font-medium py-3 px-4 rounded-lg transition"
                >
                  Paste Image from Clipboard
                </button>
                <div
                  className="rounded-lg border-2 border-dashed border-gray-600 p-6 text-center hover:border-gray-500 transition cursor-pointer"
                  onPaste={handlePasteFixtureImage}
                  tabIndex={0}
                >
                  <input type="file" accept="image/*" onChange={handleFixtureImageChange} className="hidden" id="fixture-image-upload" />
                  <label htmlFor="fixture-image-upload" className="cursor-pointer">
                    <div className="text-3xl mb-2">📅</div>
                    <p className="text-gray-400">Click to browse or Ctrl+V</p>
                  </label>
                </div>
              </div>
              {fixtureImportPreview && (
                <div className="mb-4 relative inline-block">
                  <img src={fixtureImportPreview} alt="Fixture preview" className="max-h-64 rounded-lg border border-gray-600" />
                  <button onClick={removeFixtureImage} className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">×</button>
                </div>
              )}
              <button onClick={handleFixtureImageImport} disabled={loading || !fixtureImportImage} className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded transition">
                {loading ? "Extracting..." : "Import Fixtures"}
              </button>
              {fixtureImportResult && (
                <div className="mt-4 p-4 rounded-lg bg-purple-500/20 border border-purple-500/30">
                  <h3 className="text-purple-300 font-semibold mb-2">
                    {fixtureImportResult.success ? "✅ Fixtures Imported!" : "⚠️ Completed with Issues"}
                  </h3>
                  <p className="text-gray-400 text-sm">
                    Created: {fixtureImportResult.stats?.created || 0} • Skipped: {fixtureImportResult.stats?.skipped || 0}
                  </p>
                </div>
              )}
            </div>

            {/* JSON Import */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">📝 Import Match Data (JSON)</h2>
              <textarea value={jsonData} onChange={(e) => setJsonData(e.target.value)} className="w-full h-64 p-4 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono text-sm" placeholder="Paste match JSON here..." />
              <button onClick={handleImport} disabled={loading || !jsonData.trim()} className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded transition">
                {loading ? "Importing..." : "Import (JSON)"}
              </button>
            </div>
          </div>
        )}

        {/* Other tabs remain the same but shortened for brevity */}
        {activeTab === "leagues" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingLeague ? "Edit League" : "Add New League"}</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="block text-gray-300 mb-2 text-sm">Name *</label><input type="text" value={leagueForm.name} onChange={(e) => setLeagueForm({ ...leagueForm, name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="League name" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Season</label><input type="text" value={leagueForm.season} onChange={(e) => setLeagueForm({ ...leagueForm, season: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="2024" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Format</label><select value={leagueForm.format} onChange={(e) => setLeagueForm({ ...leagueForm, format: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600"><option value="league">League</option><option value="knockout">Knockout</option><option value="group_knockout">Group + Knockout</option></select></div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSaveLeague} disabled={loading || !leagueForm.name} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded">{editingLeague ? "Update" : "Create"} League</button>
                {editingLeague && <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded">Cancel</button>}
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Leagues ({leagues.length})</h2>
              {leagues.length === 0 ? <p className="text-gray-400">No leagues yet.</p> : (
                <div className="space-y-2">
                  {leagues.map((l) => (
                    <div key={l.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                      <div><span className="text-white font-medium">{l.name}</span>{l.season && <span className="text-gray-400 ml-2">({l.season})</span>}</div>
                      <div className="flex gap-2"><button onClick={() => handleEditLeague(l)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button><button onClick={() => handleDeleteLeague(l.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "teams" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingTeam ? "Edit Team" : "Add New Team"}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div><label className="block text-gray-300 mb-2 text-sm">Name *</label><input type="text" value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="Team name" /></div>
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Leagues</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto p-2 rounded bg-gray-700 border border-gray-600">
                    {leagues.map((l) => (
                      <label key={l.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-600 p-1 rounded">
                        <input type="checkbox" checked={teamForm.league_ids.includes(l.id)} onChange={(e) => { if (e.target.checked) { setTeamForm({ ...teamForm, league_ids: [...teamForm.league_ids, l.id] }); } else { setTeamForm({ ...teamForm, league_ids: teamForm.league_ids.filter(id => id !== l.id) }); } }} className="rounded bg-gray-600" />
                        <span className="text-white text-sm">{l.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSaveTeam} disabled={loading || !teamForm.name} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded">{editingTeam ? "Update" : "Create"} Team</button>
                {editingTeam && <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded">Cancel</button>}
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Merge Teams</h2>
              <p className="text-gray-400 text-sm mb-4">Merge two duplicate teams into one. All matches referencing the source team will be updated to the target team.</p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Source Team (will be deleted)</label>
                  <select value={mergingTeams.source || ""} onChange={(e) => setMergingTeams({ ...mergingTeams, source: e.target.value || null })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600">
                    <option value="">Select source team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Target Team (will keep)</label>
                  <select value={mergingTeams.target || ""} onChange={(e) => setMergingTeams({ ...mergingTeams, target: e.target.value || null })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600">
                    <option value="">Select target team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <button onClick={handleMergeTeams} disabled={loading || !mergingTeams.source || !mergingTeams.target} className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded">Merge Teams</button>
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Teams ({teams.length})</h2>
              {teams.length === 0 ? <p className="text-gray-400">No teams yet.</p> : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {teams.map((t) => (
                    <div key={t.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                      <span className="text-white font-medium">{t.name}</span>
                      <div className="flex gap-2"><button onClick={() => handleEditTeam(t)} className="text-blue-400 text-sm">Edit</button><button onClick={() => handleDeleteTeam(t.id)} className="text-red-400 text-sm">Delete</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "players" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingPlayer ? "Edit Player" : "Add New Player"}</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="block text-gray-300 mb-2 text-sm">Name</label><input type="text" value={playerForm.name} onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="Player name" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Handle</label><input type="text" value={playerForm.handle} onChange={(e) => setPlayerForm({ ...playerForm, handle: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="@handle" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Game User ID</label><input type="text" value={playerForm.game_user_id} onChange={(e) => setPlayerForm({ ...playerForm, game_user_id: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="8-char ID" /></div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSavePlayer} disabled={loading || (!playerForm.name && !playerForm.handle && !playerForm.game_user_id)} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded">{editingPlayer ? "Update" : "Create"} Player</button>
                {editingPlayer && <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded">Cancel</button>}
              </div>
            </div>
                          <div className="bg-gray-800 p-6 rounded-lg">
                <h2 className="text-lg font-semibold text-white mb-4">Merge Players</h2>
                <p className="text-gray-400 text-sm mb-4">Merge two duplicate players into one. All match results from the source player will be transferred to the target player.</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-gray-300 mb-2 text-sm">Source Player (will be deleted)</label>
                    <select value={mergingPlayers.source || ""} onChange={(e) => setMergingPlayers({ ...mergingPlayers, source: e.target.value || null })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600">
                      <option value="">Select source player</option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>{p.name || p.handle || p.game_user_id?.slice(0, 8)} {p.game_user_id && `(${p.game_user_id})`}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-2 text-sm">Target Player (will keep)</label>
                    <select value={mergingPlayers.target || ""} onChange={(e) => setMergingPlayers({ ...mergingPlayers, target: e.target.value || null })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600">
                      <option value="">Select target player</option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>{p.name || p.handle || p.game_user_id?.slice(0, 8)} {p.game_user_id && `(${p.game_user_id})`}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4">
                  <button onClick={handleMergePlayers} disabled={loading || !mergingPlayers.source || !mergingPlayers.target} className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded">Merge Players</button>
                </div>
              </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Players ({players.length})</h2>
              {players.length === 0 ? <p className="text-gray-400">No players yet.</p> : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {players.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                      <div><span className="text-white font-medium">{p.name || p.handle || p.game_user_id?.slice(0, 8)}</span>{p.game_user_id && <span className="text-gray-500 ml-2 text-xs font-mono">{p.game_user_id}</span>}</div>
                      <div className="flex gap-2"><button onClick={() => handleEditPlayer(p)} className="text-blue-400 text-sm">Edit</button><button onClick={() => handleDeletePlayer(p.id)} className="text-red-400 text-sm">Delete</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "fixtures" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingFixture ? "Edit Fixture" : "Add New Fixture"}</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="block text-gray-300 mb-2 text-sm">League</label><select value={fixtureForm.league_id} onChange={(e) => setFixtureForm({ ...fixtureForm, league_id: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600"><option value="">Select league</option>{leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Date & Time *</label><input type="datetime-local" value={fixtureForm.played_at} onChange={(e) => setFixtureForm({ ...fixtureForm, played_at: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Day</label><input type="number" min="1" value={fixtureForm.day} onChange={(e) => setFixtureForm({ ...fixtureForm, day: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="1, 2, 3..." /></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <div><label className="block text-gray-300 mb-2 text-sm">Home Team *</label><input type="text" list="team-options" value={fixtureForm.home_team} onChange={(e) => setFixtureForm({ ...fixtureForm, home_team: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="Home team" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Away Team *</label><input type="text" list="team-options" value={fixtureForm.away_team} onChange={(e) => setFixtureForm({ ...fixtureForm, away_team: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="Away team" /></div>
              </div>
              <datalist id="team-options">{allTeamNames.map((name) => <option key={name} value={name} />)}</datalist>
              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <div><label className="block text-gray-300 mb-2 text-sm">Home Score</label><input type="number" min="0" value={fixtureForm.home_score} onChange={(e) => setFixtureForm({ ...fixtureForm, home_score: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="—" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Away Score</label><input type="number" min="0" value={fixtureForm.away_score} onChange={(e) => setFixtureForm({ ...fixtureForm, away_score: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="—" /></div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSaveFixture} disabled={loading || !fixtureForm.played_at || !fixtureForm.home_team || !fixtureForm.away_team} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded">{editingFixture ? "Update" : "Create"} Fixture</button>
                {editingFixture && <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded">Cancel</button>}
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Fixtures ({fixtures.length})</h2>
              {fixtures.length === 0 ? <p className="text-gray-400">No fixtures yet.</p> : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {fixtures.map((f) => {
                    const isUpcoming = f.home_score === null || f.away_score === null;
                    const isStatsExpanded = expandedFixtureStats === f.id;
                    return (
                      <div key={f.id} className="bg-gray-700 rounded">
                        <div className="flex items-center justify-between p-3">
                          <div>
                            {isUpcoming && <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 mr-2">Upcoming</span>}
                            <span className="text-white font-medium">{f.home_team}</span>
                            <span className="text-gray-400 mx-2">{isUpcoming ? "vs" : `${f.home_score} - ${f.away_score}`}</span>
                            <span className="text-white font-medium">{f.away_team}</span>
                            {f.league && <span className="text-gray-500 text-xs ml-2">{(f.league as any).name}</span>}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => toggleFixtureStats(f.id)} className={cx("text-sm", isStatsExpanded ? "text-purple-300" : "text-purple-400")}>{isStatsExpanded ? "Close Stats" : "Stats"}</button>
                            <button onClick={() => handleEditFixture(f)} className="text-blue-400 text-sm">Edit</button>
                            <button onClick={() => handleDeleteFixture(f.id)} className="text-red-400 text-sm">Delete</button>
                          </div>
                        </div>

                        {isStatsExpanded && (
                          <div className="border-t border-gray-600 p-4">
                            {loadingStats ? (
                              <p className="text-gray-400 text-sm">Loading stats...</p>
                            ) : editingMatchStats ? (
                              <div>
                                <div className="flex gap-2 mb-4">
                                  <button onClick={() => setStatsTab("team")} className={cx("px-3 py-1 rounded text-sm", statsTab === "team" ? "bg-blue-600 text-white" : "bg-gray-600 text-gray-300")}>Team Stats</button>
                                  <button onClick={() => setStatsTab("players")} className={cx("px-3 py-1 rounded text-sm", statsTab === "players" ? "bg-blue-600 text-white" : "bg-gray-600 text-gray-300")}>Player Stats ({editingMatchStats.player_stats.length})</button>
                                </div>

                                {statsTab === "team" && (
                                  <div className="overflow-auto">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="text-gray-400 text-xs">
                                          <th className="text-left py-1 pr-2">Stat</th>
                                          <th className="text-left py-1 pr-2">{f.home_team}</th>
                                          <th className="text-left py-1">{f.away_team}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {TEAM_STAT_FIELDS.map(({ label, key }) => (
                                          <tr key={key}>
                                            <td className="py-1 pr-2 text-gray-300 whitespace-nowrap">{label}</td>
                                            <td className="py-1 pr-2">
                                              <input type="number" step={key === "possession" ? "0.1" : "1"} value={editingMatchStats.team_stats.home?.[key] ?? ""} onChange={(e) => updateTeamStat("home", key, e.target.value)} className="w-20 p-1 rounded bg-gray-800 text-white border border-gray-600 text-sm" />
                                            </td>
                                            <td className="py-1">
                                              <input type="number" step={key === "possession" ? "0.1" : "1"} value={editingMatchStats.team_stats.away?.[key] ?? ""} onChange={(e) => updateTeamStat("away", key, e.target.value)} className="w-20 p-1 rounded bg-gray-800 text-white border border-gray-600 text-sm" />
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {statsTab === "players" && (
                                  <div className="overflow-auto">
                                    {editingMatchStats.player_stats.length === 0 ? (
                                      <p className="text-gray-400 text-sm">No player stats recorded for this match.</p>
                                    ) : (
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="text-gray-400 text-xs">
                                            <th className="text-left py-1 pr-1 sticky left-0 bg-gray-700">Player</th>
                                            <th className="text-left py-1 pr-1">Side</th>
                                            <th className="text-left py-1 pr-1">Pos</th>
                                            {PLAYER_STAT_FIELDS.map(({ label, key }) => (
                                              <th key={key} className="text-left py-1 pr-1 whitespace-nowrap">{label}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {editingMatchStats.player_stats.map((ps, idx) => (
                                            <tr key={ps.player_id} className="border-t border-gray-600/50">
                                              <td className="py-1 pr-1 text-white whitespace-nowrap sticky left-0 bg-gray-700">{ps.player?.name || ps.player?.handle || ps.player_id.slice(0, 8)}</td>
                                              <td className="py-1 pr-1 text-gray-300 text-xs">{ps.team_side}</td>
                                              <td className="py-1 pr-1">
                                                <input type="text" value={ps.position || ""} onChange={(e) => updatePlayerStat(idx, "position", e.target.value)} className="w-12 p-1 rounded bg-gray-800 text-white border border-gray-600 text-xs" />
                                              </td>
                                              {PLAYER_STAT_FIELDS.map(({ key }) => (
                                                <td key={key} className="py-1 pr-1">
                                                  <input type="number" min="0" value={(ps as any)[key] ?? 0} onChange={(e) => updatePlayerStat(idx, key, e.target.value)} className="w-14 p-1 rounded bg-gray-800 text-white border border-gray-600 text-xs" />
                                                </td>
                                              ))}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                )}

                                <div className="mt-4 flex gap-2">
                                  <button onClick={handleSaveMatchStats} disabled={loadingStats} className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded text-sm">{loadingStats ? "Saving..." : "Save Stats"}</button>
                                  <button onClick={() => { setExpandedFixtureStats(null); setEditingMatchStats(null); }} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded text-sm">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-gray-400 text-sm">No stats data found.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
