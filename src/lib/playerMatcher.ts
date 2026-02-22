/**
 * Multi-Factor Player Matching System
 * 
 * Since neither player IDs nor names are reliable:
 * - IDs: ~50% OCR error rate (0/O, 1/l/I, 5/S, 8/B confusion)
 * - Names: Players change them frequently
 * 
 * This system uses multiple factors to match players:
 * 1. Team roster context (who typically plays for this team)
 * 2. Position matching (GK, LB, RB, CM, LW, RW, etc.)
 * 3. Level/rating proximity (players don't change level drastically)
 * 4. ID validation (check if extracted ID exists in database)
 * 5. Fuzzy ID matching with OCR-aware character substitution
 */

export interface DbPlayer {
  id: string;
  name: string | null;
  handle: string | null;
  game_user_id: string | null;
}

export interface ExtractedPlayer {
  position: string;
  name: string;
  user_id: string | null;
  level: number | null;
  overall_rating: number | null;
  score: number;
  [key: string]: any;
}

export interface PlayerMatchResult {
  playerId: string | null;
  confidence: number; // 0-100
  matchMethod: string;
  suggestions: PlayerSuggestion[];
  needsUserReview: boolean;
  extractedId: string | null;
  extractedName: string;
  isNewPlayer: boolean;
  matchedDbPlayer: DbPlayer | null;
  warnings: string[];
}

// Alias for backwards compatibility
export type MatchResult = PlayerMatchResult;

export interface PlayerSuggestion {
  player: DbPlayer;
  confidence: number;
  matchReasons: string[];
}

export interface TeamRosterContext {
  teamName: string;
  recentPlayerIds: string[];
  recentPlayers: DbPlayer[];
}

// OCR character confusion mapping - characters that commonly get misread
const OCR_CONFUSIONS: Record<string, string[]> = {
  '0': ['O', 'o', 'Q', 'D'],
  'O': ['0', 'o', 'Q', 'D'],
  'o': ['0', 'O', 'Q'],
  '1': ['l', 'I', 'i', '|', '7'],
  'l': ['1', 'I', 'i', '|'],
  'I': ['1', 'l', 'i', '|'],
  'i': ['1', 'l', 'I', '|'],
  '5': ['S', 's', '6'],
  'S': ['5', 's', '8'],
  's': ['5', 'S', '8'],
  '8': ['B', '6', '3'],
  'B': ['8', '6', '3'],
  '6': ['G', 'b', '8'],
  'G': ['6', 'C', '0'],
  'g': ['9', 'q'],
  '9': ['g', 'q'],
  'q': ['9', 'g'],
  'n': ['h', 'm', 'r'],
  'h': ['n', 'b'],
  'm': ['n', 'rn'],
  'rn': ['m'],
  'x': ['X', 'k'],
  'X': ['x', 'K'],
  'v': ['V', 'u', 'w'],
  'V': ['v', 'U', 'W'],
  'u': ['v', 'U'],
  'U': ['u', 'V'],
  'w': ['W', 'vv'],
  'W': ['w', 'VV'],
  'c': ['C', 'e', '('],
  'C': ['c', 'G', '('],
  'e': ['c', 'a'],
  'a': ['e', 'o'],
  'z': ['Z', '2'],
  'Z': ['z', '2'],
  '2': ['Z', 'z'],
  'p': ['P', 'q'],
  'P': ['p', 'R'],
  'd': ['D', 'b'],
  'D': ['d', '0', 'O'],
  'b': ['d', '6'],
};

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate OCR-aware similarity score between two IDs
 * Returns a score from 0-100 where 100 is exact match
 */
export function ocrAwareSimilarity(id1: string | null, id2: string | null): number {
  if (!id1 || !id2) return 0;
  if (id1 === id2) return 100;
  if (id1.toLowerCase() === id2.toLowerCase()) return 95;

  // Different lengths - unlikely to be same ID
  if (Math.abs(id1.length - id2.length) > 1) return 0;

  let matchingChars = 0;
  let ocrConfusionMatches = 0;
  const maxLen = Math.max(id1.length, id2.length);

  for (let i = 0; i < Math.min(id1.length, id2.length); i++) {
    const c1 = id1[i];
    const c2 = id2[i];

    if (c1 === c2) {
      matchingChars++;
    } else if (c1.toLowerCase() === c2.toLowerCase()) {
      matchingChars += 0.9;
    } else {
      // Check OCR confusion
      const confusions = OCR_CONFUSIONS[c1] || [];
      if (confusions.includes(c2)) {
        ocrConfusionMatches++;
      }
    }
  }

  // Score based on matching chars + OCR confusion allowance
  const score = ((matchingChars + ocrConfusionMatches * 0.7) / maxLen) * 100;
  return Math.round(score);
}

