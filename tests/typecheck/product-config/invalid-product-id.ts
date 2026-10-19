import { PRODUCTS, PRODUCT_IDS } from "../../../packages/product-config/index.js";

type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS]["id"];
type ListedProductId = (typeof PRODUCT_IDS)[number];

const invalidDefinitionId: ProductId = "unsupported-product";
const invalidListId: ListedProductId = "unsupported-product";

void invalidDefinitionId;
void invalidListId;
