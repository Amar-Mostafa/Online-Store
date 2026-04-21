// ===== Cart Manager =====
const Cart = {
  _getItems() {
    try {
      return JSON.parse(localStorage.getItem('cart_items')) || [];
    } catch {
      return [];
    }
  },

  _save(items) {
    localStorage.setItem('cart_items', JSON.stringify(items));
  },

  getAll() {
    return this._getItems();
  },

  add(product) {
    const items = this._getItems();
    const existing = items.find(i => i.id === product.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      items.push({
        id: product.id,
        name: product.name,
        price: product.price,
        duration: product.duration,
        quantity: 1
      });
    }
    this._save(items);
  },

  remove(productId) {
    const items = this._getItems().filter(i => i.id !== productId);
    this._save(items);
  },

  updateQuantity(productId, quantity) {
    const items = this._getItems();
    const item = items.find(i => i.id === productId);
    if (item) {
      item.quantity = Math.max(1, quantity);
      this._save(items);
    }
  },

  has(productId) {
    return this._getItems().some(i => i.id === productId);
  },

  getCount() {
    return this._getItems().reduce((sum, i) => sum + i.quantity, 0);
  },

  getTotal() {
    return this._getItems().reduce((sum, i) => sum + (i.price * i.quantity), 0);
  },

  clear() {
    localStorage.removeItem('cart_items');
  }
};
