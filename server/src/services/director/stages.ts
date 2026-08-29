// 导演域阶段元数据（重构计划 R4.2 / spec §3.3）：阶段顺序与展示名的唯一事实源。
// 禁止在其他文件复制阶段字符串清单；新增阶段只改这里。
export type DirectorStage =
  | 'inspiration'
  | 'directions'
  | 'framing'
  | 'macro'
  | 'world'
  | 'characters'
  | 'volumes'
  | 'beats'
  | 'chapters'
  | 'refine'
  | 'ready'

export const STAGE_LABELS: Record<DirectorStage, string> = {
  inspiration: '灵感理解',
  directions: '方向生成（2 套 + 标题组）',
  framing: '项目设定（framing）',
  macro: '故事宏观规划',
  world: '世界观骨架',
  characters: '角色方案',
  volumes: '卷战略',
  beats: '节奏板',
  chapters: '章节清单',
  refine: '章节细化',
  ready: '可开写检查点'
}

export const STAGE_ORDER: DirectorStage[] = [
  'inspiration',
  'directions',
  'framing',
  'macro',
  'world',
  'characters',
  'volumes',
  'beats',
  'chapters',
  'refine',
  'ready'
]
