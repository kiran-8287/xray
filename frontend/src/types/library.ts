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
}

export interface TaxonomySubcategory {
  name: string;
  slug: string;
  items: any[];
}

export interface TaxonomyCategory {
  name: string;
  slug: string;
  subcategories: TaxonomySubcategory[];
}

export interface CategorizedItems {
  [category: string]: {
    [subcategory: string]: Item[];
  };
}

export interface UploadSession {
  id: string;
  folder_name: string;
  uploaded_at: string;
  item_count: number;
  items: Item[];
}
