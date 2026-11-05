import { generateGeminiDraft } from './gemini.js';

const NO_MATCH_RESPONSE = {
  answer: 'I could not find an in-stock product matching that request.',
  recommendedProducts: [],
  sources: []
};

const ignoredTerms = new Set([
  'a', 'an', 'and', 'are', 'can', 'do', 'for', 'have', 'i', 'in', 'is', 'it',
  'me', 'my', 'of', 'on', 'or', 'please', 'recommend', 'show', 'that', 'the',
  'this', 'to', 'what', 'which', 'with', 'you',
  'available', 'availability', 'below', 'budget', 'cheaper', 'item', 'items',
  'less', 'max', 'maximum', 'more', 'php', 'price', 'product', 'products',
  'stock', 'than', 'type', 'under', 'up'
]);

const budgetPattern = /(?:₱\s*|php\s*)(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/i;
const budgetCuePattern = /(?:under|below|less\s+than|up\s+to|within|maximum|max|budget(?:\s+of)?|price\s+limit(?:\s+of)?|not\s+more\s+than)\s*(?:₱\s*|php\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/i;

export function parseBudget(question) {
  const currencyMatch = question.match(budgetPattern);
  const match = currencyMatch ?? question.match(budgetCuePattern);
  if (!match) return null;
  return Number(`${match[1]}${match[2] ?? ''}`.replaceAll(',', ''));
}

export function rankProducts(products, question) {
  const terms = question.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !ignoredTerms.has(term));
  const budget = parseBudget(question);
  return products
    .filter((product) => product.active !== false
      && product.stock > 0
      && (budget === null || Number(product.price) <= budget))
    .map((product) => {
      const name = product.name.toLowerCase().split(/[^a-z0-9]+/);
      const category = product.category.toLowerCase().split(/[^a-z0-9]+/);
      const description = product.description.toLowerCase().split(/[^a-z0-9]+/);
      const score = terms.reduce((total, term) => total
        + (name.includes(term) ? 3 : 0)
        + (category.includes(term) ? 2 : 0)
        + (description.includes(term) ? 1 : 0), 0);
      return { ...product, price: Number(product.price), score };
    })
    .filter((product) => product.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.price) - Number(b.price));
}

export function buildAssistantResponse(products, question) {
  const ranked = rankProducts(products, question).slice(0, 3);
  return buildFallbackResponse(ranked);
}

function buildFallbackResponse(products) {
  if (products.length === 0) return NO_MATCH_RESPONSE;
  const names = products.map((product) => product.name).join(', ');
  return {
    answer: `Based on the current ShopSmart catalog, these in-stock products match your request: ${names}.`,
    recommendedProducts: products.map(({ id, name, price, category }) => ({ id, name, price: Number(price), category })),
    sources: products.map(({ id, name }) => ({ type: 'product', id, name }))
  };
}

const safeAnswerWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'based', 'be', 'because', 'catalog', 'consider',
  'choice', 'could', 'current', 'design', 'excellent', 'for', 'great', 'good', 'has', 'helpful',
  'i', 'ideal', 'is', 'it', 'its', 'match', 'matches', 'might', 'on', 'option',
  'options', 'perfect', 'product', 'products', 'recommend', 'recommended', 'request',
  'setup', 'setups', 'shop', 'smart', 'suitable', 'thanks', 'the', 'these', 'this',
  'to', 'your'
]);

const unsupportedClaimPattern = /\b(price|prices|cost|costs|discount|discounts|sale|cheap|cheaper|expensive|affordable|free|stock|availability|available|unavailable|in-stock|out-of-stock|warranty|guarantee|guaranteed|delivery|shipping|waterproof|water-resistant|supports|support|features|feature|includes|include|comes|offering|offers|offer|not|never|without|isn't|aren't|doesn't|don't|can't|cannot|won't|lacks|lack)\b|[₱$€£]/i;
const claimNeutralWords = new Set(['at', 'by', 'from', 'its', 'that', 'which', 'while']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeExactCatalogFacts(text, products) {
  return products.reduce((remaining, product) => {
    const facts = [product.name, product.category, product.description]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return facts.reduce(
      (result, fact) => result.replace(new RegExp(escapeRegExp(fact), 'gi'), ' '),
      remaining
    );
  }, text);
}

function getUngroundedWords(text, product) {
  const unmatchedText = removeExactCatalogFacts(text, [product]);
  if (/[\p{Sc}\d]/u.test(unmatchedText)) return { failure: 'UNSUPPORTED_NUMERIC_CLAIM' };
  const unmatchedWords = unmatchedText.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!unmatchedWords.every((word) => safeAnswerWords.has(word) || claimNeutralWords.has(word))) {
    return { failure: 'UNGROUNDED_ANSWER_WORD' };
  }
  return { failure: null };
}

function getAnswerValidationFailure(answer, products) {
  if (unsupportedClaimPattern.test(answer)) return 'UNSUPPORTED_CLAIM';

  const mentions = products.flatMap((product) => [...answer.matchAll(new RegExp(escapeRegExp(product.name), 'gi'))]
    .map((match) => ({ product, start: match.index, end: match.index + match[0].length })))
    .sort((a, b) => a.start - b.start);
  if (products.some((product) => !mentions.some((mention) => mention.product === product))) {
    return 'MISSING_RECOMMENDATION_MENTION';
  }

  const prefixValidation = getUngroundedWords(answer.slice(0, mentions[0].start), { name: '', category: '', description: '' });
  if (prefixValidation.failure) return prefixValidation.failure;
  for (let index = 0; index < mentions.length; index += 1) {
    const mention = mentions[index];
    const segmentEnd = mentions[index + 1]?.start ?? answer.length;
    const segmentValidation = getUngroundedWords(answer.slice(mention.start, segmentEnd), mention.product);
    if (segmentValidation.failure) return segmentValidation.failure;
  }
  return null;
}

