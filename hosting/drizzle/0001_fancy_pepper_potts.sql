CREATE TABLE `market_cache` (
	`product` text PRIMARY KEY NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`fetched_at` integer DEFAULT 0 NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL
);
