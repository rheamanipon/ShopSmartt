import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantResponse, buildGroundedAssistantResponse, parseBudget, rankProducts, validateGeminiDraft } from '../src/services/assistant.js';
import { classifyGeminiError, createGeminiProvider } from '../src/services/gemini.js';
import { getAssistantProducts } from '../src/routes/assistant.js';

const products = [
  { id: 1, name: 'Compact Mechanical Keyboard', category: 'Accessories', description: 'Hot-swappable compact keyboard with tactile switches.', price: '1850.00', stock: 8 },
  { id: 2, name: 'Wireless Mouse', category: 'Accessories', description: 'Quiet wireless mouse with adjustable sensitivity and USB receiver.', price: '650.00', stock: 12 },
  { id: 3, name: 'USB-C Study Lamp', category: 'Study', description: 'Adjustable desk lamp with three brightness levels.', price: '900.00', stock: 10 },
  { id: 4, name: '1080p Webcam', category: 'Video', description: 'Full HD webcam with privacy cover and built-in microphone.', price: '1450.00', stock: 6 },
  { id: 5, name: 'Out of Stock Keyboard', category: 'Accessories', description: 'Mechanical keyboard', price: '1000.00', stock: 0 }
];

const studyLampProducts = [
  products[2],
  { id: 6, name: 'Adjustable Desk Lamp', category: 'Home', description: 'Flexible LED lamp for reading.', price: '1500.00', stock: 5 },
  { id: 7, name: 'Laptop Stand', category: 'Study', description: 'Foldable aluminum stand for laptops up to 16 inches.', price: '1200.00', stock: 9 }
];

test('parseBudget accepts peso amounts and contextual limits without treating model numbers as budgets', () => {
  assert.equal(parseBudget('below ₱2,000'), 2000);
  assert.equal(parseBudget('₱ 1,234.50'), 1234.5);
  assert.equal(parseBudget('PHP 2000'), 2000);
  assert.equal(parseBudget('below 1,234.50'), 1234.5);
  assert.equal(parseBudget('1080p webcam'), null);
});

test('recommends the relevant keyboard within the stated budget only', () => {
  const result = buildAssistantResponse(products, 'Which keyboard is below ₱2,000?');
  assert.deepEqual(result.recommendedProducts.map((product) => product.id), [1]);
  assert.deepEqual(result.sources.map((source) => source.id), [1]);
  assert.equal(result.recommendedProducts[0].price, 1850);
});

test('rankProducts respects a contextual budget', () => {
  assert.deepEqual(rankProducts(products, 'mouse below 700').map((product) => product.id), [2]);
});

test('plural keyboard keywords match singular catalog products while respecting budgets', () => {
  const result = rankProducts(products, 'Which keyboards are below ₱2,000?');
  assert.deepEqual(result.map((product) => product.id), [1]);
  assert.deepEqual(rankProducts(products, 'keyboards below ₱1,000').map((product) => product.id), []);
});

test('specific product type matching excludes category-only matches but keeps multiple relevant products', () => {
  const result = rankProducts(studyLampProducts, 'Do you have a study lamp below ₱2000?');

  assert.deepEqual(result.map(({ id }) => id), [3, 6]);
  assert.equal(result.some(({ id }) => id === 7), false);
});

test('a specific out-of-stock product request does not fall back to another product in its category', async () => {
  let providerCalled = false;
  const result = await buildGroundedAssistantResponse([
    { ...studyLampProducts[0], stock: 0 },
    studyLampProducts[2]
  ], 'Do you have a study lamp?', {
    generateDraft: async () => { providerCalled = true; },
    log: () => {}
  });

  assert.equal(providerCalled, false);
  assert.deepEqual(result, {
    answer: 'I could not find an in-stock product matching that request.',
    recommendedProducts: [],
    sources: []
  });
});

test('general category requests still recommend matching products across that category', () => {
  const result = rankProducts(studyLampProducts, 'What Study products do you recommend?');

  assert.deepEqual(result.map(({ id }) => id), [3, 7]);
});

test('Gemini and rule-based fallback receive only products matching the requested product type', async () => {
  let providerProductIds;
  const result = await buildGroundedAssistantResponse(
    studyLampProducts,
    'Do you have a study lamp below ₱2000?',
    {
      generateDraft: async (_question, selected) => {
        providerProductIds = selected.map(({ id }) => id);
        throw new Error('mocked provider failure');
      },
      log: () => {}
    }
  );

  assert.deepEqual(providerProductIds, [3, 6]);
  assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [3, 6]);
  assert.deepEqual(result.sources.map(({ id }) => id), [3, 6]);
  assert.doesNotMatch(result.answer, /Laptop Stand/);
});

