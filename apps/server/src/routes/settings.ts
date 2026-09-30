import type { FastifyPluginAsync } from 'fastify'
import type { DB } from '../db/index.ts'
import { readSettings, settingsSchema, writeSettings } from '../lib/settings.ts'

export const settingsRoutes = (db: DB): FastifyPluginAsync => async (fastify) => {
  fastify.get('/settings', async () => ({ settings: readSettings(db) }))

  fastify.patch('/settings', async (req) => {
    const patch = settingsSchema.parse(req.body ?? {})
    return { settings: writeSettings(db, patch) }
  })
}
