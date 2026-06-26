"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { splitMatchImage } from "@/lib/imageRowSplitter";

// Compress an image dataURL to stay under a max size (JPEG quality reduction + downscale)
async function compressImage(dataUrl: string, maxBytes = 1_200_000): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      // Downscale if larger than 1920 on the longest side
      const maxDim = 1920;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      // Try progressively lower quality until under maxBytes
      let quality = 0.85;
      let result = canvas.toDataURL("image/jpeg", quality);
      while (result.length * 0.75 > maxBytes && quality > 0.3) {
        quality -= 0.1;
        result = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(result);
    };
    img.src = dataUrl;
  });
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

// Client-side team-name matching (mirrors the server) so editing a team name in
// the review re-checks it against the loaded DB teams live.
function normTeam(name: string): string {
  return (name || "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+fc$/i, "").replace(/^fc\s+/i, "")
    .replace(/\s+/g, " ").trim();
}
function alnumTeam(name: string): string {
  return normTeam(name).replace(/[^a-z0-9]/g, "");
}
function matchDbTeam(name: string, teams: { id: string; name: string }[]): { id: string; name: string } | null {
  if (!name || !teams?.length) return null;
  const n = normTeam(name), a = alnumTeam(name);
  let best = teams.find((t) => normTeam(t.name) === n);
  if (!best) best = teams.find((t) => { const tn = normTeam(t.name); return !!tn && (tn.includes(n) || n.includes(tn)); });
  if (!best) best = teams.find((t) => { const ta = alnumTeam(t.name); return !!ta && !!a && (ta === a || ta.includes(a) || a.includes(ta)); });
  return best ? { id: best.id, name: best.name } : null;
}

type Zone = { name: string; color: string; spots: number; type: "top" | "bottom" };

type League = {
  id: string;
  name: string;
  season: string | null;
  format: string | null;
  image: string | null;
  tier: number | null;
  use_tier_bonus?: boolean;
  award_champion?: boolean;
  ended?: boolean;
  zones?: Zone[];
};

type Team = {
  id: string;
  name: string;
  league_id: string | null;
  no_elo?: boolean;
  disbanded?: boolean;
  league?: { name: string } | null;
  leagues?: { id: string; name: string; season: string | null }[];
  league_ids?: string[];
  group_assignments?: Record<string, string | null>;
};

type Player = {
  id: string;
  name: string | null;
  handle: string | null;
  game_user_id: string | null;
  discord_id: string | null;
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
  forfeited_by: "home" | "away" | null;
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

  // TEST version — separate match groups state
  const [testMatchGroups, setTestMatchGroups] = useState<MatchGroup[]>([
    { id: generateGroupId(), images: [], previews: [], leagueId: "auto", extractedData: null, editedData: null, status: "idle", importResult: null, error: null, teamRosters: null, validationStats: null }
  ]);
  const [testEditingGroupId, setTestEditingGroupId] = useState<string | null>(null);
  const [zoomedStrip, setZoomedStrip] = useState<string | null>(null);

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

  const [activeTab, setActiveTab] = useState<"import" | "leagues" | "teams" | "players" | "fixtures" | "settings">("leagues");
  const [tierSettings, setTierSettings] = useState([
    { tier: 1, label: "Elite", bonus: 5 },
    { tier: 2, label: "Standard", bonus: 0 },
    { tier: 3, label: "Amateur", bonus: -5 },
  ]);

  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [fixtureSearch, setFixtureSearch] = useState("");

  const [keepFixtureDate, setKeepFixtureDate] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [jsonData, setJsonData] = useState("");

  const [leagueForm, setLeagueForm] = useState<{ id: string; name: string; season: string; format: string; image: string; tier: number; use_tier_bonus: boolean; award_champion: boolean; ended: boolean; zones: Zone[] }>({ id: "", name: "", season: "", format: "league", image: "", tier: 2, use_tier_bonus: true, award_champion: true, ended: false, zones: [] });
  const [newZone, setNewZone] = useState<Zone>({ name: "", color: "#4ade80", spots: 1, type: "top" });
  const [editingZoneIdx, setEditingZoneIdx] = useState<number | null>(null);
  const [editingLeague, setEditingLeague] = useState<string | null>(null);

  const [teamForm, setTeamForm] = useState<{ id: string; name: string; league_ids: string[]; no_elo: boolean; disbanded: boolean; group_assignments: Record<string, string> }>({ id: "", name: "", league_ids: [], no_elo: false, disbanded: false, group_assignments: {} });
  const [teamSearch, setTeamSearch] = useState("");
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [mergingTeams, setMergingTeams] = useState<{ source: string | null; target: string | null }>({ source: null, target: null });

  const [playerForm, setPlayerForm] = useState({ id: "", name: "", handle: "", game_user_id: "", discord_id: "" });
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
    forfeited_by: "" as "" | "home" | "away",
  });
  const [editingFixture, setEditingFixture] = useState<string | null>(null);

  // Match stats editing state
  const [expandedFixtureStats, setExpandedFixtureStats] = useState<string | null>(null);
  const [matchStatsCache, setMatchStatsCache] = useState<Record<string, MatchStatsData>>({});
  const [editingMatchStats, setEditingMatchStats] = useState<MatchStatsData | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsTab, setStatsTab] = useState<"team" | "players">("team");
  const [addPlayerSearch, setAddPlayerSearch] = useState("");
  const [addPlayerSide, setAddPlayerSide] = useState<"home" | "away">("home");

  const authHeaders = {
    "Content-Type": "application/json",
    "x-admin-password": password,
    Authorization: `Bearer ${token}`,
  };

  const verifyAuth = async (pw: string, tok: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/admin/import", {
        method: "GET",
        headers: { "x-admin-password": pw, Authorization: `Bearer ${tok}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoading(true);
    try {
      const ok = await verifyAuth(password, token);
      if (ok) {
        try { localStorage.setItem("psafdb_admin_auth", JSON.stringify({ password, token })); } catch {}
        setAuthenticated(true); // data loads via the effect below, once creds are in state
      } else {
        setLoginError("Invalid admin password or Invalid Token");
      }
    } catch (err: any) {
      setLoginError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    try { localStorage.removeItem("psafdb_admin_auth"); } catch {}
    setAuthenticated(false);
    setPassword("");
    setToken("");
  };

  const loadAllData = async () => {
    await Promise.all([loadLeagues(), loadTeams(), loadPlayers(), loadFixtures(), loadTierSettings()]);
  };

  // Restore session on refresh: re-use saved credentials and re-verify them.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("psafdb_admin_auth");
      if (!saved) return;
      const { password: pw, token: tok } = JSON.parse(saved);
      if (!pw || !tok) return;
      setPassword(pw);
      setToken(tok);
      (async () => {
        if (await verifyAuth(pw, tok)) {
          setAuthenticated(true); // data loads via the effect below
        } else {
          try { localStorage.removeItem("psafdb_admin_auth"); } catch {}
        }
      })();
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load all admin data once authenticated AND credentials are in state, so the
  // request headers (built from password/token) are populated. Calling
  // loadAllData() right after setPassword/setToken would use stale empty headers.
  useEffect(() => {
    if (authenticated && password && token) loadAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, password, token]);

  const loadTierSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) setTierSettings(data);
      }
    } catch (err) {
      console.error("Failed to load tier settings:", err);
    }
  };

  const handleSaveTierSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ tiers: tierSettings }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Tier settings saved." });
      } else {
        const d = await res.json();
        setMessage({ type: "error", text: d.error || "Failed to save tier settings." });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to save tier settings." });
    } finally {
      setLoading(false);
    }
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

      // Convert a player from either format to extractedData format
      const convertPlayer = (p: any, subIdx: { n: number }) => {
        const rawPos: string = p.postion || p.position || "";
        const isSubPos = /^sub\s*\d*/i.test(rawPos.trim());
        const isStarter = !isSubPos;
        let subNumber: number | null = null;
        if (isSubPos) {
          const m = rawPos.match(/\d+/);
          subNumber = m ? parseInt(m[0]) : subIdx.n++;
        }
        const allZero = !p.score && !p.goals && !p.assists && !p.passes && !p.tackles && !p.interceptions && !p.gKSaves && !p.gk_saves;
        const benched = isSubPos && allZero;
        return {
          name: p.playerName || p.name || p.handle || "",
          user_id: p.playerId || p.game_user_id || null,
          position: isSubPos ? "" : rawPos,
          score: p.score ?? 0,
          goals: p.goals ?? 0,
          assists: p.assists ?? 0,
          passes: p.passes ?? 0,
          key_passes: p.keyPasses ?? p.key_passes ?? 0,
          shots: p.shots ?? 0,
          shots_on_target: p.shotsOnTarget ?? p.shots_on_target ?? 0,
          tackles: p.tackles ?? 0,
          key_tackles: p.keyTackles ?? p.key_tackles ?? 0,
          interceptions: p.interceptions ?? 0,
          key_interceptions: p.keyInterceptions ?? p.key_interceptions ?? 0,
          possessions_lost: p.possessionsLost ?? p.possessions_lost ?? 0,
          gk_saves: p.gKSaves ?? p.gk_saves ?? 0,
          gk_catches: p.gKCatches ?? p.gk_catches ?? 0,
          is_starter: isStarter,
          sub_number: subNumber,
          benched,
          stats_incomplete: p.stats_incomplete ?? false,
        };
      };

      let extractedData: any;

      if ("team1Stats" in parsed) {
        // Custom format: { team1Stats, team2Stats, team1PlayerStats, team2PlayerStats }
        const t1 = parsed.team1Stats;
        const t2 = parsed.team2Stats;
        // Normalise camelCase team stat fields to snake_case for the API
        const normalizeTeamStats = (t: any) => ({
          possession: t.possession ?? 0,
          passes: t.passes ?? 0,
          key_passes: t.keyPasses ?? t.key_passes ?? 0,
          assists: t.assists ?? 0,
          shots: t.shots ?? 0,
          shots_on_target: t.shotsOnTarget ?? t.shots_on_target ?? 0,
          goals: t.goals ?? 0,
          tackles: t.tackles ?? 0,
          key_tackles: t.keyTackles ?? t.key_tackles ?? 0,
          interceptions: t.interceptions ?? 0,
          key_interceptions: t.keyInterceptions ?? t.key_interceptions ?? 0,
          possessions_lost: t.possessionsLost ?? t.possessions_lost ?? 0,
          fouls: t.fouls ?? 0,
          offsides: t.offsides ?? 0,
          yellow_cards: t.yellowCards ?? t.yellow_cards ?? 0,
          red_cards: t.redCards ?? t.red_cards ?? 0,
          goal_kicks: t.goalKicks ?? t.goal_kicks ?? 0,
          corner_kicks: t.cornerKicks ?? t.corner_kicks ?? 0,
          throw_ins: t.throwIns ?? t.throw_ins ?? 0,
          free_kicks: t.freeKicks ?? t.free_kicks ?? 0,
          penalties: t.penalties ?? 0,
          set_piece_timeouts: t.setPieceTimeouts ?? t.set_piece_timeouts ?? 0,
        });
        extractedData = {
          home_team: {
            team_name: t1.teamName || "",
            goals: t1.goals ?? 0,
            players: (parsed.team1PlayerStats || []).map((p: any) => convertPlayer(p, { n: 1 })),
          },
          away_team: {
            team_name: t2.teamName || "",
            goals: t2.goals ?? 0,
            players: (parsed.team2PlayerStats || []).map((p: any) => convertPlayer(p, { n: 1 })),
          },
          league: null,
          team_stats: { home: normalizeTeamStats(t1), away: normalizeTeamStats(t2) },
        };
      } else {
        // Generic format: { league, match, players, team_stats }
        const match = parsed.match || {};
        const players: any[] = Array.isArray(parsed.players) ? parsed.players : [];
        extractedData = {
          home_team: {
            team_name: match.home_team || "",
            goals: match.home_score ?? 0,
            players: players.filter((p: any) => p.team_side === "home").map((p: any) => convertPlayer(p, { n: 1 })),
          },
          away_team: {
            team_name: match.away_team || "",
            goals: match.away_score ?? 0,
            players: players.filter((p: any) => p.team_side === "away").map((p: any) => convertPlayer(p, { n: 1 })),
          },
          league: parsed.league || null,
          team_stats: parsed.team_stats || null,
        };
      }

      // Run through player validation
      const validateRes = await fetch("/api/admin/validate-players", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ extractedData }),
      });
      const validateData = await validateRes.json();
      if (!validateRes.ok) throw new Error(validateData.error || "Validation failed");

      // Create a new match group with the validated data and open the review UI
      const newGroupId = generateGroupId();
      const newGroup: MatchGroup = {
        id: newGroupId,
        images: [],
        previews: [],
        leagueId: "auto",
        extractedData,
        editedData: JSON.parse(JSON.stringify(validateData.validatedData)),
        status: "validated",
        importResult: null,
        error: null,
        teamRosters: validateData.teamRosters,
        validationStats: validateData.stats,
      };

      setMatchGroups(prev => [...prev, newGroup]);
      setEditingGroupId(newGroupId);
      setActiveTab("import");
      setJsonData("");

      const reviewCount = validateData.stats?.playersNeedingReview || 0;
      setMessage({
        type: "success",
        text: reviewCount > 0
          ? `JSON parsed! ${reviewCount} player(s) need review — check the Import tab.`
          : "JSON parsed! All players matched. Review & confirm in the Import tab.",
      });
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
          image: leagueForm.image || null,
          tier: leagueForm.tier,
          use_tier_bonus: leagueForm.use_tier_bonus,
          award_champion: leagueForm.award_champion,
          ended: leagueForm.ended,
          zones: leagueForm.zones,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: editingLeague ? "League updated!" : "League created!" });
        setLeagueForm({ id: "", name: "", season: "", format: "league", image: "", tier: 2, use_tier_bonus: true, award_champion: true, ended: false, zones: [] });
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
    setLeagueForm({ id: league.id, name: league.name, season: league.season || "", format: league.format || "league", image: league.image || "", tier: league.tier ?? 2, use_tier_bonus: league.use_tier_bonus ?? true, award_champion: league.award_champion ?? true, ended: league.ended ?? false, zones: league.zones || [] });
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

  const handleToggleLeagueEnded = async (league: League) => {
    const newEnded = !league.ended;
    if (newEnded && !confirm(`Mark "${league.name}" as ended? No new results can be imported once ended.`)) return;
    try {
      const res = await fetch("/api/admin/leagues", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          id: league.id,
          name: league.name,
          season: league.season || null,
          format: league.format || "league",
          image: league.image || null,
          tier: league.tier ?? 2,
          use_tier_bonus: league.use_tier_bonus ?? true,
          award_champion: league.award_champion ?? true,
          ended: newEnded,
          zones: league.zones || [],
        }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: newEnded ? `"${league.name}" marked as ended.` : `"${league.name}" reopened.` });
        loadLeagues();
      } else {
        const d = await res.json();
        setMessage({ type: "error", text: d.error || "Failed to update league." });
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
          no_elo: teamForm.no_elo,
          disbanded: teamForm.disbanded,
          group_assignments: teamForm.group_assignments,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const dr = data.disbandResults;
        const extra = dr ? (dr.forfeited > 0 ? ` ${dr.forfeited} match(es) forfeited.` : dr.restored > 0 ? ` ${dr.restored} match(es) restored.` : "") : "";
        setMessage({ type: "success", text: (editingTeam ? "Team updated!" : "Team created!") + extra });
        setTeamForm({ id: "", name: "", league_ids: [], no_elo: false, disbanded: false, group_assignments: {} });
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
    const ids = team.league_ids || (team.league_id ? [team.league_id] : []);
    const groups: Record<string, string> = {};
    for (const lid of ids) {
      const g = team.group_assignments?.[lid];
      if (g) groups[lid] = g;
    }
    setTeamForm({
      id: team.id,
      name: team.name,
      league_ids: ids,
      no_elo: team.no_elo ?? false,
      disbanded: team.disbanded ?? false,
      group_assignments: groups,
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
          discord_id: playerForm.discord_id || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: editingPlayer ? "Player updated!" : "Player created!" });
        setPlayerForm({ id: "", name: "", handle: "", game_user_id: "", discord_id: "" });
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
    setPlayerForm({ id: player.id, name: player.name || "", handle: player.handle || "", game_user_id: player.game_user_id || "", discord_id: player.discord_id || "" });
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
          forfeited_by: fixtureForm.forfeited_by || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: editingFixture ? "Fixture updated!" : "Fixture created!" });
        setFixtureForm({ id: "", league_id: "", played_at: "", home_team: "", away_team: "", home_score: "", away_score: "", stage: "", group_name: "", day: "", forfeited_by: "" });
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
      forfeited_by: fixture.forfeited_by || "",
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
      setAddPlayerSearch("");
    } else {
      setExpandedFixtureStats(matchId);
      setStatsTab("team");
      setAddPlayerSearch("");
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

  const updatePlayerStat = (playerIdx: number, field: string, value: string | boolean) => {
    if (!editingMatchStats) return;
    setEditingMatchStats((prev) => {
      if (!prev) return prev;
      const updated = [...prev.player_stats];
      let parsed: string | number | boolean | null;
      if (typeof value === "boolean") parsed = value;
      else if (field === "position") parsed = value || null;
      else parsed = parseInt(value) || 0;
      updated[playerIdx] = { ...updated[playerIdx], [field]: parsed };
      return { ...prev, player_stats: updated };
    });
  };

  const addPlayerToMatch = (playerId: string, teamSide: "home" | "away") => {
    if (!editingMatchStats || !expandedFixtureStats) return;
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    if (editingMatchStats.player_stats.some(ps => ps.player_id === playerId)) return;
    const newRow: PlayerStatsRow = {
      match_id: expandedFixtureStats,
      player_id: playerId,
      team_side: teamSide,
      position: null,
      score: 0, passes: 0, key_passes: 0, assists: 0, shots: 0, shots_on_target: 0,
      goals: 0, tackles: 0, key_tackles: 0, interceptions: 0, key_interceptions: 0,
      possessions_lost: 0, gk_saves: 0, gk_catches: 0,
      is_starter: true, sub_number: null, benched: false, stats_incomplete: false,
      player: { id: player.id, name: player.name, handle: player.handle, game_user_id: player.game_user_id },
    };
    setEditingMatchStats(prev => prev ? { ...prev, player_stats: [...prev.player_stats, newRow] } : prev);
  };

  const removePlayerFromMatch = (playerIdx: number) => {
    if (!editingMatchStats) return;
    setEditingMatchStats(prev => {
      if (!prev) return prev;
      const updated = [...prev.player_stats];
      updated.splice(playerIdx, 1);
      return { ...prev, player_stats: updated };
    });
  };

  const cancelEdit = () => {
    setEditingLeague(null);
    setEditingTeam(null);
    setEditingPlayer(null);
    setEditingFixture(null);
    setLeagueForm({ id: "", name: "", season: "", format: "league", image: "", tier: 2, use_tier_bonus: true, award_champion: true, ended: false, zones: [] });
    setTeamForm({ id: "", name: "", league_ids: [], no_elo: false, disbanded: false, group_assignments: {} });
    setMergingTeams({ source: null, target: null });
    setPlayerForm({ id: "", name: "", handle: "", game_user_id: "", discord_id: "" });
    setFixtureForm({ id: "", league_id: "", played_at: "", home_team: "", away_team: "", home_score: "", away_score: "", stage: "", group_name: "", day: "", forfeited_by: "" });
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
      reader.onload = async (event) => {
        const raw = event.target?.result as string;
        const base64 = await compressImage(raw);
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
          reader.onload = async (event) => {
            const raw = event.target?.result as string;
            const base64 = await compressImage(raw);
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
          reader.onload = async (event) => {
            const raw = event.target?.result as string;
            const base64 = await compressImage(raw);
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
      // Cut each image into per-player row strips (client-side) so each player's
      // stats are read from their own isolated row — same enhanced flow as TEST.
      // A single team is at most 9 rows (6 starters + 3 subs); skip larger sets
      // (the overview's centre stats-box or both lineups) so they aren't sent.
      const stripSets: { strips: { dataUrl: string; isSub: boolean; label: string }[] }[] = [];
      for (const img of group.images) {
        try {
          const result = await splitMatchImage(img);
          const strips = result.panels.flatMap((p) =>
            p.rows.map((r) => ({ dataUrl: r.dataUrl, isSub: r.isSub, label: r.label }))
          );
          if (strips.length > 0 && strips.length <= 10) stripSets.push({ strips });
        } catch (e) {
          console.error("Row cut failed for an image:", e);
        }
      }

      // Step 1: Extract data (enhanced strip-based route)
      const extractRes = await fetch("/api/admin/extract-match-test", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ images: group.images, stripSets }),
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

  const calculateExpectedScore = (p: any): number => {
    return (
      15 * (p.passes ?? 0) +
      25 * (p.key_passes ?? 0) +
      60 * (p.assists ?? 0) +
      25 * (p.shots ?? 0) +
      25 * (p.shots_on_target ?? 0) +
      50 * (p.goals ?? 0) +
      15 * (p.tackles ?? 0) +
      25 * (p.key_tackles ?? 0) +
      15 * (p.interceptions ?? 0) +
      25 * (p.key_interceptions ?? 0) -
      10 * (p.possessions_lost ?? 0) +
      75 * (p.gk_saves ?? 0) +
      25 * (p.gk_catches ?? 0)
    );
  };

  const handleImportGroup = async (groupId: string) => {
    const group = matchGroups.find(g => g.id === groupId);
    if (!group || !group.editedData) return;

    updateGroup(groupId, { status: "importing", error: null });

    try {
      // drop the heavy _strip preview images before importing
      const cleaned = JSON.parse(JSON.stringify(group.editedData));
      for (const t of ["home_team", "away_team"]) {
        for (const p of cleaned?.[t]?.players || []) delete p._strip;
      }
      const res = await fetch("/api/admin/import-images", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          images: [],
          league_id: group.leagueId || "auto",
          extractedData: cleaned,
          keepFixtureDate,
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
        body: JSON.stringify({ images: group.images, league_id: group.leagueId || null, keepFixtureDate }),
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
            // Include in suggestions so the dropdown remains visible for confirmation
            currentPlayer.matchResult = {
              playerId: exact.id,
              confidence: 100,
              matchMethod: "user_id_exact",
              needsUserReview: false,
              suggestions: [{ id: exact.id, name: exact.name, game_user_id: exact.game_user_id, confidence: 100, matchReasons: ["Exact ID match"] }],
            };
          } else {
            const scored = players
              .map(p => {
                const gid = p.game_user_id?.toLowerCase() || "";
                const nm = p.name?.toLowerCase() || "";
                const hdl = p.handle?.toLowerCase() || "";
                if (gid === val) return { p, score: 100, reason: "Exact ID" };
                if (gid && gid.includes(val)) return { p, score: 82, reason: "ID contains search" };
                if (gid && val.includes(gid)) return { p, score: 78, reason: "Search contains ID" };
                const dist = gid ? levenshtein(val, gid) : 99;
                if (dist === 1) return { p, score: 90, reason: "ID off by 1 char" };
                if (dist === 2) return { p, score: 75, reason: "ID off by 2 chars" };
                if (nm.includes(val) || val.includes(nm)) return { p, score: 55, reason: "Name match" };
                if (hdl.includes(val)) return { p, score: 50, reason: "Handle match" };
                return null;
              })
              .filter((x): x is NonNullable<typeof x> => x !== null)
              .sort((a, b) => b.score - a.score)
              .slice(0, 8);

            currentPlayer.matchResult = {
              playerId: null,
              confidence: 0,
              matchMethod: "user_id_search",
              needsUserReview: true,
              suggestions: scored.map(({ p, score, reason }) => ({
                id: p.id,
                name: p.name,
                game_user_id: p.game_user_id,
                confidence: score,
                matchReasons: [reason],
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

        // Auto-match when name changes
        if (field === "name" && typeof value === "string" && value.length >= 2) {
          const val = value.trim().toLowerCase();
          const exactByName = players.find(p => p.name?.toLowerCase() === val);
          if (exactByName) {
            currentPlayer.matchResult = {
              playerId: exactByName.id,
              confidence: 100,
              matchMethod: "name_exact",
              needsUserReview: false,
              suggestions: [{ id: exactByName.id, name: exactByName.name, game_user_id: exactByName.game_user_id, confidence: 100, matchReasons: ["Exact name match"] }],
            };
          } else {
            const scored = players
              .map(p => {
                const nm = p.name?.toLowerCase() || "";
                if (!nm) return null;
                if (nm === val) return { p, score: 100, reason: "Exact name" };
                if (nm.includes(val) || val.includes(nm)) return { p, score: 75, reason: "Name contains search" };
                const dist = levenshtein(val, nm);
                if (dist === 1) return { p, score: 85, reason: "Name off by 1 char" };
                if (dist === 2) return { p, score: 65, reason: "Name off by 2 chars" };
                return null;
              })
              .filter((x): x is NonNullable<typeof x> => x !== null)
              .sort((a, b) => b.score - a.score)
              .slice(0, 8);

            if (scored.length > 0) {
              currentPlayer.matchResult = {
                ...(currentPlayer.matchResult || {}),
                needsUserReview: true,
                suggestions: scored.map(({ p, score, reason }) => ({
                  id: p.id,
                  name: p.name,
                  game_user_id: p.game_user_id,
                  confidence: score,
                  matchReasons: [reason],
                })),
              };
            }
          }
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

  // Update match-level metadata (group_name, stage, etc.)
  const updateGroupPreviewMeta = (groupId: string, field: string, value: any) => {
    setMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        return { ...g, editedData: { ...g.editedData, [field]: value || null } };
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
        if (field === "team_name") updated[team]._team_match = matchDbTeam(value, teams);
        return { ...g, editedData: updated };
      }
      return g;
    }));
    // When team name changes, refresh the roster for that side
    if (field === "team_name" && typeof value === "string" && value.length >= 2) {
      refreshTeamRoster(groupId, teamSide, value);
    }
  };

  const refreshTeamRoster = async (groupId: string, side: "home" | "away", teamName: string) => {
    try {
      const res = await fetch(`/api/admin/team-roster?team=${encodeURIComponent(teamName)}`, {
        headers: authHeaders,
      });
      if (!res.ok) return;
      const data = await res.json();
      setMatchGroups(prev => prev.map(g => {
        if (g.id === groupId) {
          return {
            ...g,
            teamRosters: {
              home: g.teamRosters?.home || [],
              away: g.teamRosters?.away || [],
              [side]: data.players || [],
            },
          };
        }
        return g;
      }));
    } catch {}
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

  // ==================== TEST VERSION MATCH GROUP HANDLERS ====================
  // Mirror of all match-group handlers, using testMatchGroups state and
  // calling /api/admin/extract-match-test instead of /api/admin/extract-match.
  // Modify the test API route freely without affecting the production flow.

  const updateTestGroup = (groupId: string, updates: Partial<MatchGroup>) => {
    setTestMatchGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...updates } : g));
  };

  const addTestMatchGroup = () => {
    setTestMatchGroups(prev => [...prev, {
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

  const removeTestMatchGroup = (groupId: string) => {
    if (testMatchGroups.length === 1) {
      updateTestGroup(groupId, { images: [], previews: [], leagueId: "auto", extractedData: null, editedData: null, status: "idle", importResult: null, error: null, teamRosters: null, validationStats: null });
    } else {
      setTestMatchGroups(prev => prev.filter(g => g.id !== groupId));
    }
  };

  const handleTestGroupImageChange = (groupId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const raw = event.target?.result as string;
        const base64 = await compressImage(raw);
        setTestMatchGroups(prev => prev.map(g => g.id === groupId ? { ...g, images: [...g.images, base64], previews: [...g.previews, base64] } : g));
      };
      reader.readAsDataURL(file);
    });
  };

  const removeTestGroupImage = (groupId: string, index: number) => {
    setTestMatchGroups(prev => prev.map(g => g.id === groupId ? { ...g, images: g.images.filter((_, i) => i !== index), previews: g.previews.filter((_, i) => i !== index) } : g));
  };

  const handleTestPasteGroupImages = (groupId: string, e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const raw = event.target?.result as string;
            const base64 = await compressImage(raw);
            setTestMatchGroups(prev => prev.map(g => g.id === groupId ? { ...g, images: [...g.images, base64], previews: [...g.previews, base64] } : g));
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const pasteTestGroupImageFromClipboard = async (groupId: string) => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = async (event) => {
            const raw = event.target?.result as string;
            const base64 = await compressImage(raw);
            setTestMatchGroups(prev => prev.map(g => g.id === groupId ? { ...g, images: [...g.images, base64], previews: [...g.previews, base64] } : g));
          };
          reader.readAsDataURL(blob);
          setMessage({ type: "success", text: "Image pasted successfully!" });
          return;
        }
      }
      setMessage({ type: "error", text: "No image found in clipboard" });
    } catch {
      setMessage({ type: "error", text: "Clipboard access denied. Try Ctrl+V instead." });
    }
  };

  const handleTestExtractGroup = async (groupId: string) => {
    const group = testMatchGroups.find(g => g.id === groupId);
    if (!group || group.images.length === 0) {
      setMessage({ type: "error", text: "Please upload at least one image" });
      return;
    }
    updateTestGroup(groupId, { status: "extracting", error: null });
    try {
      // Cut each uploaded image into per-player row strips (client-side). Each
      // detailed team panel → one stripSet; the server runs one GPT-4o call per
      // set so each player's stats come from their own isolated row.
      const stripSets: { strips: { dataUrl: string; isSub: boolean; label: string }[] }[] = [];
      for (const img of group.images) {
        try {
          const result = await splitMatchImage(img);
          const strips = result.panels.flatMap((p) =>
            p.rows.map((r) => ({ dataUrl: r.dataUrl, isSub: r.isSub, label: r.label }))
          );
          if (strips.length > 0 && strips.length <= 10) stripSets.push({ strips });
        } catch (e) {
          console.error("Row cut failed for an image:", e);
        }
      }

      // Calls the TEST extraction endpoint — modify /api/admin/extract-match-test/route.ts to experiment
      const extractRes = await fetch("/api/admin/extract-match-test", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ images: group.images, stripSets }),
      });
      const extractData = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractData.error || "Extraction failed");

      updateTestGroup(groupId, { status: "validating" });

      const validateRes = await fetch("/api/admin/validate-players", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ extractedData: extractData.extracted }),
      });
      const validateData = await validateRes.json();
      if (!validateRes.ok) throw new Error(validateData.error || "Validation failed");

      updateTestGroup(groupId, {
        extractedData: extractData.extracted,
        editedData: JSON.parse(JSON.stringify(validateData.validatedData)),
        status: "validated",
        teamRosters: validateData.teamRosters,
        validationStats: validateData.stats,
      });

      const reviewCount = validateData.stats?.playersNeedingReview || 0;
      const stripNote = extractData.strippedTeams ? ` (per-player strips: ${extractData.strippedTeams} team${extractData.strippedTeams > 1 ? "s" : ""})` : "";
      setMessage({ type: "success", text: (reviewCount > 0 ? `[TEST] Extracted! ${reviewCount} player(s) need review.` : "[TEST] Extracted! All players matched.") + stripNote });
    } catch (err: any) {
      updateTestGroup(groupId, { status: "error", error: err.message });
      setMessage({ type: "error", text: err.message });
    }
  };

  const handleTestImportGroup = async (groupId: string) => {
    const group = testMatchGroups.find(g => g.id === groupId);
    if (!group || !group.editedData) return;
    updateTestGroup(groupId, { status: "importing", error: null });
    try {
      // drop the heavy _strip preview images before importing
      const cleaned = JSON.parse(JSON.stringify(group.editedData));
      for (const t of ["home_team", "away_team"]) {
        for (const p of cleaned?.[t]?.players || []) delete p._strip;
      }
      const res = await fetch("/api/admin/import-images", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ images: [], league_id: group.leagueId || "auto", extractedData: cleaned, keepFixtureDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      updateTestGroup(groupId, { status: "imported", importResult: data });
      setMessage({ type: "success", text: data.fixtureUpdated ? "Fixture updated!" : "Match imported!" });
      loadFixtures();
      loadPlayers();
    } catch (err: any) {
      updateTestGroup(groupId, { status: "error", error: err.message });
      setMessage({ type: "error", text: err.message });
    }
  };

  const handleTestDirectImportGroup = async (groupId: string) => {
    const group = testMatchGroups.find(g => g.id === groupId);
    if (!group || group.images.length === 0) {
      setMessage({ type: "error", text: "Please upload at least one image" });
      return;
    }
    updateTestGroup(groupId, { status: "importing", error: null });
    try {
      const res = await fetch("/api/admin/import-images", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ images: group.images, league_id: group.leagueId || null, keepFixtureDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      updateTestGroup(groupId, { status: "imported", importResult: data, images: [], previews: [] });
      setMessage({ type: "success", text: "Match imported successfully!" });
      loadFixtures();
      loadPlayers();
    } catch (err: any) {
      updateTestGroup(groupId, { status: "error", error: err.message });
      setMessage({ type: "error", text: err.message });
    }
  };

  const updateTestGroupPreviewPlayer = (groupId: string, teamSide: "home" | "away", playerIndex: number, field: string, value: any) => {
    setTestMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team] };
        updated[team].players = [...updated[team].players];
        const currentPlayer = { ...updated[team].players[playerIndex], [field]: value };

        if (field === "user_id" && typeof value === "string" && value.length >= 2) {
          const val = value.trim().toLowerCase();
          const exact = players.find(p => p.game_user_id?.toLowerCase() === val);
          if (exact) {
            currentPlayer.matchResult = { playerId: exact.id, confidence: 100, matchMethod: "user_id_exact", needsUserReview: false, suggestions: [{ id: exact.id, name: exact.name, game_user_id: exact.game_user_id, confidence: 100, matchReasons: ["Exact ID match"] }] };
          } else {
            const scored = players.map(p => {
              const gid = p.game_user_id?.toLowerCase() || "";
              const nm = p.name?.toLowerCase() || "";
              const hdl = p.handle?.toLowerCase() || "";
              if (gid === val) return { p, score: 100, reason: "Exact ID" };
              if (gid && gid.includes(val)) return { p, score: 82, reason: "ID contains search" };
              if (gid && val.includes(gid)) return { p, score: 78, reason: "Search contains ID" };
              const dist = gid ? levenshtein(val, gid) : 99;
              if (dist === 1) return { p, score: 90, reason: "ID off by 1 char" };
              if (dist === 2) return { p, score: 75, reason: "ID off by 2 chars" };
              if (nm.includes(val) || val.includes(nm)) return { p, score: 55, reason: "Name match" };
              if (hdl.includes(val)) return { p, score: 50, reason: "Handle match" };
              return null;
            }).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => b.score - a.score).slice(0, 8);
            currentPlayer.matchResult = { playerId: null, confidence: 0, matchMethod: "user_id_search", needsUserReview: true, suggestions: scored.map(({ p, score, reason }) => ({ id: p.id, name: p.name, game_user_id: p.game_user_id, confidence: score, matchReasons: [reason] })) };
          }
        } else if (field === "user_id" && (typeof value !== "string" || value.length < 2)) {
          currentPlayer.matchResult = { playerId: null, confidence: 0, matchMethod: "none", needsUserReview: true, suggestions: [] };
        }

        if (field === "name" && typeof value === "string" && value.length >= 2) {
          const val = value.trim().toLowerCase();
          const exactByName = players.find(p => p.name?.toLowerCase() === val);
          if (exactByName) {
            currentPlayer.matchResult = { playerId: exactByName.id, confidence: 100, matchMethod: "name_exact", needsUserReview: false, suggestions: [{ id: exactByName.id, name: exactByName.name, game_user_id: exactByName.game_user_id, confidence: 100, matchReasons: ["Exact name match"] }] };
          } else {
            const scored = players.map(p => {
              const nm = p.name?.toLowerCase() || "";
              if (!nm) return null;
              if (nm === val) return { p, score: 100, reason: "Exact name" };
              if (nm.includes(val) || val.includes(nm)) return { p, score: 75, reason: "Name contains search" };
              const dist = levenshtein(val, nm);
              if (dist === 1) return { p, score: 85, reason: "Name off by 1 char" };
              if (dist === 2) return { p, score: 65, reason: "Name off by 2 chars" };
              return null;
            }).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => b.score - a.score).slice(0, 8);
            if (scored.length > 0) {
              currentPlayer.matchResult = { ...(currentPlayer.matchResult || {}), needsUserReview: true, suggestions: scored.map(({ p, score, reason }) => ({ id: p.id, name: p.name, game_user_id: p.game_user_id, confidence: score, matchReasons: [reason] })) };
            }
          }
        }

        updated[team].players[playerIndex] = currentPlayer;
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  const selectTestPlayerForMatch = (groupId: string, teamSide: "home" | "away", playerIndex: number, selectedPlayer: Player) => {
    setTestMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team] };
        updated[team].players = [...updated[team].players];
        updated[team].players[playerIndex] = { ...updated[team].players[playerIndex], matchResult: { ...updated[team].players[playerIndex].matchResult, playerId: selectedPlayer.id, confidence: 100, matchMethod: "user_selected", needsUserReview: false } };
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  const updateTestGroupPreviewMeta = (groupId: string, field: string, value: any) => {
    setTestMatchGroups(prev => prev.map(g => g.id === groupId && g.editedData ? { ...g, editedData: { ...g.editedData, [field]: value || null } } : g));
  };

  const refreshTestTeamRoster = async (groupId: string, side: "home" | "away", teamName: string) => {
    try {
      const res = await fetch(`/api/admin/team-roster?team=${encodeURIComponent(teamName)}`, { headers: authHeaders });
      if (!res.ok) return;
      const data = await res.json();
      setTestMatchGroups(prev => prev.map(g => g.id === groupId ? { ...g, teamRosters: { home: g.teamRosters?.home || [], away: g.teamRosters?.away || [], [side]: data.players || [] } } : g));
    } catch {}
  };

  const updateTestGroupPreviewTeam = (groupId: string, teamSide: "home" | "away", field: string, value: any) => {
    setTestMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team], [field]: value };
        if (field === "team_name") updated[team]._team_match = matchDbTeam(value, teams);
        return { ...g, editedData: updated };
      }
      return g;
    }));
    if (field === "team_name" && typeof value === "string" && value.length >= 2) {
      refreshTestTeamRoster(groupId, teamSide, value);
    }
  };

  const removeTestGroupPreviewPlayer = (groupId: string, teamSide: "home" | "away", playerIndex: number) => {
    setTestMatchGroups(prev => prev.map(g => {
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

  const addTestGroupPreviewPlayer = (groupId: string, teamSide: "home" | "away") => {
    setTestMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team] };
        updated[team].players = [...updated[team].players, { name: "New Player", user_id: "", position: "CM", score: 0, goals: 0, assists: 0, shots: 0, shots_on_target: 0, passes: 0, key_passes: 0, tackles: 0, key_tackles: 0, interceptions: 0, key_interceptions: 0, possessions_lost: 0, gk_saves: 0, gk_catches: 0, is_starter: false, sub_number: updated[team].players.filter((p: any) => !p.is_starter).length + 1, matchResult: { playerId: null, confidence: 0, matchMethod: "new", needsUserReview: true, suggestions: [] } }];
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
    reader.onload = async (event) => {
      const base64 = await compressImage(event.target?.result as string);
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
    reader.onload = async (event) => {
      const base64 = await compressImage(event.target?.result as string);
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
          reader.onload = async (event) => {
            const base64 = await compressImage(event.target?.result as string);
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
          reader.onload = async (event) => {
            const base64 = await compressImage(event.target?.result as string);
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
          reader.onload = async (event) => {
            const base64 = await compressImage(event.target?.result as string);
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
          reader.onload = async (event) => {
            const base64 = await compressImage(event.target?.result as string);
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
  const testEditingGroup = testEditingGroupId ? testMatchGroups.find(g => g.id === testEditingGroupId) : null;

  if (!authenticated) {
    return (
      <div className="admin-dark min-h-screen bg-gray-900 flex items-center justify-center p-4">
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
    <div className="admin-dark min-h-screen bg-gray-900 p-4 md:p-8">
      {zoomedStrip && (
        <div
          onClick={() => setZoomedStrip(null)}
          className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out overflow-auto"
        >
          <div className="max-w-[98vw] max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={zoomedStrip}
              alt="zoomed player row"
              className="rounded border border-gray-600"
              style={{ minWidth: "1600px", width: "100%" }}
            />
            <p className="text-center text-gray-400 text-xs mt-2">Click outside the image to close</p>
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <Link href="/" className="text-sm text-gray-400 hover:text-white transition">← Back to Site</Link>
            <h1 className="text-2xl font-bold text-white mt-2">Admin Dashboard</h1>
          </div>
          <button onClick={handleLogout} className="text-gray-400 hover:text-white text-sm">Logout</button>
        </div>

        {message && (
          <div className={cx("mb-6 p-4 rounded-lg", message.type === "success" ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-200" : "bg-red-500/20 border border-red-500/30 text-red-200")}>
            {message.text}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          {(["leagues", "teams", "players", "fixtures", "import", "settings"] as const).map((tab) => (
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
                              <label className="w-full flex items-center gap-2 cursor-pointer select-none text-sm text-gray-300">
                                <input
                                  type="checkbox"
                                  checked={keepFixtureDate}
                                  onChange={e => setKeepFixtureDate(e.target.checked)}
                                  className="w-4 h-4 rounded accent-blue-500"
                                />
                                Keep original fixture date
                                <span className="text-gray-500 font-normal">(uncheck to set date to now)</span>
                              </label>
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
                          {editingGroup.editedData.home_team?._team_match
                            ? <p className="text-xs font-normal text-emerald-400 text-right mt-1">✓ detected: {editingGroup.editedData.home_team._team_match.name}</p>
                            : <p className="text-xs font-normal text-amber-400 text-right mt-1">⚠ no matching team — a new one will be created</p>}
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
                          {editingGroup.editedData.away_team?._team_match
                            ? <p className="text-xs font-normal text-emerald-400 text-left mt-1">✓ detected: {editingGroup.editedData.away_team._team_match.name}</p>
                            : <p className="text-xs font-normal text-amber-400 text-left mt-1">⚠ no matching team — a new one will be created</p>}
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
                                    {player._strip && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={player._strip} alt={`source row for ${player.name || idx + 1}`} title="Click to zoom — source row this player's stats were read from" onClick={() => setZoomedStrip(player._strip)} className="w-full rounded mb-2 border border-gray-700 bg-black/20 cursor-zoom-in hover:border-yellow-500/60 transition" />
                                    )}
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
                                            <optgroup label="Team Roster (recent)">
                                              {roster
                                                .filter((p: Player) => !suggestions.some((s: any) => s.id === p.id))
                                                .slice(0, 15)
                                                .map((p: Player) => (
                                                  <option key={p.id} value={p.id}>
                                                    {p.name || 'Unknown'} ({p.game_user_id || '—'})
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

                                    {/* Score Validation */}
                                    {(() => {
                                      const expected = calculateExpectedScore(player);
                                      const actual = player.score ?? 0;
                                      const diff = actual - expected;
                                      const isIncomplete = player.stats_incomplete;
                                      const mismatch = !isIncomplete && diff !== 0;
                                      return mismatch ? (
                                        <div className={`text-xs px-2 py-1 rounded mb-1 ${Math.abs(diff) > 50 ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                                          Score mismatch: actual {actual} vs expected {expected} (diff {diff > 0 ? "+" : ""}{diff})
                                        </div>
                                      ) : null;
                                    })()}

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-5 gap-1 text-xs">
                                      {[
                                        { key: "score", label: "Score", color: "text-amber-400" },
                                        { key: "goals", label: "Goals", color: "text-emerald-400" },
                                        { key: "assists", label: "Assists", color: "text-sky-400" },
                                        { key: "shots", label: "Shots", color: "" },
                                        { key: "shots_on_target", label: "On Target", color: "" },
                                        { key: "passes", label: "Passes", color: "" },
                                        { key: "key_passes", label: "Key Pass", color: "" },
                                        { key: "tackles", label: "Tackles", color: "" },
                                        { key: "key_tackles", label: "Key Tack", color: "" },
                                        { key: "interceptions", label: "Int.", color: "" },
                                        { key: "key_interceptions", label: "Key Int.", color: "" },
                                        { key: "possessions_lost", label: "Poss Lost", color: "text-red-400" },
                                        { key: "gk_saves", label: "Saves", color: "text-yellow-400" },
                                        { key: "gk_catches", label: "Catches", color: "text-yellow-400" },
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

                  {/* Score Mismatch Warning */}
                  {(() => {
                    const ed = editingGroup?.editedData;
                    if (!ed) return null;
                    const mismatches: { name: string; actual: number; expected: number }[] = [];
                    for (const side of ["home_team", "away_team"] as const) {
                      const players = ed[side]?.players ?? [];
                      for (const p of players) {
                        if (p.stats_incomplete) continue;
                        const isBenched = !p.is_starter && p.sub_number !== null && (p.score === 0 || p.score === undefined);
                        if (isBenched) continue;
                        const actual = p.score ?? 0;
                        const expected = calculateExpectedScore(p);
                        if (actual !== expected) {
                          mismatches.push({ name: p.name || p.user_id || "Unknown", actual, expected });
                        }
                      }
                    }
                    return mismatches.length > 0 ? (
                      <div className="mx-4 mb-2 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                        <div className="text-red-400 text-sm font-semibold mb-1">⚠️ Score Mismatch — Import Blocked</div>
                        {mismatches.map((m, i) => (
                          <div key={i} className="text-red-300 text-xs">{m.name}: actual {m.actual} vs expected {m.expected} (diff {m.actual - m.expected > 0 ? "+" : ""}{m.actual - m.expected})</div>
                        ))}
                        <div className="text-red-400/70 text-xs mt-1">Fix the player stats so scores add up before importing.</div>
                      </div>
                    ) : null;
                  })()}

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
                        const ed = editingGroup?.editedData;
                        if (ed) {
                          // Block import if any player has a score mismatch (stats don't add up)
                          for (const side of ["home_team", "away_team"] as const) {
                            const players = ed[side]?.players ?? [];
                            for (const p of players) {
                              if (p.stats_incomplete) continue;
                              const isBenched = !p.is_starter && p.sub_number !== null && (p.score === 0 || p.score === undefined);
                              if (isBenched) continue;
                              const actual = p.score ?? 0;
                              const expected = calculateExpectedScore(p);
                              if (actual !== expected) {
                                alert(`⚠️ Score mismatch for ${p.name || p.user_id || "Unknown"}: actual ${actual} vs expected ${expected}. Fix player stats before importing.`);
                                return;
                              }
                            }
                          }
                        }
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

            {/* ===== TEST VERSION: Match Screenshot Import ===== */}
            <div className="bg-gray-900 border-2 border-yellow-500/40 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-yellow-400">🧪 TEST VERSION — Import Match Results from Screenshots (AI)</h2>
                  <p className="text-gray-400 text-sm mt-1">Uses <code className="text-yellow-300 bg-gray-800 px-1 rounded">/api/admin/extract-match-test</code> — modify that file to experiment. Import still goes through the normal route.</p>
                  <p className="text-gray-400 text-sm mt-1">
                    ✂️ <Link href="/admin/cut-test" className="text-sky-400 hover:underline">Open Row Cutter</Link> — auto-slice each player's stats into separate strips (preview only, no AI yet).
                  </p>
                </div>
                <button
                  onClick={addTestMatchGroup}
                  className="bg-yellow-600 hover:bg-yellow-700 text-white font-medium py-2 px-4 rounded-lg transition flex items-center gap-2"
                >
                  <span className="text-lg">+</span> Add Match Group
                </button>
              </div>

              <div className="space-y-4">
                {testMatchGroups.map((group, groupIndex) => (
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
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="bg-yellow-700 text-white font-bold px-3 py-1 rounded-full text-sm">Match {groupIndex + 1}</span>
                        {group.status === "extracting" && <span className="text-amber-400 text-sm flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Extracting (TEST)...</span>}
                        {group.status === "validating" && <span className="text-purple-400 text-sm flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Validating players...</span>}
                        {group.status === "importing" && <span className="text-blue-400 text-sm flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Importing...</span>}
                        {group.status === "validated" && group.validationStats && <span className="text-amber-400 text-sm">✓ Extracted - {group.validationStats.playersNeedingReview > 0 ? <span className="text-red-400">{group.validationStats.playersNeedingReview} player(s) need review</span> : "All players matched"}</span>}
                        {group.status === "imported" && <span className="text-emerald-400 text-sm">✓ Imported successfully</span>}
                        {group.status === "error" && <span className="text-red-400 text-sm">⚠ Error: {group.error}</span>}
                      </div>
                      <button onClick={() => removeTestMatchGroup(group.id)} className="text-gray-500 hover:text-red-400 transition p-1" title="Remove group">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>

                    {group.status === "imported" && group.importResult && (
                      <div className={`mb-4 p-4 rounded-lg ${group.importResult.fixtureUpdated ? "bg-purple-500/20 border border-purple-500/30" : "bg-emerald-500/20 border border-emerald-500/30"}`}>
                        <h4 className={`${group.importResult.fixtureUpdated ? "text-purple-300" : "text-emerald-300"} font-semibold mb-2`}>{group.importResult.fixtureUpdated ? "✅ Fixture Updated!" : "✅ Match Imported!"}</h4>
                        <p className="text-white text-lg font-medium">{group.importResult.match?.home_team} {group.importResult.match?.home_score} - {group.importResult.match?.away_score} {group.importResult.match?.away_team}</p>
                        {group.importResult.league && <p className="text-blue-300 text-sm mt-1">League: {group.importResult.league.name}</p>}
                        <p className="text-gray-400 text-sm mt-1">Players: {group.importResult.stats?.playerStatsCount || 0} • Matched: {group.importResult.stats?.playersMatched?.length || 0} • Created: {group.importResult.stats?.playersCreated?.length || 0}</p>
                        {group.importResult.stats?.playersNeedingReview?.length > 0 && <p className="text-amber-400 text-sm mt-1">⚠️ Low-confidence auto-matches: {group.importResult.stats.playersNeedingReview.join(", ")}</p>}
                      </div>
                    )}

                    {group.status !== "imported" && (
                      <>
                        <div className="mb-4">
                          <label className="block text-gray-300 mb-2 text-sm">League</label>
                          <select value={group.leagueId} onChange={(e) => updateTestGroup(group.id, { leagueId: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-yellow-500 focus:outline-none">
                            <option value="auto">🔍 Auto (find fixture)</option>
                            <option value="">No league (create new match)</option>
                            {leagues.map((l) => <option key={l.id} value={l.id}>{l.name} {l.season ? `(${l.season})` : ""}</option>)}
                          </select>
                        </div>

                        <div className="mb-4">
                          <label className="block text-gray-300 mb-2 text-sm">Match Screenshots</label>
                          <button type="button" onClick={() => pasteTestGroupImageFromClipboard(group.id)} className="mb-3 w-full flex items-center justify-center gap-2 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-500/30 text-yellow-300 font-medium py-3 px-4 rounded-lg transition">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                            Paste Image from Clipboard
                          </button>
                          <div className="rounded-lg border-2 border-dashed border-yellow-600/40 p-6 text-center hover:border-yellow-500/60 focus-within:border-yellow-500 transition cursor-pointer" onPaste={(e) => handleTestPasteGroupImages(group.id, e)} tabIndex={0}>
                            <input type="file" accept="image/*" multiple onChange={(e) => handleTestGroupImageChange(group.id, e)} className="hidden" id={`test-match-image-upload-${group.id}`} />
                            <label htmlFor={`test-match-image-upload-${group.id}`} className="cursor-pointer">
                              <div className="text-3xl mb-2">🧪</div>
                              <p className="text-gray-400">Click to browse files</p>
                              <p className="text-xs text-gray-500 mt-1">Or focus here and press Ctrl+V</p>
                            </label>
                          </div>
                        </div>

                        {group.previews.length > 0 && (
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm text-gray-400">{group.previews.length} image(s) ready</span>
                              <button onClick={() => updateTestGroup(group.id, { images: [], previews: [] })} className="text-xs text-red-400 hover:text-red-300">Clear all</button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {group.previews.map((preview, index) => (
                                <div key={index} className="relative inline-block">
                                  <img src={preview} alt={`Preview ${index + 1}`} className="h-20 rounded-lg border border-gray-600" />
                                  <button onClick={() => removeTestGroupImage(group.id, index)} className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">×</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          {(group.status === "idle" || group.status === "error") && (
                            <>
                              <button onClick={() => handleTestExtractGroup(group.id)} disabled={group.images.length === 0} className="flex-1 min-w-[150px] bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded transition">Extract & Validate (TEST)</button>
                              <button onClick={() => handleTestDirectImportGroup(group.id)} disabled={group.images.length === 0} className="flex-1 min-w-[150px] bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded transition">Direct Import</button>
                            </>
                          )}
                          {group.status === "validated" && (
                            <>
                              <label className="w-full flex items-center gap-2 cursor-pointer select-none text-sm text-gray-300">
                                <input type="checkbox" checked={keepFixtureDate} onChange={e => setKeepFixtureDate(e.target.checked)} className="w-4 h-4 rounded accent-yellow-500" />
                                Keep original fixture date <span className="text-gray-500 font-normal">(uncheck to set date to now)</span>
                              </label>
                              <button onClick={() => setTestEditingGroupId(group.id)} className="flex-1 min-w-[150px] bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 px-4 rounded transition flex items-center justify-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                Review & Edit
                              </button>
                              <button onClick={() => handleTestImportGroup(group.id)} className="flex-1 min-w-[150px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded transition">Import Match</button>
                              <button onClick={() => updateTestGroup(group.id, { status: "idle", extractedData: null, editedData: null, teamRosters: null, validationStats: null })} className="bg-gray-700 hover:bg-gray-600 text-gray-300 py-2.5 px-4 rounded transition">Reset</button>
                            </>
                          )}
                        </div>

                        {group.status === "validated" && group.editedData && (
                          <div className="mt-4 p-3 bg-gray-800 rounded-lg">
                            <div className="flex items-center justify-center gap-4 text-lg font-bold">
                              <span className="text-blue-400">{group.editedData.home_team?.team_name}</span>
                              <span className="text-white">{group.editedData.home_team?.goals ?? 0} - {group.editedData.away_team?.goals ?? 0}</span>
                              <span className="text-red-400">{group.editedData.away_team?.team_name}</span>
                            </div>
                            <div className="text-center text-gray-500 text-sm mt-1">{group.editedData.home_team?.players?.length || 0} + {group.editedData.away_team?.players?.length || 0} players extracted</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* TEST Edit Modal */}
            {testEditingGroupId && testEditingGroup && testEditingGroup.editedData && (
              <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-y-auto">
                <div className="bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-y-auto">
                  <div className="sticky top-0 bg-gray-800 border-b border-yellow-700/50 p-4 flex items-center justify-between z-10">
                    <div>
                      <h3 className="text-lg font-semibold text-yellow-400">🧪 TEST — Review & Edit Players</h3>
                      {testEditingGroup.validationStats && testEditingGroup.validationStats.playersNeedingReview > 0 && <p className="text-sm text-red-400 mt-1">⚠️ {testEditingGroup.validationStats.playersNeedingReview} player(s) need manual selection</p>}
                    </div>
                    <button onClick={() => setTestEditingGroupId(null)} className="text-gray-400 hover:text-white p-2">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>

                  <div className="p-4 space-y-6">
                    <div className="bg-gray-900 p-4 rounded-lg">
                      <div className="flex items-center justify-center gap-4 text-2xl font-bold">
                        <div className="text-right flex-1">
                          <input type="text" value={testEditingGroup.editedData.home_team?.team_name || ""} onChange={(e) => updateTestGroupPreviewTeam(testEditingGroupId, "home", "team_name", e.target.value)} className="bg-transparent border-b border-gray-600 text-white text-right w-full focus:border-yellow-500 focus:outline-none" />
                          {testEditingGroup.editedData.home_team?._team_match
                            ? <p className="text-xs font-normal text-emerald-400 text-right mt-1">✓ detected: {testEditingGroup.editedData.home_team._team_match.name}</p>
                            : <p className="text-xs font-normal text-amber-400 text-right mt-1">⚠ no matching team — a new one will be created</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="number" value={testEditingGroup.editedData.home_team?.goals ?? 0} onChange={(e) => updateTestGroupPreviewTeam(testEditingGroupId, "home", "goals", parseInt(e.target.value) || 0)} className="w-12 bg-gray-700 text-white text-center rounded p-1" />
                          <span className="text-gray-400">-</span>
                          <input type="number" value={testEditingGroup.editedData.away_team?.goals ?? 0} onChange={(e) => updateTestGroupPreviewTeam(testEditingGroupId, "away", "goals", parseInt(e.target.value) || 0)} className="w-12 bg-gray-700 text-white text-center rounded p-1" />
                        </div>
                        <div className="text-left flex-1">
                          <input type="text" value={testEditingGroup.editedData.away_team?.team_name || ""} onChange={(e) => updateTestGroupPreviewTeam(testEditingGroupId, "away", "team_name", e.target.value)} className="bg-transparent border-b border-gray-600 text-white w-full focus:border-yellow-500 focus:outline-none" />
                          {testEditingGroup.editedData.away_team?._team_match
                            ? <p className="text-xs font-normal text-emerald-400 text-left mt-1">✓ detected: {testEditingGroup.editedData.away_team._team_match.name}</p>
                            : <p className="text-xs font-normal text-amber-400 text-left mt-1">⚠ no matching team — a new one will be created</p>}
                        </div>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      {(["home", "away"] as const).map((side) => {
                        const team = side === "home" ? testEditingGroup.editedData.home_team : testEditingGroup.editedData.away_team;
                        const players2 = team?.players || [];
                        const roster = side === "home" ? testEditingGroup.teamRosters?.home : testEditingGroup.teamRosters?.away;

                        return (
                          <div key={side} className="bg-gray-900 p-4 rounded-lg">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className={`font-semibold ${side === "home" ? "text-blue-400" : "text-red-400"}`}>{team?.team_name || (side === "home" ? "Home" : "Away")} Players ({players2.length})</h4>
                              <button onClick={() => addTestGroupPreviewPlayer(testEditingGroupId, side)} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded">+ Add</button>
                            </div>

                            <div className="space-y-3 max-h-[500px] overflow-y-auto">
                              {players2.map((player: any, idx: number) => {
                                const matchResult = player.matchResult;
                                const needsReview = matchResult?.needsUserReview;
                                const suggestions = matchResult?.suggestions || [];
                                const isBenched = !player.is_starter && player.sub_number !== null && (player.score === 0 || player.score === undefined);

                                return (
                                  <div key={idx} className={cx("p-3 rounded-lg border", needsReview ? "bg-red-900/20 border-red-500/50" : isBenched ? "bg-gray-800/50 border-gray-700" : "bg-gray-800 border-gray-700")}>
                                    {player._strip && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={player._strip} alt={`source row for ${player.name || idx + 1}`} title="Click to zoom — source row this player's stats were read from" onClick={() => setZoomedStrip(player._strip)} className="w-full rounded mb-2 border border-gray-700 bg-black/20 cursor-zoom-in hover:border-yellow-500/60 transition" />
                                    )}
                                    <div className="flex items-center gap-2 mb-2">
                                      <select value={player.position || ""} onChange={(e) => updateTestGroupPreviewPlayer(testEditingGroupId, side, idx, "position", e.target.value)} className="bg-gray-700 text-white text-xs rounded px-2 py-1 w-16">
                                        {["GK", "LB", "CB", "RB", "LWB", "RWB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "LF", "RF", "CF", "ST"].map(pos => <option key={pos} value={pos}>{pos}</option>)}
                                      </select>
                                      <input type="text" value={player.name || ""} onChange={(e) => updateTestGroupPreviewPlayer(testEditingGroupId, side, idx, "name", e.target.value)} className="bg-gray-700 text-white text-sm rounded px-2 py-1 flex-1" placeholder="Player name" />
                                      <ConfidenceBadge confidence={matchResult?.confidence || 0} />
                                      <button onClick={() => removeTestGroupPreviewPlayer(testEditingGroupId, side, idx)} className="text-red-400 hover:text-red-300 text-sm px-2">✕</button>
                                    </div>

                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="text-xs text-gray-500">ID:</span>
                                      <input type="text" value={player.user_id || ""} onChange={(e) => updateTestGroupPreviewPlayer(testEditingGroupId, side, idx, "user_id", e.target.value)} className="bg-gray-700 text-white text-xs rounded px-2 py-1 flex-1 font-mono" placeholder="Player ID (8 chars)" />
                                      {matchResult?.matchMethod && <span className="text-xs text-gray-500">{matchResult.matchMethod}</span>}
                                    </div>

                                    {(needsReview || suggestions.length > 0) && (
                                      <div className="mb-2 p-2 bg-gray-900 rounded">
                                        <label className="block text-xs text-amber-400 mb-1">{needsReview ? "⚠️ Select correct player:" : "Suggestions:"}</label>
                                        <select value={matchResult?.playerId || ""} onChange={(e) => {
                                          const selectedId = e.target.value;
                                          if (selectedId === "__new__") {
                                            updateTestGroupPreviewPlayer(testEditingGroupId, side, idx, "matchResult", { ...matchResult, playerId: null, confidence: 0, matchMethod: "create_new", needsUserReview: false });
                                          } else if (selectedId) {
                                            const allOptions = [...suggestions, ...(roster || [])];
                                            const selected = allOptions.find((p: any) => (p.id || p.player?.id) === selectedId);
                                            if (selected) selectTestPlayerForMatch(testEditingGroupId, side, idx, selected.player || selected);
                                          }
                                        }} className="w-full bg-gray-700 text-white text-xs rounded p-2">
                                          <option value="">-- Select player --</option>
                                          {suggestions.length > 0 && <optgroup label="Suggestions">{suggestions.map((s: any) => <option key={s.id} value={s.id}>{s.name || 'Unknown'} ({s.game_user_id}) - {s.confidence}%</option>)}</optgroup>}
                                          {roster && roster.length > 0 && <optgroup label="Team Roster (recent)">{roster.filter((p: Player) => !suggestions.some((s: any) => s.id === p.id)).slice(0, 15).map((p: Player) => <option key={p.id} value={p.id}>{p.name || 'Unknown'} ({p.game_user_id || '—'})</option>)}</optgroup>}
                                          <optgroup label="Other"><option value="__new__">➕ Create new player</option></optgroup>
                                        </select>
                                      </div>
                                    )}

                                    <div className="flex items-center gap-2 mb-2">
                                      <label className="flex items-center gap-1 text-xs text-gray-400">
                                        <input type="checkbox" checked={player.is_starter ?? true} onChange={(e) => { updateTestGroupPreviewPlayer(testEditingGroupId, side, idx, "is_starter", e.target.checked); if (e.target.checked) updateTestGroupPreviewPlayer(testEditingGroupId, side, idx, "sub_number", null); }} className="rounded bg-gray-600" />
                                        Starter
                                      </label>
                                      {!player.is_starter && <input type="number" value={player.sub_number || ""} onChange={(e) => updateTestGroupPreviewPlayer(testEditingGroupId, side, idx, "sub_number", parseInt(e.target.value) || null)} className="bg-gray-700 text-white text-xs rounded px-2 py-1 w-16" placeholder="Sub#" />}
                                    </div>

                                    {(() => {
                                      const expected = calculateExpectedScore(player);
                                      const actual = player.score ?? 0;
                                      const diff = actual - expected;
                                      const mismatch = !player.stats_incomplete && diff !== 0;
                                      return mismatch ? <div className={`text-xs px-2 py-1 rounded mb-1 ${Math.abs(diff) > 50 ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>Score mismatch: actual {actual} vs expected {expected} (diff {diff > 0 ? "+" : ""}{diff})</div> : null;
                                    })()}

                                    <div className="grid grid-cols-5 gap-1 text-xs">
                                      {[{ key: "score", label: "Score", color: "text-amber-400" }, { key: "goals", label: "Goals", color: "text-emerald-400" }, { key: "assists", label: "Assists", color: "text-sky-400" }, { key: "shots", label: "Shots", color: "" }, { key: "shots_on_target", label: "On Target", color: "" }, { key: "passes", label: "Passes", color: "" }, { key: "key_passes", label: "Key Pass", color: "" }, { key: "tackles", label: "Tackles", color: "" }, { key: "key_tackles", label: "Key Tack", color: "" }, { key: "interceptions", label: "Int.", color: "" }, { key: "key_interceptions", label: "Key Int.", color: "" }, { key: "possessions_lost", label: "Poss Lost", color: "text-red-400" }, { key: "gk_saves", label: "Saves", color: "text-yellow-400" }, { key: "gk_catches", label: "Catches", color: "text-yellow-400" }].map(({ key, label, color }) => (
                                        <div key={key} className="flex flex-col">
                                          <span className={`text-gray-500 ${color}`}>{label}</span>
                                          <input type="number" value={player[key] ?? 0} onChange={(e) => updateTestGroupPreviewPlayer(testEditingGroupId, side, idx, key, parseInt(e.target.value) || 0)} className="bg-gray-700 text-white rounded px-1 py-0.5 text-xs w-full" />
                                        </div>
                                      ))}
                                    </div>

                                    {isBenched && <div className="mt-2 text-xs text-gray-500 flex items-center gap-1"><span className="bg-gray-700 px-2 py-0.5 rounded">Benched</span></div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(() => {
                    const ed = testEditingGroup?.editedData;
                    if (!ed) return null;
                    const mismatches: { name: string; actual: number; expected: number }[] = [];
                    for (const side of ["home_team", "away_team"] as const) {
                      for (const p of ed[side]?.players ?? []) {
                        if (p.stats_incomplete) continue;
                        const isBenched = !p.is_starter && p.sub_number !== null && (p.score === 0 || p.score === undefined);
                        if (isBenched) continue;
                        const actual = p.score ?? 0;
                        const expected = calculateExpectedScore(p);
                        if (actual !== expected) mismatches.push({ name: p.name || p.user_id || "Unknown", actual, expected });
                      }
                    }
                    return mismatches.length > 0 ? (
                      <div className="mx-4 mb-2 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                        <div className="text-red-400 text-sm font-semibold mb-1">⚠️ Score Mismatch — Import Blocked</div>
                        {mismatches.map((m, i) => <div key={i} className="text-red-300 text-xs">{m.name}: actual {m.actual} vs expected {m.expected} (diff {m.actual - m.expected > 0 ? "+" : ""}{m.actual - m.expected})</div>)}
                        <div className="text-red-400/70 text-xs mt-1">Fix the player stats so scores add up before importing.</div>
                      </div>
                    ) : null;
                  })()}

                  <div className="sticky bottom-0 bg-gray-800 border-t border-gray-700 p-4 flex gap-3">
                    <button onClick={() => setTestEditingGroupId(null)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-4 rounded transition">Save & Close</button>
                    <button onClick={() => {
                      const ed = testEditingGroup?.editedData;
                      if (ed) {
                        for (const side of ["home_team", "away_team"] as const) {
                          for (const p of ed[side]?.players ?? []) {
                            if (p.stats_incomplete) continue;
                            const isBenched = !p.is_starter && p.sub_number !== null && (p.score === 0 || p.score === undefined);
                            if (isBenched) continue;
                            const actual = p.score ?? 0;
                            const expected = calculateExpectedScore(p);
                            if (actual !== expected) { alert(`⚠️ Score mismatch for ${p.name || p.user_id || "Unknown"}: actual ${actual} vs expected ${expected}. Fix player stats before importing.`); return; }
                          }
                        }
                      }
                      handleTestImportGroup(testEditingGroupId);
                      setTestEditingGroupId(null);
                    }} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded transition">✓ Save & Import</button>
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
              <p className="text-gray-400 text-sm mb-3">Paste match JSON. Players will be matched automatically — you can review & confirm before importing.</p>
              <textarea value={jsonData} onChange={(e) => setJsonData(e.target.value)} className="w-full h-64 p-4 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono text-sm" placeholder="Paste match JSON here..." />
              <button onClick={handleImport} disabled={loading || !jsonData.trim()} className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded transition">
                {loading ? "Matching players..." : "Parse & Match Players"}
              </button>
            </div>
          </div>
        )}

        {/* Other tabs remain the same but shortened for brevity */}
        {activeTab === "leagues" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingLeague ? "Edit League" : "Add New League"}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div><label className="block text-gray-300 mb-2 text-sm">Name *</label><input type="text" value={leagueForm.name} onChange={(e) => setLeagueForm({ ...leagueForm, name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="League name" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Season</label><input type="text" value={leagueForm.season} onChange={(e) => setLeagueForm({ ...leagueForm, season: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="2024" /></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <div><label className="block text-gray-300 mb-2 text-sm">Format</label><select value={leagueForm.format} onChange={(e) => setLeagueForm({ ...leagueForm, format: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600"><option value="league">League</option><option value="knockout">Knockout</option><option value="group_knockout">Group + Knockout</option></select></div>
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Tier <span className="text-gray-500 font-normal">(affects player ratings)</span></label>
                  <select value={leagueForm.tier} onChange={(e) => setLeagueForm({ ...leagueForm, tier: parseInt(e.target.value) })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600">
                    <option value={1}>Tier 1 – Elite (+5 rating pts)</option>
                    <option value={2}>Tier 2 – Standard</option>
                    <option value={3}>Tier 3 – Amateur (−5 rating pts)</option>
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-gray-300 mb-2 text-sm">League Logo</label>
                <div className="flex gap-3 items-center">
                  {[
                    { value: "cd", src: "/cd.png", label: "CD", filter: "invert(1)" },
                    { value: "pl", src: "/pl.png", label: "PL", filter: "invert(1)" },
                    { value: "cl", src: "/cl.png", label: "CL", filter: "invert(1) hue-rotate(180deg) brightness(1.1)" },
                    { value: "ml", src: "/ml.png", label: "ML", filter: "invert(1) hue-rotate(180deg) brightness(1.1)" },
                  ].map(({ value, src, label, filter }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLeagueForm({ ...leagueForm, image: leagueForm.image === value ? "" : value })}
                      className={`flex flex-col items-center gap-1 p-2 rounded border-2 transition ${leagueForm.image === value ? "border-blue-500 bg-blue-500/20" : "border-gray-600 bg-gray-700 hover:border-gray-500"}`}
                    >
                      <img src={src} alt={label} style={{ width: 40, height: 40, filter }} />
                      <span className="text-xs text-gray-300">{label}</span>
                    </button>
                  ))}
                  {leagueForm.image && (
                    <button type="button" onClick={() => setLeagueForm({ ...leagueForm, image: "" })} className="text-xs text-gray-500 hover:text-gray-300 ml-1">
                      Clear
                    </button>
                  )}
                  {!leagueForm.image && <span className="text-xs text-gray-500">No logo selected</span>}
                </div>
              </div>
              {/* Zone Configuration */}
              <div className="mt-4">
                <label className="block text-gray-300 mb-2 text-sm">Zone Configuration <span className="text-gray-500 font-normal">(highlights standings rows — e.g. Promotion, Playoff, Relegation)</span></label>
                {leagueForm.zones.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {leagueForm.zones.map((zone, i) => (
                      <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded text-sm ${editingZoneIdx === i ? "bg-blue-900/40 border border-blue-500/40" : "bg-gray-700/60"}`}>
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: zone.color }} />
                        <span className="text-white flex-1">{zone.type === "top" ? "▲" : "▼"} {zone.name} · {zone.spots} spot{zone.spots !== 1 ? "s" : ""}</span>
                        <button type="button" onClick={() => { setEditingZoneIdx(i); setNewZone({ ...zone }); }} className="text-blue-400 hover:text-blue-300 text-xs">Edit</button>
                        <button type="button" onClick={() => { setLeagueForm({ ...leagueForm, zones: leagueForm.zones.filter((_, j) => j !== i) }); if (editingZoneIdx === i) { setEditingZoneIdx(null); setNewZone({ name: "", color: "#4ade80", spots: 1, type: "top" }); } }} className="text-red-400 hover:text-red-300 text-xs font-bold">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={newZone.type} onChange={(e) => setNewZone({ ...newZone, type: e.target.value as "top" | "bottom" })} className="p-2 rounded bg-gray-700 text-white border border-gray-600 text-sm">
                    <option value="top">▲ From top</option>
                    <option value="bottom">▼ From bottom</option>
                  </select>
                  <input type="text" value={newZone.name} onChange={(e) => setNewZone({ ...newZone, name: e.target.value })} placeholder="Zone name (e.g. Promotion)" className="p-2 rounded bg-gray-700 text-white border border-gray-600 text-sm w-48" />
                  <input type="number" min={1} max={20} value={newZone.spots} onChange={(e) => setNewZone({ ...newZone, spots: Math.max(1, parseInt(e.target.value) || 1) })} className="p-2 rounded bg-gray-700 text-white border border-gray-600 text-sm w-20" title="Number of spots" />
                  <input type="color" value={newZone.color} onChange={(e) => setNewZone({ ...newZone, color: e.target.value })} className="w-10 h-9 rounded cursor-pointer border border-gray-600 bg-gray-700" title="Zone color" />
                  {editingZoneIdx !== null ? (
                    <>
                      <button type="button" onClick={() => { if (!newZone.name.trim()) return; const updated = [...leagueForm.zones]; updated[editingZoneIdx] = { ...newZone, name: newZone.name.trim() }; setLeagueForm({ ...leagueForm, zones: updated }); setEditingZoneIdx(null); setNewZone({ name: "", color: "#4ade80", spots: 1, type: "top" }); }} disabled={!newZone.name.trim()} className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm py-2 px-3 rounded">Update Zone</button>
                      <button type="button" onClick={() => { setEditingZoneIdx(null); setNewZone({ name: "", color: "#4ade80", spots: 1, type: "top" }); }} className="bg-gray-600 hover:bg-gray-500 text-white text-sm py-2 px-3 rounded">Cancel</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => { if (!newZone.name.trim()) return; setLeagueForm({ ...leagueForm, zones: [...leagueForm.zones, { ...newZone, name: newZone.name.trim() }] }); setNewZone({ name: "", color: "#4ade80", spots: 1, type: "top" }); }} disabled={!newZone.name.trim()} className="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm py-2 px-3 rounded">+ Add Zone</button>
                  )}
                </div>
              </div>
              <div className="mt-4">
                <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
                  <input type="checkbox" checked={leagueForm.use_tier_bonus} onChange={(e) => setLeagueForm({ ...leagueForm, use_tier_bonus: e.target.checked })} className="w-4 h-4 rounded accent-blue-500" />
                  <span className="text-gray-300 text-sm">Apply tier bonus <span className="text-gray-500 font-normal">(uncheck for cups/champions leagues — only domestic leagues should affect tier rating)</span></span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer select-none w-fit mt-3">
                  <input type="checkbox" checked={leagueForm.award_champion} onChange={(e) => setLeagueForm({ ...leagueForm, award_champion: e.target.checked })} className="w-4 h-4 rounded accent-yellow-500" />
                  <span className="text-gray-300 text-sm">Award champion <span className="text-gray-500 font-normal">(uncheck to prevent the top team from receiving a championship badge)</span></span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer select-none w-fit mt-3">
                  <input type="checkbox" checked={leagueForm.ended} onChange={(e) => setLeagueForm({ ...leagueForm, ended: e.target.checked })} className="w-4 h-4 rounded accent-orange-500" />
                  <span className="text-gray-300 text-sm">Season ended <span className="text-gray-500 font-normal">(blocks new results)</span></span>
                </label>
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
                      <div className="flex items-center gap-2">
                        {l.image && <img src={`/${l.image}.png`} alt={l.image} style={{ width: 24, height: 24, opacity: 0.8, filter: ["cl","ml"].includes(l.image) ? "invert(1) hue-rotate(180deg) brightness(1.1)" : "invert(1)" }} />}
                        <span className="text-white font-medium">{l.name}</span>
                        {l.season && <span className="text-gray-400 ml-1">({l.season})</span>}
                        {l.ended && <span className="text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/40 px-2 py-0.5 rounded">ENDED</span>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleToggleLeagueEnded(l)} className={`text-sm ${l.ended ? "text-green-400 hover:text-green-300" : "text-orange-400 hover:text-orange-300"}`}>{l.ended ? "Reopen" : "End Season"}</button>
                        <button onClick={() => handleEditLeague(l)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                        <button onClick={() => handleDeleteLeague(l.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
                      </div>
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
                    {leagues.map((l) => {
                      const checked = teamForm.league_ids.includes(l.id);
                      return (
                        <div key={l.id} className="flex items-center gap-2 hover:bg-gray-600 p-1 rounded">
                          <input type="checkbox" checked={checked} onChange={(e) => {
                            if (e.target.checked) {
                              setTeamForm({ ...teamForm, league_ids: [...teamForm.league_ids, l.id] });
                            } else {
                              const { [l.id]: _, ...rest } = teamForm.group_assignments;
                              setTeamForm({ ...teamForm, league_ids: teamForm.league_ids.filter(id => id !== l.id), group_assignments: rest });
                            }
                          }} className="rounded bg-gray-600 cursor-pointer" />
                          <span className="text-white text-sm flex-1">{l.name}{l.season ? <span className="text-gray-400 ml-1">({l.season})</span> : null}</span>
                          {checked && (
                            <input
                              type="text"
                              value={teamForm.group_assignments[l.id] || ""}
                              onChange={(e) => setTeamForm({ ...teamForm, group_assignments: { ...teamForm.group_assignments, [l.id]: e.target.value } })}
                              placeholder="Group (e.g. A)"
                              className="w-28 px-2 py-0.5 text-xs rounded bg-gray-600 text-white border border-gray-500 placeholder-gray-400"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
                  <input type="checkbox" checked={teamForm.no_elo} onChange={(e) => setTeamForm({ ...teamForm, no_elo: e.target.checked })} className="w-4 h-4 rounded accent-red-500" />
                  <span className="text-gray-300 text-sm">Disable ELO <span className="text-gray-500 font-normal">(exclude this team from ELO calculations)</span></span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
                  <input type="checkbox" checked={teamForm.disbanded} onChange={(e) => setTeamForm({ ...teamForm, disbanded: e.target.checked })} className="w-4 h-4 rounded accent-red-500" />
                  <span className="text-gray-300 text-sm">Disbanded <span className="text-gray-500 font-normal">(all results in active leagues become 3-0 forfeit to the opponent — ended leagues are untouched, existing player stats are kept)</span></span>
                </label>
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
              <div className="flex items-center justify-between mb-4 gap-4">
                <h2 className="text-lg font-semibold text-white whitespace-nowrap">Teams ({teams.length})</h2>
                <input
                  type="text"
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  placeholder="Search teams..."
                  className="flex-1 max-w-xs px-3 py-1.5 text-sm rounded bg-gray-700 text-white border border-gray-600 placeholder-gray-400"
                />
              </div>
              {teams.length === 0 ? <p className="text-gray-400">No teams yet.</p> : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {teams.filter(t => t.name.toLowerCase().includes(teamSearch.toLowerCase())).map((t) => (
                    <div key={t.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                      <span className="text-white font-medium">{t.name}{t.disbanded && <span className="ml-2 text-xs text-red-400 font-semibold">[DISBANDED]</span>}</span>
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div><label className="block text-gray-300 mb-2 text-sm">Name</label><input type="text" value={playerForm.name} onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="Player name" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Handle</label><input type="text" value={playerForm.handle} onChange={(e) => setPlayerForm({ ...playerForm, handle: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="@handle" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Game User ID</label><input type="text" value={playerForm.game_user_id} onChange={(e) => setPlayerForm({ ...playerForm, game_user_id: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="8-char ID" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Discord ID</label><input type="text" value={playerForm.discord_id} onChange={(e) => setPlayerForm({ ...playerForm, discord_id: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="Discord user ID" /></div>
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
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Players ({players.length})</h2>
                <input
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  placeholder="Search players..."
                  className="p-2 rounded bg-gray-700 text-white border border-gray-600 text-sm w-56"
                />
              </div>
              {players.length === 0 ? <p className="text-gray-400">No players yet.</p> : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {players.filter((p) => {
                    const q = playerSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (p.name ?? "").toLowerCase().includes(q) ||
                           (p.handle ?? "").toLowerCase().includes(q) ||
                           (p.game_user_id ?? "").toLowerCase().includes(q);
                  }).map((p) => (
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
              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Group Name</label>
                  <input type="text" value={fixtureForm.group_name} onChange={(e) => setFixtureForm({ ...fixtureForm, group_name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="e.g. Group A" />
                </div>
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Stage</label>
                  <input type="text" value={fixtureForm.stage} onChange={(e) => setFixtureForm({ ...fixtureForm, stage: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600" placeholder="e.g. Semifinal, Final, group" />
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-gray-300 mb-2 text-sm">Forfeit</label>
                <select
                  value={fixtureForm.forfeited_by}
                  onChange={(e) => setFixtureForm({ ...fixtureForm, forfeited_by: e.target.value as "" | "home" | "away" })}
                  className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600"
                >
                  <option value="">No forfeit</option>
                  <option value="home">{fixtureForm.home_team || "Home team"} forfeited (−1 pt)</option>
                  <option value="away">{fixtureForm.away_team || "Away team"} forfeited (−1 pt)</option>
                </select>
                {fixtureForm.forfeited_by && (
                  <p className="mt-1 text-xs text-orange-400">
                    {fixtureForm.forfeited_by === "home" ? fixtureForm.home_team || "Home team" : fixtureForm.away_team || "Away team"} will lose 1 point in their league standings.
                  </p>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSaveFixture} disabled={loading || !fixtureForm.played_at || !fixtureForm.home_team || !fixtureForm.away_team} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded">{editingFixture ? "Update" : "Create"} Fixture</button>
                {editingFixture && <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded">Cancel</button>}
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Fixtures ({fixtures.length})</h2>
                <input
                  value={fixtureSearch}
                  onChange={(e) => setFixtureSearch(e.target.value)}
                  placeholder="Search fixtures..."
                  className="p-2 rounded bg-gray-700 text-white border border-gray-600 text-sm w-56"
                />
              </div>
              {fixtures.length === 0 ? <p className="text-gray-400">No fixtures yet.</p> : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {fixtures.filter((f) => {
                    const q = fixtureSearch.trim().toLowerCase();
                    if (!q) return true;
                    return f.home_team.toLowerCase().includes(q) ||
                           f.away_team.toLowerCase().includes(q) ||
                           (f.league as any)?.name?.toLowerCase().includes(q) ||
                           (f.group_name ?? "").toLowerCase().includes(q);
                  }).map((f) => {
                    const isUpcoming = f.home_score === null || f.away_score === null;
                    const isStatsExpanded = expandedFixtureStats === f.id;
                    return (
                      <div key={f.id} className="bg-gray-700 rounded">
                        <div className="flex items-center justify-between p-3">
                          <div>
                            {isUpcoming && <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 mr-2">Upcoming</span>}
                            {f.forfeited_by && <span className="text-xs px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 mr-2">FORFEIT ({f.forfeited_by})</span>}
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
                                    {editingMatchStats.player_stats.length > 0 && (
                                      <table className="w-full text-sm mb-4">
                                        <thead>
                                          <tr className="text-gray-400 text-xs">
                                            <th className="text-left py-1 pr-1 sticky left-0 bg-gray-700">Player</th>
                                            <th className="text-left py-1 pr-1">Side</th>
                                            <th className="text-left py-1 pr-1">Pos</th>
                                            {PLAYER_STAT_FIELDS.map(({ label, key }) => (
                                              <th key={key} className="text-left py-1 pr-1 whitespace-nowrap">{label}</th>
                                            ))}
                                            <th className="text-left py-1 pr-1 whitespace-nowrap">Check</th>
                                            <th className="text-left py-1 pr-1 whitespace-nowrap">Detail</th>
                                            <th className="text-left py-1 pr-1"></th>
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
                                              {(() => {
                                                const expected = calculateExpectedScore(ps);
                                                const actual = ps.score ?? 0;
                                                const diff = actual - expected;
                                                if (ps.stats_incomplete) return <td className="py-1 pr-1 text-gray-500 text-xs">N/A</td>;
                                                if (diff === 0) return <td className="py-1 pr-1 text-green-400 text-xs">OK</td>;
                                                return <td className={`py-1 pr-1 text-xs font-semibold ${Math.abs(diff) > 50 ? "text-red-400" : "text-yellow-400"}`}>{diff > 0 ? "+" : ""}{diff}</td>;
                                              })()}
                                              <td className="py-1 pr-1">
                                                <label className="flex items-center gap-1 cursor-pointer" title={ps.stats_incomplete ? "Stats incomplete — check to mark as complete" : "Stats complete — uncheck to mark incomplete"}>
                                                  <input type="checkbox" checked={!ps.stats_incomplete} onChange={(e) => updatePlayerStat(idx, "stats_incomplete", !e.target.checked)} className="accent-green-500" />
                                                  <span className={`text-xs ${ps.stats_incomplete ? "text-gray-500" : "text-green-400"}`}>{ps.stats_incomplete ? "Inc" : "Full"}</span>
                                                </label>
                                              </td>
                                              <td className="py-1 pr-1">
                                                <button onClick={() => removePlayerFromMatch(idx)} className="text-red-400 hover:text-red-300 text-xs">X</button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                    {editingMatchStats.player_stats.length === 0 && (
                                      <p className="text-gray-400 text-sm mb-4">No player stats recorded for this match.</p>
                                    )}

                                    {/* Add player section */}
                                    <div className="bg-gray-800 p-3 rounded border border-gray-600">
                                      <p className="text-gray-300 text-xs font-semibold mb-2">Add Player</p>
                                      <div className="flex gap-2 items-end flex-wrap">
                                        <div className="flex-1 min-w-[180px]">
                                          <input
                                            type="text"
                                            placeholder="Search player name..."
                                            value={addPlayerSearch}
                                            onChange={(e) => setAddPlayerSearch(e.target.value)}
                                            className="w-full p-1.5 rounded bg-gray-700 text-white border border-gray-600 text-xs"
                                          />
                                        </div>
                                        <select value={addPlayerSide} onChange={(e) => setAddPlayerSide(e.target.value as "home" | "away")} className="p-1.5 rounded bg-gray-700 text-white border border-gray-600 text-xs">
                                          <option value="home">{f.home_team} (Home)</option>
                                          <option value="away">{f.away_team} (Away)</option>
                                        </select>
                                      </div>
                                      {addPlayerSearch.trim().length >= 2 && (() => {
                                        const q = addPlayerSearch.trim().toLowerCase();
                                        const existingIds = new Set(editingMatchStats.player_stats.map(ps => ps.player_id));
                                        const matches = players.filter(p =>
                                          !existingIds.has(p.id) &&
                                          ((p.name?.toLowerCase().includes(q)) || (p.handle?.toLowerCase().includes(q)))
                                        ).slice(0, 8);
                                        return matches.length > 0 ? (
                                          <div className="mt-2 space-y-1">
                                            {matches.map(p => (
                                              <button
                                                key={p.id}
                                                onClick={() => { addPlayerToMatch(p.id, addPlayerSide); setAddPlayerSearch(""); }}
                                                className="block w-full text-left px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs"
                                              >
                                                {p.name || p.handle || p.id.slice(0, 8)}
                                                {p.name && p.handle ? <span className="text-gray-400 ml-2">{p.handle}</span> : null}
                                              </button>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="mt-2 text-gray-500 text-xs">No matching players found.</p>
                                        );
                                      })()}
                                    </div>
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
        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-1">Rating Tier Bonuses</h2>
              <p className="text-gray-400 text-sm mb-6">Adjust the point bonus applied to player ratings based on league tier. Changes affect all rating calculations.</p>
              <div className="space-y-4 max-w-md">
                {tierSettings.map((ts, i) => (
                  <div key={ts.tier} className="flex items-center gap-4">
                    <div className="w-8 text-gray-400 text-sm font-medium">T{ts.tier}</div>
                    <input
                      type="text"
                      value={ts.label}
                      onChange={(e) => {
                        const next = [...tierSettings];
                        next[i] = { ...next[i], label: e.target.value };
                        setTierSettings(next);
                      }}
                      className="flex-1 p-2 rounded bg-gray-700 text-white border border-gray-600 text-sm"
                      placeholder="Label"
                    />
                    <input
                      type="number"
                      value={ts.bonus}
                      onChange={(e) => {
                        const next = [...tierSettings];
                        next[i] = { ...next[i], bonus: parseInt(e.target.value) || 0 };
                        setTierSettings(next);
                      }}
                      className="w-24 p-2 rounded bg-gray-700 text-white border border-gray-600 text-sm text-center"
                      placeholder="Bonus"
                    />
                    <span className="text-gray-500 text-sm w-16">{ts.bonus >= 0 ? `+${ts.bonus}` : ts.bonus} pts</span>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <button
                  onClick={handleSaveTierSettings}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-6 rounded"
                >
                  {loading ? "Saving..." : "Save Tier Settings"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