test('a stocked keyboard is recommended under budget while the matching out-of-stock keyboard is excluded', async () => {
  const keyboardFixture = [
    {
      id: 21,
      name: 'Out-of-Stock Compact Keyboard',
      category: 'Accessories',
      description: 'Compact keyboard with tactile switches.',
      price: '1500.00',
      stock: 0,
      active: true
    },
    {
      id: 22,
      name: 'Compact Mechanical Keyboard',
      category: 'Accessories',
      description: 'Compact keyboard with tactile switches.',
      price: '1800.00',
      stock: 4,
      active: true
    }
  ];
  let providerProducts;
  const result = await buildGroundedAssistantResponse(keyboardFixture, 'Which keyboard is under ₱2,000?', {
    generateDraft: async (_question, selected) => {
      providerProducts = selected;
      return {
        answer: 'The Compact Mechanical Keyboard is a good option: Compact keyboard with tactile switches.',
        productIds: [22],
        sourceIds: [22]
      };
    },
    log: () => {}
  });

  assert.deepEqual(providerProducts.map(({ id }) => id), [22]);
  assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [22]);
  assert.deepEqual(result.sources.map(({ id }) => id), [22]);
  assert.equal(result.recommendedProducts.some(({ id }) => id === 21), false);
  assert.equal(result.sources.some(({ id }) => id === 21), false);
});

test('an out-of-stock-only matching keyboard returns honest no-match without calling Gemini', async () => {
  let providerCalled = false;
  const result = await buildGroundedAssistantResponse([{
    id: 23,
    name: 'Out-of-Stock Compact Keyboard',
    category: 'Accessories',
    description: 'Compact keyboard with tactile switches.',
    price: '1500.00',
    stock: 0,
    active: true
  }], 'Which keyboard is under ₱2,000?', {
    generateDraft: async () => { providerCalled = true; },
    log: () => {}
  });

  assert.equal(providerCalled, false);
  assert.deepEqual(result, {
    answer: 'I could not find an in-stock product matching that request.',
    recommendedProducts: [],
    sources: []
  });
});

test('does not recommend unrelated products when the question has no matching product', () => {
  assert.deepEqual(buildAssistantResponse(products, 'Which keyboard is below ₱2,000?').recommendedProducts.map((product) => product.id), [1]);
  const result = buildAssistantResponse(products, 'Do you have a gaming chair?');
  assert.deepEqual(result, {
    answer: 'I could not find an in-stock product matching that request.',
    recommendedProducts: [],
    sources: []
  });
});

test('excludes products with no stock', () => {
  assert.deepEqual(rankProducts(products, 'keyboard').map((product) => product.id), [1]);
});

test('assistant response contains corresponding product IDs in recommendations and sources', () => {
  const result = buildAssistantResponse(products, 'mouse');
  assert.deepEqual(result.recommendedProducts.map((product) => product.id), [2]);
  assert.deepEqual(result.sources.map((source) => source.id), [2]);
});

test('a valid Gemini draft supplies the answer while records and sources use verified catalog data', async () => {
  const logs = [];
  const result = await buildGroundedAssistantResponse(products, 'keyboard', {
    generateDraft: async (_question, selected) => ({
      answer: 'The Compact Mechanical Keyboard is a good option: Hot-swappable compact keyboard with tactile switches.',
      productIds: [selected[0].id],
      sourceIds: [selected[0].id]
    }),
    log: (message) => logs.push(message)
  });

  assert.deepEqual(Object.keys(result), ['answer', 'recommendedProducts', 'sources']);
  assert.equal(result.answer, 'The Compact Mechanical Keyboard is a good option: Hot-swappable compact keyboard with tactile switches.');
  assert.deepEqual(result.recommendedProducts, [{ id: 1, name: 'Compact Mechanical Keyboard', price: 1850, category: 'Accessories' }]);
  assert.deepEqual(result.sources, [{ type: 'product', id: 1, name: 'Compact Mechanical Keyboard' }]);
  assert.deepEqual(logs, ['Gemini response validation succeeded; fallback not used']);
});

test('no-match requests bypass Gemini and preserve the response shape', async () => {
  let called = false;
  const result = await buildGroundedAssistantResponse(products, 'gaming chair', {
    generateDraft: async () => { called = true; }
  });

  assert.equal(called, false);
  assert.deepEqual(result, {
    answer: 'I could not find an in-stock product matching that request.',
    recommendedProducts: [],
    sources: []
  });
});

