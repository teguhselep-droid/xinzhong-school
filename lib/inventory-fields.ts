export const inventoryTitle = 'Inventaris / 库存';
export const categorySlots = 20;
export const inventoryPageSize = 10;
export const maxSalesPrice = 999_999_999_999;
export const maxInventoryQuantity = 999_999_999;
export const canAddInventory = (role: string) => role === 'admin' || role === 'supervisor';

export type InventoryCategory = { id: number; name: string; revision: number };
export type InventoryProduct = {
  id: number;
  name: string;
  categoryId: number;
  category: string;
  salesPrice: number;
  quantity: number;
  createdAt: string | null;
  recordedBy: string | null;
};

export type MovementDirection = 'in' | 'out';
export const movementLabels = { in: 'Barang Masuk / 入库', out: 'Barang Keluar / 出库' };
export type InventoryMovement = {
  id: number;
  purchaseId: number | null;
  direction: MovementDirection;
  productId: number;
  product: string;
  quantity: number;
  payment: number;
  bank: string;
  recordedAt: string;
  recordedBy: string;
};
