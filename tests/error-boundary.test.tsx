// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../client/src/components/ErrorBoundary'

// v0.25.0（审查 L2）：页面级 ErrorBoundary 测试。
// 此前全应用只有 root 一层边界且无复位能力——任一页面抛错即整应用白屏、未保存正文丢失。

let shouldFail = true

function Boom(): React.JSX.Element {
  if (shouldFail) throw new Error('模拟页面崩溃')
  return <div>页面恢复正常</div>
}

beforeEach(() => {
  shouldFail = true
  // React 在渲染抛出时会向 console.error 输出错误详情，测试内静音
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary（页面级错误边界）', () => {
  it('无错误时正常渲染 children', () => {
    shouldFail = false
    render(
      <ErrorBoundary name="章节执行">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('页面恢复正常')).toBeTruthy()
  })

  it('捕获错误并展示页面名与错误信息（不再整应用白屏）', () => {
    render(
      <ErrorBoundary name="章节执行">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('「章节执行」页面出错了')).toBeTruthy()
    expect(screen.getByText('模拟页面崩溃')).toBeTruthy()
    expect(screen.queryByText('页面恢复正常')).toBeNull()
  })

  it('错误态给出「其余页面不受影响」的引导', () => {
    render(
      <ErrorBoundary name="章节执行">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText(/其余页面不受影响/)).toBeTruthy()
  })

  it('点击「重试此页」复位并重新渲染 children', () => {
    render(
      <ErrorBoundary name="章节执行">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('「章节执行」页面出错了')).toBeTruthy()
    // 复位前先让子组件不再抛错，否则复位后会再次进入错误态
    shouldFail = false
    fireEvent.click(screen.getByText('重试此页'))
    expect(screen.getByText('页面恢复正常')).toBeTruthy()
  })

  it('resetKey 变化（路由切换）自动复位，无需用户操作', () => {
    const { rerender } = render(
      <ErrorBoundary name="章节执行" resetKey="/novels/1/chapters">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('「章节执行」页面出错了')).toBeTruthy()

    shouldFail = false
    rerender(
      <ErrorBoundary name="章节执行" resetKey="/novels/1/director">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('页面恢复正常')).toBeTruthy()
  })

  it('resetKey 未变化时不吞掉错误（保持错误态）', () => {
    const { rerender } = render(
      <ErrorBoundary name="章节执行" resetKey="/same">
        <Boom />
      </ErrorBoundary>
    )
    shouldFail = false
    rerender(
      <ErrorBoundary name="章节执行" resetKey="/same">
        <Boom />
      </ErrorBoundary>
    )
    // resetKey 未变 → 错误态保留（不会假装恢复）
    expect(screen.getByText('「章节执行」页面出错了')).toBeTruthy()
  })

  it('提供「重新加载应用」兜底入口', () => {
    render(
      <ErrorBoundary name="章节执行">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('重新加载应用')).toBeTruthy()
  })

  it('未传 name 时错误标题不带页面名', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('页面出错了')).toBeTruthy()
  })
})
