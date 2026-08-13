import type { Point } from "./geometry";

export interface Item {
  id: string;
  filename: string;
  filepath: string;
  category: string;
  subcategory: string;
  name: string;
  valid_region_points?: Point[] | string;
  validRegionData?: any;
  /** 16-bit attenuation pixel value (0 = fully absorbing / black, 65535 = transparent / white) */
  pixel_value: number;
  /** Reference width in pixels */
  width?: number;
  /** Reference height in pixels */
  height?: number;
  /** Normalized polygon outline as [{x, y}] where values are in -0.5..0.5 range */
  polygon_json?: Point[] | string;
  /** Segmentation mask (normalized [0,1] polygon over the item's own width/height)
   *  returned by GET /api/items/segmentation-masks. Used to place objects using a
   *  tight axis-aligned box (from the mask) instead of the raw image rectangle. */
  segmentationMask?: Point[];
  /** Tags from non-threat list associated with this item (for bags) */
  tags?: string[];
}


export interface CategorizedItems {
  [category: string]: {
    [subcategory: string]: Item[];
  };
}

