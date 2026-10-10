import { describe, expect, it } from 'vitest'
import { matchesType, normalizeIconName, typeIconUrl } from './typeIcons'

/**
 * 文件名与规则表的 `type` 怎么对上。
 *
 * 这一层存在的原因是**实际收来的文件名和规则表不一致**：收来的是一套成套图标，
 * 叫 `Vue.svg`、`React Native.svg`、`Chrome Extension.svg`（Title Case、带空格、
 * 有时还换个说法），而规则表里是 `vue`、`react-native`、`chrome` 这种 slug。
 * 不归一化的话，一张都对不上——规则再准，界面上也是空的。
 */
describe('typeIcons · 文件名怎么和规则表对上', () => {
  it('大小写与空格都不影响（这些都是实际收来的文件名）', () => {
    const pairs: [string, string][] = [
      ['Vue', 'vue'],
      ['React', 'react'],
      ['Nextjs', 'nextjs'],
      ['Nuxt', 'nuxt'],
      ['React Native', 'react-native'],
      ['IOS', 'ios'],
      ['Swift', 'swift'],
      ['WordPress', 'wordpress'],
      ['Remote', 'remote'],
      ['Tauri', 'tauri'],
      ['Android', 'android'],
      ['VS Code', 'vscode'],
    ]
    for (const [file, type] of pairs) {
      expect(matchesType(file, type), `${file} → ${type}`).toBe(true)
    }
  })

  it('归一化也接不上的两个，靠别名表（成套图标里它们叫「… Extension」）', () => {
    expect(matchesType('Chrome Extension', 'chrome')).toBe(true)
    expect(matchesType('VS Code Extension', 'vscode')).toBe(true)
  })

  it('**React 与 React Native 不能混**（归一化之后是 react 与 reactnative）', () => {
    expect(matchesType('React', 'react-native')).toBe(false)
    expect(matchesType('React Native', 'react')).toBe(false)
  })

  it('不相干的还是不相干', () => {
    expect(matchesType('Svelte', 'solid')).toBe(false)
    expect(matchesType('Unity', 'unreal')).toBe(false)
  })

  it('归一化只留字母数字', () => {
    expect(normalizeIconName('React Native')).toBe('reactnative')
    expect(normalizeIconName('C / C++')).toBe('cc')
  })

  it('对着**真实目录**再验一次：别名与空格那两条路真的能取到图', () => {
    /*
      这条读的是 `docs/types/` 里实际存在的文件（图标是仓库的一部分）。
      故意让它依赖真实文件：上一版的失败正是「规则对了、名字对不上、界面上全空」，
      而那件事**不报错**。宁可这条红。
    */
    expect(typeIconUrl('chrome')).not.toBeNull()
    expect(typeIconUrl('vscode')).not.toBeNull()
    expect(typeIconUrl('react-native')).not.toBeNull()
  })
})
