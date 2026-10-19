import { PRODUCT_IDS } from "../../../packages/product-config/index.js";
import {
  PRODUCT_BRANDS,
  getProductBrand,
} from "../../../src/shared/brandIdentity.js";

type ProductId = (typeof PRODUCT_IDS)[number];

const badId: ProductId = "unsupported-product";
PRODUCT_BRANDS.hotel.name = "Renamed Hotel";

const uncertain = getProductBrand("unsupported-product");
const unsafeName = uncertain.name;

void badId;
void unsafeName;
