import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: leagues } = await sb.from('leagues').select('id,name,season,format');
const { data: matches } = await sb.from('matches').select('id,league_id,home_team,away_team,home_score,away_score,stage,group_name,forfeited_by,played_at');
const { data: directTeams } = await sb.from('teams').select('id,name,league_id');
const { data: tl } = await sb.from('team_leagues').select('team_id,league_id,group_name,teams(name)');

console.log('leagues:', leagues.length, '| matches:', matches.length);

for (const lg of leagues) {
  const names = new Set();
  for (const t of directTeams) if (t.league_id===lg.id) names.add(t.name);
  for (const j of tl) if (j.league_id===lg.id && j.teams) names.add(j.teams.name);
  const lgMatches = matches.filter(m=>m.league_id===lg.id && m.home_score!=null && m.away_score!=null);
  const problems = [];
  for (const m of lgMatches) {
    const bad = [];
    if (!names.has(m.home_team)) bad.push('HOME "'+m.home_team+'"');
    if (!names.has(m.away_team)) bad.push('AWAY "'+m.away_team+'"');
    if (bad.length) problems.push({m, bad});
  }
  if (problems.length) {
    console.log('\n=== LEAGUE: '+lg.name+' ('+(lg.season||'')+') ['+lg.format+'] — '+problems.length+' mismatched result(s) ===');
    console.log('  registered team names:', [...names].sort().join(' | '));
    for (const {m,bad} of problems) {
      console.log('  • '+m.home_team+' '+m.home_score+'-'+m.away_score+' '+m.away_team+'  ['+(m.played_at||'').slice(0,10)+']  -> not matching: '+bad.join(', '));
    }
  }
}
console.log('\nDONE');