export function validateGeminiDraft(draft, products) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return { failure: 'INVALID_DRAFT_SHAPE' };
  if (Object.keys(draft).length !== 3
    || !Object.hasOwn(draft, 'answer')
    || !Object.hasOwn(draft, 'productIds')
    || !Object.hasOwn(draft, 'sourceIds')) return { failure: 'INVALID_DRAFT_SHAPE' };
  if (typeof draft.answer !== 'string' || draft.answer.trim().length === 0) return { failure: 'MISSING_ANSWER' };
  if (draft.answer.length > 500) return { failure: 'ANSWER_TOO_LONG' };
  if (!Array.isArray(draft.productIds) || draft.productIds.length === 0 || draft.productIds.length > products.length) {
    return { failure: 'INVALID_RECOMMENDATION_IDS' };
  }
  if (!Array.isArray(draft.sourceIds) || draft.sourceIds.length > products.length) return { failure: 'INVALID_SOURCE_IDS' };

  const selectedIds = new Set(products.map(({ id }) => id));
  const parseIds = (ids, failurePrefix) => {
    const parsedIds = ids.map((id) => {
      if (Number.isInteger(id)) return id;
      if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
      return null;
    });
    if (parsedIds.some((id) => id === null)) return { failure: `INVALID_${failurePrefix}_ID_TYPE` };
    if (parsedIds.some((id) => !selectedIds.has(id))) return { failure: `UNSELECTED_${failurePrefix}_ID` };
    if (new Set(parsedIds).size !== parsedIds.length) return { failure: `DUPLICATE_${failurePrefix}_ID` };
    return { ids: parsedIds };
  };
  const recommendationValidation = parseIds(draft.productIds, 'RECOMMENDATION');
  if (recommendationValidation.failure) return recommendationValidation;
  const sourceValidation = parseIds(draft.sourceIds, 'SOURCE');
  if (sourceValidation.failure) return sourceValidation;

  const productIds = recommendationValidation.ids;
  const sourceIds = sourceValidation.ids;
  const referencedProducts = productIds.map((id) => products.find((product) => product.id === id));
  const referencedSources = sourceIds.map((id) => products.find((product) => product.id === id));
  if (referencedProducts.some((product) => product.active === false || product.stock <= 0)) {
    return { failure: 'INELIGIBLE_RECOMMENDATION' };
  }
  if (referencedSources.some((product) => product.active === false || product.stock <= 0)) {
    return { failure: 'INELIGIBLE_SOURCE' };
  }

  if (products.some((product) => !referencedProducts.includes(product)
    && draft.answer.toLowerCase().includes(product.name.toLowerCase()))
  ) return { failure: 'UNSELECTED_PRODUCT_MENTION' };
  if (referencedProducts.some((product) => !draft.answer.toLowerCase().includes(product.name.toLowerCase()))) {
    return { failure: 'MISSING_RECOMMENDATION_MENTION' };
  }
  const answerFailure = getAnswerValidationFailure(draft.answer, referencedProducts);
  if (answerFailure) return { failure: answerFailure };
  return { value: { answer: draft.answer.trim(), products: referencedProducts, sources: referencedSources } };
}

export async function buildGroundedAssistantResponse(products, question, {
  generateDraft = generateGeminiDraft,
  log = (message) => console.info(`[assistant] ${message}`)
} = {}) {
  const selected = rankProducts(products, question).slice(0, 3);
  if (selected.length === 0) return NO_MATCH_RESPONSE;

  try {
    const validation = validateGeminiDraft(await generateDraft(question, selected), selected);
    if (validation.failure) {
      log(`Gemini response validation failed: ${validation.failure}`);
      log('Gemini fallback used: INVALID_DRAFT');
      return buildFallbackResponse(selected);
    }
    const { answer, products: verifiedProducts, sources: verifiedSources } = validation.value;
    log('Gemini response validation succeeded; fallback not used');
    return {
      answer,
      recommendedProducts: verifiedProducts.map(({ id, name, price, category }) => ({
        id,
        name,
        price: Number(price),
        category
      })),
      sources: verifiedSources.map(({ id, name }) => ({ type: 'product', id, name }))
    };
  } catch (error) {
    const knownReasons = new Set([
      'MISSING_API_KEY',
      'APPLICATION_TIMEOUT',
      'PROVIDER_TIMEOUT',
      'NETWORK_ERROR',
      'INVALID_CREDENTIALS',
      'ACCESS_DENIED',
      'MODEL_UNAVAILABLE',
      'INVALID_REQUEST',
      'RATE_LIMIT',
      'MALFORMED_RESPONSE',
      'PROVIDER_ERROR'
    ]);
    const reason = knownReasons.has(error?.code) ? error.code : 'PROVIDER_ERROR';
    log(`Gemini fallback used: ${reason}`);
    return buildFallbackResponse(selected);
  }
}
