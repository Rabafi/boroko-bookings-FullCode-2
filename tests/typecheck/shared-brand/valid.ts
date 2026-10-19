import { PRODUCT_IDS } from "../../../packages/product-config/index.js";
import {
  ECOSYSTEM_BRAND,
  PRODUCT_BRANDS,
  getProductBrand,
} from "../../../src/shared/brandIdentity.js";

type ProductId = (typeof PRODUCT_IDS)[number];

const knownIds: readonly ProductId[] = [
  "lodge-camp",
  "hotel",
  "hospitality-pos"
];
const exportedIds: readonly ProductId[] = PRODUCT_IDS;

function brandNameOf(id: ProductId): string {
  return PRODUCT_BRANDS[id].name;
}

const hotelName: string = PRODUCT_BRANDS.hotel.name;
const hotelShortName: string = PRODUCT_BRANDS.hotel.shortName;
const ecosystemName: string = ECOSYSTEM_BRAND.name;
const ecosystemOwner: string = ECOSYSTEM_BRAND.legalOwner;

// Getter results stay unknown until narrowed: no claim that every string
// yields a brand (inherited keys resolve to functions at runtime).
const defaultBrand: unknown = getProductBrand();
const hotelBrand: unknown = getProductBrand("hotel");
const fallbackBrand: unknown = getProductBrand("unsupported-product");

void knownIds;
void exportedIds;
void brandNameOf;
void hotelName;
void hotelShortName;
void ecosystemName;
void ecosystemOwner;
void defaultBrand;
void hotelBrand;
void fallbackBrand;
