// 导演主循环（重构计划 R4.2 / spec §3.3）：取消感知、熔断（按阶段计数 + 决策路径去重）、
// 产物驱动幂等跳过、重试、supervised 暂停与 done 收尾。
// 执行面隔离：由 scheduler 的 director 执行器驱动（AGENTS #23/#25），API 不得直接调用。
import { DatabaseSync } from 'node:sqlite'
import { isJobCancelled, isJobAborted } from '../jobQueue'
import { STAGE_LABELS, STAGE_ORDER } from './stages'
import { loadDirectorTask, saveDirectorTask } from './checkpoint'
import { isStageDone } from './artifacts'
import { STAGE_EXECUTORS } from './executors'

const MAX_REPLAN = 3

export interface PipelineContext {
  chaptersPerVolume: number
  // P20（M2）：job 感知（取消时每阶段边界中止）
  jobId?: number
}

export async function runDirectorPipeline(
  db: DatabaseSync,
  novelId: number,
  mode: 'auto' | 'supervised' = 'auto',
  ctx: PipelineContext = { chaptersPerVolume: 20 }
): Promise<void> {
  // 加载或新建任务
  let task = loadDirectorTask(db, novelId)
  if (!task) {
    task = {
      id: 0,
      novelId,
      stage: 'inspiration',
      status: 'running',
      mode,
      checkpoint: {
        stage: 'inspiration',
        progress: {},
        decisions: [],
        replanCount: 0,
        mode,
        chaptersPerVolume: ctx.chaptersPerVolume, // P2.2 🟡10
        displayStatus: '导演启动',
        resumeAction: '自动推进'
      }
    }
  }
  task.status = 'running'
  task.mode = mode
  task.checkpoint.chaptersPerVolume = ctx.chaptersPerVolume // P2.2 🟡10：resume 时保留
  saveDirectorTask(db, task)

  for (const stage of STAGE_ORDER) {
    // P20（M2）：取消感知（用户取消 → 中止并标记 task）；v0.8.0（审查 #8）：watchdog 超时同样中止
    if (ctx.jobId && isJobAborted(db, ctx.jobId)) {
      const watchdogStuck = isJobCancelled(db, ctx.jobId) === false
      task.status = 'cancelled'
      task.checkpoint.displayStatus = watchdogStuck ? '导演已中止（任务超时回收）' : '导演已取消（用户中止）'
      task.checkpoint.resumeAction = '重新运行导演以继续'
      saveDirectorTask(db, task)
      return
    }

    // 熔断：超过上限直接停
    // P20（M6）：按阶段计数——早期网络抖动不耗尽全局预算
    const stageReplans = task.checkpoint.decisions.filter((d) => d.startsWith(`${stage}:`)).length
    if (stageReplans > MAX_REPLAN) {
      task.status = 'failed'
      task.checkpoint.displayStatus = '重规划超限，需人工介入'
      task.checkpoint.blockingReason = `阶段 ${STAGE_LABELS[stage]} 连续重规划 ${stageReplans} 次超过上限 ${MAX_REPLAN}`
      task.checkpoint.resumeAction = '人工修改后重跑导演'
      saveDirectorTask(db, task)
      return
    }

    // 幂等：产物已落库则跳过（重启恢复的关键；checkpoint 未推进时同样生效）
    if (isStageDone(db, novelId, stage)) {
      task.checkpoint.progress[stage] = true
      task.stage = stage
      task.checkpoint.stage = stage
      task.checkpoint.displayStatus = `阶段完成：${STAGE_LABELS[stage]}（跳过）`
      saveDirectorTask(db, task)
      continue
    }

    task.stage = stage
    task.checkpoint.stage = stage
    task.checkpoint.displayStatus = `执行中：${STAGE_LABELS[stage]}`
    task.checkpoint.lastError = undefined
    saveDirectorTask(db, task)

    try {
      await STAGE_EXECUTORS[stage](db, novelId, { chaptersPerVolume: ctx.chaptersPerVolume })
      task.checkpoint.progress[stage] = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      task.checkpoint.lastError = message
      task.checkpoint.replanCount += 1
      // 决策路径去重（熔断）：同类错误不无限重试
      const sig = `${stage}:${message.slice(0, 60)}`
      if (!task.checkpoint.decisions.includes(sig)) {
        task.checkpoint.decisions.push(sig)
      }
      const isRetryable =
        /LLM JSON 输出解析失败|rate limit|429|503|timeout|网络|ECONN|配额|insufficient_quota/i.test(message)
      // P20（M6）：按阶段计数判定可重试（同签名的重试计入该阶段预算；
      // 本次运行推进到下一阶段，失败阶段在下次 resume 时经产物判定重试）
      const stageReplansNow = task.checkpoint.decisions.filter((d) => d.startsWith(`${stage}:`)).length
      if (isRetryable && stageReplansNow <= MAX_REPLAN) {
        task.status = 'running'
        task.checkpoint.displayStatus = `阶段失败（可重试 ${stageReplansNow}/${MAX_REPLAN}）：${STAGE_LABELS[stage]}`
        saveDirectorTask(db, task)
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      task.status = 'failed'
      task.checkpoint.displayStatus = `失败（不可自动恢复）：${STAGE_LABELS[stage]}`
      task.checkpoint.blockingReason = message
      task.checkpoint.resumeAction = mode === 'supervised' ? '确认后重试' : '人工介入或换模型后 resume'
      saveDirectorTask(db, task)
      return
    }

    // supervised 模式：每阶段完成暂停等确认
    if (mode === 'supervised' && stage !== 'ready') {
      task.status = 'paused'
      task.checkpoint.displayStatus = `检查点：${STAGE_LABELS[stage]} 完成，等待确认`
      task.checkpoint.resumeAction = 'resume 继续下一阶段'
      saveDirectorTask(db, task)
      return
    }
  }

  // P2.1 🟡10：ready 收尾位于 done 判定之前——auto 模式自动确认 pending 角色入册（supervised 保持手动）
  if (task.mode === 'auto') {
    db.prepare(
      "UPDATE character SET status = 'roster', updated_at = datetime('now') WHERE novel_id = ? AND status = 'pending'"
    ).run(novelId)
  }

  task.status = 'done'
  task.checkpoint.stage = 'ready'
  task.checkpoint.displayStatus = '导演完成：全书规划可开写'
  saveDirectorTask(db, task)
}
