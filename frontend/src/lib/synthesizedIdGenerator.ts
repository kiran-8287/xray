/**
 * Generates a unique ID for synthesized bags in format: SB{YYMMDD}-{ABCDE}
 * Example: SB260703-00001 (generated on July 3, 2026, first sequence)
 * 
 * Format breakdown:
 * - SB: Prefix for Synthesized Bag
 * - {YYMMDD}: 2-digit year, month, day
 * - {ABCDE}: 5-digit sequence number (00001, 00002, etc.) for same-day generations
 */

export interface GeneratedId {
  id: string;
  timestamp: number;
}

/**
 * Generate a unique synthesized bag ID
 * @param bagId - The original bag ID (unused in the new format, kept for API compatibility)
 * @param existingIds - Optional array of existing IDs to check for collisions
 * @returns Generated ID object with id and timestamp
 */
export function generateSynthesizedId(
  bagId: string,
  existingIds: string[] = []
): GeneratedId {
  // Get current date
  const now = new Date();
  const timestamp = now.getTime();
  
  // Format: YYMMDD (2-digit year, month, day)
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  const datePrefix = `${year}${month}${day}`;
  
  // Find the next available sequence number
  const baseId = `SB${datePrefix}`;
  const sequence = findNextSequence(baseId, existingIds);
  
  const id = `${baseId}-${String(sequence).padStart(5, '0')}`;
  
  return { id, timestamp };
}

/**
 * Find the next available sequence number for a given base ID
 * @param baseId - The base ID without sequence (e.g., "SB260703")
 * @param existingIds - Array of existing IDs to check
 * @returns Next available sequence number
 */
function findNextSequence(baseId: string, existingIds: string[]): number {
  if (existingIds.length === 0) {
    return 1;
  }
  
  let maxSequence = 0;
  
  for (const existingId of existingIds) {
    // Check if this ID starts with our base ID
    if (existingId.startsWith(baseId + '-')) {
      // Extract sequence number
      const suffix = existingId.slice(baseId.length + 1);
      const sequence = parseInt(suffix, 10);
      if (!isNaN(sequence) && sequence > maxSequence) {
        maxSequence = sequence;
      }
    }
  }
  
  return maxSequence + 1;
}