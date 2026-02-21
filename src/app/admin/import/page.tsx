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

type MatchGroupStatus = "idle" | "uploading" | "extracting" | "extracted" | "importing" | "imported" | "error";

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
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function generateGroupId(): string {
  return `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export default function AdminDashboardPage() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  
  // Match Groups State (replacing single import state)
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>([
    { id: generateGroupId(), images: [], previews: [], leagueId: "auto", extractedData: null, editedData: null, status: "idle", importResult: null, error: null }
  ]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  
  // Team import state (unchanged)
  const [teamImportImage, setTeamImportImage] = useState<string | null>(null);
  const [teamImportPreview, setTeamImportPreview] = useState<string | null>(null);
  const [teamImportLeagueId, setTeamImportLeagueId] = useState("");
  const [teamImportResult, setTeamImportResult] = useState<any>(null);
  
  // Fixture import state (unchanged)
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

  const [playerForm, setPlayerForm] = useState({ id: "", name: "", handle: "", game_user_id: "" });
  const [editingPlayer, setEditingPlayer] = useState<string | null>(null);

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

  const cancelEdit = () => {
    setEditingLeague(null);
    setEditingTeam(null);
    setEditingPlayer(null);
    setEditingFixture(null);
    setLeagueForm({ id: "", name: "", season: "", format: "league" });
    setTeamForm({ id: "", name: "", league_ids: [] });
    setPlayerForm({ id: "", name: "", handle: "", game_user_id: "" });
    setFixtureForm({ id: "", league_id: "", played_at: "", home_team: "", away_team: "", home_score: "", away_score: "", stage: "", group_name: "", day: "" });
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
    }]);
  };

  const removeMatchGroup = (groupId: string) => {
    if (matchGroups.length === 1) {
      // Reset the only group instead of removing
      updateGroup(groupId, {
        images: [],
        previews: [],
        leagueId: "auto",
        extractedData: null,
        editedData: null,
        status: "idle",
        importResult: null,
        error: null,
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

  const handleExtractGroup = async (groupId: string) => {
    const group = matchGroups.find(g => g.id === groupId);
    if (!group || group.images.length === 0) {
      setMessage({ type: "error", text: "Please upload at least one image" });
      return;
    }

    updateGroup(groupId, { status: "extracting", error: null });

    try {
      const res = await fetch("/api/admin/extract-match", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ images: group.images }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");

      updateGroup(groupId, {
        extractedData: data.extracted,
        editedData: JSON.parse(JSON.stringify(data.extracted)),
        status: "extracted",
      });
      setMessage({ type: "success", text: "Data extracted! Click 'View Stats & Edit' to review." });
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

  // Update player in preview for a specific group
  const updateGroupPreviewPlayer = (groupId: string, teamSide: "home" | "away", playerIndex: number, field: string, value: any) => {
    setMatchGroups(prev => prev.map(g => {
      if (g.id === groupId && g.editedData) {
        const updated = { ...g.editedData };
        const team = teamSide === "home" ? "home_team" : "away_team";
        updated[team] = { ...updated[team] };
        updated[team].players = [...updated[team].players];
        updated[team].players[playerIndex] = {
          ...updated[team].players[playerIndex],
          [field]: value
        };
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  // Update team stats in preview for a specific group
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

  // Remove player from preview for a specific group
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

  // Add player to preview for a specific group
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
          }
        ];
        return { ...g, editedData: updated };
      }
      return g;
    }));
  };

  // ==================== TEAM & FIXTURE IMAGE HANDLERS (unchanged) ====================

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
            {/* Match Screenshot Import - GROUPED */}
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
                      group.status === "extracted" ? "border-amber-500/50 bg-amber-500/5" :
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
                        {group.status === "importing" && (
                          <span className="text-blue-400 text-sm flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Importing...
                          </span>
                        )}
                        {group.status === "extracted" && (
                          <span className="text-amber-400 text-sm">✓ Data extracted - ready to review</span>
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

                    {/* Import Result Display (if imported) */}
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
                          Players extracted: {group.importResult.stats?.homePlayersExtracted || 0} + {group.importResult.stats?.awayPlayersExtracted || 0}
                        </p>
                      </div>
                    )}

                    {/* Group Content (only show when not imported) */}
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
                          {group.status === "idle" || group.status === "error" ? (
                            <>
                              <button
                                onClick={() => handleExtractGroup(group.id)}
                                disabled={group.images.length === 0}
                                className="flex-1 min-w-[150px] bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded transition"
                              >
                                Extract Data
                              </button>
                              <button
                                onClick={() => handleDirectImportGroup(group.id)}
                                disabled={group.images.length === 0}
                                className="flex-1 min-w-[150px] bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded transition"
                              >
                                Direct Import
                              </button>
                            </>
                          ) : group.status === "extracted" ? (
                            <>
                              <button
                                onClick={() => setEditingGroupId(group.id)}
                                className="flex-1 min-w-[150px] bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 px-4 rounded transition flex items-center justify-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                View Stats & Edit
                              </button>
                              <button
                                onClick={() => handleImportGroup(group.id)}
                                className="flex-1 min-w-[150px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded transition"
                              >
                                Import Match
                              </button>
                              <button
                                onClick={() => updateGroup(group.id, { status: "idle", extractedData: null, editedData: null })}
                                className="bg-gray-700 hover:bg-gray-600 text-gray-300 py-2.5 px-4 rounded transition"
                              >
                                Reset
                              </button>
                            </>
                          ) : null}
                        </div>

                        {/* Quick Preview of Extracted Data */}
                        {group.status === "extracted" && group.editedData && (
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

            {/* Edit Modal */}
            {editingGroupId && editingGroup && editingGroup.editedData && (
              <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-y-auto">
                <div className="bg-gray-800 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto">
                  <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between z-10">
                    <h3 className="text-lg font-semibold text-amber-400">📝 Edit Extracted Data - Match {matchGroups.findIndex(g => g.id === editingGroupId) + 1}</h3>
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

                    {/* Team Stats */}
                    <div className="grid md:grid-cols-2 gap-4">
                      {(["home", "away"] as const).map((side) => {
                        const team = side === "home" ? editingGroup.editedData.home_team : editingGroup.editedData.away_team;

                        return (
                          <div key={side} className="bg-gray-900 p-4 rounded-lg">
                            <h4 className={`font-semibold mb-3 ${side === "home" ? "text-blue-400" : "text-red-400"}`}>
                              {team?.team_name || (side === "home" ? "Home" : "Away")} Stats
                            </h4>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              {[
                                { key: "possession", label: "Poss %" },
                                { key: "shots", label: "Shots" },
                                { key: "shots_on_target", label: "On Target" },
                                { key: "passes", label: "Passes" },
                                { key: "key_passes", label: "Key Pass" },
                                { key: "tackles", label: "Tackles" },
                                { key: "interceptions", label: "Int." },
                                { key: "fouls", label: "Fouls" },
                                { key: "corner_kicks", label: "Corners" },
                              ].map(({ key, label }) => (
                                <div key={key} className="flex flex-col">
                                  <span className="text-gray-500 text-xs">{label}</span>
                                  <input
                                    type="number"
                                    value={team?.[key] ?? 0}
                                    onChange={(e) => updateGroupPreviewTeam(editingGroupId, side, key, parseInt(e.target.value) || 0)}
                                    className="bg-gray-700 text-white rounded px-2 py-1 text-sm w-full"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Players */}
                    <div className="grid md:grid-cols-2 gap-4">
                      {(["home", "away"] as const).map((side) => {
                        const team = side === "home" ? editingGroup.editedData.home_team : editingGroup.editedData.away_team;
                        const players = team?.players || [];

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

                            <div className="space-y-2 max-h-80 overflow-y-auto">
                              {players.map((player: any, idx: number) => {
                                const isBenched = !player.is_starter && player.sub_number !== null && (player.score === 0 || player.score === undefined);

                                return (
                                  <div
                                    key={idx}
                                    className={`p-3 rounded-lg border ${isBenched ? "bg-gray-800/50 border-gray-700" : "bg-gray-800 border-gray-700"}`}
                                  >
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
                                      <button
                                        onClick={() => removeGroupPreviewPlayer(editingGroupId, side, idx)}
                                        className="text-red-400 hover:text-red-300 text-sm px-2"
                                      >
                                        ✕
                                      </button>
                                    </div>

                                    <div className="flex items-center gap-2 mb-2">
                                      <input
                                        type="text"
                                        value={player.user_id || ""}
                                        onChange={(e) => updateGroupPreviewPlayer(editingGroupId, side, idx, "user_id", e.target.value)}
                                        className="bg-gray-700 text-white text-xs rounded px-2 py-1 flex-1 font-mono"
                                        placeholder="Player ID"
                                      />
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
                                        Start
                                      </label>
                                      {!player.is_starter && (
                                        <input
                                          type="number"
                                          value={player.sub_number || ""}
                                          onChange={(e) => updateGroupPreviewPlayer(editingGroupId, side, idx, "sub_number", parseInt(e.target.value) || null)}
                                          className="bg-gray-700 text-white text-xs rounded px-2 py-1 w-12"
                                          placeholder="Sub#"
                                        />
                                      )}
                                    </div>

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
                                        (will not count towards stats)
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

            {/* Fixture Screenshot Import (unchanged) */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">📅 Import Fixtures from Screenshot (AI)</h2>
              <p className="text-gray-400 text-sm mb-4">Upload a Discord fixture announcement screenshot. AI will extract fixtures and match them to existing teams and leagues.</p>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2 text-sm">Fixture Screenshot</label>

                {/* Paste Button */}
                <button
                  type="button"
                  onClick={pasteFixtureImageFromClipboard}
                  className="mb-3 w-full flex items-center justify-center gap-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 font-medium py-3 px-4 rounded-lg transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Paste Image from Clipboard
                </button>

                <div
                  className="rounded-lg border-2 border-dashed border-gray-600 p-6 text-center hover:border-gray-500 focus-within:border-purple-500 transition cursor-pointer"
                  onPaste={handlePasteFixtureImage}
                  tabIndex={0}
                >
                  <input type="file" accept="image/*" onChange={handleFixtureImageChange} className="hidden" id="fixture-image-upload" />
                  <label htmlFor="fixture-image-upload" className="cursor-pointer">
                    <div className="text-3xl mb-2">📅</div>
                    <p className="text-gray-400">Click to browse files</p>
                    <p className="text-xs text-gray-500 mt-1">Or focus here and press Ctrl+V</p>
                  </label>
                </div>
              </div>
              {fixtureImportPreview && (
                <div className="mb-4 relative inline-block">
                  <img src={fixtureImportPreview} alt="Fixture preview" className="max-h-64 rounded-lg border border-gray-600" />
                  <button onClick={removeFixtureImage} className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">×</button>
                </div>
              )}
              <button onClick={handleFixtureImageImport} disabled={loading || !fixtureImportImage} className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded transition">
                {loading ? "Extracting fixtures..." : "Import Fixtures from Screenshot"}
              </button>
              {fixtureImportResult && (
                <div className="mt-4 p-4 rounded-lg bg-purple-500/20 border border-purple-500/30">
                  <h3 className="text-purple-300 font-semibold mb-2">{fixtureImportResult.success ? "✅ Fixtures Imported!" : "⚠️ Import Completed with Issues"}</h3>
                  {fixtureImportResult.league && (<p className="text-white">League: <span className="text-purple-300 font-medium">{fixtureImportResult.league.name}</span></p>)}
                  {fixtureImportResult.extracted?.day && (<p className="text-white">Day: <span className="text-purple-300 font-medium">{fixtureImportResult.extracted.day}</span></p>)}
                  <p className="text-gray-400 text-sm mt-2">Created: {fixtureImportResult.stats?.created || 0} • Skipped: {fixtureImportResult.stats?.skipped || 0} • Total: {fixtureImportResult.stats?.total || 0}</p>
                  {fixtureImportResult.fixturesCreated?.length > 0 && (
                    <div className="mt-3">
                      <p className="text-green-300 text-sm font-medium">Created:</p>
                      <ul className="text-sm text-gray-300 mt-1 space-y-1">
                        {fixtureImportResult.fixturesCreated.map((f: any, i: number) => (<li key={i}>{f.home_team} vs {f.away_team}{f.day && <span className="text-gray-500 ml-2">Day {f.day}</span>}</li>))}
                      </ul>
                    </div>
                  )}
                  {fixtureImportResult.fixturesSkipped?.length > 0 && (
                    <div className="mt-3">
                      <p className="text-yellow-300 text-sm font-medium">Skipped:</p>
                      <ul className="text-sm text-gray-400 mt-1 space-y-1">
                        {fixtureImportResult.fixturesSkipped.map((f: any, i: number) => (<li key={i}>{f.home_team} vs {f.away_team}<span className="text-yellow-500 ml-2">({f.reason})</span></li>))}
                      </ul>
                    </div>
                  )}
                  {fixtureImportResult.errors && (
                    <div className="mt-2 p-2 rounded bg-red-500/20 text-red-300 text-sm">
                      <strong>Errors:</strong>
                      <ul className="list-disc list-inside">{fixtureImportResult.errors.map((e: string, i: number) => (<li key={i}>{e}</li>))}</ul>
                    </div>
                  )}
                  {fixtureImportResult.logs && (
                    <details className="mt-2 text-xs text-gray-500">
                      <summary className="cursor-pointer">Debug logs</summary>
                      <pre className="mt-1 p-2 bg-gray-900 rounded overflow-auto max-h-40">{fixtureImportResult.logs.join("\n")}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* JSON Import (unchanged) */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">📝 Import Match Data (JSON)</h2>
              <textarea value={jsonData} onChange={(e) => setJsonData(e.target.value)} className="w-full h-64 p-4 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono text-sm" placeholder="Paste match JSON here..." />
              <button onClick={handleImport} disabled={loading || !jsonData.trim()} className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded transition">{loading ? "Importing..." : "Import Match (JSON)"}</button>
            </div>
          </div>
        )}

        {/* LEAGUES TAB */}
        {activeTab === "leagues" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingLeague ? "Edit League" : "Add New League"}</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="block text-gray-300 mb-2 text-sm">Name *</label><input type="text" value={leagueForm.name} onChange={(e) => setLeagueForm({ ...leagueForm, name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="League name" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Season</label><input type="text" value={leagueForm.season} onChange={(e) => setLeagueForm({ ...leagueForm, season: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="2024" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Format</label><select value={leagueForm.format} onChange={(e) => setLeagueForm({ ...leagueForm, format: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"><option value="league">League</option><option value="knockout">Knockout</option><option value="group_knockout">Group + Knockout</option></select></div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSaveLeague} disabled={loading || !leagueForm.name} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded transition">{editingLeague ? "Update" : "Create"} League</button>
                {editingLeague && (<button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded transition">Cancel</button>)}
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Leagues ({leagues.length})</h2>
              {leagues.length === 0 ? (<p className="text-gray-400">No leagues yet.</p>) : (
                <div className="space-y-2">
                  {leagues.map((l) => (
                    <div key={l.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                      <div><span className="text-white font-medium">{l.name}</span>{l.season && <span className="text-gray-400 ml-2">({l.season})</span>}<span className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-600 text-gray-300">{l.format || "league"}</span></div>
                      <div className="flex gap-2"><button onClick={() => handleEditLeague(l)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button><button onClick={() => handleDeleteLeague(l.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TEAMS TAB */}
        {activeTab === "teams" && (
          <div className="space-y-6">
            {/* Team Image Import Section */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">📷 Import Teams from Screenshot (AI)</h2>
              <p className="text-gray-400 text-sm mb-4">Upload a leaderboard/standings screenshot and AI will extract all team names.</p>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2 text-sm">Add to League (optional)</label>
                <select value={teamImportLeagueId} onChange={(e) => setTeamImportLeagueId(e.target.value)} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none">
                  <option value="">No league</option>
                  {leagues.map((l) => (<option key={l.id} value={l.id}>{l.name} {l.season ? `(${l.season})` : ""}</option>))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2 text-sm">Leaderboard Screenshot</label>

                {/* Paste Button */}
                <button
                  type="button"
                  onClick={pasteTeamImageFromClipboard}
                  className="mb-3 w-full flex items-center justify-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-medium py-3 px-4 rounded-lg transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Paste Image from Clipboard
                </button>

                <div
                  className="rounded-lg border-2 border-dashed border-gray-600 p-6 text-center hover:border-gray-500 focus-within:border-emerald-500 transition cursor-pointer"
                  onPaste={handlePasteTeamImage}
                  tabIndex={0}
                >
                  <input type="file" accept="image/*" onChange={handleTeamImageChange} className="hidden" id="team-image-upload" />
                  <label htmlFor="team-image-upload" className="cursor-pointer">
                    <div className="text-3xl mb-2">🏆</div>
                    <p className="text-gray-400">Click to browse files</p>
                    <p className="text-xs text-gray-500 mt-1">Or focus here and press Ctrl+V</p>
                  </label>
                </div>
              </div>
              {teamImportPreview && (
                <div className="mb-4 relative inline-block">
                  <img src={teamImportPreview} alt="Leaderboard preview" className="max-h-48 rounded-lg border border-gray-600" />
                  <button onClick={removeTeamImage} className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">×</button>
                </div>
              )}
              <button onClick={handleTeamImageImport} disabled={loading || !teamImportImage} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded transition">
                {loading ? "Extracting teams..." : "Import Teams from Screenshot"}
              </button>
              {teamImportResult && (
                <div className="mt-4 p-4 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                  <h3 className="text-emerald-300 font-semibold mb-2">✅ Teams Imported!</h3>
                  <p className="text-white">Found {teamImportResult.stats?.total || 0} teams</p>
                  <p className="text-gray-400 text-sm mt-1">Created: {teamImportResult.stats?.created || 0} • Already existed: {teamImportResult.stats?.existing || 0}</p>
                  {teamImportResult.stats?.teamsCreated?.length > 0 && (<p className="text-blue-300 text-sm mt-1">New teams: {teamImportResult.stats.teamsCreated.join(", ")}</p>)}
                  {teamImportResult.stats?.teamsExisting?.length > 0 && (<p className="text-gray-400 text-sm mt-1">Existing: {teamImportResult.stats.teamsExisting.join(", ")}</p>)}
                  {teamImportResult.errors && (<div className="mt-2 p-2 rounded bg-red-500/20 text-red-300 text-sm"><strong>Errors:</strong><ul className="list-disc list-inside">{teamImportResult.errors.map((e: string, i: number) => (<li key={i}>{e}</li>))}</ul></div>)}
                  {teamImportResult.logs && (<details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">Debug logs</summary><pre className="mt-1 p-2 bg-gray-900 rounded overflow-auto max-h-40">{teamImportResult.logs.join("\n")}</pre></details>)}
                </div>
              )}
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingTeam ? "Edit Team" : "Add New Team"}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div><label className="block text-gray-300 mb-2 text-sm">Name *</label><input type="text" value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="Team name" /></div>
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Leagues (select multiple)</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto p-2 rounded bg-gray-700 border border-gray-600">
                    {leagues.length === 0 ? (<p className="text-gray-500 text-sm">No leagues available</p>) : (
                      leagues.map((l) => (
                        <label key={l.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-600 p-1 rounded">
                          <input type="checkbox" checked={teamForm.league_ids.includes(l.id)} onChange={(e) => { if (e.target.checked) { setTeamForm({ ...teamForm, league_ids: [...teamForm.league_ids, l.id] }); } else { setTeamForm({ ...teamForm, league_ids: teamForm.league_ids.filter(id => id !== l.id) }); } }} className="rounded bg-gray-600 border-gray-500 text-blue-500 focus:ring-blue-500" />
                          <span className="text-white text-sm">{l.name}</span>
                          {l.season && <span className="text-gray-400 text-xs">({l.season})</span>}
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSaveTeam} disabled={loading || !teamForm.name} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded transition">{editingTeam ? "Update" : "Create"} Team</button>
                {editingTeam && (<button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded transition">Cancel</button>)}
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Teams ({teams.length})</h2>
              {teams.length === 0 ? (<p className="text-gray-400">No teams yet.</p>) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {teams.map((t) => (
                    <div key={t.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                      <div className="flex-1">
                        <span className="text-white font-medium">{t.name}</span>
                        {t.leagues && t.leagues.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {t.leagues.map((league: any) => (<span key={league.id} className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">{league.name}</span>))}
                          </div>
                        ) : t.league ? (<span className="text-gray-400 ml-2 text-sm">• {t.league.name}</span>) : (<span className="text-gray-500 ml-2 text-sm">• No league</span>)}
                      </div>
                      <div className="flex gap-2"><button onClick={() => handleEditTeam(t)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button><button onClick={() => handleDeleteTeam(t.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PLAYERS TAB */}
        {activeTab === "players" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingPlayer ? "Edit Player" : "Add New Player"}</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="block text-gray-300 mb-2 text-sm">Name</label><input type="text" value={playerForm.name} onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="Player name" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Handle</label><input type="text" value={playerForm.handle} onChange={(e) => setPlayerForm({ ...playerForm, handle: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="@handle" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Game User ID</label><input type="text" value={playerForm.game_user_id} onChange={(e) => setPlayerForm({ ...playerForm, game_user_id: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="Unique game ID" /></div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSavePlayer} disabled={loading || (!playerForm.name && !playerForm.handle && !playerForm.game_user_id)} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded transition">{editingPlayer ? "Update" : "Create"} Player</button>
                {editingPlayer && (<button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded transition">Cancel</button>)}
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Players ({players.length})</h2>
              {players.length === 0 ? (<p className="text-gray-400">No players yet.</p>) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {players.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                      <div><span className="text-white font-medium">{p.name || p.handle || p.game_user_id?.slice(0, 8)}</span>{p.handle && p.name && <span className="text-gray-400 ml-2">@{p.handle}</span>}</div>
                      <div className="flex gap-2"><button onClick={() => handleEditPlayer(p)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button><button onClick={() => handleDeletePlayer(p.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* FIXTURES TAB */}
        {activeTab === "fixtures" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingFixture ? "Edit Fixture" : "Add New Fixture"}</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <div><label className="block text-gray-300 mb-2 text-sm">League</label><select value={fixtureForm.league_id} onChange={(e) => setFixtureForm({ ...fixtureForm, league_id: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"><option value="">Select league</option>{leagues.map((l) => (<option key={l.id} value={l.id}>{l.name} {l.season ? `(${l.season})` : ""}</option>))}</select></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Date & Time *</label><input type="datetime-local" value={fixtureForm.played_at} onChange={(e) => setFixtureForm({ ...fixtureForm, played_at: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Stage</label><select value={fixtureForm.stage} onChange={(e) => setFixtureForm({ ...fixtureForm, stage: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"><option value="">None</option><option value="group">Group Stage</option><option value="round_of_16">Round of 16</option><option value="quarter">Quarter Finals</option><option value="semi">Semi Finals</option><option value="third_place">3rd Place</option><option value="final">Final</option></select></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Group</label><input type="text" value={fixtureForm.group_name} onChange={(e) => setFixtureForm({ ...fixtureForm, group_name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="A, B, C..." /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Day</label><input type="number" min="1" value={fixtureForm.day} onChange={(e) => setFixtureForm({ ...fixtureForm, day: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="1, 2, 3..." /></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <div><label className="block text-gray-300 mb-2 text-sm">Home Team *</label><input type="text" list="team-options" value={fixtureForm.home_team} onChange={(e) => setFixtureForm({ ...fixtureForm, home_team: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="Home team name" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Away Team *</label><input type="text" list="team-options" value={fixtureForm.away_team} onChange={(e) => setFixtureForm({ ...fixtureForm, away_team: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="Away team name" /></div>
              </div>
              <datalist id="team-options">{allTeamNames.map((name) => (<option key={name} value={name} />))}</datalist>
              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <div><label className="block text-gray-300 mb-2 text-sm">Home Score (leave blank for upcoming)</label><input type="number" min="0" value={fixtureForm.home_score} onChange={(e) => setFixtureForm({ ...fixtureForm, home_score: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="—" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Away Score (leave blank for upcoming)</label><input type="number" min="0" value={fixtureForm.away_score} onChange={(e) => setFixtureForm({ ...fixtureForm, away_score: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="—" /></div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleSaveFixture} disabled={loading || !fixtureForm.played_at || !fixtureForm.home_team || !fixtureForm.away_team} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded transition">{editingFixture ? "Update" : "Create"} Fixture</button>
                {editingFixture && (<button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded transition">Cancel</button>)}
              </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Fixtures ({fixtures.length})</h2>
              {fixtures.length === 0 ? (<p className="text-gray-400">No fixtures yet.</p>) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {fixtures.map((f) => {
                    const isUpcoming = f.home_score === null || f.away_score === null;
                    const date = new Date(f.played_at);
                    return (
                      <div key={f.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isUpcoming && (<span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300">Upcoming</span>)}
                            {f.league && <span className="text-xs text-gray-400">{f.league.name}</span>}
                            {f.day && <span className="text-xs text-purple-400">Day {f.day}</span>}
                            {f.stage && <span className="text-xs text-gray-500">• {f.stage}</span>}
                            {f.group_name && <span className="text-xs text-gray-500">• Group {f.group_name}</span>}
                          </div>
                          <div className="mt-1"><span className="text-white font-medium">{f.home_team}</span><span className="text-gray-400 mx-2">{isUpcoming ? "vs" : `${f.home_score} - ${f.away_score}`}</span><span className="text-white font-medium">{f.away_team}</span></div>
                          <div className="text-xs text-gray-500 mt-1">{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        </div>
                        <div className="flex gap-2"><button onClick={() => handleEditFixture(f)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button><button onClick={() => handleDeleteFixture(f.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button></div>
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
