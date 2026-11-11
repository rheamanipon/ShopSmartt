import { describe, expect, it } from 'vitest';
import { CART_STORAGE_KEY, loadCart, saveCart } from './cartStorage.js';

function createFakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); }
  };
}

const cart = [
  { productId: 2, name: 'Compact Mechanical Keyboard', price: 1850, stock: 3, quantity: 3 }
];

describe('cart storage', () => {
  it('returns an empty cart when nothing was saved', () => {
    expect(loadCart(createFakeStorage())).toEqual([]);
  });

  it('restores the saved cart after a page reload', () => {
    const storage = createFakeStorage();
    saveCart(storage, cart);
    expect(loadCart(storage)).toEqual(cart);
  });

  it('returns an empty cart when the saved data is corrupted', () => {
    const storage = createFakeStorage({ [CART_STORAGE_KEY]: '{not json' });
    expect(loadCart(storage)).toEqual([]);
  });

  it('drops saved items that are not valid cart items', () => {
    const saved = JSON.stringify([...cart, { productId: 1, quantity: 0 }, null]);
    const storage = createFakeStorage({ [CART_STORAGE_KEY]: saved });
    expect(loadCart(storage)).toEqual(cart);
  });

  it('does not throw when storage is unavailable', () => {
    expect(loadCart(null)).toEqual([]);
    expect(() => saveCart(null, cart)).not.toThrow();
  });
});
