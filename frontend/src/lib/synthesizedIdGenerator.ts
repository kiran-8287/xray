/**
 * Generates a unique ID for synthesized bags in format: SB{last5digits}-{date}{time}-{sequence}
 * Example: SB00923-29062026530-00001 (for bag P01X010-2024101200923 at 29/06/2026 5:30 AM)
 * 
 * Format breakdown:
 * - SB: Prefix for Synthesized Bag
 * - {last5digits}: Last 5 digits of the bag ID
 * - {date}{time}: DDMMYYYYHHMM (24-hour format)
 * - {sequence}: 5-digit sequence number (00001, 00002, etc.) for same-minute generations
 */

export interface GeneratedId {
  id: string;
  timestamp: number;
}

/**
 * Generate a unique synthesized bag ID
 * @param bagId - The original bag ID (e.g., "P01X010-2024101200923")
 * @param existingIds - Optional array of existing IDs to check for collisions
 * @returns Generated ID object with id and timestamp
 */
export function generateSynthesizedId(
  bagId: string,
  existingIds: string[] = []
): GeneratedId {
  // Extract last 5 digits from bag ID
  const last5digits = bagId.slice(-5).padStart(5, '0');
  
  // Get current date and time
  const now = new Date();
  const timestamp = now.getTime();
  
  // Format: DDMMYYYY
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  
  // Format: HHMM (24-hour format)
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  
  const dateTimePrefix = `${day}${month}${year}${hours}${minutes}`;
  
  // Find the next available sequence number
  const baseId = `SB${last5digits}-${dateTimePrefix}`;
  const sequence = findNextSequence(baseId, existingIds);
  
  const id = `${baseId}-${String(sequence).padStart(5, '0')}`;
  
  return { id, timestamp };
}

/**
 * Find the next available sequence number for a given base ID
 * @param baseId - The base ID without sequence (e.g., "SB00923-29062026530")
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

