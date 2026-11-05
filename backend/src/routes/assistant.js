import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { buildGroundedAssistantResponse } from '../services/assistant.js';
import { assistantQuestionSchema } from '../validators/schemas.js';
const router = Router();

const assistantLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

export async function getAssistantProducts(database = prisma) {
  return database.product.findMany({
    where: { active: true, stock: { gt: 0 } },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      price: true,
      stock: true
    },
    orderBy: { price: 'asc' }
  });
}

router.post('/questions', assistantLimiter, async (request, response, next) => {
  try {
    const parsed = assistantQuestionSchema.safeParse(request.body);
    if (!parsed.success) return response.status(422).json({ error: { code: 'INVALID_QUESTION', message: 'Question must contain between 3 and 300 characters.' } });
    const products = await getAssistantProducts();
    response.json(await buildGroundedAssistantResponse(products, parsed.data.question));
  } catch (error) { next(error); }
});

export default router;
