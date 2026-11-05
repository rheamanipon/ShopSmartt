import { useState } from 'react';
import { Link } from 'react-router-dom';
import StatusMessage from '../components/StatusMessage.jsx';
import { api } from '../services/api.js';

export default function AssistantPage() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(event) {
    event.preventDefault(); setError(''); setResult(null); setLoading(true);
    try { setResult(await api.askAssistant(question)); }
    catch (caught) { setError(caught.message); }
    finally { setLoading(false); }
  }

  return (
    <section className="assistant-layout">
      <div>
        <p className="eyebrow">SHOPSMART ASSISTANT</p>
        <h1>Find a product</h1>
        <p>Ask about products in our catalog. The assistant uses AI when it can verify its answer against current catalog records, and otherwise falls back to a safe catalog-based response.</p>
        <form onSubmit={ask}>
          <label>Your question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} minLength="3" maxLength="300" placeholder="Which keyboard is below ₱2,000?" required /></label>
          <button disabled={loading} aria-busy={loading}>{loading ? 'Searching catalog and preparing answer…' : 'Ask ShopSmart'}</button>
          {loading && <StatusMessage>Checking relevant products and preparing a grounded answer…</StatusMessage>}
        </form>
      </div>
      <div className="assistant-answer">
        <h2>Assistant response</h2>
        <StatusMessage type="error">{error}</StatusMessage>
        {!result && !error && <p>Your answer will appear here.</p>}
        {result && <>
          <p>{result.answer}</p>
          {result.recommendedProducts?.length > 0 && <>
            <h3>Recommended products</h3>
            <div className="recommendations">
              {result.recommendedProducts.map((product) => (
                <Link key={product.id} to={`/products/${product.id}`}>{product.name} — ₱{Number(product.price).toLocaleString('en-PH')}</Link>
              ))}
            </div>
          </>}
          {result.sources?.length > 0 && <section aria-labelledby="assistant-sources-heading">
            <h3 id="assistant-sources-heading">Sources</h3>
            <ul>
              {result.sources.map((source) => (
                <li key={`${source.type}-${source.id}`}>
                  <Link to={`/products/${source.id}`}>{source.name}</Link>
                </li>
              ))}
            </ul>
          </section>}
        </>}
      </div>
    </section>
  );
}