test('rejects source IDs outside the selected products and uses the safe fallback', async () => {
  const selectedMouse = [products[1]];
  assert.equal(validateGeminiDraft({
    answer: 'The Wireless Mouse is a good option.',
    productIds: [2],
    sourceIds: [1]
  }, selectedMouse).failure, 'UNSELECTED_SOURCE_ID');

  const result = await buildGroundedAssistantResponse(products, 'mouse', {
    generateDraft: async () => ({
      answer: 'The Wireless Mouse is a good option.',
      productIds: [2],
      sourceIds: [1]
    }),
    log: () => {}
  });

  assert.match(result.answer, /Wireless Mouse/);
  assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [2]);
  assert.deepEqual(result.sources.map(({ id }) => id), [2]);
});

test('rejects missing and unrelated source IDs and uses the safe fallback', async () => {
  const drafts = [
    { question: 'mouse', draft: { answer: 'The Wireless Mouse is a good option.', productIds: [2], sourceIds: [] } },
    { question: 'mouse keyboard', draft: { answer: 'The Wireless Mouse is a good option.', productIds: [2], sourceIds: [2, 1] } }
  ];

  for (const { question, draft } of drafts) {
    const result = await buildGroundedAssistantResponse(products, question, {
      generateDraft: async () => draft,
      log: () => {}
    });
    const expectedIds = rankProducts(products, question).slice(0, 3).map(({ id }) => id);
    assert.match(result.answer, /Based on the current ShopSmart catalog/);
    assert.deepEqual(result.recommendedProducts.map(({ id }) => id), expectedIds);
    assert.deepEqual(result.sources.map(({ id }) => id), expectedIds);
  }
});

test('rejects model-generated product and source objects instead of trusting their fields', () => {
  const selected = [products[0]];
  const result = validateGeminiDraft({
    answer: 'The Compact Mechanical Keyboard is a good option.',
    productIds: [1],
    sourceIds: [1],
    recommendedProducts: [{ id: 1, name: 'Fake keyboard', price: 1, category: 'Fake' }],
    sources: [{ id: 1, name: 'Fake source' }]
  }, selected);

  assert.equal(result.failure, 'INVALID_DRAFT_SHAPE');
});

test('rejects incorrect prices, false availability, and unsupported specifications', () => {
  const selected = [{ ...products[0], price: 1850, id: 1 }];
  const unsupportedDrafts = [
    { answer: 'The Compact Mechanical Keyboard costs ₱1,000.', productIds: [1], sourceIds: [1] },
    { answer: 'The Compact Mechanical Keyboard is available now.', productIds: [1], sourceIds: [1] },
    { answer: 'The Compact Mechanical Keyboard is waterproof.', productIds: [1], sourceIds: [1] },
    { answer: 'The Compact Mechanical Keyboard is not hot-swappable.', productIds: [1], sourceIds: [1] }
  ];

  assert.deepEqual(
    unsupportedDrafts.map((draft) => validateGeminiDraft(draft, selected).failure),
    ['UNSUPPORTED_CLAIM', 'UNSUPPORTED_CLAIM', 'UNSUPPORTED_CLAIM', 'UNSUPPORTED_CLAIM']
  );
});

test('inactive and out-of-stock products cannot be recommended or sourced', async () => {
  let called = false;
  const inactive = { ...products[0], id: 11, active: false };
  const outOfStock = { ...products[0], id: 12, stock: 0 };
  const inactiveResult = await buildGroundedAssistantResponse([inactive], 'keyboard', {
    generateDraft: async () => { called = true; }
  });
  const outOfStockResult = await buildGroundedAssistantResponse([outOfStock], 'keyboard', {
    generateDraft: async () => { called = true; }
  });

  assert.equal(called, false);
  assert.deepEqual(inactiveResult.recommendedProducts, []);
  assert.deepEqual(inactiveResult.sources, []);
  assert.deepEqual(outOfStockResult.recommendedProducts, []);
  assert.deepEqual(outOfStockResult.sources, []);
  assert.equal(validateGeminiDraft({
    answer: 'The Compact Mechanical Keyboard is a good option: Hot-swappable compact keyboard with tactile switches.',
    productIds: [11],
    sourceIds: [11]
  }, [inactive]).failure, 'INELIGIBLE_RECOMMENDATION');
});

test('missing API key falls back without constructing a Gemini client', async () => {
  const generateDraft = createGeminiProvider({
    apiKey: '',
    clientFactory: () => { throw new Error('Client should not be constructed'); }
  });
  const result = await buildGroundedAssistantResponse(products, 'mouse', { generateDraft, log: () => {} });

  assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [2]);
  await assert.rejects(generateDraft('mouse', [products[1]]), (error) => error.code === 'MISSING_API_KEY');
});

