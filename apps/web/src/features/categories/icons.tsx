import {
  Activity,
  Archive,
  AtSign,
  Atom,
  BarChart3,
  Bell,
  Book,
  BookOpen,
  Bookmark,
  Bot,
  Brain,
  Braces,
  Briefcase,
  Brush,
  Bug,
  Calculator,
  Camera,
  CircleUser,
  Clapperboard,
  Clock,
  Cloud,
  CloudUpload,
  Code,
  Coffee,
  Cpu,
  Database,
  FileCheck,
  FileCode,
  FileText,
  Film,
  Flag,
  Flame,
  FlaskConical,
  Folder,
  Gamepad2,
  Gauge,
  GitBranch,
  GitCommit,
  GitFork,
  GitMerge,
  Globe,
  GraduationCap,
  Hammer,
  Hash,
  Heart,
  Headphones,
  Home,
  Image,
  Key,
  LaptopMinimal,
  Leaf,
  Library,
  Lightbulb,
  LineChart,
  Link,
  Lock,
  MapPin,
  Mic,
  Moon,
  Music,
  Network,
  Newspaper,
  Package,
  Palette,
  PawPrint,
  Percent,
  PieChart,
  Pin,
  Plane,
  Puzzle,
  Radar,
  Rss,
  ScrollText,
  Server,
  Share2,
  Shield,
  ShoppingCart,
  Sigma,
  Sparkles,
  Star,
  StickyNote,
  Sun,
  Table,
  Tag,
  Terminal,
  TrendingUp,
  Utensils,
  Video,
  Wallet,
  Webhook,
  Wifi,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { CategoryIconKey } from '@git-nest/core'

/**
 * 分类图标：**名字 → 组件 + 中文名 + 搜索关键词**。
 *
 * 名字表住在 core（服务端据此校验），这里只负责「那个名字在界面上长什么样」。
 * 两张表靠 `icons.test.ts` 钉住一一对应——少一个，用户能选到但看不见；
 * 多一个，白占一行。
 *
 * 关键词是给搜索用的：**中文、英文、以及用户可能想到的词**都塞进去（「知识库」
 * 会搜到打开的书，是因为关键词里有它）。`label` 同时是那个按钮的可访问名字。
 *
 * 一张表而不是两张（组件一张、文案一张）：文案和组件分开写，迟早会各说各话。
 */
export const CATEGORY_ICONS: Record<
  CategoryIconKey,
  { Icon: LucideIcon; label: string; keywords: string }
> = {
  // 技术 / 开发
  code: { Icon: Code, label: '代码', keywords: 'code 源码 编程 开发' },
  terminal: { Icon: Terminal, label: '终端', keywords: 'terminal 命令行 shell 控制台' },
  'git-branch': { Icon: GitBranch, label: '分支', keywords: 'git branch 分支 版本' },
  'git-commit': { Icon: GitCommit, label: '提交', keywords: 'git commit 提交 记录' },
  'git-merge': { Icon: GitMerge, label: '合并', keywords: 'git merge 合并 拉取' },
  bug: { Icon: Bug, label: '缺陷', keywords: 'bug 缺陷 问题 调试' },
  cpu: { Icon: Cpu, label: '处理器', keywords: 'cpu 芯片 性能 硬件' },
  database: { Icon: Database, label: '数据库', keywords: 'database 数据库 db 存储' },
  server: { Icon: Server, label: '服务器', keywords: 'server 服务器 后端 主机' },
  package: { Icon: Package, label: '包', keywords: 'package 依赖 模块 npm' },
  wrench: { Icon: Wrench, label: '扳手', keywords: 'wrench 工具 维修 配置' },
  hammer: { Icon: Hammer, label: '锤子', keywords: 'hammer 构建 打造 工具' },
  puzzle: { Icon: Puzzle, label: '拼图', keywords: 'puzzle 插件 扩展 模块' },
  braces: { Icon: Braces, label: '花括号', keywords: 'braces 代码 语法 json' },
  'file-code': { Icon: FileCode, label: '代码文件', keywords: 'file code 源文件 脚本' },
  webhook: { Icon: Webhook, label: '钩子', keywords: 'webhook 钩子 回调 集成' },

  // 数据与图表
  'bar-chart-3': { Icon: BarChart3, label: '柱状图', keywords: 'bar chart 柱状图 统计 数据' },
  'line-chart': { Icon: LineChart, label: '折线图', keywords: 'line chart 折线图 趋势' },
  'pie-chart': { Icon: PieChart, label: '饼图', keywords: 'pie chart 饼图 占比' },
  activity: { Icon: Activity, label: '活跃度', keywords: 'activity 活跃 监控 波动' },
  'trending-up': { Icon: TrendingUp, label: '上升', keywords: 'trending up 增长 趋势 上升' },
  table: { Icon: Table, label: '表格', keywords: 'table 表格 数据 行列' },
  sigma: { Icon: Sigma, label: '求和', keywords: 'sigma 求和 数学 统计' },
  gauge: { Icon: Gauge, label: '仪表', keywords: 'gauge 仪表 速度 指标' },
  calculator: { Icon: Calculator, label: '计算器', keywords: 'calculator 计算 数学 账' },
  percent: { Icon: Percent, label: '百分比', keywords: 'percent 百分比 比例 率' },

  // AI 与算法
  brain: { Icon: Brain, label: '大脑', keywords: 'brain 大脑 智能 ai 模型' },
  sparkles: { Icon: Sparkles, label: '星光', keywords: 'sparkles 星光 生成 ai 魔法' },
  bot: { Icon: Bot, label: '机器人', keywords: 'bot 机器人 助手 agent' },
  network: { Icon: Network, label: '网络图', keywords: 'network 网络 关系 图' },
  workflow: { Icon: Workflow, label: '流程', keywords: 'workflow 流程 编排 管线' },
  'git-fork': { Icon: GitFork, label: '分叉', keywords: 'fork 分叉 派生 分支' },
  atom: { Icon: Atom, label: '原子', keywords: 'atom 原子 科学 物理' },
  radar: { Icon: Radar, label: '雷达', keywords: 'radar 雷达 扫描 探测' },
  'flask-conical': { Icon: FlaskConical, label: '锥形瓶', keywords: 'flask 实验 试验 化学' },

  // 文档与知识
  'book-open': { Icon: BookOpen, label: '打开的书', keywords: 'book open 知识库 文档 阅读' },
  book: { Icon: Book, label: '书', keywords: 'book 书 手册 教程' },
  library: { Icon: Library, label: '书架', keywords: 'library 书架 合集 知识库' },
  'file-text': { Icon: FileText, label: '文档', keywords: 'file text 文档 笔记 说明' },
  'sticky-note': { Icon: StickyNote, label: '便签', keywords: 'note 便签 备忘 随手记' },
  'graduation-cap': { Icon: GraduationCap, label: '学位帽', keywords: 'graduation 学习 课程 毕业' },
  lightbulb: { Icon: Lightbulb, label: '灯泡', keywords: 'idea 想法 灵感 点子' },
  newspaper: { Icon: Newspaper, label: '报纸', keywords: 'news 资讯 新闻 订阅' },
  bookmark: { Icon: Bookmark, label: '书签', keywords: 'bookmark 书签 收藏 待读' },
  'scroll-text': { Icon: ScrollText, label: '卷轴', keywords: 'scroll 卷轴 文稿 长文' },
  'file-check': { Icon: FileCheck, label: '已核对', keywords: 'check 核对 通过 完成' },

  // 媒体
  image: { Icon: Image, label: '图片', keywords: 'image 图片 图像 素材' },
  video: { Icon: Video, label: '视频', keywords: 'video 视频 录像 剪辑' },
  music: { Icon: Music, label: '音乐', keywords: 'music 音乐 音频 歌' },
  camera: { Icon: Camera, label: '相机', keywords: 'camera 相机 拍照 摄影' },
  mic: { Icon: Mic, label: '麦克风', keywords: 'mic 麦克风 录音 播客' },
  film: { Icon: Film, label: '胶片', keywords: 'film 胶片 电影 影视' },
  palette: { Icon: Palette, label: '调色板', keywords: 'palette 调色板 设计 配色' },
  brush: { Icon: Brush, label: '画笔', keywords: 'brush 画笔 绘画 设计' },
  clapperboard: { Icon: Clapperboard, label: '场记板', keywords: 'clapper 场记 影片 制作' },
  headphones: { Icon: Headphones, label: '耳机', keywords: 'headphones 耳机 听 音频' },

  // 网络与云
  cloud: { Icon: Cloud, label: '云', keywords: 'cloud 云 远端 存储' },
  'cloud-upload': { Icon: CloudUpload, label: '上传到云', keywords: 'upload 上传 同步 备份' },
  globe: { Icon: Globe, label: '地球', keywords: 'globe 地球 互联网 全球' },
  wifi: { Icon: Wifi, label: '无线', keywords: 'wifi 无线 网络 连接' },
  link: { Icon: Link, label: '链接', keywords: 'link 链接 地址 url' },
  'share-2': { Icon: Share2, label: '分享', keywords: 'share 分享 分发 传播' },
  rss: { Icon: Rss, label: '订阅源', keywords: 'rss 订阅 源 资讯' },
  shield: { Icon: Shield, label: '盾牌', keywords: 'shield 安全 防护 权限' },
  lock: { Icon: Lock, label: '锁', keywords: 'lock 锁 私密 加密' },
  key: { Icon: Key, label: '钥匙', keywords: 'key 钥匙 密钥 凭证' },

  // 符号与标记
  star: { Icon: Star, label: '星标', keywords: 'star 星标 收藏 重点' },
  heart: { Icon: Heart, label: '爱心', keywords: 'heart 喜欢 收藏 爱' },
  flag: { Icon: Flag, label: '旗标', keywords: 'flag 旗标 标记 里程碑' },
  tag: { Icon: Tag, label: '标签', keywords: 'tag 标签 分类 记号' },
  hash: { Icon: Hash, label: '井号', keywords: 'hash 井号 编号 话题' },
  'at-sign': { Icon: AtSign, label: '艾特', keywords: 'at 艾特 提及 邮箱' },
  zap: { Icon: Zap, label: '闪电', keywords: 'zap 闪电 快速 性能' },
  flame: { Icon: Flame, label: '火焰', keywords: 'flame 火 热门 热度' },
  bell: { Icon: Bell, label: '铃铛', keywords: 'bell 提醒 通知 订阅' },
  pin: { Icon: Pin, label: '图钉', keywords: 'pin 图钉 固定 置顶' },

  // 生活与杂项
  home: { Icon: Home, label: '房子', keywords: 'home 家 首页 房子' },
  briefcase: { Icon: Briefcase, label: '公文包', keywords: 'briefcase 工作 商务 项目' },
  'shopping-cart': { Icon: ShoppingCart, label: '购物车', keywords: 'cart 购物 买到 消费' },
  coffee: { Icon: Coffee, label: '咖啡', keywords: 'coffee 咖啡 休息 生活' },
  plane: { Icon: Plane, label: '飞机', keywords: 'plane 飞机 出行 旅行' },
  sun: { Icon: Sun, label: '太阳', keywords: 'sun 太阳 白天 明亮' },
  moon: { Icon: Moon, label: '月亮', keywords: 'moon 月亮 夜晚 暗色' },
  leaf: { Icon: Leaf, label: '叶子', keywords: 'leaf 叶子 自然 环保' },
  archive: { Icon: Archive, label: '归档箱', keywords: 'archive 归档 备份 存档' },
  folder: { Icon: Folder, label: '文件夹', keywords: 'folder 文件夹 目录 分类' },
  clock: { Icon: Clock, label: '时钟', keywords: 'clock 时间 历史 定时' },
  'map-pin': { Icon: MapPin, label: '定位', keywords: 'map pin 位置 地点 定位' },
  wallet: { Icon: Wallet, label: '钱包', keywords: 'wallet 钱包 账 花销' },
  utensils: { Icon: Utensils, label: '餐具', keywords: 'utensils 吃饭 美食 生活' },
  'paw-print': { Icon: PawPrint, label: '爪印', keywords: 'paw 爪印 宠物 动物' },
  'gamepad-2': { Icon: Gamepad2, label: '手柄', keywords: 'gamepad 游戏 手柄 娱乐' },
  laptop: { Icon: LaptopMinimal, label: '笔记本', keywords: 'laptop 笔记本 电脑 本机' },
  user: { Icon: CircleUser, label: '个人', keywords: 'user 个人 我自己 账号' },
}

/**
 * 按名字取组件。**认不出来返回 undefined**（调用方什么都不画）——
 * 不塞占位图：那会让人以为这个分类本来就有个图标。
 */
export function categoryIcon(key: string | null | undefined): LucideIcon | undefined {
  if (!key) return undefined
  return CATEGORY_ICONS[key as CategoryIconKey]?.Icon
}

/** 按名字取中文名（图标的可访问名字、搜索的显示项）。认不出来也返回 undefined。 */
export function categoryIconLabel(key: string | null | undefined): string | undefined {
  if (!key) return undefined
  return CATEGORY_ICONS[key as CategoryIconKey]?.label
}
