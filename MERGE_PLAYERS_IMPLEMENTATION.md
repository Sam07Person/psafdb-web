# Player Merge Feature Implementation

## ✅ Completed:

### 1. Backend API Endpoint (COMPLETED)
- Added PATCH endpoint to `/src/app/api/admin/players/route.ts`
- Endpoint URL: `/api/admin/players` with method `PATCH`
- Accepts: `{ sourceId: string, targetId: string }`
- Functionality:
  - Validates both players exist
  - Transfers all `player_stats` records from source to target player
  - Deletes the source player
  - Returns count of transferred stats

### 2. Frontend State (COMPLETED)
- Added to line 142 in `src/app/admin/import/page.tsx`:
```typescript
const [mergingPlayers, setMergingPlayers] = useState<{ source: string | null; target: string | null }>({ source: null, target: null });
```

## 🔧 Manual Steps Required:

### 3. Add Handler Function
Insert this function after `handleDeletePlayer` (around line 432) in `src/app/admin/import/page.tsx`:

```typescript
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
```

### 4. Add UI Component
Insert this UI section in the players tab (around line 1805, after the add/edit player form and before the players list):

```tsx
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
```

## 📝 Location Details:

### Handler Function Location:
- File: `src/app/admin/import/page.tsx`
- After: `handleDeletePlayer` function (ends around line 432)
- Before: `handleSaveFixture` function (starts around line 434)

### UI Component Location:
- File: `src/app/admin/import/page.tsx`
- In the: `{activeTab === "players" && (` section
- After: The first `<div className="bg-gray-800 p-6 rounded-lg">` (Add/Edit Player form)
- Before: The second `<div className="bg-gray-800 p-6 rounded-lg">` (Players list)

## 🧪 Testing:
1. Navigate to admin dashboard → Players tab
2. You should see a new "Merge Players" section
3. Select a source player (duplicate) and target player (correct one)
4. Click "Merge Players"
5. Confirm the action
6. Verify that all match results were transferred and the duplicate was deleted

## 🔍 Reference Files:
- Full handler function: `src/app/admin/import/page_merge.tsx`
- API endpoint: `src/app/api/admin/players/route.ts` (PATCH method)