test('Gemini requests time out and fall back', async () => {
  const generateDraft = createGeminiProvider({
    apiKey: 'test-key',
    timeoutMs: 5,
    clientFactory: () => ({ interactions: { create: () => new Promise(() => {}) } })
  });
  const logs = [];
  const result = await buildGroundedAssistantResponse(products, 'mouse', {
    generateDraft,
    log: (message) => logs.push(message)
  });

  assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [2]);
  assert.deepEqual(logs, ['Gemini fallback used: APPLICATION_TIMEOUT']);
});

test('Gemini rate limits are classified and fall back', async () => {
  const generateDraft = createGeminiProvider({
    apiKey: 'test-key',
    clientFactory: () => ({ interactions: { create: async () => { throw { status: 429 }; } } })
  });
  const result = await buildGroundedAssistantResponse(products, 'mouse', { generateDraft, log: () => {} });

  assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [2]);
  await assert.rejects(generateDraft('mouse', [products[1]]), (error) => error.code === 'RATE_LIMIT');
});

test('Gemini provider errors are classified without exposing provider messages', () => {
  assert.equal(classifyGeminiError({ status: 401 }), 'INVALID_CREDENTIALS');
  assert.equal(classifyGeminiError({ status: 403 }), 'ACCESS_DENIED');
  assert.equal(classifyGeminiError({ status: 404 }), 'MODEL_UNAVAILABLE');
  assert.equal(classifyGeminiError({ status: 400, message: 'Model is not supported' }), 'MODEL_UNAVAILABLE');
  assert.equal(classifyGeminiError({ status: 429 }), 'RATE_LIMIT');
  assert.equal(classifyGeminiError({ name: 'APIConnectionTimeoutError' }), 'PROVIDER_TIMEOUT');
  assert.equal(classifyGeminiError({ name: 'APIConnectionError' }), 'NETWORK_ERROR');
  assert.equal(classifyGeminiError({ cause: { code: 'ECONNRESET' } }), 'NETWORK_ERROR');
});

test('SDK request uses a configurable timeout and disables hidden retries', async () => {
  let sdkOptions;
  let requestOptions;
  const generateDraft = createGeminiProvider({
    apiKey: 'test-key',
    timeoutMs: 16_000,
    clientFactory: (_key, options) => {
      sdkOptions = options;
      return { interactions: { create: async (_request, options) => {
        requestOptions = options;
        return { output_text: '{"answer":"ok","productIds":[],"sourceIds":[]}' };
      } } };
    }
  });
  await generateDraft('question', []);

  assert.deepEqual(sdkOptions, { httpOptions: { timeout: 16_000, retryOptions: { attempts: 1 } } });
  assert.deepEqual(requestOptions, { timeout_ms: 16_000, retries: { strategy: 'none' } });
});

test('malformed provider output falls back safely', async () => {
  const logs = [];
  const generateDraft = createGeminiProvider({
    apiKey: 'test-key',
    log: (message) => logs.push(message),
    clientFactory: () => ({ interactions: { create: async () => ({ output_text: '{bad json' }) } })
  });
  const result = await buildGroundedAssistantResponse(products, 'mouse', { generateDraft, log: (message) => logs.push(message) });

  assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [2]);
  assert.deepEqual(logs, [
    'Gemini provider request succeeded',
    'Gemini response parsing failed: INVALID_JSON',
    'Gemini fallback used: MALFORMED_RESPONSE'
  ]);
  await assert.rejects(generateDraft('mouse', [products[1]]), (error) => error.code === 'MALFORMED_RESPONSE');
});

test('draft validation reports exact failure reasons and accepts selected numeric string IDs', () => {
  const selected = [{ ...products[0], price: 1850, id: 1 }];
  const accepted = validateGeminiDraft({
    answer: 'The Compact Mechanical Keyboard is a great choice: Hot-swappable compact keyboard with tactile switches.',
    productIds: ['1'],
    sourceIds: ['1']
  }, selected);
  assert.equal(accepted.failure, undefined);
  assert.deepEqual(accepted.value.products, selected);

  assert.equal(validateGeminiDraft({ answer: '', productIds: [1], sourceIds: [1] }, selected).failure, 'MISSING_ANSWER');
  assert.equal(validateGeminiDraft({
    answer: 'The Compact Mechanical Keyboard is a great option.',
    productIds: [999],
    sourceIds: [1]
  }, selected).failure, 'UNSELECTED_RECOMMENDATION_ID');
  assert.equal(validateGeminiDraft({
    answer: 'The Compact Mechanical Keyboard is a great option for gaming.',
    productIds: [1],
    sourceIds: [1]
  }, selected).failure, 'UNGROUNDED_ANSWER_WORD');
});

