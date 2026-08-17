export const ERROR_MESSAGES = {
  GENERIC_SAVE_FAILED: "Failed to save. Make sure the backend is running.",
  GENERIC_LOAD_FAILED: "Cannot connect to backend. Please verify the server is running.",
  GENERIC_RENDER_FAILED: "Failed to render image. Please try again.",
  GENERIC_DELETE_FAILED: "Failed to delete item. Please try again.",
  OUT_OF_BOUNDS_SAVE: "Cannot save: one or more objects are out of bounds.",
  EMPTY_BAG_SAVE: "Cannot save: the bag must contain at least one item.",
  GENERATION_ABORTED: "Generation was aborted.",
  GENERATION_NO_BAGS: "Please select at least one bag before generating combinations.",
  STORAGE_FULL: "Storage is full. Please clear some data and try again.",
  WORKER_ERROR: "An error occurred during background processing. Please try again.",
} as const;

export type ErrorMessage = typeof ERROR_MESSAGES[keyof typeof ERROR_MESSAGES];