/**
 * Validate if a player ID matches expected format (8 alphanumeric characters)
 */
export function isValidPlayerId(id: string | null): boolean {
  if (!id) return false;
  // Most game user IDs are 8 alphanumeric characters
  return /^[a-zA-Z0-9]{6,10}$/.test(id);
}

/**
 * Check if two positions are compatible (same position family)
 */
export function arePositionsCompatible(pos1: string, pos2: string): boolean {
  const normalize = (p: string) => p.toUpperCase().trim();
  const p1 = normalize(pos1);
  const p2 = normalize(pos2);

  if (p1 === p2) return true;

  // Position families
  const positionFamilies: Record<string, string[]> = {
    'GK': ['GK'],
    'DEF': ['LB', 'CB', 'RB', 'LWB', 'RWB', 'SW'],
    'MID': ['CDM', 'CM', 'CAM', 'LM', 'RM', 'DM'],
    'ATT': ['LW', 'RW', 'LF', 'RF', 'CF', 'ST', 'SS'],
  };

  for (const family of Object.values(positionFamilies)) {
    if (family.includes(p1) && family.includes(p2)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if two levels are within acceptable range
 */
export function areLevelsClose(level1: number | null, level2: number | null, tolerance: number = 5): boolean {
  if (level1 === null || level2 === null) return true; // Unknown levels don't disqualify
  return Math.abs(level1 - level2) <= tolerance;
}

/**
 * Main multi-factor player matching function
 */
export function matchPlayer(
  extractedPlayer: ExtractedPlayer,
  allPlayers: DbPlayer[],
  teamRoster: TeamRosterContext | null,
  logs: string[]
): PlayerMatchResult {
  const result: PlayerMatchResult = {
    playerId: null,
    confidence: 0,
    matchMethod: '',
    suggestions: [],
    needsUserReview: false,
    extractedId: extractedPlayer.user_id,
    extractedName: extractedPlayer.name,
    isNewPlayer: false,
    matchedDbPlayer: null,
    warnings: [],
  };

  logs.push(`🔍 Matching player: ${extractedPlayer.name} (ID: ${extractedPlayer.user_id || 'none'}, Pos: ${extractedPlayer.position}, Level: ${extractedPlayer.level})`);

  // PHASE 1: Exact ID Match (highest confidence)
  if (extractedPlayer.user_id && isValidPlayerId(extractedPlayer.user_id)) {
    const exactMatch = allPlayers.find(p => p.game_user_id === extractedPlayer.user_id);
    if (exactMatch) {
      result.playerId = exactMatch.id;
      result.confidence = 100;
      result.matchMethod = 'exact_id';
      result.matchedDbPlayer = exactMatch;
      logs.push(`✓ Exact ID match: ${exactMatch.name || extractedPlayer.name} (${exactMatch.game_user_id})`);
      return result;
    }
  }

  // PHASE 2: Case-insensitive ID Match
  if (extractedPlayer.user_id) {
    const caseMatch = allPlayers.find(p =>
      p.game_user_id?.toLowerCase() === extractedPlayer.user_id?.toLowerCase()
    );
    if (caseMatch) {
      result.playerId = caseMatch.id;
      result.confidence = 95;
      result.matchMethod = 'case_insensitive_id';
      result.matchedDbPlayer = caseMatch;
      logs.push(`✓ Case-insensitive ID match: ${caseMatch.name} (${caseMatch.game_user_id})`);
      return result;
    }
  }

  // PHASE 3: OCR-aware fuzzy ID match with team roster priority
  const candidates: PlayerSuggestion[] = [];

  // First, check team roster players (higher priority)
  if (teamRoster && teamRoster.recentPlayers.length > 0) {
    for (const player of teamRoster.recentPlayers) {
      if (!player.game_user_id) continue;

      const idSimilarity = ocrAwareSimilarity(extractedPlayer.user_id, player.game_user_id);
      const reasons: string[] = [];
      let score = 0;

      if (idSimilarity >= 70) {
        reasons.push(`ID similarity: ${idSimilarity}%`);
        score += idSimilarity * 0.6;
      }

      // Team roster bonus
      reasons.push('Recent team player');
      score += 20;

      if (score > 30) {
        candidates.push({
          player,
          confidence: Math.min(score, 95),
          matchReasons: reasons,
        });
      }
    }
  }

  // Then check all players
  for (const player of allPlayers) {
    if (!player.game_user_id) continue;

    // Skip if already in candidates
    if (candidates.some(c => c.player.id === player.id)) continue;

    const idSimilarity = ocrAwareSimilarity(extractedPlayer.user_id, player.game_user_id);
    const reasons: string[] = [];
    let score = 0;

    if (idSimilarity >= 70) {
      reasons.push(`ID similarity: ${idSimilarity}%`);
      score += idSimilarity * 0.5;

      if (score > 30) {
        candidates.push({
          player,
          confidence: Math.min(score, 85),
          matchReasons: reasons,
        });
      }
    }
  }

  // Sort candidates by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Take top 5 suggestions
  result.suggestions = candidates.slice(0, 5);

  // If we have a high confidence match (>= 75), use it
  if (candidates.length > 0 && candidates[0].confidence >= 75) {
    result.playerId = candidates[0].player.id;
    result.confidence = candidates[0].confidence;
    result.matchMethod = `fuzzy_match (${candidates[0].matchReasons.join(', ')})`;
    result.needsUserReview = candidates[0].confidence < 90;
    result.matchedDbPlayer = candidates[0].player;

    logs.push(`🔧 Fuzzy match: ${candidates[0].player.name} with ${candidates[0].confidence}% confidence`);
    logs.push(`   Reasons: ${candidates[0].matchReasons.join(', ')}`);

    return result;
  }

  // PHASE 4: Team roster position-based suggestion (when ID match fails)
  if (teamRoster && teamRoster.recentPlayers.length > 0 && candidates.length === 0) {
    // Add team roster players as suggestions even without ID match
    for (const player of teamRoster.recentPlayers) {
      result.suggestions.push({
        player,
        confidence: 30,
        matchReasons: ['Plays for team', 'No ID match'],
      });
    }
    result.suggestions = result.suggestions.slice(0, 5);
  }

  // No confident match found - likely a new player
  result.needsUserReview = true;
  result.matchMethod = 'no_match';
  result.isNewPlayer = result.suggestions.length === 0; // Mark as new if no suggestions
  if (result.isNewPlayer) {
    result.warnings.push(`New player detected: ${extractedPlayer.name}`);
  } else {
    result.warnings.push(`Low confidence match for ${extractedPlayer.name}`);
  }
  logs.push(`⚠️ No confident match for ${extractedPlayer.name}. ${result.suggestions.length} suggestions available.`);

  return result;
}

/**
 * Batch match players with team context
 */
export function matchPlayersForTeam(
  extractedPlayers: ExtractedPlayer[],
  allPlayers: DbPlayer[],
  teamRoster: TeamRosterContext | null,
  logs: string[]
): Map<number, PlayerMatchResult> {
  const results = new Map<number, PlayerMatchResult>();

  for (let i = 0; i < extractedPlayers.length; i++) {
    const result = matchPlayer(extractedPlayers[i], allPlayers, teamRoster, logs);
    results.set(i, result);
  }

  return results;
}

/**
 * Generate a simple hash for deduplication
 */
export function generatePlayerKey(extractedPlayer: ExtractedPlayer): string {
  return `${extractedPlayer.user_id || ''}_${extractedPlayer.name}_${extractedPlayer.position}`;
}

/**
 * Get confidence level as a string
 */
export function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' | 'new' {
  if (confidence >= 80) return 'high';
  if (confidence >= 60) return 'medium';
  if (confidence > 0) return 'low';
  return 'new';
}

/**
 * Match all extracted players against database players
 * Simplified version without team roster context (for use in extract-match route)
 */
export function matchAllPlayers(
  extractedPlayers: ExtractedPlayer[],
  dbPlayers: DbPlayer[]
): MatchResult[] {
  const results: MatchResult[] = [];
  const logs: string[] = []; // Internal logs, not exposed

  for (const player of extractedPlayers) {
    const result = matchPlayer(player, dbPlayers, null, logs);
    results.push(result);
  }

  return results;
}

/**
 * Get a summary of matching results
 */
export function getMatchingSummary(results: MatchResult[]): {
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  newPlayers: number;
  withWarnings: number;
} {
  let highConfidence = 0;
  let mediumConfidence = 0;
  let lowConfidence = 0;
  let newPlayers = 0;
  let withWarnings = 0;

  for (const result of results) {
    const level = getConfidenceLevel(result.confidence);
    
    if (level === 'high') highConfidence++;
    else if (level === 'medium') mediumConfidence++;
    else if (level === 'low') lowConfidence++;
    
    if (result.isNewPlayer) newPlayers++;
    if (result.warnings.length > 0) withWarnings++;
  }

  return {
    total: results.length,
    highConfidence,
    mediumConfidence,
    lowConfidence,
    newPlayers,
    withWarnings,
  };
}
