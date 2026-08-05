/// <reference types="@types/bun" />

// In-process CronJob handle returned by the 2-arg Bun.cron overload
interface BunCronJob {
  readonly cron: string;
  stop(): void;
  unref(): void;
  ref(): void;
}
