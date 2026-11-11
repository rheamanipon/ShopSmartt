export const CART_STORAGE_KEY = 'shopsmart.cart';

function isValidCartItem(item) {
  return item !== null
    && typeof item === 'object'
    && Number.isInteger(item.productId) && item.productId > 0
    && typeof item.name === 'string'
    && Number.isFinite(item.price) && item.price >= 0
    && Number.isInteger(item.stock) && item.stock >= 0
    && Number.isInteger(item.quantity) && item.quantity >= 1;
}

export function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCart(storage) {
  try {
    const saved = storage.getItem(CART_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidCartItem);
  } catch {
    return [];
  }
}

export function saveCart(storage, cart) {
  try {
    storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Storage is unavailable or full. The cart still works in memory.
  }
}
