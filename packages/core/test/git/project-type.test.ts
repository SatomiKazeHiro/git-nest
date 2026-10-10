import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { detectProjectType, TYPE_RULES } from '../../src/git/project-type.ts'
import { PROJECT_TYPES } from '../../src/project-types.ts'
import { cleanup, tempDir } from '../helpers/repo.ts'

/**
 * 项目类型识别。
 *
 * 重点不在「认得出来」，而在**认对哪一个**：一个真实仓库几乎必然同时命中好几层
 * （Tauri 应用 = 壳 + Vue + TS；Django 项目 = manage.py + Python 文件），
 * 而界面上只有一个角标位。所以下面大半用例都在钉优先级。
 */

const dirs: string[] = []
const track = (dir: string) => (dirs.push(dir), dir)
afterAll(() => cleanup(...dirs))

/** 搭一个项目形状的目录（键可以带子目录）。 */
function project(files: Record<string, string>): string {
  const dir = track(tempDir())
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, data)
  }
  return dir
}

describe('detectProjectType · 优先级（一个仓库命中好几层时选哪个）', () => {
  it('Tauri 应用里也有 Vue 和 TS，但答案是 tauri', async () => {
    const dir = project({
      'src-tauri/tauri.conf.json': '{}',
      'src-tauri/Cargo.toml': '[package]\nname = "app"',
      'src/App.vue': '<template><div/></template>',
      'package.json': JSON.stringify({ dependencies: { vue: '^3' } }),
      'tsconfig.json': '{}',
    })
    expect(await detectProjectType(dir)).toBe('tauri')
  })

  it('Next.js 不该被判成 react', async () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { next: '^15', react: '^19' } }),
    })
    expect(await detectProjectType(dir)).toBe('nextjs')
  })

  it('全栈仓库：express 比 react 更说明问题（react 常见于只为渲染文档的仓库）', async () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { react: '^19', express: '^4' } }),
    })
    expect(await detectProjectType(dir)).toBe('express')
  })

  it('有 .vue 文件就是 Vue，不看 package.json（可能是别的框架的模板仓库）', async () => {
    const dir = project({ 'src/App.vue': '<template/>', 'tsconfig.json': '{}' })
    expect(await detectProjectType(dir)).toBe('vue')
  })

  it('Django 的 manage.py、Spring 的 spring-boot 依赖都比「语言」具体', async () => {
    expect(
      await detectProjectType(
        project({ 'manage.py': '#!/usr/bin/env python', 'app/models.py': '' }),
      ),
    ).toBe('django')
    expect(
      await detectProjectType(
        project({ 'pom.xml': '<artifactId>spring-boot-starter-parent</artifactId>' }),
      ),
    ).toBe('spring')
  })

  it('VS Code 扩展：package.json 里的 engines.vscode', async () => {
    const dir = project({ 'package.json': JSON.stringify({ engines: { vscode: '^1.90.0' } }) })
    expect(await detectProjectType(dir)).toBe('vscode')
  })
})

describe('detectProjectType · 必须读内容才能分的', () => {
  it('**manifest.json 是个共用名**：Chrome 扩展 vs PWA 清单', async () => {
    const chrome = project({
      'manifest.json': JSON.stringify({ manifest_version: 3, name: 'x' }),
      'background.js': '',
    })
    expect(await detectProjectType(chrome)).toBe('chrome')

    // PWA 清单没有 manifest_version：它不是扩展，也不该被当成任何一种类型
    const pwa = project({ 'manifest.json': JSON.stringify({ name: 'x', start_url: '/' }) })
    expect(await detectProjectType(pwa)).toBeNull()
  })

  it('Flutter 与纯 Dart 包分得开（两边都叫 pubspec.yaml）', async () => {
    const flutter = project({
      'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n',
    })
    expect(await detectProjectType(flutter)).toBe('flutter')

    const pure = project({ 'pubspec.yaml': 'name: pure_dart\n' })
    expect(await detectProjectType(pure)).toBe('dart')
  })

  it('ASP.NET 与普通 C# 分得开（都靠 .csproj，只是 SDK 不同）', async () => {
    expect(
      await detectProjectType(
        project({ 'App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' }),
      ),
    ).toBe('aspnet')
    expect(
      await detectProjectType(project({ 'App.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>' })),
    ).toBe('csharp')
  })

  it('游戏引擎', async () => {
    expect(
      await detectProjectType(project({ 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022' })),
    ).toBe('unity')
    expect(await detectProjectType(project({ 'project.godot': '[application]' }))).toBe('godot')
    expect(await detectProjectType(project({ 'Game.uproject': '{}' }))).toBe('unreal')
  })
})

describe('detectProjectType · 兜底与认不出来', () => {
  it('规则表与展示目录必须一致：规则认出来的 type，目录里得有它', () => {
    /*
      两处列表分在两个文件里（规则表要用 fs，只能待在 node-only 入口；
      目录要给 web 显示中文名），所以会漂。漂的后果很安静：规则认出来了，
      可图标文件按目录的名字找，界面上那个角标永远画不出来。
    */
    const known = new Set(PROJECT_TYPES.map((t) => t.type))
    for (const rule of TYPE_RULES) {
      expect(known.has(rule.type), `${rule.type} 不在 PROJECT_TYPES 里`).toBe(true)
    }
  })
  it('语言那一层', async () => {
    expect(await detectProjectType(project({ 'main.py': 'print(1)' }))).toBe('python')
    expect(await detectProjectType(project({ 'Cargo.toml': '[package]' }))).toBe('rust')
    expect(await detectProjectType(project({ 'go.mod': 'module x' }))).toBe('go')
    expect(await detectProjectType(project({ 'Gemfile': 'source "x"' }))).toBe('ruby')
    expect(await detectProjectType(project({ 'composer.json': '{}' }))).toBe('php')
    expect(await detectProjectType(project({ 'a.java': 'class A {}' }))).toBe('java')
    expect(await detectProjectType(project({ 'a.kt': 'fun main() {}' }))).toBe('kotlin')
    expect(await detectProjectType(project({ 'a.swift': 'import Foundation' }))).toBe('swift')
  })

  it('TS 与 JS 分得开（只差一个 tsconfig.json）', async () => {
    expect(await detectProjectType(project({ 'package.json': '{}', 'tsconfig.json': '{}' }))).toBe(
      'typescript',
    )
    expect(await detectProjectType(project({ 'package.json': '{}' }))).toBe('javascript')
  })

  it('领域那一层', async () => {
    expect(await detectProjectType(project({ 'main.tf': 'resource "x" "y" {}' }))).toBe('terraform')
    expect(await detectProjectType(project({ 'nb.ipynb': '{}' }))).toBe('jupyter')
    expect(await detectProjectType(project({ 'paper.tex': '\\documentclass{article}' }))).toBe('latex')
    expect(await detectProjectType(project({ 'platformio.ini': '[env:esp32]' }))).toBe('platformio')
    expect(await detectProjectType(project({ 'foundry.toml': '[profile]' }))).toBe('solidity')
  })

  it('认不出来就是 null——界面上不显示角标，不硬凑一个', async () => {
    expect(await detectProjectType(project({ 'README.md': '# 只是些笔记\n' }))).toBeNull()
  })

  it('目录不在了 → null，不抛', async () => {
    expect(await detectProjectType(path.join(tempDir(), '不存在'))).toBeNull()
  })

  it('大小写不敏感（Windows 上 Go.MOD 也是 go.mod）', async () => {
    expect(await detectProjectType(project({ 'Go.MOD': 'module x' }))).toBe('go')
  })
})
