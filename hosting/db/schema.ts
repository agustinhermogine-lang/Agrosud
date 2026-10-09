import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});
export const marketCache = sqliteTable('market_cache', {
 product:text('product').primaryKey(),
 payload:text('payload').notNull().default('{}'),
 fetchedAt:integer('fetched_at').notNull().default(0),
 lockUntil:integer('lock_until').notNull().default(0),
});
