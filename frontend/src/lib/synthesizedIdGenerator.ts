/**
 * Generates a unique ID for synthesized bags in format: SB{DDMMYY}-{X}{ABCDE}
 * Example: SB030726-A00001 (generated on July 3, 2026, first sequence)
 * 
 * Format breakdown:
 * - SB: Prefix for Synthesized Bag
 * - {DDMMYY}: 2-digit day, month, year
 * - {X}: Letter suffix (A-Z)
 * - {ABCDE}: 5-digit sequence number (00001-99999)
 * 
 * Sequence progression:
 * - A00001 to A99999 (99,999 combinations)
 * - B00001 to B99999 (99,999 combinations)
 * - ... up to Z99999
 * - Total: 26 letters × 99,999 = ~2.6 million combinations per day
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
  
  // Format: DDMMYY (2-digit day, month, year)
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  
  const datePrefix = `${day}${month}${year}`;
  
  // Find the next available sequence
  const baseId = `SB${datePrefix}`;
  const sequence = findNextSequence(baseId, existingIds);
  
  // Convert sequence to letter + 5-digit format
  // sequence 1-99999 = A00001-A99999
  // sequence 100000-199998 = B00001-B99999
  // etc.
  const letterIndex = Math.floor((sequence - 1) / 99999);
  const numberPart = ((sequence - 1) % 99999) + 1;
  const letter = String.fromCharCode(65 + letterIndex); // 65 = 'A'
  
  const id = `${baseId}-${letter}${String(numberPart).padStart(5, '0')}`;
  
  return { id, timestamp };
}

/**
 * Find the next available sequence number for a given base ID
 * @param baseId - The base ID without sequence (e.g., "SB030726")
 * @param existingIds - Array of existing IDs to check
 * @returns Next available sequence number (1-based)
 */
function findNextSequence(baseId: string, existingIds: string[]): number {
  if (existingIds.length === 0) {
    return 1;
  }
  
  let maxSequence = 0;
  
  for (const existingId of existingIds) {
    // Check if this ID starts with our base ID
    if (existingId.startsWith(baseId + '-')) {
      // Extract the letter+number suffix (e.g., "A00001" from "SB030726-A00001")
      const suffix = existingId.slice(baseId.length + 1);
      
      // Parse the letter and number
      if (suffix.length >= 6) {
        const letter = suffix.charAt(0);
        const numberStr = suffix.slice(1);
        const number = parseInt(numberStr, 10);
        
        if (!isNaN(number) && letter >= 'A' && letter <= 'Z') {
          // Convert to sequence number: A00001 = 1, A00002 = 2, ..., B00001 = 100000
          const letterValue = letter.charCodeAt(0) - 65; // 0 for 'A', 1 for 'B', etc.
          const sequence = letterValue * 99999 + number;
          
          if (sequence > maxSequence) {
            maxSequence = sequence;
          }
        }
      }
    }
  }
  
  return maxSequence + 1;
}