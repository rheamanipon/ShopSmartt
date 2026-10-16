import { useEffect, useMemo, useState } from 'react';
import ProductCard from '../components/ProductCard.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { useCart } from '../context/CartContext.jsx';
import { api } from '../services/api.js';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(['All']);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('default');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const { addToCart, cartMessage } = useCart();

  useEffect(() => {
    let active = true;
    api.getProducts()
      .then((data) => {
        if (active) {
          setCategories(['All', ...new Set(data.products.map((product) => product.category))]);
        }
      })
      .catch((caught) => {
        if (active) setCategoryError(caught.message);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.getProducts(search)
      .then((data) => {
        if (active) setProducts(data.products);
      })
      .catch((caught) => {
        if (active) {
          setProducts([]);
          setError(caught.message);
        }
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [search]);

  const visibleProducts = useMemo(() => {
    const filteredProducts = products.filter((product) => {
      const matchesCategory = category === 'All' || product.category === category;
      return matchesCategory;
    });

    if (sort === 'default') return filteredProducts;

    return [...filteredProducts].sort((first, second) => {
      if (sort === 'price-low') return Number(first.price) - Number(second.price);
      if (sort === 'price-high') return Number(second.price) - Number(first.price);
      return first.name.localeCompare(second.name);
    });
  }, [category, products, sort]);

  return (
    <section>
      <div className="hero">
        <div>
          <p className="eyebrow">BSIT FULL-STACK PROJECT</p>
          <h1>Technology for study, work and play</h1>
          <p>Browse the starter catalog, build a cart and complete a simulated order.</p>
        </div>
      </div>

      <div className="toolbar">
        <label>
          <span>Search products</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try keyboard" />
        </label>
        <label>
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="default">Default</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
            <option value="name-az">Name: A to Z</option>
          </select>
        </label>
      </div>

      <StatusMessage>{cartMessage}</StatusMessage>
      {categoryError && <StatusMessage type="error">Category options could not be loaded: {categoryError}</StatusMessage>}
      {loading && <StatusMessage>Loading products…</StatusMessage>}
      {error && <StatusMessage type="error">{error} Make sure the backend is running.</StatusMessage>}
      {!loading && !error && visibleProducts.length === 0 && <StatusMessage>No products match your search or filters.</StatusMessage>}

      {!loading && !error && (
        <div className="product-grid">
          {visibleProducts.map((product) => (
            <ProductCard key={product.id} product={product} onAddToCart={addToCart} />
          ))}
        </div>
      )}
    </section>
  );
}