test('missing answer causes a categorized fallback', async () => {
  const logs = [];
  const result = await buildGroundedAssistantResponse(products, 'keyboard', {
    generateDraft: async () => ({ answer: '', productIds: [1], sourceIds: [1] }),
    log: (message) => logs.push(message)
  });

  assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [1]);
  assert.deepEqual(logs, [
    'Gemini response validation failed: MISSING_ANSWER',
    'Gemini fallback used: INVALID_DRAFT'
  ]);
});

test('unknown Gemini product IDs and unsupported price claims are rejected', async () => {
  const invalidDrafts = [
    { answer: 'The Compact Mechanical Keyboard is a good option: Hot-swappable compact keyboard with tactile switches.', productIds: [999], sourceIds: [1] },
    { answer: 'The Compact Mechanical Keyboard costs ₱1,850.', productIds: [1], sourceIds: [1] }
  ];

  for (const draft of invalidDrafts) {
    const result = await buildGroundedAssistantResponse(products, 'keyboard', {
      generateDraft: async () => draft,
      log: () => {}
    });
    assert.match(result.answer, /Compact Mechanical Keyboard/);
    assert.deepEqual(result.recommendedProducts.map(({ id }) => id), [1]);
  }
});

test('Gemini receives only selected public product fields and the configured model', async () => {
  let request;
  const generateDraft = createGeminiProvider({
    apiKey: 'test-key',
    model: 'gemini-test-model',
    clientFactory: () => ({ interactions: { create: async (options) => {
      request = options;
      return { output_text: JSON.stringify({
        answer: 'The Compact Mechanical Keyboard is a good option: Hot-swappable compact keyboard with tactile switches.',
        productIds: [1],
        sourceIds: [1]
      }) };
    } } })
  });
  const draft = await generateDraft('keyboard', [{ ...products[0], score: 3 }]);

  assert.equal(request.model, 'gemini-test-model');
  assert.equal(request.response_format.mime_type, 'application/json');
  assert.deepEqual(request.response_format.schema.required, ['answer', 'productIds', 'sourceIds']);
  assert.equal(draft.productIds[0], 1);
  assert.equal(draft.sourceIds[0], 1);
  assert.match(request.input, /"price":1850/);
  assert.doesNotMatch(request.input, /"score"|email|address|customerName|order/i);
});

test('retrieves only active, in-stock products and the assistant public fields', async () => {
  let query;
  const retrievalCandidates = [
    { ...products[0], active: true },
    { ...products[0], id: 6, name: 'Inactive Keyboard', active: false },
    { ...products[4], active: true }
  ];
  const database = {
    product: {
      findMany: async (options) => {
        query = options;
        return retrievalCandidates
          .filter((product) => product.active === options.where.active && product.stock > 0)
          .map(({ id, name, description, category, price, stock }) => ({ id, name, description, category, price, stock }));
      }
    }
  };

  const result = await getAssistantProducts(database);
  assert.deepEqual(query.where, { active: true, stock: { gt: 0 } });
  assert.deepEqual(query.select, {
    id: true,
    name: true,
    description: true,
    category: true,
    price: true,
    stock: true
  });
  assert.deepEqual(result.map((product) => product.id), [1]);
  assert.equal(result.some((product) => product.stock === 0), false);
});

test('route catalog retrieval excludes stock-zero keyboard when another matching keyboard is stocked', async () => {
  const keyboardFixture = [
    {
      id: 31,
      name: 'Out-of-Stock Keyboard',
      category: 'Accessories',
      description: 'Compact mechanical keyboard.',
      price: '1200.00',
      stock: 0,
      active: true
    },
    {
      id: 32,
      name: 'Stocked Keyboard',
      category: 'Accessories',
      description: 'Compact mechanical keyboard.',
      price: '1600.00',
      stock: 3,
      active: true
    }
  ];
  let query;
  const database = {
    product: {
      findMany: async (options) => {
        query = options;
        return keyboardFixture
          .filter((product) => product.active === options.where.active && product.stock > options.where.stock.gt)
          .map(({ id, name, description, category, price, stock }) => ({ id, name, description, category, price, stock }));
      }
    }
  };

  const retrieved = await getAssistantProducts(database);
  assert.deepEqual(query.where, { active: true, stock: { gt: 0 } });
  assert.deepEqual(retrieved.map(({ id }) => id), [32]);
  assert.equal(retrieved.some(({ id }) => id === 31), false);
});
