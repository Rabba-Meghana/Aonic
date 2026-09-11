import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, requireAdmin } from '@/lib/auth'
import { logger } from '@/lib/logger'

const ProductQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DRAFT']).optional(),
  tag: z.string().optional(),
})

// GET /api/products — list products with cursor-based pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = ProductQuerySchema.parse(Object.fromEntries(searchParams))

    const products = await db.product.findMany({
      where: {
        status: query.status ?? 'ACTIVE',
        ...(query.tag ? { tags: { has: query.tag } } : {}),
      },
      include: {
        variants: true,
        subscriptionPlans: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    })

    const hasMore = products.length > query.limit
    const items = hasMore ? products.slice(0, -1) : products

    return NextResponse.json({
      products: items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
      hasMore,
    })
  } catch (err) {
    logger.error('Products list failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const CreateProductSchema = z.object({
  shopifyProductId: z.string(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  imageUrl: z.string().url().optional(),
})

// POST /api/products — create product (admin only)
export async function POST(request: NextRequest) {
  try {
    const auth = requireAdmin(request)

    const body = await request.json() as unknown
    const parsed = CreateProductSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const product = await db.product.create({
      data: { ...parsed.data },
    })

    logger.info('Product created', { productId: product.id, adminId: auth.sub })

    return NextResponse.json({ product }, { status: 201 })
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (err.message === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logger.error('Product creation failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
