/** Compatibility entry point for the job scheduler (重构计划 R3 / spec §3.2)。
 * 实现（轮询/claim/watchdog/执行器分发）已迁至 services/jobs/scheduler.ts。 */
export {
  startJobScheduler as startScheduler,
  stopJobScheduler as stopScheduler,
  isJobSchedulerBusy as isSchedulerBusy
} from './jobs/scheduler'
