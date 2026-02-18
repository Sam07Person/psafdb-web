"use client";

import { useState } from "react";

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
  league?: { name: string } | null;
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

export default function AdminDashboardPage() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [importImages, setImportImages] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageLeagueId, setImageLeagueId] = useState("");
  const [imageImportResult, setImageImportResult] = useState<any>(null);
  const [teamImportImage, setTeamImportImage] = useState<string | null>(null);
  const [teamImportPreview, setTeamImportPreview] = useState<string | null>(null);
  const [teamImportLeagueId, setTeamImportLeagueId] = useState("");
  const [teamImportResult, setTeamImportResult] = useState<any>(null);
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
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: editingFixture ? "Fixture updated!" : "Fixture created!" });
        setFixtureForm({ id: "", league_id: "", played_at: "", home_team: "", away_team: "", home_score: "", away_score: "", stage: "", group_name: "" });
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
    setFixtureForm({ id: "", league_id: "", played_at: "", home_team: "", away_team: "", home_score: "", away_score: "", stage: "", group_name: "" });
  };

  const allTeamNames = Array.from(
    new Set([...teams.map((t) => t.name), ...fixtures.flatMap((f) => [f.home_team, f.away_team])])
  ).sort();

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setImportImages((prev) => [...prev, base64]);
        setImagePreviews((prev) => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setImportImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

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

  const handleImageImport = async () => {
    if (importImages.length === 0) {
      setMessage({ type: "error", text: "Please upload at least one image" });
      return;
    }
    setLoading(true);
    setMessage(null);
    setImageImportResult(null);
    try {
      const res = await fetch("/api/admin/import-images", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ images: importImages, league_id: imageLeagueId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImageImportResult(data);
      setMessage({ type: "success", text: "Match imported successfully from screenshots!" });
      setImportImages([]);
      setImagePreviews([]);
      loadFixtures();
      loadPlayers();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
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

        {activeTab === "import" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">📷 Import from Screenshots (AI)</h2>
              <p className="text-gray-400 text-sm mb-4">Upload match screenshots and AI will automatically extract all data including player stats.</p>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2 text-sm">League (optional)</label>
                <select value={imageLeagueId} onChange={(e) => setImageLeagueId(e.target.value)} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none">
                  <option value="">No league</option>
                  {leagues.map((l) => (<option key={l.id} value={l.id}>{l.name} {l.season ? `(${l.season})` : ""}</option>))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2 text-sm">Screenshots</label>
                <div className="rounded-lg border-2 border-dashed border-gray-600 p-6 text-center hover:border-gray-500 transition cursor-pointer">
                  <input type="file" accept="image/*" multiple onChange={handleImageChange} className="hidden" id="image-upload" />
                  <label htmlFor="image-upload" className="cursor-pointer">
                    <div className="text-3xl mb-2">📷</div>
                    <p className="text-gray-400">Click to upload match screenshots</p>
                    <p className="text-xs text-gray-500 mt-1">Upload: Match overview + Both team stat screens</p>
                  </label>
                </div>
              </div>
              {imagePreviews.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {imagePreviews.map((preview, index) => (
                    <div key={index} className="relative group">
                      <img src={preview} alt={`Screenshot ${index + 1}`} className="w-full h-24 object-cover rounded-lg border border-gray-600" />
                      <button onClick={() => removeImage(index)} className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">×</button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={handleImageImport} disabled={loading || importImages.length === 0} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded transition">
                {loading ? (<span className="flex items-center justify-center gap-2"><svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Extracting with AI...</span>) : (`Import from ${importImages.length} Screenshot${importImages.length !== 1 ? "s" : ""}`)}
              </button>
              {imageImportResult && (
                <div className="mt-4 p-4 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                  <h3 className="text-emerald-300 font-semibold mb-2">✅ Match Imported!</h3>
                  <p className="text-white">{imageImportResult.extracted?.home_team?.team_name} <span className="text-emerald-300 font-bold">{imageImportResult.match?.home_score} - {imageImportResult.match?.away_score}</span> {imageImportResult.extracted?.away_team?.team_name}</p>
                  <p className="text-gray-400 text-sm mt-1">Players extracted: {imageImportResult.stats?.homePlayersExtracted || 0} + {imageImportResult.stats?.awayPlayersExtracted || 0}</p>
                  <p className="text-gray-400 text-sm">Player stats inserted: {imageImportResult.stats?.playerStatsCount || 0}</p>
                  {imageImportResult.stats?.playersCreated?.length > 0 && (<p className="text-blue-300 text-sm mt-1">New players created: {imageImportResult.stats.playersCreated.join(", ")}</p>)}
                  {imageImportResult.errors && (<div className="mt-2 p-2 rounded bg-red-500/20 text-red-300 text-sm"><strong>Errors:</strong><ul className="list-disc list-inside">{imageImportResult.errors.map((e: string, i: number) => (<li key={i}>{e}</li>))}</ul></div>)}
                  {imageImportResult.logs && (<details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">Debug logs</summary><pre className="mt-1 p-2 bg-gray-900 rounded overflow-auto max-h-40">{imageImportResult.logs.join("\n")}</pre></details>)}
                </div>
              )}
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">📝 Import Match Data (JSON)</h2>
              <textarea value={jsonData} onChange={(e) => setJsonData(e.target.value)} className="w-full h-64 p-4 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono text-sm" placeholder="Paste match JSON here..." />
              <button onClick={handleImport} disabled={loading || !jsonData.trim()} className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded transition">{loading ? "Importing..." : "Import Match (JSON)"}</button>
            </div>
          </div>
        )}

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

        {activeTab === "teams" && (
          <div className="space-y-6">
            {/* Team Image Import Section */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">📷 Import Teams from Screenshot (AI)</h2>
              <p className="text-gray-400 text-sm mb-4">
                Upload a leaderboard/standings screenshot and AI will extract all team names.
              </p>

              {/* League Selection */}
              <div className="mb-4">
                <label className="block text-gray-300 mb-2 text-sm">Add to League (optional)</label>
                <select
                  value={teamImportLeagueId}
                  onChange={(e) => setTeamImportLeagueId(e.target.value)}
                  className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">No league</option>
                  {leagues.map((l) => (<option key={l.id} value={l.id}>{l.name} {l.season ? `(${l.season})` : ""}</option>))}
                </select>
              </div>

              {/* Upload Area */}
              <div className="mb-4">
                <label className="block text-gray-300 mb-2 text-sm">Leaderboard Screenshot</label>
                <div className="rounded-lg border-2 border-dashed border-gray-600 p-6 text-center hover:border-gray-500 transition cursor-pointer">
                  <input type="file" accept="image/*" onChange={handleTeamImageChange} className="hidden" id="team-image-upload" />
                  <label htmlFor="team-image-upload" className="cursor-pointer">
                    <div className="text-3xl mb-2">🏆</div>
                    <p className="text-gray-400">Click to upload leaderboard screenshot</p>
                    <p className="text-xs text-gray-500 mt-1">AI will extract team names from the image</p>
                  </label>
                </div>
              </div>

              {/* Image Preview */}
              {teamImportPreview && (
                <div className="mb-4 relative inline-block">
                  <img src={teamImportPreview} alt="Leaderboard preview" className="max-h-48 rounded-lg border border-gray-600" />
                  <button onClick={removeTeamImage} className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">×</button>
                </div>
              )}

              <button onClick={handleTeamImageImport} disabled={loading || !teamImportImage} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded transition">
                {loading ? (<span className="flex items-center justify-center gap-2"><svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Extracting teams...</span>) : ("Import Teams from Screenshot")}
              </button>

              {/* Import Result */}
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

            {/* Team Form */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingTeam ? "Edit Team" : "Add New Team"}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Name *</label>
                  <input
                    type="text"
                    value={teamForm.name}
                    onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                    className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder="Team name"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 mb-2 text-sm">Leagues (select multiple)</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto p-2 rounded bg-gray-700 border border-gray-600">
                    {leagues.length === 0 ? (
                      <p className="text-gray-500 text-sm">No leagues available</p>
                    ) : (
                      leagues.map((l) => (
                        <label key={l.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-600 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={teamForm.league_ids.includes(l.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTeamForm({ ...teamForm, league_ids: [...teamForm.league_ids, l.id] });
                              } else {
                                setTeamForm({ ...teamForm, league_ids: teamForm.league_ids.filter(id => id !== l.id) });
                              }
                            }}
                            className="rounded bg-gray-600 border-gray-500 text-blue-500 focus:ring-blue-500"
                          />
                          <span className="text-white text-sm">{l.name}</span>
                          {l.season && <span className="text-gray-400 text-xs">({l.season})</span>}
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleSaveTeam}
                  disabled={loading || !teamForm.name}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded transition"
                >
                  {editingTeam ? "Update" : "Create"} Team
                </button>
                {editingTeam && (
                  <button onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded transition">
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Teams List */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">Teams ({teams.length})</h2>
              {teams.length === 0 ? (
                <p className="text-gray-400">No teams yet.</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {teams.map((t) => (
                    <div key={t.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                      <div className="flex-1">
                        <span className="text-white font-medium">{t.name}</span>
                        {t.leagues && t.leagues.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {t.leagues.map((league: any) => (
                              <span key={league.id} className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                                {league.name}
                              </span>
                            ))}
                          </div>
                        ) : t.league ? (
                          <span className="text-gray-400 ml-2 text-sm">• {t.league.name}</span>
                        ) : (
                          <span className="text-gray-500 ml-2 text-sm">• No league</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleEditTeam(t)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                        <button onClick={() => handleDeleteTeam(t.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
                      </div>
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

        {activeTab === "fixtures" && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">{editingFixture ? "Edit Fixture" : "Add New Fixture"}</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div><label className="block text-gray-300 mb-2 text-sm">League</label><select value={fixtureForm.league_id} onChange={(e) => setFixtureForm({ ...fixtureForm, league_id: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"><option value="">Select league</option>{leagues.map((l) => (<option key={l.id} value={l.id}>{l.name} {l.season ? `(${l.season})` : ""}</option>))}</select></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Date & Time *</label><input type="datetime-local" value={fixtureForm.played_at} onChange={(e) => setFixtureForm({ ...fixtureForm, played_at: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" /></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Stage</label><select value={fixtureForm.stage} onChange={(e) => setFixtureForm({ ...fixtureForm, stage: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"><option value="">None</option><option value="group">Group Stage</option><option value="round_of_16">Round of 16</option><option value="quarter">Quarter Finals</option><option value="semi">Semi Finals</option><option value="third_place">3rd Place</option><option value="final">Final</option></select></div>
                <div><label className="block text-gray-300 mb-2 text-sm">Group</label><input type="text" value={fixtureForm.group_name} onChange={(e) => setFixtureForm({ ...fixtureForm, group_name: e.target.value })} className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder="A, B, C..." /></div>
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
                          <div className="flex items-center gap-2">{isUpcoming && (<span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300">Upcoming</span>)}{f.league && <span className="text-xs text-gray-400">{f.league.name}</span>}{f.stage && <span className="text-xs text-gray-500">• {f.stage}</span>}{f.group_name && <span className="text-xs text-gray-500">• Group {f.group_name}</span>}</div>
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