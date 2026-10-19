import { PRODUCTS, PRODUCT_IDS } from "../../../packages/product-config/index.js";

type ProductDefinition = (typeof PRODUCTS)[keyof typeof PRODUCTS];
type ProductId = ProductDefinition["id"];
type ListedProductId = (typeof PRODUCT_IDS)[number];

const accepted: readonly ProductId[] = [
  "lodge-camp",
  "hotel",
  "hospitality-pos"
];
const exportedIds: readonly ProductId[] = PRODUCT_IDS;
const hotelId: "hotel" = PRODUCTS.hotel.id;
const listedHotel: ListedProductId = "hotel";

void accepted;
void exportedIds;
void hotelId;
void listedHotel;
